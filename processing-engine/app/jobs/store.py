# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Mongo-backed job store — the engine's first write-capable repository.

Every mutation is a single atomic ``$set``/``$push`` update; no
read-modify-write cycles, so the executor thread and cancel requests can race
safely. Long-running work must poll :meth:`is_cancel_requested` at safe
boundaries.
"""

from datetime import UTC, datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorCollection

from app.jobs.models import (
    ACTIVE_STATUSES,
    INTERRUPTED_ERROR,
    LOG_TAIL_MAX_LINES,
    JobRecord,
    JobResult,
    JobStatus,
)


COLLECTION_NAME = "jobs"

#: Distinguishes "caller did not mention this field" from "caller wants this
#: field set to null". ``current_file`` genuinely needs to be cleared (a
#: combining stage must not inherit the previous stage's file position), so
#: None cannot double as "unspecified" the way it does for the other fields.
_UNSET: Any = object()


def _now_iso() -> str:
    # Match pydantic's JSON serialization (trailing Z, not +00:00) so every
    # timestamp in a job document carries the same format and sorts lexically.
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


_ACTIVE_LIST = list(ACTIVE_STATUSES)


def _active(job_id: str) -> dict[str, Any]:
    """Filter matching a job only while the engine still owes work on it."""
    return {"job_id": job_id, "status": {"$in": _ACTIVE_LIST}}


def _touch(fields: dict[str, Any]) -> dict[str, Any]:
    """Add the last-activity stamp to a ``$set`` payload.

    Piggybacking on writes the store already makes keeps this free: no extra
    Mongo round trip, so the single-worker event loop sees no added contention.
    """
    return {**fields, "updated_at": _now_iso()}


class JobStore:
    def __init__(self, collection: AsyncIOMotorCollection):
        self._col = collection

    async def ensure_indexes(self) -> None:
        await self._col.create_index("job_id", unique=True)
        await self._col.create_index([("user_id", 1), ("created_at", -1)])

    async def create(self, job: JobRecord) -> str:
        await self._col.insert_one(job.to_document())
        return job.job_id

    async def get(self, job_id: str) -> dict[str, Any] | None:
        return await self._col.find_one({"job_id": job_id}, {"_id": 0})

    async def list_for_user(self, user_id: str, limit: int = 50) -> list[dict[str, Any]]:
        cursor = (
            self._col.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
        )
        return await cursor.to_list(length=limit)

    async def request_cancel(self, job_id: str, user_id: str) -> bool:
        """Flag an active, owned job for cancellation. Returns False when the
        job doesn't exist, isn't owned by ``user_id``, or already finished."""
        result = await self._col.update_one(
            {
                "job_id": job_id,
                "user_id": user_id,
                "status": {"$in": _ACTIVE_LIST},
            },
            # Deliberately NOT _touch: updated_at means "the engine is still
            # working on this". Cancellation is cooperative, so a wedged run
            # can't observe the request — stamping here would make the very
            # job the user is trying to kill look freshly alive.
            {"$set": {"cancel_requested": True}},
        )
        return result.matched_count == 1

    async def is_cancel_requested(self, job_id: str) -> bool:
        doc = await self._col.find_one({"job_id": job_id}, {"cancel_requested": 1})
        return bool(doc and doc.get("cancel_requested"))

    async def set_status(self, job_id: str, status: JobStatus) -> None:
        # Active-only: a terminal job never goes back to running (see _active).
        await self._col.update_one(_active(job_id), {"$set": _touch({"status": status.value})})
        if status is JobStatus.RUNNING:
            # Stamp started_at only on the FIRST running transition — a job
            # returning from DOWNLOADING must not shift its start time.
            await self._col.update_one(
                {"job_id": job_id, "started_at": None, "status": {"$in": _ACTIVE_LIST}},
                {"$set": {"started_at": _now_iso()}},
            )

    async def set_progress(
        self,
        job_id: str,
        *,
        current_stage: str | None = None,
        message: str | None = None,
        download_pct: float | None = None,
        stages: list[dict[str, Any]] | None = None,
        current_file: int | None = _UNSET,
        total_files: int | None = _UNSET,
    ) -> None:
        fields: dict[str, Any] = {}
        if current_stage is not None:
            fields["progress.current_stage"] = current_stage
        if message is not None:
            fields["progress.message"] = message
        if download_pct is not None:
            fields["progress.download_pct"] = download_pct
        if stages is not None:
            fields["progress.stages"] = stages
        # Explicit None is meaningful here (see _UNSET): it clears a stale
        # per-file position rather than leaving the previous stage's.
        if current_file is not _UNSET:
            fields["progress.current_file"] = current_file
        if total_files is not _UNSET:
            fields["progress.total_files"] = total_files
        if fields:
            # Active-only: a stage that outlives its job (the timeout path
            # leaves the jwst thread running) must not keep advancing progress
            # or updated_at on a document that already reads "failed".
            await self._col.update_one(_active(job_id), {"$set": _touch(fields)})

    async def append_log(self, job_id: str, *lines: str) -> None:
        if not lines:
            return
        await self._col.update_one(
            # Active-only, for the same reason as set_progress.
            _active(job_id),
            {
                "$push": {
                    "log_tail": {
                        "$each": list(lines),
                        # Keep only the newest lines; full logs go to storage.
                        "$slice": -LOG_TAIL_MAX_LINES,
                    }
                },
                # Same op, so a log flush is also proof of life for the UI.
                "$set": {"updated_at": _now_iso()},
            },
        )

    async def mark_succeeded(self, job_id: str, result: JobResult) -> None:
        await self._col.update_one(
            # Terminal transitions are one-way: never overwrite a job that has
            # already finished (a late cancellation must not undo a success).
            _active(job_id),
            {
                "$set": _touch(
                    {
                        "status": JobStatus.SUCCEEDED.value,
                        "finished_at": _now_iso(),
                        "result": result.model_dump(mode="json"),
                    }
                )
            },
        )

    async def mark_failed(self, job_id: str, error: str) -> None:
        await self._col.update_one(
            # Terminal transitions are one-way: never overwrite a job that has
            # already finished (a late cancellation must not undo a success).
            _active(job_id),
            {
                "$set": _touch(
                    {
                        "status": JobStatus.FAILED.value,
                        "finished_at": _now_iso(),
                        "error": error,
                    }
                )
            },
        )

    async def mark_cancelled(self, job_id: str) -> None:
        await self._col.update_one(
            # Terminal transitions are one-way: never overwrite a job that has
            # already finished (a late cancellation must not undo a success).
            _active(job_id),
            {
                "$set": _touch(
                    {
                        "status": JobStatus.CANCELLED.value,
                        "finished_at": _now_iso(),
                    }
                )
            },
        )

    async def mark_interrupted(self, job_id: str) -> None:
        """Record that the ENGINE ended this run, not the user.

        Deliberately ``failed`` + :data:`INTERRUPTED_ERROR` rather than
        ``cancelled``: "cancelled" is the user's word, and a job that died to a
        restart used to land there with ``error: None``, which left the UI no
        way to explain what happened. Same status/error as
        :meth:`reconcile_interrupted`, which handles the case where the process
        died before this could run.
        """
        await self._col.update_one(
            # Terminal transitions are one-way: never overwrite a job that has
            # already finished (a late cancellation must not undo a success).
            _active(job_id),
            {
                "$set": _touch(
                    {
                        "status": JobStatus.FAILED.value,
                        "finished_at": _now_iso(),
                        "error": INTERRUPTED_ERROR,
                    }
                )
            },
        )

    async def reconcile_interrupted(self) -> int:
        """Mark jobs left active by a previous process as failed (v1 jobs do
        not survive restarts — resume-on-restart is a tracked follow-up)."""
        result = await self._col.update_many(
            {"status": {"$in": _ACTIVE_LIST}},
            {
                "$set": _touch(
                    {
                        "status": JobStatus.FAILED.value,
                        "finished_at": _now_iso(),
                        "error": INTERRUPTED_ERROR,
                    }
                )
            },
        )
        return result.modified_count
