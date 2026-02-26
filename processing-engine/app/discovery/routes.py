"""FastAPI routes for the discovery suggestion/recipe engine."""

import logging

from fastapi import APIRouter, HTTPException

from .models import SuggestRecipesRequest, SuggestRecipesResponse, TargetInfo
from .recipe_engine import generate_recipes


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/discovery", tags=["Discovery"])


@router.post("/suggest-recipes", response_model=SuggestRecipesResponse)
async def suggest_recipes(request: SuggestRecipesRequest) -> SuggestRecipesResponse:
    """Generate composite recipe suggestions for a target's observations.

    Takes a list of observations (filter, instrument, wavelength) and returns
    ranked composite recipes with chromatic-ordered color assignments.

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

    recipes = generate_recipes(request.observations)

    target = TargetInfo(name=request.target_name) if request.target_name else None

    logger.info(f"Generated {len(recipes)} recipes")

    return SuggestRecipesResponse(target=target, recipes=recipes)
