# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for the Mongo-backed job store and runner (app/jobs/).

Runs against the real MongoDB in the dev container (MONGODB_URI) using a
throwaway collection per test — the store's whole value is its atomic update
operators, which an in-memory fake would not exercise honestly.
"""

import asyncio
import contextlib
import uuid

import pytest

from app.db.client import get_database, reset_client
from app.jobs.models import (
    INTERRUPTED_ERROR,
    LOG_TAIL_MAX_LINES,
    JobRecord,
    JobResult,
    JobStatus,
)
from app.jobs.runner import JobCancelled, JobContext, launch
from app.jobs.store import JobStore


USER = "user-a"
OTHER = "user-b"


@pytest.fixture()
async def store():
    # Fresh motor client per test: the cached global binds to the first
    # event loop it touches, and pytest-asyncio makes a new loop per test.
    reset_client()
    collection = get_database()[f"jobs_test_{uuid.uuid4().hex}"]
    yield JobStore(collection)
    await collection.drop()
    reset_client()


def make_job(user_id: str = USER) -> JobRecord:
    return JobRecord(type="calibration", user_id=user_id, request={"recipe_id": "x"})


class TestJobStore:
    async def test_create_and_get_roundtrip(self, store: JobStore) -> None:
        job = make_job()
        await store.create(job)
        doc = await store.get(job.job_id)
        assert doc is not None
        assert doc["status"] == "queued"
        assert doc["user_id"] == USER
        assert doc["request"] == {"recipe_id": "x"}
        assert "_id" not in doc

    async def test_get_unknown_returns_none(self, store: JobStore) -> None:
        assert await store.get("nope") is None

    async def test_list_for_user_isolates_owners(self, store: JobStore) -> None:
        mine = make_job()
        theirs = make_job(user_id=OTHER)
        await store.create(mine)
        await store.create(theirs)
        jobs = await store.list_for_user(USER)
        assert [j["job_id"] for j in jobs] == [mine.job_id]

    async def test_status_transitions_stamp_timestamps(self, store: JobStore) -> None:
        job = make_job()
        await store.create(job)
        await store.set_status(job.job_id, JobStatus.RUNNING)
        doc = await store.get(job.job_id)
        assert doc["status"] == "running"
        assert doc["started_at"] is not None

        await store.mark_succeeded(job.job_id, JobResult())
        doc = await store.get(job.job_id)
        assert doc["status"] == "succeeded"
        assert doc["finished_at"] is not None

    async def test_cancel_only_active_owned_jobs(self, store: JobStore) -> None:
        job = make_job()
        await store.create(job)

        assert await store.request_cancel(job.job_id, OTHER) is False
        assert await store.request_cancel(job.job_id, USER) is True
        assert await store.is_cancel_requested(job.job_id) is True

        await store.mark_cancelled(job.job_id)
        # Terminal job: further cancels are refused.
        assert await store.request_cancel(job.job_id, USER) is False

    async def test_append_log_caps_tail(self, store: JobStore) -> None:
        job = make_job()
        await store.create(job)
        lines = [f"line {i}" for i in range(LOG_TAIL_MAX_LINES + 25)]
        await store.append_log(job.job_id, *lines)
        doc = await store.get(job.job_id)
        assert len(doc["log_tail"]) == LOG_TAIL_MAX_LINES
        assert doc["log_tail"][-1] == lines[-1]
        assert doc["log_tail"][0] == lines[25]

    async def test_set_progress_partial_updates(self, store: JobStore) -> None:
        job = make_job()
        await store.create(job)
        await store.set_progress(job.job_id, current_stage="image3", message="resampling")
        await store.set_progress(job.job_id, download_pct=42.5)
        doc = await store.get(job.job_id)
        assert doc["progress"]["current_stage"] == "image3"
        assert doc["progress"]["message"] == "resampling"
        assert doc["progress"]["download_pct"] == 42.5

    async def test_set_progress_tracks_per_file_position(self, store: JobStore) -> None:
        job = make_job()
        await store.create(job)
        await store.set_progress(job.job_id, current_file=2, total_files=4)
        doc = await store.get(job.job_id)
        assert doc["progress"]["current_file"] == 2
        assert doc["progress"]["total_files"] == 4

        # An unrelated update must not disturb the position...
        await store.set_progress(job.job_id, message="still going")
        doc = await store.get(job.job_id)
        assert doc["progress"]["current_file"] == 2

        # ...but an EXPLICIT None clears it (combining stage / run finished).
        await store.set_progress(job.job_id, current_file=None, total_files=None)
        doc = await store.get(job.job_id)
        assert doc["progress"]["current_file"] is None
        assert doc["progress"]["total_files"] is None

    async def test_new_job_has_null_file_position(self, store: JobStore) -> None:
        job = make_job()
        await store.create(job)
        doc = await store.get(job.job_id)
        assert doc["progress"]["current_file"] is None
        assert doc["progress"]["total_files"] is None
        assert doc["updated_at"] is None

    async def test_every_mutation_stamps_updated_at(self, store: JobStore) -> None:
        # The UI's "last update N min ago" is only trustworthy if EVERY write
        # moves the stamp — a progress-only write is exactly the case that used
        # to leave a slow run looking dead.
        job = make_job()
        await store.create(job)
        stamps: list[str] = []

        async def stamp_after(action) -> None:
            await action
            doc = await store.get(job.job_id)
            assert doc["updated_at"] is not None
            stamps.append(doc["updated_at"])

        await stamp_after(store.set_status(job.job_id, JobStatus.RUNNING))
        await stamp_after(store.set_progress(job.job_id, message="working"))
        await stamp_after(store.append_log(job.job_id, "a line"))
        await stamp_after(store.mark_succeeded(job.job_id, JobResult()))

        # Monotonic, ISO-8601 with the trailing Z the rest of the doc uses.
        assert stamps == sorted(stamps)
        assert all(s.endswith("Z") for s in stamps)

    async def test_cancel_request_does_not_stamp_activity(self, store: JobStore) -> None:
        # Cancellation is cooperative: a WEDGED run never observes the request.
        # If the user's click stamped updated_at, the stuck job would suddenly
        # look freshly alive — the exact case this signal exists to expose.
        job = make_job()
        await store.create(job)
        await store.set_status(job.job_id, JobStatus.RUNNING)
        before = (await store.get(job.job_id))["updated_at"]

        await store.request_cancel(job.job_id, USER)
        doc = await store.get(job.job_id)
        assert doc["cancel_requested"] is True
        assert doc["updated_at"] == before

    async def test_terminal_jobs_reject_further_writes(self, store: JobStore) -> None:
        # A stage that outlives its job (timeout leaves the jwst thread
        # running) must not resurrect progress on a finished document.
        job = make_job()
        await store.create(job)
        await store.set_status(job.job_id, JobStatus.RUNNING)
        await store.mark_failed(job.job_id, "boom")
        finished = await store.get(job.job_id)

        await store.set_progress(job.job_id, current_file=3, total_files=4, message="late")
        await store.append_log(job.job_id, "late line")
        await store.set_status(job.job_id, JobStatus.RUNNING)
        await store.mark_cancelled(job.job_id)
        await store.mark_interrupted(job.job_id)

        doc = await store.get(job.job_id)
        assert doc["status"] == "failed"
        assert doc["error"] == "boom"
        assert doc["progress"]["current_file"] is None
        assert doc["log_tail"] == []
        # Nothing moved the liveness stamp either.
        assert doc["updated_at"] == finished["updated_at"]

    async def test_success_survives_a_late_interruption(self, store: JobStore) -> None:
        job = make_job()
        await store.create(job)
        await store.set_status(job.job_id, JobStatus.RUNNING)
        await store.mark_succeeded(job.job_id, JobResult(jwst_version="1.2.3"))
        await store.mark_interrupted(job.job_id)

        doc = await store.get(job.job_id)
        assert doc["status"] == "succeeded"
        assert doc["error"] is None

    async def test_mark_interrupted_explains_the_restart(self, store: JobStore) -> None:
        job = make_job()
        await store.create(job)
        await store.set_status(job.job_id, JobStatus.RUNNING)
        await store.mark_interrupted(job.job_id)
        doc = await store.get(job.job_id)
        # Not "cancelled with error: None" — the user never asked for this.
        assert doc["status"] == "failed"
        assert doc["error"] == INTERRUPTED_ERROR
        assert doc["finished_at"] is not None

    async def test_reconcile_interrupted_fails_active_only(self, store: JobStore) -> None:
        active = make_job()
        done = make_job()
        await store.create(active)
        await store.create(done)
        await store.set_status(active.job_id, JobStatus.RUNNING)
        await store.mark_succeeded(done.job_id, JobResult())

        assert await store.reconcile_interrupted() == 1
        doc = await store.get(active.job_id)
        assert doc["status"] == "failed"
        # Same status/error as the in-process shutdown handler, so the UI has
        # one story regardless of which path caught the job.
        assert doc["error"] == INTERRUPTED_ERROR
        assert (await store.get(done.job_id))["status"] == "succeeded"


class TestRunner:
    async def test_successful_work_marks_succeeded(self, store: JobStore) -> None:
        async def work(ctx: JobContext) -> JobResult:
            await ctx.log("starting", "working")
            return JobResult(jwst_version="0.0-test")

        job_id = await launch(store, make_job(), work)
        await _wait_terminal(store, job_id)
        doc = await store.get(job_id)
        assert doc["status"] == "succeeded"
        assert doc["result"]["jwst_version"] == "0.0-test"
        assert doc["log_tail"] == ["starting", "working"]

    async def test_raising_work_marks_failed(self, store: JobStore) -> None:
        async def work(ctx: JobContext) -> JobResult:
            raise RuntimeError("boom")

        job_id = await launch(store, make_job(), work)
        await _wait_terminal(store, job_id)
        doc = await store.get(job_id)
        assert doc["status"] == "failed"
        assert doc["error"] == "boom"

    async def test_cancel_observed_at_boundary(self, store: JobStore) -> None:
        started = asyncio.Event()
        release = asyncio.Event()

        async def work(ctx: JobContext) -> JobResult:
            started.set()
            await release.wait()
            await ctx.raise_if_cancelled()
            return JobResult()

        job_id = await launch(store, make_job(), work)
        await started.wait()
        assert await store.request_cancel(job_id, USER) is True
        release.set()
        await _wait_terminal(store, job_id)
        assert (await store.get(job_id))["status"] == "cancelled"

    async def test_job_cancelled_exception_maps_to_cancelled(self, store: JobStore) -> None:
        async def work(ctx: JobContext) -> JobResult:
            raise JobCancelled()

        job_id = await launch(store, make_job(), work)
        await _wait_terminal(store, job_id)
        assert (await store.get(job_id))["status"] == "cancelled"

    async def test_engine_shutdown_is_reported_as_interrupted(self, store: JobStore) -> None:
        # Loop teardown cancels the task without cancel_requested ever being
        # set. That used to land as "cancelled" with error None, which told the
        # user their run was cancelled when in fact the engine restarted.
        started = asyncio.Event()

        async def work(ctx: JobContext) -> JobResult:
            started.set()
            await asyncio.sleep(60)
            return JobResult()

        job_id = await launch(store, make_job(), work)
        await started.wait()
        _task_for(job_id).cancel()
        await _wait_terminal(store, job_id)

        doc = await store.get(job_id)
        assert doc["status"] == "failed"
        assert doc["error"] == INTERRUPTED_ERROR
        assert doc["cancel_requested"] is False

    async def test_task_cancellation_after_user_cancel_stays_cancelled(
        self, store: JobStore
    ) -> None:
        # Same mechanical path, but the user DID ask — cancel_requested is the
        # signal that keeps this one honestly "cancelled".
        started = asyncio.Event()

        async def work(ctx: JobContext) -> JobResult:
            started.set()
            await asyncio.sleep(60)
            return JobResult()

        job_id = await launch(store, make_job(), work)
        await started.wait()
        assert await store.request_cancel(job_id, USER) is True
        _task_for(job_id).cancel()
        await _wait_terminal(store, job_id)

        doc = await store.get(job_id)
        assert doc["status"] == "cancelled"
        assert doc["error"] is None

    async def test_repeated_cancellation_never_lies_about_the_outcome(
        self, store: JobStore
    ) -> None:
        # Loop teardown can deliver cancellation more than once, which is what
        # the shields in _run exist for. The invariant: the job must never end
        # as a bare "cancelled" (the user's word) when nobody asked.
        started = asyncio.Event()

        async def work(ctx: JobContext) -> JobResult:
            started.set()
            await asyncio.sleep(60)
            return JobResult()

        job_id = await launch(store, make_job(), work)
        await started.wait()
        task = _task_for(job_id)
        task.cancel()
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

        doc = await store.get(job_id)
        # Either the shielded write landed, or the job is left active for
        # startup reconciliation — never "cancelled".
        assert doc["status"] != "cancelled"
        if doc["status"] == "failed":
            assert doc["error"] == INTERRUPTED_ERROR


def _task_for(job_id: str) -> asyncio.Task:
    """The fire-and-forget task the runner registered for this job."""
    from app.jobs import runner

    for task in runner._running_tasks:
        if task.get_name() == f"job-{job_id}":
            return task
    raise AssertionError(f"no running task for job {job_id}")


async def _wait_terminal(store: JobStore, job_id: str, timeout: float = 5.0) -> None:
    async with asyncio.timeout(timeout):
        while True:
            doc = await store.get(job_id)
            if doc and doc["status"] in ("succeeded", "failed", "cancelled"):
                return
            await asyncio.sleep(0.02)
