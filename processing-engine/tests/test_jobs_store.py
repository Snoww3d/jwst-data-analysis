# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for the Mongo-backed job store and runner (app/jobs/).

Runs against the real MongoDB in the dev container (MONGODB_URI) using a
throwaway collection per test — the store's whole value is its atomic update
operators, which an in-memory fake would not exercise honestly.
"""

import asyncio
import uuid

import pytest

from app.db.client import get_database, reset_client
from app.jobs.models import (
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
        assert doc["error"] == "interrupted by service restart"
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


async def _wait_terminal(store: JobStore, job_id: str, timeout: float = 5.0) -> None:
    async with asyncio.timeout(timeout):
        while True:
            doc = await store.get(job_id)
            if doc and doc["status"] in ("succeeded", "failed", "cancelled"):
                return
            await asyncio.sleep(0.02)
