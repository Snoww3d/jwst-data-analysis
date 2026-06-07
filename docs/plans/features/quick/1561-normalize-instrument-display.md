# Plan: Normalize instrument names in recipe/target card meta line

**Issue**: #1561
**Complexity**: Quick (presentational display helper, follow-up to #1454)

## Problem

#1454 cleaned up auto-generated recipe **titles** via display normalization in
`recipe_engine.py` (`normalize_instrument_for_display` / `format_instruments_for_display`).
But the recipe/target **cards render the raw `instruments` field directly** in their
meta line, so users still see the `/IMAGE` suffix and all-caps form (e.g.
`NIRCAM/IMAGE + MIRI/IMAGE`).

The `instruments` field is intentionally kept raw on the backend (data field for
downstream consumers), so normalization belongs at the render site.

## Fix

Add a small TS display helper mirroring the backend helpers, then apply it at the
two render sites.

## Files Changed

| File | Change |
|------|--------|
| `frontend/jwst-frontend/src/utils/instrumentDisplay.ts` | New `formatInstruments(raw: string[]): string` + `normalizeInstrument(raw: string): string`, mirroring the backend (`NIRCAM/IMAGE` → `NIRCam`, ordered NIRCam → NIRISS → NIRSpec → FGS → MIRI, ` + ` joined, dedup, unknown title-cased + sorted). |
| `frontend/jwst-frontend/src/utils/instrumentDisplay.test.ts` | Unit tests mirroring `test_recipe_engine.py` cases. |
| `frontend/jwst-frontend/src/components/discovery/RecipeCard.tsx` | Replace `recipe.instruments.join(' + ')` with `formatInstruments(recipe.instruments)`. |
| `frontend/jwst-frontend/src/components/discovery/TargetCard.tsx` | Replace `target.instruments.join(' + ')` with `formatInstruments(target.instruments)`. |
| `frontend/jwst-frontend/e2e/target-detail.spec.ts` | Update pinned raw form `NIRCAM/IMAGE + MIRI/IMAGE` → `NIRCam + MIRI`. |

## Implementation Notes

- Ordering and normalization map kept identical to the backend `_INSTRUMENT_DISPLAY`
  / `_INSTRUMENT_DISPLAY_ORDER` so the cards match recipe titles exactly.
- Unknown instruments fall back to title-cased base and are appended in sorted order
  for determinism (mirrors backend).
- `TargetCard` uses the formatted text for both the visible meta line and the
  `aria-label`, so the accessible name stays clean too.

## Acceptance

- [x] Recipe and target cards show clean instrument names (no `/IMAGE`, proper casing).
- [x] E2E assertion updated.
- [x] Ordering matches the backend display helper.
