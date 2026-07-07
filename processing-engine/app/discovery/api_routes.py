"""CE /api facade for discovery (ADR 0001 Phase 2).

Two concerns live here that the unprefixed engine routes don't have:

1. ``/api/discovery/featured`` — serves featured_targets.json, which moved
   from the .NET Configuration dir (the .NET copy remains canonical for the
   main app until the gateway retires; keep them in sync).
2. ``/api/discovery/suggest-recipes`` — the frontend speaks camelCase (the
   .NET wire contract) while the engine models are snake_case. This facade
   converts request/response casing; the existing ``/discovery/suggest-recipes``
   route keeps its snake_case wire because the .NET proxy depends on it.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.db.casing import camel_to_snake_keys, snake_to_camel_keys
from app.discovery.models import SuggestRecipesRequest
from app.discovery.routes import suggest_recipes as engine_suggest_recipes


router = APIRouter(prefix="/api/discovery", tags=["Discovery API"])

_FEATURED_PATH = Path(__file__).parent / "featured_targets.json"


@lru_cache(maxsize=1)
def load_featured_targets() -> list[dict[str, Any]]:
    """Load and normalize featured targets to the .NET DTO shape.

    The .NET serializer emits mastSearchParams.searchRadius as an explicit
    null when absent; the fixture pins that, so the facade adds it.
    """
    targets = json.loads(_FEATURED_PATH.read_text())
    for target in targets:
        params = target.setdefault("mastSearchParams", {})
        params.setdefault("searchRadius", None)
    return targets


def resolve_target_alias(name: str) -> str:
    """Map display names to catalog ids (e.g. 'Pillars of Creation' -> 'M16').

    Parity with DiscoveryService.ResolveTargetAlias — used by the MAST target
    search facade (next Phase 2 PR).
    """
    lowered = name.strip().lower()
    for target in load_featured_targets():
        if target.get("name", "").lower() == lowered:
            return target.get("catalogId") or name
    return name


@router.get("/featured")
async def get_featured_targets() -> list[dict[str, Any]]:
    return load_featured_targets()


@router.post("/suggest-recipes")
async def suggest_recipes_api(request: dict) -> JSONResponse:
    """camelCase wrapper around the engine recipe route.

    Deliberately reuses the engine handler (including its 400 on empty
    observations) so recipe behavior can never drift between the two wires.
    """
    engine_request = SuggestRecipesRequest.model_validate(camel_to_snake_keys(request))
    response = engine_suggest_recipes(engine_request)
    payload = response.model_dump(mode="json")
    for recipe in payload.get("recipes", []):
        # exact .NET wire parity: SuggestRecipesResponseDto has no
        # recommended_feather_strength field, so the .NET tier drops it
        recipe.pop("recommended_feather_strength", None)
    return JSONResponse(content=snake_to_camel_keys(payload))
