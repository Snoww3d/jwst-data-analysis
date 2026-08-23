"""CE /api/mast facade (ADR 0001 Phase 2).

The frontend speaks the .NET wire: camelCase request bodies, `whats-new`
instead of `search/recent`. The engine's snake_case response envelope passes
through verbatim (the .NET tier never reshaped it — pinned by the golden
fixture post_mast_search_target.json). Search only: import/download routes
are deliberately absent (deny-by-default, see
docs/plans/features/ce-phase1-route-allowlist.md).

Target search resolves featured-target display names to catalog ids first
(DiscoveryService.ResolveTargetAlias parity, e.g. 'Pillars of Creation' ->
'M16').
"""

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.db.casing import camel_to_snake_keys
from app.discovery.api_routes import resolve_target_alias
from app.mast.models import (
    MastCoordinateSearchRequest,
    MastFacetSearchRequest,
    MastObservationSearchRequest,
    MastProgramSearchRequest,
    MastRecentReleasesRequest,
    MastSearchResponse,
    MastTargetSearchRequest,
)
from app.mast.routes import (
    search_by_coordinates,
    search_by_facets,
    search_by_observation_id,
    search_by_program_id,
    search_by_target,
    search_recent_releases,
)


router = APIRouter(prefix="/api/mast", tags=["MAST API"])


# Request subtrees keyed by DATA, not by DTO property: `filters` holds raw
# CAOM criteria names (instrument_name, intentType, ...) that MastCriteria
# matches verbatim — case-mangling them would turn intentType into
# intent_type and fail the whitelist.
_VERBATIM_REQUEST_KEYS = frozenset({"filters"})


def _validate(model_cls, body: dict, transform=None):
    """camelCase body -> engine request model; FIELD-level validation errors
    become 400 (.NET DataAnnotations parity). Note: a malformed body that is
    not a JSON object still yields FastAPI's 422 at the request layer — the
    CE frontend always sends objects, so only field-level parity is
    maintained (pinned by test_malformed_body_is_422)."""
    snake = camel_to_snake_keys(body, verbatim_keys=_VERBATIM_REQUEST_KEYS)
    if transform is not None:
        snake = transform(snake)
    try:
        return model_cls.model_validate(snake)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors()) from exc


def _prepare_target_search(snake: dict) -> dict:
    if isinstance(snake.get("target_name"), str):
        # featured display names resolve to catalog ids (.NET parity)
        snake["target_name"] = resolve_target_alias(snake["target_name"])
    # `filters` is validated by MastCriteria on the request model — a closed
    # whitelist of CAOM criteria, so an unauthenticated client cannot reach
    # pagesize / obs_collection / s_ra / t_obs_release via this route.
    return snake


@router.post("/search/target", response_model=MastSearchResponse)
async def api_search_target(body: dict) -> MastSearchResponse:
    request = _validate(MastTargetSearchRequest, body, transform=_prepare_target_search)
    return await search_by_target(request)


@router.post("/search/coordinates", response_model=MastSearchResponse)
async def api_search_coordinates(body: dict) -> MastSearchResponse:
    return await search_by_coordinates(_validate(MastCoordinateSearchRequest, body))


@router.post("/search/observation", response_model=MastSearchResponse)
async def api_search_observation(body: dict) -> MastSearchResponse:
    return await search_by_observation_id(_validate(MastObservationSearchRequest, body))


@router.post("/search/program", response_model=MastSearchResponse)
async def api_search_program(body: dict) -> MastSearchResponse:
    return await search_by_program_id(_validate(MastProgramSearchRequest, body))


@router.post("/search/facets", response_model=MastSearchResponse)
async def api_search_facets(body: dict) -> MastSearchResponse:
    """Position-less facet search (MAST Search v2 Phase 4). `filters` is the
    same closed MastCriteria whitelist as the target/coordinate routes."""
    return await search_by_facets(_validate(MastFacetSearchRequest, body))


@router.post("/whats-new", response_model=MastSearchResponse)
async def api_whats_new(body: dict) -> MastSearchResponse:
    """.NET route name for the engine's /mast/search/recent."""
    return await search_recent_releases(_validate(MastRecentReleasesRequest, body))
