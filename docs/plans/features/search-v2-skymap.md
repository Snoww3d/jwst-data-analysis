# MAST Search v2 — Phase 5: Sky map (Aladin Lite) + browse-first empty state

**Branch:** `feature/search-v2-skymap` · Parent plan: MAST Search v2 (Phases 0–6). Frontend + a small Python addition (+ .NET passthrough) + nginx CSP.

## Problem

Every MAST result already carries an `s_region` footprint polygon, and nothing renders it. The results table answers "what did MAST return" but not "where is it on the sky" — and a user arriving at `/search` with nothing in mind gets a blank input and a blank rail. The plan's decision 5 ("exploration, not just lookup") makes the empty state a browsing surface: the whole sky with JWST coverage, the recent releases, and the recent searches.

## Decisions

- **Aladin Lite v3 via a runtime script-tag loader** (`lib/loadAladin.ts`), not an npm import: the bundle is LGPL-3.0, the repo is MIT, and a separately-fetched, separately-replaceable script keeps the boundary clean. `VITE_ALADIN_URL` overrides the CDN (CE operators can self-host on LAN). The loader feature-detects WebGL2 first (Aladin v3's `A.init` rejects without it), times out after 10 s, memoises the promise. The subset of the API we use is typed by hand in `types/aladin-lite.d.ts`.
- **`SplitView` ui primitive.** Two horizontal panes, pointer-draggable divider with keyboard (←/→, Home/End) and `aria-valuenow`; stacks below 1024 px; ratio persisted per caller `storageKey`; `collapsed` hides the secondary pane. Documented in `components/ui/README.md`. `FitsViewer.css` is not retrofitted.
- **Our own STC-S parser** (`components/mast/map/footprints.ts`) serves everything that is logic — bounds, centroid, `fitToResults`, and Phase 6 clipping. Aladin's `A.footprintsFromSTCS` draws. Actual JWST rows are bare 4-vertex `POLYGON` strings with no frame token (fast path); the tolerant path accepts an optional frame token (no transform), `CIRCLE` (→ 32-gon), `UNION (…)`, concatenated polygons, lowercase, nested parens; `NOT`/unknown shapes are counted and skipped.
- **Footprints in one `A.graphicOverlay`; hover/selection in a second.** Colour by instrument — the swatch tokens (`--instrument-*`) are read from the document at runtime so the canvas matches the chips. Row ↔ footprint linkage via `hoverId` / `selectedIds` in `MastSearch` page state (no new context); map click selects the row and scrolls it into view.
- **View toggle.** `?view=split` (parsed since Phase 2) is now enabled; the table is the primary pane, the map the secondary one. "Fit map to results" in the toolbar.
- **Browse-first empty state** (no `q`, no narrowing facets): the results area shows the map at whole-sky FOV with a **coverage layer**, "What's New" as the default panel (compact header; a row click moves the map to it and highlights it), and recent-search chips above the input. The `EmptyState` copy invites — "Pan the sky, pick a recent release, or type a target" — never "no results". Clicking a coverage footprint pushes `q=<ra dec>` (`r=0.2`) to the URL, which runs the normal coordinate search.
- **Coverage payload shape — measured, not guessed.** `GET /mast/coverage` (+ `GET /api/mast/coverage` in CE, + .NET passthrough `GET api/mast/coverage` for the full stack) runs `query_criteria(obs_collection='JWST', calib_level=3, dataproduct_type='image', intentType='science')` once, paged, and caches the result for 24 h (`TTLCache`, `Cache-Control: public, max-age=86400`). The measurement (see the PR) decided between the flat footprint list and a density grid; the response carries `shape` so the frontend renders either. If the grid shape is in use, real footprints are only fetched when the map FOV is below 10° (`?bbox=`).
- **CSP.** `nginx-ssl.conf` gains the Aladin host in `script-src` plus `'wasm-unsafe-eval'`, `data:` + the CDS hosts in `connect-src`, the CDS hosts in `img-src`, and `worker-src blob:`. Aladin v3 fetches HiPS tiles from the Rust/wasm core via `fetch()` (connect-src), not `<img>`; its wasm is an inlined `data:` URL instantiated through `fetch` + `WebAssembly.instantiateStreaming`; its tile-decode worker is a `blob:` URL. `nginx-ce.conf` has no CSP; `docs/ce/` notes the directives a CE operator adding one needs.
- **Offline / failure modes.** Loader timeout or no WebGL → `EmptyState` "Sky map unavailable" inside the secondary pane; the table stays fully usable. Tile errors → a small banner; footprints still render. Coverage fetch failure → banner on the empty-state map.

## Changes

1. `FE/components/ui/SplitView.tsx` + `.css` (+test), `ui/README.md`.
2. `FE/lib/loadAladin.ts` (+test), `FE/types/aladin-lite.d.ts`, `vite-env.d.ts` (`VITE_ALADIN_URL`).
3. `FE/components/mast/map/footprints.ts` (+test), `SkyMap.tsx` + `.css` (+test), `instrumentColors.ts`.
4. `FE/components/mast/MastSearch.tsx` — split layout, hover/selection linkage, empty state; `ResultsToolbar.tsx` — Split enabled, Fit-to-results; `ResultsTable.tsx` — hover/highlight props; `BrowseEmptyState.tsx` + `.css`.
5. `FE/components/WhatsNewPanel.tsx` — `compact` + `onSelect` props; removed from `pages/SearchPage.tsx`.
6. `FE/services/mastService.ts` — `getCoverage`; `MastTypes.ts` — coverage types.
7. `processing-engine/app/mast/routes.py` — `GET /mast/coverage`; `api_routes.py` — `GET /api/mast/coverage`; `mast_service.py` — `get_coverage`; `tests/test_ce_mode_mounting.py` allowlist; coverage route tests.
8. `.NET` — `GetCoverageAsync` passthrough + `GET api/mast/coverage`.
9. `frontend/jwst-frontend/nginx-ssl.conf` CSP; `docs/ce/` note; `docs/quick-reference.md`.
10. `e2e/mast-search.spec.ts` — empty state shows What's New; split toggles; row hover adds the highlight class (Aladin stubbed via `page.route`).

## Tests

`parseStcs` table (≥12 cases incl. the real fixture, frame token, UNION of 4, CIRCLE, lowercase, garbage, RA wrap); `footprintBounds` / `footprintCentroid`; `SplitView` drag / collapse / persist / keyboard; `loadAladin` memoisation, timeout, no-WebGL; `SkyMap` with a stubbed `window.A` incl. loader timeout → EmptyState; `MastSearch` split layout + hover linkage + empty-state render; Python: coverage route shape, cache, CE allowlist. Existing tests untouched.

## Out of scope

Draw-to-search (Phase 6), "browse by target" index, `FitsViewer` → `SplitView`, light theme.
