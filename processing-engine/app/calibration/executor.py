# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Stage-3 fast-path executor (#1709 PR 5).

Runs ``Image3Pipeline`` on already-calibrated Level-2 ``_cal`` files from the
library, producing drizzled ``_i2d`` mosaics. Detector1/Image2 (full uncal
path) land in PR 6.

Security posture (requirement recorded in the plan, from the PR 3 review):
recipes/run overrides are scalar-only by schema, but scalar strings can be
file paths — so step NAMES are allowlisted per stage and parameter names/
values that smuggle filesystem references (``override_<ref>``, path-looking
strings) are rejected before anything reaches ``Pipeline.call``.

Cancellation is cooperative at stage boundaries: ``Pipeline.call`` is a
monolithic C-accelerated run we do not kill mid-flight in v1. A cancel
request is honored before the run starts and after it returns (outputs are
then discarded).
"""

import asyncio
import contextlib
import logging
import os
import re
import shutil
import threading
from pathlib import Path
from typing import Any

from app.calibration.models import CalibrationRecipe
from app.jobs.models import JobOutput, JobResult
from app.jobs.runner import JobCancelled, JobContext
from app.storage.factory import get_storage_provider
from app.storage.helpers import resolve_fits_path, validate_fits_file_size


logger = logging.getLogger(__name__)

# Steps the executor will pass through to each pipeline stage. Anything not
# listed is rejected — this is the executable-surface allowlist.
ALLOWED_STEPS: dict[str, frozenset[str]] = {
    "image3": frozenset(
        {"assign_mtwcs", "tweakreg", "skymatch", "outlier_detection", "resample", "source_catalog"}
    ),
}

# Run-control/behavior params the executor owns or that smuggle behavior:
# output_* / suffix / input_dir break workdir confinement (a bare relative
# output_dir resolves against process cwd, escaping the per-job rmtree);
# pre_hooks/post_hooks accept importable code references — never user-settable.
DENIED_PARAMS = frozenset(
    {
        "output_dir",
        "output_file",
        "output_use_index",
        "output_use_model",
        "save_results",
        "suffix",
        "input_dir",
        "pre_hooks",
        "post_hooks",
        "logcfg",
    }
)

MAX_CALIBRATION_INPUTS = int(os.environ.get("MAX_CALIBRATION_INPUTS", "50"))

OUTPUT_PREFIX = "calibration"


def _work_root() -> Path:
    return Path(os.environ.get("CALIBRATION_WORK_DIR", "/app/data/calibration-work"))


_semaphore: threading.BoundedSemaphore | None = None


def _get_semaphore() -> threading.BoundedSemaphore:
    # Plain single-stage gate: jobs queue in Mongo by design, so no 429
    # admission tier (unlike composite's synchronous request-scoped renders).
    global _semaphore
    if _semaphore is None:
        limit = int(os.environ.get("MAX_CONCURRENT_CALIBRATIONS", "1"))
        _semaphore = threading.BoundedSemaphore(max(1, limit))
    return _semaphore


class RecipeValidationError(ValueError):
    """A recipe/override combination the executor refuses to run."""


def _looks_like_path(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return (
        "/" in value
        or "\\" in value
        or value.startswith((".", "~"))
        or value.endswith((".fits", ".asdf", ".json"))
    )


def validate_step_overrides(stage_name: str, step_overrides: dict) -> None:
    """Enforce the executable-surface allowlist (see module docstring)."""
    allowed = ALLOWED_STEPS.get(stage_name)
    if allowed is None:
        raise RecipeValidationError(f"stage '{stage_name}' is not runnable yet")
    for step, params in step_overrides.items():
        if step not in allowed:
            raise RecipeValidationError(
                f"step '{step}' is not allowed in stage '{stage_name}' (allowed: {sorted(allowed)})"
            )
        for param, value in params.items():
            if param.startswith("override_"):
                raise RecipeValidationError(
                    f"step '{step}' param '{param}': reference-file overrides "
                    "are not allowed in recipes"
                )
            if param in DENIED_PARAMS:
                raise RecipeValidationError(
                    f"step '{step}' param '{param}': run-control parameters "
                    "are managed by the executor and cannot be overridden"
                )
            values = value if isinstance(value, list) else [value]
            for item in values:
                if _looks_like_path(item):
                    raise RecipeValidationError(
                        f"step '{step}' param '{param}': path-like values are "
                        "not allowed in recipes"
                    )


def merge_overrides(recipe_overrides: dict, run_overrides: dict) -> dict:
    """Run-time overrides win per parameter; both sides already validated."""
    merged: dict[str, dict] = {step: dict(params) for step, params in recipe_overrides.items()}
    for step, params in run_overrides.items():
        merged.setdefault(step, {}).update(params)
    return merged


def check_disk_floor(path: Path) -> None:
    floor_gb = float(os.environ.get("CALIBRATION_MIN_FREE_DISK_GB", "10"))
    free_gb = shutil.disk_usage(path).free / 1e9
    if free_gb < floor_gb:
        raise RecipeValidationError(
            f"insufficient disk space: {free_gb:.1f}GB free, {floor_gb:.0f}GB required (see #1713)"
        )


# stpipe logs step boundaries like:
#   "Step tweakreg running with args ..." / "Step tweakreg done"
_STEP_LINE = re.compile(r"Step (?P<step>\w+) (?P<event>running|done)")


class _JobLogHandler(logging.Handler):
    """Bridges stpipe/jwst log records into the job's log tail and step
    checklist. Best-effort: parsing misses only degrade the checklist.

    Lines are batched (flush every ``_BATCH_SIZE`` or on a step boundary) and
    capped per job — jwst pipelines emit thousands of INFO lines and each
    Mongo update op competes with the API event loop, so one chatty run must
    not flood the single-worker engine.
    """

    _BATCH_SIZE = 25
    _MAX_LINES = 2000

    def __init__(self, loop: asyncio.AbstractEventLoop, ctx: JobContext, steps: list[str]):
        super().__init__(level=logging.INFO)
        self._loop = loop
        self._ctx = ctx
        self._steps = steps
        self._buffer: list[str] = []
        self._sent = 0
        self._last_submission = None

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage()
        except Exception:
            return
        step_boundary = False
        match = _STEP_LINE.search(message)
        if match and match.group("step") in self._steps:
            step_boundary = True
            step, event = match.group("step"), match.group("event")
            self._submit(
                self._ctx.set_progress(
                    current_stage=f"image3:{step}",
                    message=f"{step} {'running' if event == 'running' else 'complete'}",
                )
            )
        if self._sent < self._MAX_LINES:
            self._buffer.append(message)
            self._sent += 1
            if self._sent == self._MAX_LINES:
                self._buffer.append("... log tail truncated (per-job line cap) ...")
        if self._buffer and (step_boundary or len(self._buffer) >= self._BATCH_SIZE):
            self._flush_buffer()

    def flush_remaining(self) -> None:
        self._flush_buffer()

    def _flush_buffer(self) -> None:
        if not self._buffer:
            return
        lines, self._buffer = self._buffer, []
        self._submit(self._ctx.log(*lines))

    def _submit(self, coro) -> None:
        # Handler runs on the pipeline worker thread; job store is async.
        # Chain on the previous submission so updates apply in emit order —
        # independent coroutines awaiting Mongo can otherwise complete out of
        # order and leave stale progress as the final state.
        previous = self._last_submission

        async def _chained():
            if previous is not None:
                # Failure already reported by the done callback.
                with contextlib.suppress(Exception):
                    await asyncio.wrap_future(previous)
            return await coro

        future = asyncio.run_coroutine_threadsafe(_chained(), self._loop)
        future.add_done_callback(_log_submit_failure)
        self._last_submission = future


def _log_submit_failure(future) -> None:
    exc = future.exception()
    if exc is not None:
        logger.warning("Job log/progress update failed: %s", exc)


def _run_image3_sync(
    input_paths: list[Path], steps: dict, product_name: str, workdir: Path
) -> None:
    """Blocking pipeline invocation — runs inside asyncio.to_thread."""
    from jwst.associations import asn_from_list
    from jwst.associations.lib.rules_level3_base import DMS_Level3_Base
    from jwst.pipeline import Image3Pipeline

    asn = asn_from_list.asn_from_list(
        [str(p) for p in input_paths], rule=DMS_Level3_Base, product_name=product_name
    )
    asn_path = workdir / "level3_asn.json"
    _, serialized = asn.dump(format="json")
    asn_path.write_text(serialized, encoding="utf-8")

    Image3Pipeline.call(
        str(asn_path),
        steps=steps,
        output_dir=str(workdir),
        save_results=True,
    )


async def run_stage3_job(
    ctx: JobContext,
    recipe: CalibrationRecipe,
    input_keys: list[str],
    run_overrides: dict,
) -> JobResult:
    """Job work function (see app/jobs/runner.py) for a stage-3-only run."""
    stage = next((s for s in recipe.stages if s.name == "image3" and s.enabled), None)
    if stage is None:
        raise RecipeValidationError("recipe has no enabled image3 stage")

    validate_step_overrides("image3", stage.step_overrides)
    validate_step_overrides("image3", run_overrides)
    steps = merge_overrides(stage.step_overrides, run_overrides)
    step_names = sorted(ALLOWED_STEPS["image3"])

    work_root = _work_root()
    work_root.mkdir(parents=True, exist_ok=True)
    check_disk_floor(work_root)

    if len(input_keys) > MAX_CALIBRATION_INPUTS:
        raise RecipeValidationError(
            f"too many inputs ({len(input_keys)} > {MAX_CALIBRATION_INPUTS})"
        )

    # Resolve inputs BEFORE claiming a run slot (fails fast on bad keys).
    # NOTE trust boundary: keys are only traversal-guarded — the library is
    # shared/public today and the engine has no per-user file ownership.
    # Per-user input authorization is tracked for when ownership lands.
    input_paths = [resolve_fits_path(key) for key in input_keys]
    for path in input_paths:
        validate_fits_file_size(path)

    workdir = work_root / ctx.job_id
    workdir.mkdir(parents=True, exist_ok=True)
    loop = asyncio.get_running_loop()
    handler = _JobLogHandler(loop, ctx, step_names)
    stpipe_logger = logging.getLogger("stpipe")

    await ctx.raise_if_cancelled()
    await ctx.set_progress(current_stage="image3", message="waiting for a run slot")

    semaphore = _get_semaphore()
    try:
        await asyncio.to_thread(semaphore.acquire)
        # Everything after a successful acquire sits inside this try so the
        # permit can never leak (a cancel/Mongo error in the pre-run window
        # would otherwise burn the only slot permanently).
        try:
            await ctx.raise_if_cancelled()
            await ctx.set_progress(current_stage="image3", message="running Image3Pipeline")
            # stpipe's logger inherits the root level; make sure INFO step
            # boundaries reach our handler, restoring the level afterwards.
            previous_level = stpipe_logger.level
            stpipe_logger.setLevel(logging.INFO)
            stpipe_logger.addHandler(handler)
            try:
                await asyncio.to_thread(
                    _run_image3_sync,
                    input_paths,
                    steps,
                    recipe.association.product_name,
                    workdir,
                )
            finally:
                stpipe_logger.removeHandler(handler)
                stpipe_logger.setLevel(previous_level)
                handler.flush_remaining()
        finally:
            semaphore.release()

        if await ctx.store.is_cancel_requested(ctx.job_id):
            raise JobCancelled()

        outputs = _persist_outputs(ctx.job_id, workdir, recipe.output_suffixes)
        if not outputs:
            raise RuntimeError(
                f"pipeline completed but produced no {recipe.output_suffixes} outputs"
            )
        log_key = _persist_log(ctx.job_id, workdir)
        return JobResult(
            outputs=outputs,
            log_key=log_key,
            jwst_version=_jwst_version(),
            crds_context=os.environ.get("CRDS_CONTEXT"),
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _persist_outputs(job_id: str, workdir: Path, suffixes: list[str]) -> list[JobOutput]:
    storage = get_storage_provider()
    outputs: list[JobOutput] = []
    for path in sorted(workdir.iterdir()):
        suffix = next((s for s in suffixes if path.stem.endswith(s)), None)
        if suffix is None or not path.is_file():
            continue
        key = f"{OUTPUT_PREFIX}/{job_id}/{path.name}"
        storage.write_from_path(key, path)
        outputs.append(JobOutput(storage_key=key, suffix=suffix, size_bytes=path.stat().st_size))
    return outputs


def _persist_log(job_id: str, workdir: Path) -> str | None:
    # Image3Pipeline writes its own log only when configured; the job log
    # tail (Mongo) is primary in v1. Persist any .log files found.
    for path in workdir.glob("*.log"):
        key = f"{OUTPUT_PREFIX}/{job_id}/{path.name}"
        get_storage_provider().write_from_path(key, path)
        return key
    return None


def _jwst_version() -> str | None:
    from app.calibration.flags import jwst_version

    return jwst_version()
