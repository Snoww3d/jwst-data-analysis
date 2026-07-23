# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Job record models for the Mongo-persisted job store (ADR-0001 Phase 3).

The ``jobs`` collection is Python-native and uses snake_case field names — a
deliberate divergence from the PascalCase .NET-era collections (``jwst_data``,
``users``). The wire shape is camelCase via ``app.db.casing`` in the routes.
"""

import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


# Statuses a job can be observed in while the engine still owes work on it.
ACTIVE_STATUSES = ("queued", "downloading", "running")

# Upper bound on the in-document log tail; full logs belong in storage.
LOG_TAIL_MAX_LINES = 200


class JobStatus(StrEnum):
    QUEUED = "queued"
    DOWNLOADING = "downloading"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class StageState(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"


class JobStageProgress(BaseModel):
    name: str
    status: StageState = StageState.PENDING
    started_at: datetime | None = None
    finished_at: datetime | None = None


class JobProgress(BaseModel):
    stages: list[JobStageProgress] = Field(default_factory=list)
    current_stage: str | None = None
    message: str | None = None
    download_pct: float | None = None


class JobOutput(BaseModel):
    storage_key: str
    suffix: str
    size_bytes: int


class JobResult(BaseModel):
    outputs: list[JobOutput] = Field(default_factory=list)
    log_key: str | None = None
    jwst_version: str | None = None
    crds_context: str | None = None


class JobRecord(BaseModel):
    """A persisted job. ``request`` is job-type-specific (calibration embeds a
    recipe snapshot there) and is treated as opaque data by the store."""

    job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str
    user_id: str
    status: JobStatus = JobStatus.QUEUED
    cancel_requested: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    started_at: datetime | None = None
    finished_at: datetime | None = None
    request: dict[str, Any] = Field(default_factory=dict)
    progress: JobProgress = Field(default_factory=JobProgress)
    log_tail: list[str] = Field(default_factory=list)
    result: JobResult | None = None
    error: str | None = None

    def to_document(self) -> dict[str, Any]:
        return self.model_dump(mode="json")
