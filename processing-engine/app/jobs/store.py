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
    LOG_TAIL_MAX_LINES,
    JobRecord,
    JobResult,
    JobStatus,
)


COLLECTION_NAME = "jobs"


def _now_iso() -> str:
    # Match pydantic's JSON serialization (trailing Z, not +00:00) so every
    # timestamp in a job document carries the same format and sorts lexically.
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


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
                "status": {"$in": list(ACTIVE_STATUSES)},
            },
            {"$set": {"cancel_requested": True}},
        )
        return result.matched_count == 1

    async def is_cancel_requested(self, job_id: str) -> bool:
        doc = await self._col.find_one({"job_id": job_id}, {"cancel_requested": 1})
        return bool(doc and doc.get("cancel_requested"))

    async def set_status(self, job_id: str, status: JobStatus) -> None:
        await self._col.update_one({"job_id": job_id}, {"$set": {"status": status.value}})
        if status is JobStatus.RUNNING:
            # Stamp started_at only on the FIRST running transition — a job
            # returning from DOWNLOADING must not shift its start time.
            await self._col.update_one(
                {"job_id": job_id, "started_at": None},
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
        if fields:
            await self._col.update_one({"job_id": job_id}, {"$set": fields})

    async def append_log(self, job_id: str, *lines: str) -> None:
        if not lines:
            return
        await self._col.update_one(
            {"job_id": job_id},
            {
                "$push": {
                    "log_tail": {
                        "$each": list(lines),
                        # Keep only the newest lines; full logs go to storage.
                        "$slice": -LOG_TAIL_MAX_LINES,
                    }
                }
            },
        )

    async def mark_succeeded(self, job_id: str, result: JobResult) -> None:
        await self._col.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    "status": JobStatus.SUCCEEDED.value,
                    "finished_at": _now_iso(),
                    "result": result.model_dump(mode="json"),
                }
            },
        )

    async def mark_failed(self, job_id: str, error: str) -> None:
        await self._col.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    "status": JobStatus.FAILED.value,
                    "finished_at": _now_iso(),
                    "error": error,
                }
            },
        )

    async def mark_cancelled(self, job_id: str) -> None:
        await self._col.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    "status": JobStatus.CANCELLED.value,
                    "finished_at": _now_iso(),
                }
            },
        )

    async def reconcile_interrupted(self) -> int:
        """Mark jobs left active by a previous process as failed (v1 jobs do
        not survive restarts — resume-on-restart is a tracked follow-up)."""
        result = await self._col.update_many(
            {"status": {"$in": list(ACTIVE_STATUSES)}},
            {
                "$set": {
                    "status": JobStatus.FAILED.value,
                    "finished_at": _now_iso(),
                    "error": "interrupted by service restart",
                }
            },
        )
        return result.modified_count
