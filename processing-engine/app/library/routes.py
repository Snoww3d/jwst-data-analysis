"""Library read endpoints (ADR 0001 Phase 2 — CE read-slice).

Anonymous-only semantics: everything here serves IsPublic data, matching the
.NET controller's anonymous branch. Wire shapes are pinned by the golden
fixtures in tests/contract/fixtures/ — see docs/plans/features/
ce-phase1-spike-report.md for the contract rules.

Writes (upload/archive/delete/scan) intentionally do not exist in this router;
CE mounts are deny-by-default (docs/plans/features/ce-phase1-route-allowlist.md).
"""

import asyncio
import logging
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.db.access import resolve_public_path, to_relative_key
from app.db.deps import get_file_exists, get_repository
from app.db.projection import to_data_response
from app.db.repository import JwstDataReadRepository
from app.render.routes import generate_preview as engine_preview
from app.render.routes import get_cube_info as engine_cube_info
from app.render.routes import get_histogram as engine_histogram
from app.render.routes import get_pixel_data as engine_pixel_data


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Library"])

# Usable calibration levels for guided creation (JwstDataController.cs:2139)
_USABLE_LEVELS = {"L2a", "L2b", "L3"}
RepoDep = Annotated[JwstDataReadRepository, Depends(get_repository)]
FileExistsDep = Annotated[Callable[[str], bool], Depends(get_file_exists)]


class CheckAvailabilityRequest(BaseModel):
    observation_ids: list[str] = Field(alias="observationIds")


@router.get("/jwstdata")
async def list_jwst_data(repo: RepoDep, includeArchived: bool = False) -> list[dict]:  # noqa: N803 -- camelCase query param is the .NET wire contract
    docs = await repo.get_public_list(include_archived=includeArchived)
    return [to_data_response(d) for d in docs]


@router.get("/jwstdata/{data_id}/thumbnail")
async def get_thumbnail(data_id: str, repo: RepoDep) -> Response:
    doc = await repo.get_public_by_id(data_id)
    if doc is None:
        # 404 (not 403) to prevent ID enumeration — .NET parity
        raise HTTPException(status_code=404)
    thumb = doc.get("ThumbnailData")
    if thumb is None:
        return Response(status_code=204)
    return Response(
        content=bytes(thumb),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/jwstdata/check-availability")
async def check_availability(
    request: CheckAvailabilityRequest, repo: RepoDep, file_exists: FileExistsDep
) -> dict:
    obs_ids = request.observation_ids
    if not obs_ids:
        raise HTTPException(status_code=400, detail="ObservationIds is required")
    if len(obs_ids) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 observation IDs per request")

    results: dict[str, dict] = {}
    for obs_id in obs_ids:
        if not obs_id or not obs_id.strip():
            continue
        records = await repo.get_public_by_observation_base_id(obs_id)
        usable = [
            r
            for r in records
            if not r.get("IsArchived")
            and r.get("FilePath")
            and r.get("ProcessingLevel") in _USABLE_LEVELS
        ]
        # Mongo records can outlive deleted files — verify on disk.
        # file_exists is a sync local-stat under CE (STORAGE_PROVIDER=local);
        # wrap in a thread if S3 storage is ever used behind this route.
        verified = [r for r in usable if file_exists(to_relative_key(r["FilePath"]))]
        if verified:
            image_info = verified[0].get("ImageInfo") or {}
            results[obs_id] = {
                "available": True,
                "dataIds": [str(r["_id"]) for r in verified],
                "filter": image_info.get("Filter"),
            }
    return {"results": results}


@router.get("/jwstdata/{data_id}/preview")
async def get_preview(  # noqa: PLR0913 -- mirrors the .NET query surface 1:1
    data_id: str,
    repo: RepoDep,
    cmap: str = "grayscale",
    width: int = 1000,
    height: int = 1000,
    stretch: str = "zscale",
    gamma: float = 1.0,
    blackPoint: float = 0.0,  # noqa: N803 -- camelCase query params are the .NET wire contract
    whitePoint: float = 1.0,  # noqa: N803
    asinhA: float = 0.1,  # noqa: N803
    sliceIndex: int = -1,  # noqa: N803
    format: str = "png",  # noqa: A002 -- .NET query param name
    quality: int = 90,
    embedAvm: bool = False,  # noqa: N803
    smoothMethod: str = "",  # noqa: N803
    smoothSigma: float = 1.0,  # noqa: N803
    smoothSize: int = 3,  # noqa: N803
) -> Response:
    """Preview render shim: dataId -> engine generate_preview (thread pool).

    Forwards the engine's response verbatim — including the X-Cube-Slices /
    X-Cube-Current headers the .NET tier passes back to the viewer.
    """
    file_path = await resolve_public_path(repo, data_id)
    return await asyncio.to_thread(
        engine_preview,
        data_id=data_id,
        file_path=file_path,
        cmap=cmap,
        width=width,
        height=height,
        stretch=stretch,
        gamma=gamma,
        black_point=blackPoint,
        white_point=whitePoint,
        asinh_a=asinhA,
        slice_index=sliceIndex,
        format=format,
        quality=quality,
        embed_avm=embedAvm,
        smooth_method=smoothMethod,
        smooth_sigma=smoothSigma,
        smooth_size=smoothSize,
    )


@router.get("/jwstdata/{data_id}/pixeldata")
async def get_pixeldata(
    data_id: str,
    repo: RepoDep,
    maxSize: int = 1200,  # noqa: N803 -- camelCase query params are the .NET wire contract
    sliceIndex: int = -1,  # noqa: N803
):
    file_path = await resolve_public_path(repo, data_id)
    return await asyncio.to_thread(
        engine_pixel_data,
        data_id=data_id,
        file_path=file_path,
        max_size=maxSize,
        slice_index=sliceIndex,
    )


@router.get("/jwstdata/{data_id}/cubeinfo")
async def get_cubeinfo(data_id: str, repo: RepoDep):
    file_path = await resolve_public_path(repo, data_id)
    return await asyncio.to_thread(engine_cube_info, data_id=data_id, file_path=file_path)


@router.get("/jwstdata/{data_id}/histogram")
async def get_histogram_shim(  # noqa: PLR0913 -- mirrors the .NET query surface 1:1
    data_id: str,
    repo: RepoDep,
    bins: int = 256,
    sliceIndex: int = -1,  # noqa: N803 -- camelCase query params are the .NET wire contract
    stretch: str = "zscale",
    gamma: float = 1.0,
    blackPoint: float = 0.0,  # noqa: N803
    whitePoint: float = 1.0,  # noqa: N803
    asinhA: float = 0.1,  # noqa: N803
    smoothMethod: str = "",  # noqa: N803
    smoothSigma: float = 1.0,  # noqa: N803
    smoothSize: int = 3,  # noqa: N803
):
    """Histogram shim — ImageViewer fetches this unconditionally; it was the
    one render read missing from the Phase 1 inventory (review catch)."""
    file_path = await resolve_public_path(repo, data_id)
    return await asyncio.to_thread(
        engine_histogram,
        data_id=data_id,
        file_path=file_path,
        bins=bins,
        slice_index=sliceIndex,
        stretch=stretch,
        gamma=gamma,
        black_point=blackPoint,
        white_point=whitePoint,
        asinh_a=asinhA,
        smooth_method=smoothMethod,
        smooth_sigma=smoothSigma,
        smooth_size=smoothSize,
    )
