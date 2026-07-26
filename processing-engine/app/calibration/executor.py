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
import time
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

    Lines are batched (flush every ``_BATCH_SIZE`` lines, on a step boundary,
    or once ``_FLUSH_INTERVAL_S`` has passed) and capped per job — jwst
    pipelines emit thousands of INFO lines and each Mongo update op competes
    with the API event loop, so one chatty run must not flood the
    single-worker engine.

    Why the timer does not regress that: a real run measured ~3 log lines per
    minute inside a slow step, so a pure size-25 batch meant the job document
    sat unchanged for ~8 minutes and looked wedged. The interval only ever
    causes a write when there is something buffered, so it adds at most
    60/_FLUSH_INTERVAL_S = 2 writes per minute — negligible next to the
    hundreds per minute the batch cap is there to prevent. A chatty run still
    hits _BATCH_SIZE long before the interval expires, so its write rate is
    unchanged.

    The check is driven by ``emit``, so it only fires when a line arrives: it
    shortens the gap for a slow-but-talking step, but a step that logs NOTHING
    for twenty minutes would still leave the document frozen. That case is
    covered separately by :func:`_heartbeat` — the flush answers "show me the
    newest output", the heartbeat answers "is it alive at all", and conflating
    them would mean writing log batches on a timer for no new content.

    Known limit (pre-existing, unchanged here): the handler attaches to the
    process-global ``stpipe`` logger, so lines from an ORPHANED thread (a
    timed-out stage that cannot be killed) reach whichever handler is installed
    next, and MAX_CONCURRENT_CALIBRATIONS > 1 interleaves two runs' tails.
    ``_closed`` stops an orphan writing to its OWN job; full isolation needs
    per-run log routing (the same subprocess work the timeout path wants).
    Keep the concurrency limit at 1 until then.
    """

    _BATCH_SIZE = 25
    _MAX_LINES = 2000
    _FLUSH_INTERVAL_S = 30.0

    def __init__(self, loop: asyncio.AbstractEventLoop, ctx: JobContext, steps: list[str]):
        super().__init__(level=logging.INFO)
        self._loop = loop
        self._ctx = ctx
        self._steps = steps
        self._buffer: list[str] = []
        self._sent = 0
        self._last_submission = None
        self._last_flush = time.monotonic()
        self._closed = False
        # emit() runs on the pipeline worker thread while close()/drain() run
        # on the event loop; guard the buffer and the submission chain.
        self._guard = threading.RLock()
        # Updated by the stage loop; prefixes parsed step boundaries.
        self.current_stage = "run"

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage()
        except Exception:
            return
        try:
            self._emit(message)
        except Exception:
            # logging.Handler.handle does NOT wrap emit, so an exception here
            # would surface from inside stpipe's own log.info() call and get
            # blamed on jwst. Route it through the logging error path instead.
            self.handleError(record)

    def _emit(self, message: str) -> None:
        with self._guard:
            if self._closed:
                # An orphaned (timed-out) worker thread keeps logging; make
                # "it does nothing" explicit rather than emergent.
                return
            step_boundary = False
            match = _STEP_LINE.search(message)
            if match and match.group("step") in self._steps:
                step_boundary = True
                step, event = match.group("step"), match.group("event")
                self.submit(
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
            if self._buffer and (
                step_boundary
                or len(self._buffer) >= self._BATCH_SIZE
                or (time.monotonic() - self._last_flush) >= self._FLUSH_INTERVAL_S
            ):
                self._flush_buffer()

    def close_out(self) -> None:
        """Flush what's left and refuse further writes.

        A stage TIMEOUT leaves the jwst worker thread running (documented in the
        module docstring) and that thread still holds the per-file progress
        callback. Without this gate it would keep stamping ``updated_at`` on an
        already-failed job, which would read in the UI as "failed 20 minutes
        ago, last update 3 seconds ago".
        """
        with self._guard:
            self._flush_buffer()
            self._closed = True

    async def drain(self) -> None:
        """Wait for queued log/progress writes to land.

        The stage loop writes progress directly on the event loop while this
        handler queues writes from the worker thread. Without a drain, a
        queued "file 3 of 4" could complete AFTER the stage loop's newer
        update and resurrect a position the run has already moved past.
        """
        future = self._last_submission
        if future is None:
            return
        # asyncio.wait() rather than a bare await: waiting NEVER re-raises the
        # awaited future's own failure or cancellation (so a cancelled queued
        # write can't escape into the stage loop and be misread as engine
        # shutdown), but cancellation delivered to THIS task still propagates.
        # A try/except around `await future` cannot tell those two apart, and
        # swallowing the second one would skip the runner's interrupted
        # bookkeeping entirely — cancellation is delivered once, with no
        # second chance. Failures are reported by the submission's callback.
        await asyncio.wait({asyncio.wrap_future(future)})

    def _flush_buffer(self) -> None:
        # Stamp unconditionally: a no-op flush still means "we checked just
        # now", so an empty buffer must not leave the interval permanently due.
        self._last_flush = time.monotonic()
        if not self._buffer:
            return
        lines, self._buffer = self._buffer, []
        self.submit(self._ctx.log(*lines))

    def submit(self, coro) -> None:
        # Handler runs on the pipeline worker thread; job store is async.
        # Chain on the previous submission so updates apply in emit order —
        # independent coroutines awaiting Mongo can otherwise complete out of
        # order and leave stale progress as the final state.
        with self._guard:
            if self._closed:
                coro.close()
                return
            previous = self._last_submission

            async def _chained():
                try:
                    if previous is not None:
                        # BaseException, not Exception: if a predecessor is
                        # cancelled (loop teardown), every LATER write would
                        # otherwise be dropped too and the job would go
                        # permanently silent — the exact failure this whole
                        # change exists to prevent.
                        with contextlib.suppress(BaseException):
                            await asyncio.wrap_future(previous)
                    return await coro
                except BaseException:
                    # Never leave an un-awaited coroutine behind.
                    coro.close()
                    raise

            chained = _chained()
            try:
                future = asyncio.run_coroutine_threadsafe(chained, self._loop)
            except RuntimeError:
                # Loop already closed (shutdown). Close both coroutines rather
                # than leaving "never awaited" warnings, and let the caller —
                # a jwst worker thread — continue undisturbed.
                chained.close()
                coro.close()
                return
            # Deliberately NOT closing the coroutines from a done callback on
            # cancellation: run_coroutine_threadsafe's future stays PENDING for
            # the coroutine's whole life, so cancel() fires the callback while
            # the wrapping task is still alive and merely *requested* to stop.
            # Closing there throws GeneratorExit into a coroutine the loop is
            # about to resume ("cannot reuse already awaited coroutine") on
            # exactly the shutdown path this change makes legible. _chained
            # closes `coro` itself on the way out; the only residue in the
            # never-started case is a RuntimeWarning.
            future.add_done_callback(_log_submit_failure)
            self._last_submission = future


def _log_submit_failure(future) -> None:
    # Future.exception() RAISES on a cancelled future rather than returning —
    # unguarded, that blows up inside the loop's callback dispatch on exactly
    # the shutdown path this change is trying to make legible.
    if future.cancelled():
        logger.debug("Job log/progress update cancelled (engine shutting down?)")
        return
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
    stage_name: str, input_paths: list[Path], steps: dict, workdir: Path, progress_callback=None
) -> None:
    """Blocking Detector1/Image2 invocation, one file at a time.

    ``progress_callback(index, total, filename)`` is invoked with a 1-based
    index BEFORE each file starts — the interesting question during an 8-minute
    silence is "what is it chewing on now", not "what did it finish".
    """
    from jwst.pipeline import Detector1Pipeline, Image2Pipeline

    pipeline_cls = {"detector1": Detector1Pipeline, "image2": Image2Pipeline}[stage_name]
    total = len(input_paths)
    for index, path in enumerate(input_paths, start=1):
        if progress_callback:
            progress_callback(index, total, path.name)
        pipeline_cls.call(
            str(path),
            steps=steps,
            output_dir=str(workdir),
            save_results=True,
        )


def _file_progress(handler: _JobLogHandler, ctx: JobContext, stage_name: str):
    """Per-file progress reporter for a stage that iterates its inputs.

    Returned callback runs on the pipeline WORKER thread, so it hands the
    coroutine to the handler's ordered submission queue rather than scheduling
    an independent one: progress updates and log lines then land in emit order,
    and a slow write can't leave a stale "file 1 of 4" as the final state.
    """

    def _report(index: int, total: int, filename: str) -> None:
        handler.submit(
            ctx.set_progress(
                current_file=index,
                total_files=total,
                message=f"{stage_name}: file {index} of {total} ({filename})",
            )
        )

    return _report


def _heartbeat_seconds() -> float:
    return float(os.environ.get("CALIBRATION_HEARTBEAT_S", "30"))


async def _heartbeat(ctx: JobContext) -> None:
    """Stamp ``updated_at`` on a fixed interval for as long as the run lives.

    Without this, "last update N min ago" is only as good as the pipeline's
    chattiness: a stage can run for many minutes in silence, and a wedged run
    and a working one produce byte-identical documents — the complaint this
    whole change answers.

    Cost is bounded and tiny: one task per run (at most one run at
    MAX_CONCURRENT_CALIBRATIONS=1), 2 writes/min, and the loop is otherwise
    idle because the pipeline itself runs in a worker thread. Errors are
    logged, never raised — a failed heartbeat must not fail the run.
    """
    interval = _heartbeat_seconds()
    while True:
        await asyncio.sleep(interval)
        try:
            await ctx.store.touch(ctx.job_id)
        except Exception as exc:  # noqa: BLE001 -- liveness is best-effort
            logger.warning("Job %s: heartbeat failed: %s", ctx.job_id, exc)


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

    # Runs for the whole job — download, queue wait and pipeline alike are all
    # capable of long silences. Cancelled in the finally below.
    heartbeat = asyncio.create_task(_heartbeat(ctx), name=f"heartbeat-{ctx.job_id}")

    try:
        await ctx.raise_if_cancelled()
        stage_list = [{"name": s.name, "status": "pending"} for s in stages]
        await ctx.set_progress(stages=stage_list, message="preparing inputs")

        if input_keys:
            # Library inputs. These keys are NOT client input: the route derives
            # each one from a library document the caller is authorized to read
            # (app/calibration/inputs.py, #1751), and raw keys in the request
            # body are rejected. resolve_fits_path stays as defence in depth.
            # Do not reintroduce a path that lets a caller supply a key.
            input_paths = [resolve_fits_path(key) for key in input_keys]
        else:
            input_paths = await _download_inputs(ctx, recipe, workdir)
        for path in input_paths:
            validate_fits_file_size(path)

        await ctx.set_progress(message="waiting for a run slot")
        semaphore = _get_semaphore()
        await asyncio.to_thread(semaphore.acquire)
        release_permit = True
        # Everything after a successful acquire sits inside this try so a
        # cancel/Mongo error in the pre-run window can't burn the only slot.
        # NOT airtight: semaphore.acquire runs in a thread and is itself
        # uncancellable, so a cancel delivered while parked there leaves the
        # thread to take the permit with nobody left to release it. Bounded by
        # the same restart that frees a timed-out stage's permit; the real fix
        # is the tracked subprocess-isolation work.
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
                    combining = stage.name == "image3"
                    await ctx.set_progress(
                        stages=stage_list,
                        current_stage=stage.name,
                        message=(
                            f"{stage.name}: combining {len(current)} file(s)"
                            if combining
                            else f"running {stage.name}"
                        ),
                        # Clear any position carried over from the previous
                        # stage; the per-file callback republishes it below.
                        current_file=None,
                        total_files=len(current),
                    )
                    current = await asyncio.wait_for(
                        _stage_call(
                            stage.name,
                            current,
                            merged_by_stage[stage.name],
                            recipe,
                            workdir,
                            None if combining else _file_progress(handler, ctx, stage.name),
                        ),
                        timeout=_stage_timeout_seconds(),
                    )
                    # Let the worker thread's queued writes land before this
                    # loop writes newer progress over them.
                    await handler.drain()
                    stage_list[index]["status"] = "done"
                    await ctx.set_progress(stages=stage_list)
                # The chain is over; no file is in flight any more.
                await ctx.set_progress(current_file=None, total_files=None)
            except TimeoutError as exc:
                # Only OUR deadline reaches here (_stage_call re-labels
                # timeouts raised from inside the pipeline). asyncio.wait_for
                # cannot kill the worker thread: the jwst run is STILL
                # consuming the slot's CPU/RAM. Keep the permit so
                # MAX_CONCURRENT_CALIBRATIONS keeps bounding memory; the slot
                # frees on engine restart. Subprocess isolation is the real
                # fix (tracked follow-up).
                release_permit = False
                logger.error(
                    "Job %s: stage timed out; permit retained (orphaned pipeline thread)",
                    ctx.job_id,
                )
                # A bare TimeoutError stringifies to "", which would reach the
                # UI as "Run failed:" with no reason. Say what timed out.
                raise TimeoutError(
                    f"stage {stage.name} exceeded the "
                    f"{_stage_timeout_seconds():.0f}s limit (CALIBRATION_TIMEOUT_S)"
                ) from exc
            finally:
                stpipe_logger.removeHandler(handler)
                stpipe_logger.setLevel(previous_level)
                # Flush, then refuse further writes (an orphaned timed-out
                # thread must not keep touching a terminal job), then wait for
                # the queue so the last log lines land BEFORE finished_at.
                handler.close_out()
                await handler.drain()
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
        # cancel() only — never awaited: this finally can run while our own
        # task is being cancelled, and awaiting here would surrender control
        # before the workdir is cleaned up.
        heartbeat.cancel()
        shutil.rmtree(workdir, ignore_errors=True)


# Backward-compatible name used by the run route/tests since PR 5.
run_stage3_job = run_calibration_job


async def _stage_call(stage_name: str, *args) -> list[Path]:
    """``_run_stage`` with inner timeouts re-labelled.

    Since 3.11 the builtin ``TimeoutError`` IS ``asyncio.TimeoutError`` and is
    an ``OSError`` subclass, so a socket/CRDS timeout raised inside the worker
    thread is otherwise indistinguishable from our own ``wait_for`` deadline —
    and the deadline handler permanently retires the concurrency permit. With
    MAX_CONCURRENT_CALIBRATIONS=1 that wedges every later calibration over a
    transient network blip, so the two cases must not share a type.
    """
    try:
        return await _run_stage(stage_name, *args)
    except TimeoutError as exc:
        raise RuntimeError(f"stage {stage_name} failed: timed out ({exc})") from exc


async def _run_stage(
    stage_name: str,
    input_paths: list[Path],
    steps: dict,
    recipe: CalibrationRecipe,
    workdir: Path,
    progress_callback=None,
) -> list[Path]:
    """Run one stage in a worker thread; return the next stage's inputs."""
    if stage_name == "image3":
        # No per-file callback by design: Image3Pipeline consumes the whole
        # association in ONE call, so there is no file it is "on". Claiming
        # "file 1 of 4" here would be a fabricated position; the caller has
        # already published total_files with current_file cleared to null,
        # which honestly reads as "combining 4 files".
        await asyncio.to_thread(
            _run_image3_sync, input_paths, steps, recipe.association.product_name, workdir
        )
        return input_paths  # terminal stage; outputs collected by suffix later
    await asyncio.to_thread(
        _run_per_file_stage_sync, stage_name, input_paths, steps, workdir, progress_callback
    )
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

    # Chained like _JobLogHandler.submit: these updates come off the download
    # worker thread, and independent coroutines awaiting Mongo can complete out
    # of order — which would leave "file 1 of 2 / 50%" as the final state after
    # the download actually finished.
    last: Any = None

    def _progress(filename: str, current: int, total: int) -> None:
        nonlocal last
        pct = round(100.0 * current / max(total, 1), 1)
        # `current` is a 0-based "files completed" count; the wire field is a
        # 1-based position, capped so the terminal ("done", total, total) call
        # doesn't report file N+1 of N.
        previous = last

        async def _chained() -> None:
            if previous is not None:
                # BaseException, not Exception: a cancelled predecessor must
                # not silently drop every later download update.
                with contextlib.suppress(BaseException):
                    await asyncio.wrap_future(previous)
            await ctx.set_progress(
                download_pct=pct,
                message=f"downloading {filename}",
                current_file=min(current + 1, total) if total else None,
                total_files=total or None,
            )

        chained = _chained()
        try:
            last = asyncio.run_coroutine_threadsafe(chained, loop)
        except RuntimeError:
            # Loop already closed (shutdown). Close the coroutine rather than
            # raising into the download worker thread.
            chained.close()

    paths = await asyncio.to_thread(
        _download_mast_inputs_sync, recipe.input_source, workdir / "inputs", _progress
    )
    # Drain before returning: an update still in flight would otherwise land
    # after the stage loop's first write and resurrect a stale position.
    # asyncio.wait for the same reason as _JobLogHandler.drain — a cancelled
    # queued write must not escape, but cancellation of THIS task must.
    if last is not None:
        await asyncio.wait({asyncio.wrap_future(last)})
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
