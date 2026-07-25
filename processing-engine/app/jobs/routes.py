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
from fastapi.responses import FileResponse

from app.auth.deps import AuthenticatedUser, require_user
from app.db.casing import snake_to_camel_keys
from app.db.client import get_database
from app.jobs.store import COLLECTION_NAME, JobStore
from app.library.levels import UNKNOWN, level_for_filename, level_for_suffix
from app.library.lineage import (
    derived_from_for_output,
    exposure_id_from,
    observation_base_id_for_output,
)
from app.library.writer import JwstDataWriteRepository
from app.render.routes import generate_preview as engine_preview
from app.storage.helpers import resolve_fits_path


router = APIRouter(prefix="/api/jobs", tags=["Jobs"])

# Only FITS image products are renderable; other job outputs (source catalogs
# .ecsv, .asdf) are not previewable.
_PREVIEWABLE_SUFFIXES = (".fits", ".fit", ".fits.gz")

# Library thumbnails are small; the full-size render is a separate concern.
_THUMBNAIL_PX = 256


def get_job_store() -> JobStore:
    return JobStore(get_database()[COLLECTION_NAME])


def get_library_writer() -> JwstDataWriteRepository:
    return JwstDataWriteRepository(get_database()["jwst_data"])


async def _resolve_any_output(
    store: JobStore, job_id: str, user: AuthenticatedUser, index: int
) -> tuple[dict, dict, str]:
    """Ownership + bounds checks shared by the output-scoped routes.

    404 covers both "unknown" and "not yours" so the endpoints don't leak job
    existence (``get_job`` parity). The storage key is read server-side from the
    job's own result, so a client can never supply a raw path.

    No format check: download serves catalogs (.ecsv) too, which is the only
    useful action for a non-image product.
    """
    job = await store.get(job_id)
    if job is None or (job.get("user_id") != user.user_id and user.role != "Admin"):
        raise HTTPException(status_code=404, detail="Job not found")

    outputs = (job.get("result") or {}).get("outputs") or []
    if index < 0 or index >= len(outputs):
        raise HTTPException(status_code=404, detail="Output not found")

    output = outputs[index]
    storage_key = output.get("storage_key")
    if not storage_key:
        raise HTTPException(status_code=404, detail="Output not found")
    return job, output, storage_key


async def _resolve_output(
    store: JobStore, job_id: str, user: AuthenticatedUser, index: int
) -> tuple[dict, dict, str]:
    """As ``_resolve_any_output``, restricted to renderable FITS images."""
    job, output, storage_key = await _resolve_any_output(store, job_id, user, index)
    if not storage_key.lower().endswith(_PREVIEWABLE_SUFFIXES):
        raise HTTPException(status_code=415, detail="Output is not a previewable FITS image")
    return job, output, storage_key


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
    _job, _output, storage_key = await _resolve_output(store, job_id, user, index)

    return await asyncio.to_thread(
        engine_preview,
        data_id=job_id,
        file_path=storage_key,
        cmap=cmap,
        stretch=stretch,
        slice_index=sliceIndex,
    )


async def _render_thumbnail(job_id: str, storage_key: str) -> bytes | None:
    """Small PNG for the library card, or None if it can't be produced.

    A thumbnail is cosmetic — /library and the viewer both cope without one — so
    a render failure must never cost the user the save itself.
    """
    try:
        response = await asyncio.to_thread(
            engine_preview,
            data_id=job_id,
            file_path=storage_key,
            width=_THUMBNAIL_PX,
            height=_THUMBNAIL_PX,
        )
    except Exception:  # noqa: BLE001 -- cosmetic thumbnail; never fail the save over it
        return None
    body = getattr(response, "body", None)
    return bytes(body) if body else None


@router.get("/{job_id}/outputs/{index}/download")
async def download_output(
    job_id: str,
    index: int,
    user: AuthenticatedUser = Depends(require_user),
    store: JobStore = Depends(get_job_store),
) -> FileResponse:
    """Serve the raw output file. Unlike preview, this covers catalogs too."""
    _job, _output, storage_key = await _resolve_any_output(store, job_id, user, index)
    local_path = await asyncio.to_thread(resolve_fits_path, storage_key)
    return FileResponse(
        path=local_path,
        filename=storage_key.rsplit("/", 1)[-1],
        media_type="application/octet-stream",
    )


