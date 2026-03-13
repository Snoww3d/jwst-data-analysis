"""FastAPI routes for the discovery suggestion/recipe engine."""

import logging
import os
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from functools import lru_cache

from fastapi import APIRouter, HTTPException

from app.mast.mast_service import MastService

from .models import SuggestRecipesRequest, SuggestRecipesResponse, TargetInfo
from .recipe_engine import deduplicate_mosaic_observations, generate_recipes


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/discovery", tags=["Discovery"])

# Shared MastService instance for availability checks during dedup
_download_dir = os.environ.get("MAST_DOWNLOAD_DIR", os.path.join(os.getcwd(), "data", "mast"))
_mast_service = MastService(download_dir=_download_dir)

# Shared thread pool for MAST availability checks (avoids per-call pool churn)
_availability_pool = ThreadPoolExecutor(max_workers=3)

# Timeout for per-obs_id availability checks (seconds). If MAST is slow,
# we fall back to o-prefix rather than blocking the recipe endpoint.
_AVAILABILITY_CHECK_TIMEOUT = 5.0


@lru_cache(maxsize=256)
def _cached_check_has_products(obs_id: str) -> bool:
    """Check product availability, cached by obs_id.

    c-prefix availability is stable (pipeline mosaics don't appear/disappear),
    so caching avoids repeated MAST queries for the same obs_id across requests.
    Cache is bounded to 256 entries to prevent unbounded growth.
    """
    return _mast_service.check_has_products(obs_id)


def _check_has_products_with_timeout(obs_id: str) -> bool:
    """Check product availability with a timeout to avoid blocking recipe suggestions.

    Uses an LRU cache so repeated checks for the same obs_id are instant.
    Falls back to o-prefix (returns False) on timeout or error.
    """
    future = _availability_pool.submit(_cached_check_has_products, obs_id)
    try:
        return future.result(timeout=_AVAILABILITY_CHECK_TIMEOUT)
    except (FutureTimeoutError, Exception) as e:
        logger.warning(
            "Availability check timed out or failed for %s, falling back to o-prefix: %s",
            obs_id,
            e,
        )
        return False


@router.post("/suggest-recipes", response_model=SuggestRecipesResponse)
def suggest_recipes(request: SuggestRecipesRequest) -> SuggestRecipesResponse:
    """Generate composite recipe suggestions for a target's observations.

    Takes a list of observations (filter, instrument, wavelength) and returns
    ranked composite recipes with chromatic-ordered color assignments.

    Before recipe generation, deduplicates c-prefix (pipeline mosaic) and
    o-prefix (individual) observations for the same filter+instrument.
    Prefers c-prefix when downloadable (spatial superset), falls back to o-prefix.

    Returns:
        SuggestRecipesResponse with target info and ranked recipes.
    """
    if not request.observations:
        raise HTTPException(
            status_code=400,
            detail="observations list is required",
        )

    logger.info(
        f"Generating recipes for {len(request.observations)} observations"
        f" (target: {request.target_name or 'unknown'})"
    )

    # Deduplicate c-prefix vs o-prefix observations before recipe generation.
    # c-prefix (pipeline mosaics) are preferred when available since they're
    # spatial supersets, but they have inconsistent download availability.
    # Uses a timeout-wrapped checker to avoid blocking the endpoint.
    observations = deduplicate_mosaic_observations(
        request.observations,
        availability_checker=_check_has_products_with_timeout,
    )

    recipes = generate_recipes(observations, target_name=request.target_name)

    target = TargetInfo(name=request.target_name) if request.target_name else None

    logger.info(f"Generated {len(recipes)} recipes")

    return SuggestRecipesResponse(target=target, recipes=recipes)
