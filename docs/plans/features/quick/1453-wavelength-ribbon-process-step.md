# Plan: Wavelength ribbon on Process step

**Issue**: #1453
**Complexity**: Quick (presentational, additive, no data-flow changes)

## Problem

Step 2 of Create Composite (`ProcessStep.tsx` in `GuidedCreate`) is a 2–4 minute wait dominated by a stage checklist + spinner. The most interesting thing the app does — mapping N filters spanning ~0.6µm to ~25µm onto a chromatic gradient — is invisible. Users can't see *what* the composite is doing.

## Fix

Add a `WavelengthRibbon` subcomponent to `ProcessStep.tsx` that renders one colored tile per filter, log-spaced by wavelength, while the job runs. Tile color uses the recipe's `colorMapping[filter]` when present, falling back to a wavelength-derived hue.

## Files Changed

| File | Change |
|------|--------|
| `frontend/jwst-frontend/src/components/guided/ProcessStep.tsx` | Add `WavelengthRibbon` co-located subcomponent + `filters` / `colorMapping` props on `ProcessStep` (both optional). |
| `frontend/jwst-frontend/src/components/guided/ProcessStep.css` | Ribbon styles (track, tile, label) + dark-theme tile contrast. |
| `frontend/jwst-frontend/src/pages/GuidedCreate.tsx` | Forward `recipe.filters` and `recipe.colorMapping` to `ProcessStep`. |
| `frontend/jwst-frontend/src/components/guided/ProcessStep.test.tsx` | Cover render/hide/ordering/colorMapping/fallback/span-zero cases. |

## Implementation Notes

- **Subcomponent stays co-located**: minimal diff, scope-locked (no Result-step reuse).
- **Layout**: absolute positioning per tile, `left = (log(wavelength) - logMin) / (logMax - logMin)`. Honors the engine's log-bin metaphor.
- **Memoization**: `useMemo` over `buildRibbonTiles(filters, colorMapping)` to keep tile math out of the 1Hz elapsed-time re-render loop.
- **Casing fallback**: `colorMapping[filter] ?? colorMapping[filter.toUpperCase()]`.
- **Span-zero guard**: when `logMax - logMin === 0` (all filters identical wavelength — degenerate recipe), every tile gets `position = 0.5`.
- **Filter dropping**: filters where `parseWavelength` returns `null` are excluded rather than placed arbitrarily.
- **Hide threshold**: ribbon is not rendered when fewer than 2 known-wavelength tiles remain. Single-tile ribbons add no visual information.
- **A11y**: `role="img"` + `aria-label` listing every filter+wavelength; per-tile `title` for hover. Static (no animation), so reduced-motion is a no-op.

## Test Plan

- [x] Renders one tile per filter (4-filter NGC 346 NIRCam case)
- [x] Tiles ordered shortest→longest wavelength regardless of input order
- [x] Hidden when `filters.length === 0`
- [x] Hidden when `filters.length === 1`
- [x] Hidden when all filters fail `parseWavelength`
- [x] Tile color uses `colorMapping[filter]` when present (NGC 346: F200W → #0000ff)
- [x] Tile color falls back to `wavelengthToHue` when `colorMapping` missing
- [x] `colorMapping` casing tolerance: lowercase filter key resolves
- [x] Span-zero degenerate input doesn't produce NaN positions
- [x] `vitest` passes
- [x] `tsc` clean
- [x] Manual: NGC 346 NASA NIRCam recipe shows 4 tiles in chromatic order (blue→cyan→orange→red)
- [x] Manual: 2-filter bicolor recipe shows 2 tiles
- [x] Manual: mosaic-required target — no flicker on mosaic→composite transition

## NOT in Scope

- Progressive fill (tiles fade in as channels load) — engine emits no per-filter signal today; multi-PR backend work; CEO review locked out.
- Tooltip / click-to-explain per filter.
- Reusing the ribbon in `ResultStep`.
- Animation on idle.
- Wavelength axis tick labels under the ribbon.

## Risk

Low. Pure presentation, additive. Dropping the new props behaves identically to today's component. No auth, data model, API, or DTO impact. Reversal cost: <1 hour.
