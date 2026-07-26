# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Background job execution wrapper.

Fire-and-forget ``asyncio`` task in the style of the MAST download worker
(``app/mast/routes.py``), but with all state persisted through the
:class:`~app.jobs.store.JobStore` so status survives request boundaries.

SINGLE-WORKER REQUIREMENT: jobs execute as in-process asyncio tasks and
startup reconciliation fails ALL active jobs, so the engine must run with
exactly one uvicorn worker (the Dockerfile's ``--workers 1``). A multi-worker
deployment needs an external queue first.
"""

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable

from app.jobs.models import JobRecord, JobResult, JobStatus
from app.jobs.store import JobStore


logger = logging.getLogger(__name__)


class JobCancelled(Exception):
    """Raised by job work when it observes a cancel request."""


class JobContext:
    """Handle passed to job work for progress/cancellation interaction."""

    def __init__(self, store: JobStore, job_id: str):
        self.store = store
        self.job_id = job_id

    async def log(self, *lines: str) -> None:
        await self.store.append_log(self.job_id, *lines)

    async def set_progress(self, **kwargs) -> None:
        await self.store.set_progress(self.job_id, **kwargs)

    async def set_status(self, status: JobStatus) -> None:
        await self.store.set_status(self.job_id, status)

    async def raise_if_cancelled(self) -> None:
        """Call at safe boundaries (stage transitions, download chunks)."""
        if await self.store.is_cancel_requested(self.job_id):
            raise JobCancelled()


JobWork = Callable[[JobContext], Awaitable[JobResult]]

# Strong references so fire-and-forget tasks aren't garbage-collected mid-run.
_running_tasks: set[asyncio.Task] = set()


async def _run(store: JobStore, job_id: str, work: JobWork) -> None:
    ctx = JobContext(store, job_id)
    try:
        await store.set_status(job_id, JobStatus.RUNNING)
        result = await work(ctx)
        await store.mark_succeeded(job_id, result)
    except JobCancelled:
        logger.info("Job %s cancelled", job_id)
        await store.mark_cancelled(job_id)
    except asyncio.CancelledError:
        # Two different events land here, and the user deserves to be told
        # which: work that observed a USER cancel raises JobCancelled above, so
        # a raw CancelledError is almost always the event loop being torn down
        # (engine restart). cancel_requested is the signal that separates them —
        # if it is False, nobody asked for this and "cancelled" would be a lie.
        #
        # Every await here is shielded and every failure suppressed, including
        # CancelledError (hence BaseException): the task is already cancelling
        # and a second cancel() delivery would otherwise abort the bookkeeping
        # mid-way. The shielded inner task survives that delivery and can still
        # land its write; if it doesn't, startup reconciliation catches the job
        # (still in an active status) and applies the same status/error. A
        # "Task was destroyed but it is pending" warning on shutdown is that
        # trade-off working as intended, not a leak.
        cancel_requested = False
        with contextlib.suppress(BaseException):
            cancel_requested = await asyncio.shield(store.is_cancel_requested(job_id))
        with contextlib.suppress(BaseException):
            if cancel_requested:
                await asyncio.shield(store.mark_cancelled(job_id))
            else:
                logger.warning("Job %s interrupted by engine shutdown", job_id)
                await asyncio.shield(store.mark_interrupted(job_id))
        raise
    except Exception as exc:
        logger.exception("Job %s failed", job_id)
        # `or type(...)`: some exceptions stringify to "" (a bare TimeoutError
        # does), and an empty error reads in the UI as "Run failed:" with no
        # reason — the same dead end as the null error this change removes.
        await store.mark_failed(job_id, str(exc) or type(exc).__name__)


async def launch(store: JobStore, job: JobRecord, work: JobWork) -> str:
    """Persist ``job`` and start executing ``work`` in the background.

    Returns the job id immediately; callers poll ``GET /api/jobs/{id}``.
    """
    job_id = await store.create(job)
    task = asyncio.create_task(_run(store, job_id, work), name=f"job-{job_id}")
    _running_tasks.add(task)
    task.add_done_callback(_running_tasks.discard)
    return job_id
