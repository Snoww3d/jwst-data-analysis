# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Job status/cancel endpoints (ADR-0001 Phase 3, first slice).

Divergence from the ADR sketch: progress is delivered by HTTP polling of
``GET /api/jobs/{id}`` rather than a ``/ws/jobs`` WebSocket — the frontend's
job-progress hooks already support polling, and calibration jobs (the first
consumer) change state on the order of seconds, not milliseconds.

Wire shape is camelCase (``app.db.casing``); documents are snake_case.
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth.deps import AuthenticatedUser, require_user
from app.db.casing import snake_to_camel_keys
from app.db.client import get_database
from app.jobs.store import COLLECTION_NAME, JobStore
from app.render.routes import generate_preview as engine_preview


router = APIRouter(prefix="/api/jobs", tags=["Jobs"])

# Only FITS image products are renderable; other job outputs (source catalogs
# .ecsv, .asdf) are not previewable.
_PREVIEWABLE_SUFFIXES = (".fits", ".fit", ".fits.gz")


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


@router.get("/{job_id}/outputs/{index}/preview")
async def get_output_preview(
    job_id: str,
    index: int,
    user: AuthenticatedUser = Depends(require_user),
    store: JobStore = Depends(get_job_store),
    cmap: str = "grayscale",
    stretch: str = "zscale",
    sliceIndex: int = -1,  # noqa: N803 -- camelCase query param matches the frontend/render wire
) -> Response:
    """On-the-fly PNG preview of a succeeded job's output — no library record.

    The storage key is read server-side from the job's own result, so the
    client never supplies a raw path (the outputs list is derived, index-based).
    Renders via the engine ``generate_preview`` shim in a thread pool, mirroring
    ``library.routes.get_preview``; the response (incl. X-Cube-Slices /
    X-Cube-Current headers) is forwarded verbatim.
    """
    job = await store.get(job_id)
    # 404 for both "unknown" and "not yours" — don't leak job existence (get_job parity).
    if job is None or (job.get("user_id") != user.user_id and user.role != "Admin"):
        raise HTTPException(status_code=404, detail="Job not found")

    outputs = (job.get("result") or {}).get("outputs") or []
    if index < 0 or index >= len(outputs):
        raise HTTPException(status_code=404, detail="Output not found")

    storage_key = outputs[index].get("storage_key")
    if not storage_key:
        raise HTTPException(status_code=404, detail="Output not found")
    if not storage_key.lower().endswith(_PREVIEWABLE_SUFFIXES):
        raise HTTPException(status_code=415, detail="Output is not a previewable FITS image")

    return await asyncio.to_thread(
        engine_preview,
        data_id=job_id,
        file_path=storage_key,
        cmap=cmap,
        stretch=stretch,
        slice_index=sliceIndex,
    )


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
