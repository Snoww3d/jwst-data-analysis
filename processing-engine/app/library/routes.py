"""Library read endpoints (ADR 0001 Phase 2 — CE read-slice).

Anonymous-only semantics: everything here serves IsPublic data, matching the
.NET controller's anonymous branch. Wire shapes are pinned by the golden
fixtures in tests/contract/fixtures/ — see docs/plans/features/
ce-phase1-spike-report.md for the contract rules.

Writes (upload/archive/delete/scan) intentionally do not exist in this router;
CE mounts are deny-by-default (docs/plans/features/ce-phase1-route-allowlist.md).
"""

import logging
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.db.deps import get_file_exists, get_repository
from app.db.projection import to_data_response
from app.db.repository import JwstDataReadRepository


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Library"])

# Usable calibration levels for guided creation (JwstDataController.cs:2139)
_USABLE_LEVELS = {"L2a", "L2b", "L3"}
_DATA_PREFIX = "/app/data/"

RepoDep = Annotated[JwstDataReadRepository, Depends(get_repository)]
FileExistsDep = Annotated[Callable[[str], bool], Depends(get_file_exists)]


def _to_relative_key(file_path: str) -> str:
    """StorageKeyHelper.ToRelativeKey parity: strip the container data prefix."""
    if file_path.lower().startswith(_DATA_PREFIX):
        return file_path[len(_DATA_PREFIX) :]
    return file_path


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
        verified = [r for r in usable if file_exists(_to_relative_key(r["FilePath"]))]
        if verified:
            image_info = verified[0].get("ImageInfo") or {}
            results[obs_id] = {
                "available": True,
                "dataIds": [str(r["_id"]) for r in verified],
                "filter": image_info.get("Filter"),
            }
    return {"results": results}
