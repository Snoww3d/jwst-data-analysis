# MAST Search v2 — Phase 6: Draw-to-search

**Branch:** `feature/search-v2-draw` · Parent plan: MAST Search v2 (Phases 0–6). Frontend only — the backend `mode:'box'` (Phase 0) already exists in both the Python engine and the .NET passthrough (`MastCoordinateSearchRequest.Mode`).

## Problem

Phase 5 put the sky on screen; this phase lets the user ask "what did JWST observe *here*" by drawing the *here*. It is the "I don't know the name but I know roughly where" half of exploration: draw a circle or polygon on the map, and the results table shows exactly the observations whose footprints intersect it.

## Decisions

- **Native Aladin selection.** The pinned Aladin v3 bundle has `aladin.select('circle'|'rect'|'poly', cb)` (verified in the bundle source): the circle callback receives `{x, y, r}` in pixels, the polygon callback `{vertices: [{x, y}]}`; conversion is `aladin.pix2world(x, y, 'icrs')` + `aladin.angularDist(x1, y1, x2, y2)` — both added to our hand-written typings. `aladin.fire('default')` returns the view to pan mode, which is how Escape / Clear cancels a draw. No hand-rolled vertex-click overlay needed.
- **Bbox query + client-side clip.** A drawn shape becomes its **bounding circle** (unit-vector centroid, radius = max angular separation, clamped ≤ 10° — the backend max) and runs through the existing `searchByCoordinates` with `mode:'box'`, which skips Phase 0's server cone post-filter. The response is then **clipped client-side**: a row is kept when any of its `s_region` polygons (via Phase 5's `parseStcs`) intersects the drawn shape.
- **Gnomonic projection, never raw (ra, dec).** Intersection tests project both shapes onto the tangent plane at the drawn shape's centroid (unit vectors → gnomonic), then run planar tests: polygon×polygon = edge-crossing ∨ vertex containment either direction; circle×polygon = vertex within r ∨ centre inside polygon ∨ min edge distance ≤ r. Scale error is ≈ tan θ/θ − 1: 0.4 % at 5°, 1.6 % at 10° — far below a footprint width. RA wrap and the poles are safe by construction (unit vectors never subtract RA). Shapes whose bounding circle exceeds 10° radius (~20° across) are rejected with a toast ("Draw a smaller region").
- **Unparseable footprints are kept**, not dropped: a row whose `s_region` yields no polygons cannot be disproved, so it stays in the results and is counted — the toolbar notes "N without a readable footprint kept".
- **A region replaces the query.** Drawing pushes a URL with `region=` and no `q`; submitting text drops `region`. One search subject at a time keeps the semantics (and the chip row) unambiguous. Facets apply to both.
- **URL**: `region=circle:ra,dec,r` / `region=poly:ra,dec;ra,dec;…` — 4 dp, ≤ 50 vertices (a denser Aladin polygon is evenly downsampled). Round-trips through `useSearchUrlState`, participates in `searchKey` (history cache), deep links auto-run. Invalid values are ignored.
- **Clipping lives in `useMastSearch`**, not the page: the outcome's `rows`/`count` are post-clip, `unclippable` and `region` ride along, and the history cache therefore restores clipped results. `truncated` keeps the server's meaning — the *bbox* hit the cap — and the banner says so in region terms: results may be incomplete; shrink the region.
- **Chip**: `REGION: POLYGON · 5 VTX (≈0.6°)` (monospace, uppercase) in the results toolbar, removable. Removing it pushes the URL without `region` and runs nothing new — back to the empty state (or the prior facet-only search, from cache).

## Changes

1. `FE/utils/skyGeometry.ts` (+test) — `SkyRegion`, `boundingCircle`, `regionTooLarge`, `clipResults`, gnomonic intersection helpers, `serializeRegion` / `parseRegionParam` / `describeRegion`.
2. `FE/types/aladin-lite.ts` — `select`, `fire`, `pix2world`, `angularDist`.
3. `FE/components/mast/map/SkyMap.tsx` + `.css` — Circle / Polygon / Clear chrome buttons, draw-state handling, persistent region overlay (`region` prop), `onRegionDrawn` / `onRegionClear`.
4. `FE/hooks/useSearchUrlState.ts` — `region` param (parse/serialise, `searchKey`, `hasSearch`).
5. `FE/components/mast/hooks/useMastSearch.ts` — `region` run option → bounding-circle bbox query + clip; `region`/`unclippable` on the outcome.
6. `FE/services/mastService.ts` — `mode` on `SearchByCoordinatesParams` (body + cache key).
7. `FE/components/mast/MastSearch.tsx` — wiring (draw → URL push, chip, toast, banner variant); `ResultsToolbar.tsx` — region chip + unclippable note + region truncation copy.
8. `e2e/mast-search.spec.ts` — region deep link with the Aladin stub: chip renders, count is the clipped count.

## Tests

`skyGeometry` table (≥ 12): bounding circle at RA 359/1° and dec 80°, clamp; polygon×polygon inside / outside / straddling; circle×polygon centre-inside / edge-graze / miss; UNION footprint where only the second member intersects; unparseable `s_region` kept + counted; oversize rejection; serialise/parse round-trip incl. junk. `useSearchUrlState` region round-trip + searchKey. `useMastSearch` region run (mocked service: mode:'box' sent, clip applied). `SkyMap` draw buttons with a stubbed `A` (select called, conversion, cancel). `MastSearch` wiring (mock SkyMap: drawn region pushes URL; chip removal clears it). Existing tests untouched.

## Out of scope

Server-side polygon search (astroquery has no `region=` yet), saving drawn regions, rect mode (circle + poly cover it), light theme.
