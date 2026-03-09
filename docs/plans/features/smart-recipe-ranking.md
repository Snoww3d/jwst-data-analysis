# Plan: Smart Recipe Ranking and Cross-Instrument Color Mapping

**Status**: Completed 2026-03-09
**Created**: 2026-03-09

## Context

The discovery flow's recipe engine ranks cross-instrument composites last (rank 5), but for targets observed with both NIRCam and MIRI (like NGC 5134 from PHANGS-JWST), the combined composite is the most visually compelling result. The user got "close" in the composite wizard (manual control) but not in the discovery flow because:

1. The 4-filter NIRCam-only recipe was recommended — missing MIRI dust emission entirely
2. The 6-filter cross-instrument recipe existed but was buried at the bottom
3. Color mapping treated all filters uniformly — didn't separate stellar (NIRCam) from dust (MIRI) colors

Stretch presets (just added in #761) help but can't compensate for missing data or wrong color assignments.

## Approach

Three targeted changes to the recipe engine, all confined to existing files:

### 1. Promote cross-instrument recipes to rank 1

When multiple instruments are present, the combined "all filters" recipe becomes rank 1 (recommended). Single-instrument recipes shift down by 1 rank each.

### 2. Instrument-aware color mapping for cross-instrument recipes

- NIRCam filters → blue-to-green hues (240-120) — starlight, cool colors
- MIRI filters → yellow-to-red hues (60-0) — dust emission, warm colors
- Single-instrument recipes keep existing chromatic order behavior

### 3. Add recipe descriptions

Short 1-line descriptions explaining what each recipe is good for, displayed in the RecipeCard UI.

## Files to Modify

- `processing-engine/app/discovery/recipe_engine.py` — ranking, color mapping, descriptions
- `processing-engine/app/discovery/models.py` — add `description` field
- `processing-engine/tests/test_recipe_engine.py` — new + updated tests
- `backend/JwstDataAnalysis.API/Models/DiscoveryModels.cs` — add `Description` to `RecipeDto`
- `frontend/jwst-frontend/src/types/DiscoveryTypes.ts` — add `description` to `CompositeRecipe`
- `frontend/jwst-frontend/src/components/discovery/RecipeCard.tsx` + `.css` — render description
- `docs/architecture/discovery-recipe-flow.md` — update ranking docs

## Risk

Low — all changes additive, nullable new field, reversible in < 30 minutes.
