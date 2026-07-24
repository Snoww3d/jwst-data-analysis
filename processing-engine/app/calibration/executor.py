# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Calibration executor (#1709 PRs 5-6).

Runs a recipe's enabled stage chain: the stage-3 fast path (``Image3Pipeline``
on library ``_cal`` files → drizzled ``_i2d`` mosaics) or the full
``Detector1 → Image2 → Image3`` reduction from raw ``_uncal`` files fetched
via the recipe's MAST query. Each stage runs under a per-stage timeout
(``CALIBRATION_TIMEOUT_S``); file handoff between stages is by suffix
(``_uncal`` → ``_rate`` → ``_cal`` → ``_i2d``) inside the per-job workdir.

Security posture (requirement recorded in the plan, from the PR 3 review):
recipes/run overrides are scalar-only by schema, but scalar strings can be
file paths — so step NAMES are allowlisted per stage and parameter names/
values that smuggle filesystem references (``override_<ref>``, path-looking
strings) are rejected before anything reaches ``Pipeline.call``.

Cancellation is cooperative at stage boundaries: ``Pipeline.call`` is a
monolithic C-accelerated run we do not kill mid-flight in v1. A cancel
request is honored before the run starts and after it returns (outputs are
then discarded). A stage TIMEOUT likewise cannot kill the worker thread —
the job fails but the orphaned thread keeps the concurrency permit (held,
not released) so MAX_CONCURRENT_CALIBRATIONS still bounds memory; the slot
frees on engine restart. Subprocess isolation is the tracked long-term fix.
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
# listed is rejected — this is the executable-surface allowlist. Flat run
# overrides are applied to EVERY enabled stage that allows the step (only
# "resample" exists in two stages; its params are stage-appropriate either way).
ALLOWED_STEPS: dict[str, frozenset[str]] = {
    "detector1": frozenset(
        {
            "group_scale",
            "dq_init",
            "emicorr",
            "saturation",
            "ipc",
            "superbias",
            "refpix",
            "rscd",
            "firstframe",
            "lastframe",
            "linearity",
            "dark_current",
            "reset",
            "persistence",
            "charge_migration",
            "jump",
            "clean_flicker_noise",
            "ramp_fit",
            "gain_scale",
        }
    ),
    "image2": frozenset({"bkg_subtract", "assign_wcs", "flat_field", "photom", "resample"}),
    "image3": frozenset(
        {"assign_mtwcs", "tweakreg", "skymatch", "outlier_detection", "resample", "source_catalog"}
    ),
}

# Intermediate products each stage consumes/produces (file handoff).
_STAGE_INPUT_SUFFIX = {"detector1": "_uncal", "image2": "_rate", "image3": "_cal"}
_RUNNABLE_STAGES = ("detector1", "image2", "image3")

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
        # Updated by the stage loop; prefixes parsed step boundaries.
        self.current_stage = "run"

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
                    current_stage=f"{self.current_stage}:{step}",
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


def _run_per_file_stage_sync(
    stage_name: str, input_paths: list[Path], steps: dict, workdir: Path
) -> None:
    """Blocking Detector1/Image2 invocation, one file at a time."""
    from jwst.pipeline import Detector1Pipeline, Image2Pipeline

    pipeline_cls = {"detector1": Detector1Pipeline, "image2": Image2Pipeline}[stage_name]
    for path in input_paths:
        pipeline_cls.call(
            str(path),
            steps=steps,
            output_dir=str(workdir),
            save_results=True,
        )


def _stage_timeout_seconds() -> float:
    # Relaxed-threshold posture (like the CE render timeout): generous
    # per-stage ceiling so slow-but-progressing runs aren't killed.
    return float(os.environ.get("CALIBRATION_TIMEOUT_S", "14400"))


