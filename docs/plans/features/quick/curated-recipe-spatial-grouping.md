# Curated recipe spatial grouping

## Problem

Curated NASA-style recipes (NGC 346, Cosmic Cliffs, Pillars of Creation, Stephan's Quintet, etc.) were producing patchwork output. NGC 346 was observed by JWST as 6 tiled mosaics; the `_inject_curated_recipes` function in `processing-engine/app/discovery/recipe_engine.py` collected every observation whose filter matched the recipe — across all tiles — and combined them. The resulting composite has full filter coverage only in the small region where all tiles overlap.

The cross-instrument path (`generate_recipes` lines 1066-1156) already calls `group_by_spatial_overlap()` to handle this, but the curated path skipped that step.

## Fix

In `_inject_curated_recipes`:

1. Run `group_by_spatial_overlap(relevant_obs)` on the filter-matched observations.
2. Keep only clusters whose member observations cover **all** required filters.
3. Sort qualifying clusters by `(observation count desc, sum of FOV² desc)`.
4. Emit the largest cluster as the primary recipe (`rank=0`).
5. Demote additional clusters to `rank=DEMOTED_ALL_RANK` with `(alt tile N)` name suffix.
6. Fallback: if no single cluster has full filter coverage (filters split across disjoint tiles), combine all relevant obs and surface `overlap_warning` so the user knows the result will be patchy.

## Tests

- `test_ngc346_disjoint_tiles_emit_per_tile_recipes` — two non-overlapping tiles each with all 4 filters → 1 primary + 1 alt, obs_ids never cross tile boundaries.
- `test_ngc346_split_filters_across_tiles_warns` — filters split across disjoint tiles → single fallback recipe with `overlap_warning`.
- All existing curated-recipe tests still pass (no-coords path unchanged thanks to `group_by_spatial_overlap` returning `[list(observations)]` when no obs have RA/Dec).

## Generalizes to

Every target in `CURATED_RECIPES` benefits — Cosmic Cliffs (NGC 3324), Pillars of Creation (M-16), Stephan's Quintet, Southern Ring (NGC 3132), Webb's First Deep Field (SMACS 0723), and NGC 346 (both NIRCam and MIRI variants).

## Risk

Low — single-function change in the curated path, gated behind `target_name` matching a curated key. No-spatial-data inputs are preserved by `group_by_spatial_overlap`'s backward-compat single-group return. 1349 tests pass; ruff clean.
