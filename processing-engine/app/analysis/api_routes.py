"""CE /api/analysis read facade (ADR 0001 Phase 2).

The .NET AnalysisController takes a ``dataId`` and resolves it to a file
path before calling the engine's file_path-keyed analysis routes. This
facade replicates that for the three READ endpoints on the CE allowlist
(table-info, table-data, spectral-data). The compute POSTs
(region-statistics, detect-sources) are deliberately absent from CE v1 —
see the pending-decisions section of ce-phase1-route-allowlist.md.
"""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends

from app.analysis.routes import get_spectral_data as engine_spectral_data
from app.analysis.routes import get_table_data as engine_table_data
from app.analysis.routes import get_table_info as engine_table_info
from app.db.access import resolve_public_path
from app.db.deps import get_repository
from app.db.repository import JwstDataReadRepository


router = APIRouter(prefix="/api/analysis", tags=["Analysis API"])

RepoDep = Annotated[JwstDataReadRepository, Depends(get_repository)]


@router.get("/table-info")
async def api_table_info(dataId: str, repo: RepoDep):  # noqa: N803 -- camelCase query params are the .NET wire contract
    file_path = await resolve_public_path(repo, dataId)
    return await asyncio.to_thread(engine_table_info, file_path=file_path)


@router.get("/table-data")
async def api_table_data(  # noqa: PLR0913 -- mirrors the .NET query surface 1:1
    dataId: str,  # noqa: N803 -- camelCase query params are the .NET wire contract
    repo: RepoDep,
    hduIndex: int = 0,  # noqa: N803
    page: int = 0,
    pageSize: int = 100,  # noqa: N803
    sortColumn: str | None = None,  # noqa: N803
    sortDirection: str | None = None,  # noqa: N803
    search: str | None = None,
):
    file_path = await resolve_public_path(repo, dataId)
    return await asyncio.to_thread(
        engine_table_data,
        file_path=file_path,
        hdu_index=hduIndex,
        page=page,
        page_size=pageSize,
        sort_column=sortColumn,
        sort_direction=sortDirection,
        search=search,
    )


@router.get("/spectral-data")
async def api_spectral_data(
    dataId: str,  # noqa: N803 -- camelCase query params are the .NET wire contract
    repo: RepoDep,
    hduIndex: int = 1,  # noqa: N803
):
    file_path = await resolve_public_path(repo, dataId)
    return await asyncio.to_thread(engine_spectral_data, file_path=file_path, hdu_index=hduIndex)