def _download_mast_inputs_sync(query, dest: Path, progress_callback=None) -> list[Path]:
    """Download the recipe's MAST inputs (JWPipeNB idiom): query by proposal
    (+observation), filter products by suffix/calib level, download per file."""
    from astroquery.mast import Observations

    criteria: dict[str, Any] = {"proposal_id": query.proposal_id, "obs_collection": "JWST"}
    if query.filters:
        criteria["filters"] = list(query.filters)
    obs_table = Observations.query_criteria(**criteria)
    if query.observation:
        # JWST obs_ids embed the observation as "-oNNN" (e.g. jw02739-o001_...).
        token = f"-o{query.observation.zfill(3)}"
        mask = [token in str(row) for row in obs_table["obs_id"]]
        obs_table = obs_table[mask]
    if len(obs_table) == 0:
        raise RecipeValidationError("no MAST observations matched the recipe query")

    products = Observations.get_product_list(obs_table)
    sub_groups = [s.lstrip("_").upper() for s in query.product_suffixes]
    filtered = Observations.filter_products(
        products,
        productSubGroupDescription=sub_groups,
        calib_level=[query.calib_level],
    )
    if len(filtered) == 0:
        raise RecipeValidationError("no MAST products matched the recipe query")
    if len(filtered) > MAX_CALIBRATION_INPUTS:
        raise RecipeValidationError(
            f"MAST query matched too many products ({len(filtered)} > {MAX_CALIBRATION_INPUTS})"
        )

    from app.storage.helpers import MAX_FITS_FILE_SIZE_BYTES

    oversized = [
        str(p["productFilename"])
        for p in filtered
        if int(p["size"] or 0) > MAX_FITS_FILE_SIZE_BYTES
    ]
    if oversized:
        raise RecipeValidationError(
            f"products exceed MAX_FITS_FILE_SIZE_MB before download: {oversized[:3]}"
        )

    dest.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    total = len(filtered)
    for index, product in enumerate(filtered):
        if progress_callback:
            progress_callback(str(product["productFilename"]), index, total)
        manifest = Observations.download_products(
            filtered[index : index + 1], download_dir=str(dest)
        )
        paths.extend(Path(p) for p in manifest["Local Path"])
    if progress_callback:
        progress_callback("done", total, total)
    return paths


def _enabled_stages(recipe: CalibrationRecipe) -> list:
    stages = [s for s in recipe.stages if s.enabled and s.name in _RUNNABLE_STAGES]
    if not stages:
        raise RecipeValidationError("recipe has no enabled runnable stages")
    return stages


def _assign_run_overrides(stages: list, run_overrides: dict) -> dict[str, dict]:
    """Assign flat run overrides to every enabled stage that allows the step;
    reject steps no enabled stage accepts."""
    per_stage: dict[str, dict] = {s.name: {} for s in stages}
    for step, params in run_overrides.items():
        matched = False
        for stage in stages:
            if step in ALLOWED_STEPS[stage.name]:
                per_stage[stage.name][step] = params
                matched = True
        if not matched:
            raise RecipeValidationError(f"step '{step}' is not allowed in any enabled stage")
    return per_stage


async def run_calibration_job(
    ctx: JobContext,
    recipe: CalibrationRecipe,
    input_keys: list[str],
    run_overrides: dict,
) -> JobResult:
    """Job work function (see app/jobs/runner.py): runs the recipe's enabled
    stage chain. Inputs come from library storage keys when given, otherwise
    from the recipe's MAST query (downloaded into the job workdir)."""
    stages = _enabled_stages(recipe)
    per_stage_run = _assign_run_overrides(stages, run_overrides)
    merged_by_stage: dict[str, dict] = {}
    all_step_names: set[str] = set()
    for stage in stages:
        validate_step_overrides(stage.name, stage.step_overrides)
        validate_step_overrides(stage.name, per_stage_run[stage.name])
        merged_by_stage[stage.name] = merge_overrides(
            stage.step_overrides, per_stage_run[stage.name]
        )
        all_step_names.update(ALLOWED_STEPS[stage.name])

    work_root = _work_root()
    work_root.mkdir(parents=True, exist_ok=True)
    check_disk_floor(work_root)

    if len(input_keys) > MAX_CALIBRATION_INPUTS:
        raise RecipeValidationError(
            f"too many inputs ({len(input_keys)} > {MAX_CALIBRATION_INPUTS})"
        )

    workdir = work_root / ctx.job_id
    workdir.mkdir(parents=True, exist_ok=True)
    loop = asyncio.get_running_loop()
    handler = _JobLogHandler(loop, ctx, sorted(all_step_names))
    stpipe_logger = logging.getLogger("stpipe")

    try:
        await ctx.raise_if_cancelled()
        stage_list = [{"name": s.name, "status": "pending"} for s in stages]
        await ctx.set_progress(stages=stage_list, message="preparing inputs")

        if input_keys:
            # Library inputs. NOTE trust boundary: keys are only
            # traversal-guarded — the library is shared/public today and the
            # engine has no per-user file ownership (#1719).
            input_paths = [resolve_fits_path(key) for key in input_keys]
        else:
            input_paths = await _download_inputs(ctx, recipe, workdir)
        for path in input_paths:
            validate_fits_file_size(path)

        await ctx.set_progress(message="waiting for a run slot")
        semaphore = _get_semaphore()
        await asyncio.to_thread(semaphore.acquire)
        release_permit = True
        # Everything after a successful acquire sits inside this try so the
        # permit can never leak (a cancel/Mongo error in the pre-run window
        # would otherwise burn the only slot permanently).
        try:
            # stpipe's logger inherits the root level; make sure INFO step
            # boundaries reach our handler, restoring the level afterwards.
            previous_level = stpipe_logger.level
            stpipe_logger.setLevel(logging.INFO)
            stpipe_logger.addHandler(handler)
            try:
                current = input_paths
                for index, stage in enumerate(stages):
                    await ctx.raise_if_cancelled()
                    handler.current_stage = stage.name
                    stage_list[index]["status"] = "running"
                    await ctx.set_progress(
                        stages=stage_list,
                        current_stage=stage.name,
                        message=f"running {stage.name}",
                    )
                    current = await asyncio.wait_for(
                        _run_stage(
                            stage.name,
                            current,
                            merged_by_stage[stage.name],
                            recipe,
                            workdir,
                        ),
                        timeout=_stage_timeout_seconds(),
                    )
                    stage_list[index]["status"] = "done"
                    await ctx.set_progress(stages=stage_list)
            except TimeoutError:
                # asyncio.wait_for cannot kill the worker thread: the jwst run
                # is STILL consuming the slot's CPU/RAM. Keep the permit so
                # MAX_CONCURRENT_CALIBRATIONS keeps bounding memory; the slot
                # frees on engine restart. Subprocess isolation is the real
                # fix (tracked follow-up).
                release_permit = False
                logger.error(
                    "Job %s: stage timed out; permit retained (orphaned pipeline thread)",
                    ctx.job_id,
                )
                raise
            finally:
                stpipe_logger.removeHandler(handler)
                stpipe_logger.setLevel(previous_level)
                handler.flush_remaining()
        finally:
            if release_permit:
                semaphore.release()

        if await ctx.store.is_cancel_requested(ctx.job_id):
            raise JobCancelled()

        # Scope persistence to the terminal stage's products: in the full
        # chain Image2 also emits per-exposure _i2d files into the workdir,
        # which are intermediates, not the recipe's declared output.
        terminal = stages[-1].name
        prefix = recipe.association.product_name if terminal == "image3" else None
        outputs = _persist_outputs(ctx.job_id, workdir, recipe.output_suffixes, name_prefix=prefix)
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


