# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Job status/cancel endpoints (ADR-0001 Phase 3, first slice).

Divergence from the ADR sketch: progress is delivered by HTTP polling of
``GET /api/jobs/{id}`` rather than a ``/ws/jobs`` WebSocket — the frontend's
job-progress hooks already support polling, and calibration jobs (the first
consumer) change state on the order of seconds, not milliseconds.

Wire shape is camelCase (``app.db.casing``); documents are snake_case.
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth.deps import AuthenticatedUser, require_user
from app.db.casing import snake_to_camel_keys
from app.db.client import get_database
from app.jobs.store import COLLECTION_NAME, JobStore


router = APIRouter(prefix="/api/jobs", tags=["Jobs"])


def get_job_store() -> JobStore:
    return JobStore(get_database()[COLLECTION_NAME])


def to_wire(job: dict) -> dict:
    """camelCase the job envelope but keep ``request`` verbatim — it is
    opaque, job-type-owned data (e.g. a calibration recipe snapshot whose
    parameter names are meaningful snake_case identifiers, not field names)."""
    request = job.get("request")
    wire = snake_to_camel_keys({k: v for k, v in job.items() if k != "request"})
    wire["request"] = request
    return wire


@router.get("")
async def list_jobs(
    user: AuthenticatedUser = Depends(require_user),
    store: JobStore = Depends(get_job_store),
    limit: int = 50,
):
    jobs = await store.list_for_user(user.user_id, limit=min(max(limit, 1), 200))
    return {"jobs": [to_wire(j) for j in jobs]}


@router.get("/{job_id}")
async def get_job(
    job_id: str,
    user: AuthenticatedUser = Depends(require_user),
    store: JobStore = Depends(get_job_store),
):
    job = await store.get(job_id)
    # 404 for both "unknown" and "not yours" — don't leak job existence.
    if job is None or (job.get("user_id") != user.user_id and user.role != "Admin"):
        raise HTTPException(status_code=404, detail="Job not found")
    return to_wire(job)


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    user: AuthenticatedUser = Depends(require_user),
    store: JobStore = Depends(get_job_store),
):
    # Deliberately no Admin bypass here (unlike get_job): admins observe any
    # job but don't interfere with other users' runs.
    accepted = await store.request_cancel(job_id, user.user_id)
    if not accepted:
        job = await store.get(job_id)
        if job is None or job.get("user_id") != user.user_id:
            raise HTTPException(status_code=404, detail="Job not found")
        # Owned but already terminal — cancellation is a no-op, not an error.
        return {"cancelRequested": False, "status": job.get("status")}
    return {"cancelRequested": True}