@router.post("/{job_id}/outputs/{index}/save", status_code=201)
async def save_output_to_library(
    job_id: str,
    index: int,
    user: AuthenticatedUser = Depends(require_user),
    store: JobStore = Depends(get_job_store),
    writer: JwstDataWriteRepository = Depends(get_library_writer),
) -> dict:
    """Persist a calibration output as a library record and return its id.

    Saving is explicit rather than automatic: calibration is a generate → view →
    tweak → regenerate loop, and auto-persisting every attempt would flood
    ``/library``. Once saved the output has a real Mongo ``_id``, which is what
    the full ImageViewer and the compositor are keyed by.
    """
    job, output, storage_key = await _resolve_output(store, job_id, user, index)

    # Always file under the job's owner, never the caller: an Admin saving
    # someone else's output must not claim it into their own library.
    owner_id = job["user_id"]

    existing = await writer.find_by_path(storage_key, owner_id)
    if existing is not None:
        return {"dataId": str(existing["_id"]), "created": False}

    result = job.get("result") or {}
    request = job.get("request") or {}
    snapshot = request.get("recipe_snapshot") or {}
    file_name = storage_key.rsplit("/", 1)[-1]

    metadata = {
        "source": "calibration",
        "job_id": job_id,
        "recipe_id": request.get("recipe_id"),
        "suffix": output.get("suffix"),
        # Provenance the run page shows and the library record should keep:
        # which pipeline and reference files produced this image.
        "jwst_version": result.get("jwst_version"),
        "crds_context": result.get("crds_context"),
        # The settings that made THIS file. Two outputs of the same input at
        # the same level are only distinguishable by these, which is what makes
        # "run it three ways and keep the best" a workable loop.
        "run_overrides": request.get("run_overrides") or {},
        "stages_run": [
            stage.get("name") for stage in (snapshot.get("stages") or []) if stage.get("enabled")
        ],
    }

    # Prefer the declared suffix; fall back to the filename so an output the
    # engine didn't label still lands with a level rather than none.
    level = level_for_suffix(output.get("suffix"))
    if level == UNKNOWN:
        level = level_for_filename(file_name)

    # Lineage comes from the inputs, not the output's name: an image3 output is
    # named after the recipe ({product_name}_i2d.fits), so it encodes no
    # observation at all. The parents already carry a correctly-shaped id.
    input_ids = list(request.get("input_data_ids") or [])
    parents = await writer.parents_for(input_ids)
    derived_from = derived_from_for_output(parents, file_name)

    data_id = await writer.create_from_calibration_output(
        file_path=storage_key,
        file_name=file_name,
        size_bytes=int(output.get("size_bytes") or 0),
        user_id=owner_id,
        metadata=metadata,
        thumbnail=await _render_thumbnail(job_id, storage_key),
        description=_variant_description(request, level),
        processing_level=None if level == UNKNOWN else level,
        derived_from=derived_from,
        observation_base_id=observation_base_id_for_output(parents, file_name),
        # The lineage view draws its edges from ParentId, not DerivedFrom, so
        # without this a saved output appears in the tree as a disconnected
        # root — the very view this provenance work exists to feed.
        parent_id=derived_from[0] if len(derived_from) == 1 else None,
        exposure_id=exposure_id_from(file_name),
    )
    return {"dataId": data_id, "created": True}


#: JwstDataModel.Description is [StringLength(1000)]; stay well inside it so a
#: client round-tripping the record through PUT /api/jwstdata is never rejected
#: by model validation on data the engine wrote. Override names and values are
#: unbounded (the validators check shape, not size).
_DESCRIPTION_MAX = 200


def _variant_description(request: dict, level: str) -> str:
    """A one-line description that tells two variants apart in the library.

    Runs of the same recipe produce identically-named files, so without this
    the library shows N indistinguishable rows — which defeats the point of
    trying several settings and keeping the best.
    """
    recipe_id = request.get("recipe_id") or "calibration"
    overrides = request.get("run_overrides") or {}
    tweaks = sorted(
        f"{step}.{param}={value}"
        for step, params in overrides.items()
        if isinstance(params, dict)
        for param, value in params.items()
    )
    label = level if level != UNKNOWN else "output"
    head = f"{label} from {recipe_id}"
    if not tweaks:
        return f"{head} (recipe defaults)"

    # Drop whole tweaks until it fits, and say how many went — never truncate
    # inside a value, which would read as a real (wrong) setting.
    for keep in range(len(tweaks), 0, -1):
        body = ", ".join(tweaks[:keep])
        if keep < len(tweaks):
            body += f", +{len(tweaks) - keep} more"
        candidate = f"{head} ({body})"
        if len(candidate) <= _DESCRIPTION_MAX:
            return candidate
    # Even one tweak is too long to show; summarise rather than mangle it.
    return f"{head} ({len(tweaks)} custom settings)"[:_DESCRIPTION_MAX]


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