# Backward-compatible name used by the run route/tests since PR 5.
run_stage3_job = run_calibration_job


async def _run_stage(
    stage_name: str,
    input_paths: list[Path],
    steps: dict,
    recipe: CalibrationRecipe,
    workdir: Path,
) -> list[Path]:
    """Run one stage in a worker thread; return the next stage's inputs."""
    if stage_name == "image3":
        await asyncio.to_thread(
            _run_image3_sync, input_paths, steps, recipe.association.product_name, workdir
        )
        return input_paths  # terminal stage; outputs collected by suffix later
    await asyncio.to_thread(_run_per_file_stage_sync, stage_name, input_paths, steps, workdir)
    produced_suffix = {"detector1": "_rate", "image2": "_cal"}[stage_name]
    produced = sorted(
        p for p in workdir.iterdir() if p.is_file() and p.stem.endswith(produced_suffix)
    )
    if not produced:
        raise RuntimeError(f"stage {stage_name} produced no {produced_suffix} files")
    return produced


async def _download_inputs(ctx: JobContext, recipe: CalibrationRecipe, workdir: Path) -> list[Path]:
    if recipe.input_source.type != "mast_query":
        raise RecipeValidationError("recipe expects library inputs but none were provided")
    from app.jobs.models import JobStatus

    await ctx.set_status(JobStatus.DOWNLOADING)
    loop = asyncio.get_running_loop()

    def _progress(filename: str, current: int, total: int) -> None:
        pct = round(100.0 * current / max(total, 1), 1)
        asyncio.run_coroutine_threadsafe(
            ctx.set_progress(download_pct=pct, message=f"downloading {filename}"),
            loop,
        )

    paths = await asyncio.to_thread(
        _download_mast_inputs_sync, recipe.input_source, workdir / "inputs", _progress
    )
    await ctx.set_status(JobStatus.RUNNING)
    return paths


def _persist_outputs(
    job_id: str, workdir: Path, suffixes: list[str], name_prefix: str | None = None
) -> list[JobOutput]:
    storage = get_storage_provider()
    outputs: list[JobOutput] = []
    for path in sorted(workdir.iterdir()):
        suffix = next((s for s in suffixes if path.stem.endswith(s)), None)
        if suffix is None or not path.is_file():
            continue
        if name_prefix is not None and not path.name.startswith(name_prefix):
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
