"""FastAPI routes for the discovery suggestion/recipe engine."""

import logging

from fastapi import APIRouter, HTTPException

from .models import SuggestRecipesRequest, SuggestRecipesResponse, TargetInfo
from .recipe_engine import deduplicate_mosaic_observations, generate_recipes


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/discovery", tags=["Discovery"])


@router.post("/suggest-recipes", response_model=SuggestRecipesResponse)
def suggest_recipes(request: SuggestRecipesRequest) -> SuggestRecipesResponse:
    """Generate composite recipe suggestions for a target's observations.

    Takes a list of observations (filter, instrument, wavelength) and returns
    ranked composite recipes with chromatic-ordered color assignments.

    Before recipe generation, deduplicates c-prefix (pipeline mosaic) and
    o-prefix (individual) observations for the same filter+instrument.
    Always prefers o-prefix (reliable downloads) over c-prefix.

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
    # Always prefers o-prefix (individual observations) which are reliably
    # downloadable. c-prefix (pipeline mosaics) have unreliable availability.
    observations = deduplicate_mosaic_observations(request.observations)
    logger.info(
        "Dedup: %d observations → %d after deduplication",
        len(request.observations),
        len(observations),
    )

    recipes = generate_recipes(observations, target_name=request.target_name)

    target = TargetInfo(name=request.target_name) if request.target_name else None

    logger.info(f"Generated {len(recipes)} recipes")
    for r in recipes:
        obs_id_count = len(r.observation_ids) if r.observation_ids else 0
        logger.debug(
            "  Recipe '%s' (rank %d): %d filters, %d obs_ids, instruments=%s",
            r.name,
            r.rank,
            len(r.filters),
            obs_id_count,
            r.instruments,
        )

    return SuggestRecipesResponse(target=target, recipes=recipes)
