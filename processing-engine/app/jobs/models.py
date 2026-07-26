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

# Error recorded when a run ends because the engine went away rather than
# because the user asked it to stop. Two paths reach it — the runner's
# shutdown handler (loop teardown, in-process) and startup reconciliation
# (the process died before the handler ran) — and they deliberately share one
# string so the UI tells one story regardless of which one got there first.
INTERRUPTED_ERROR = "interrupted by service restart"


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
    #: 1-based index of the input file currently being worked on, and how many
    #: inputs the current stage was handed. ``current_file`` is None whenever
    #: "which file" is not a meaningful question — before any stage starts, and
    #: for combining stages (image3) that consume every input in one call.
    #: ``total_files`` stays populated there so the UI can still say
    #: "combining 4 files" without inventing a per-file position.
    current_file: int | None = None
    total_files: int | None = None


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
    #: Last time the engine wrote anything to this job (status, progress, log).
    #: Lets a poller say "last update N min ago" and distinguish a slow-but-
    #: alive run from a wedged one. Stamped by every JobStore mutation.
    updated_at: datetime | None = None
    request: dict[str, Any] = Field(default_factory=dict)
    progress: JobProgress = Field(default_factory=JobProgress)
    log_tail: list[str] = Field(default_factory=list)
    result: JobResult | None = None
    error: str | None = None

    def to_document(self) -> dict[str, Any]:
        return self.model_dump(mode="json")
