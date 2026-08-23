# MAST Search v2 — Phase 4: Filter rail + query-less faceting

**Branch:** `feature/search-v2-filters` · Parent plan: MAST Search v2 (Phases 0–6). Frontend + a small Python addition + a .NET passthrough.

## Problem

Phase 0 taught the backend to accept a whitelisted `filters` (`MastCriteria`) subtree on the target and coordinate routes, but nothing in the UI sends one, and the only position-less search is the hard-wired "What's New" (`/mast/search/recent`: release window + one instrument). A user who knows *what* they want ("MIRI cubes from this spring") but not *where* has no way to ask, and a user who knows where cannot narrow 500 capped rows by instrument or filter.

## Decisions

- **Facets are URL state.** `useSearchUrlState` implements the names reserved in Phase 2 — `inst, filt, dpt, from, to, exp` — plus `mode` (instrument sub-mode), `intent`, `days` (facet-only release window) and a generalised `calib` (`all` | comma list, `all` still means 1–3). They are part of `searchKey`, so Back/Forward and the history cache respect them. `utils/mastCriteria.ts` owns `FacetState`, `buildCriteria` (state → wire `MastCriteria`, dates → MJD via `dateToMjd`), and the URL round-trip.
- **Apply, not auto-search.** The rail edits a draft; **Apply** pushes the URL (CE nginx rate-limits MAST at 2 r/s). Apply is disabled while the draft equals the URL. Clear-all resets the draft and, if the URL had facets, applies.
- **Active filters are chips** above the results — monospace, uppercase, coloured swatch dot (design rule), each removable (removing applies immediately: it is one deliberate click).
- **Query-less faceting.** An empty `q` with any non-default facet is a valid search. Backend: the recent-releases body in `mast_service.py` is generalised into `_search_by_criteria` (release window + whitelisted criteria + calib level, sorted newest-first, limit/offset); `search_recent_releases` keeps its signature on top of it; new `search_by_facets` and `POST /mast/search/facets` (+ `/api/mast/search/facets` CE facade, + .NET passthrough). When the criteria carry no `t_min`/`t_max` and the client sent no `days_back`, the server applies **90 days** and says so (`default_window_applied: true`); the UI shows it as a removable "LAST 90 DAYS" chip. Removing it widens to 365 days explicitly; past that, the chip says to set a date range — a bare "MIRI" never pulls the whole archive.
- **Intent defaults to science.** The rail's Intent is Science / Calibration / Any; Science is the default and is sent explicitly (`intentType: ['science']`), so Level-3 calibration products stop padding results. `intent=any` removes the constraint.
- **ID lookups ignore facets.** Observation-ID and program searches do not take `filters` (the backend routes have none); the rail shows "Filters don't apply to ID lookups" and Apply stays enabled (it re-runs the lookup unchanged).

## Changes

1. `processing-engine/app/mast/models.py` — `MastFacetSearchRequest`, `default_window_applied` on `MastSearchResponse`, `resolve_facet_window`.
2. `processing-engine/app/mast/mast_service.py` — `_search_by_criteria`, `search_by_facets`, `search_recent_releases` re-based on it; `_warn_if_truncated` / `_search_result` take an optional page size.
3. `processing-engine/app/mast/routes.py` — `POST /search/facets` with a `TTLCache`; `api_routes.py` — `/api/mast/search/facets`.
4. `.NET` — `MastFacetSearchRequest` DTO, `DefaultWindowApplied` on the response DTO, `SearchByFacetsAsync` passthrough, `POST api/mast/search/facets` (pure proxy; mirrors Phase 0's `Filters`/`Mode`).
5. `FE/utils/mastCriteria.ts` (+test) — `FacetState`, `buildCriteria`, `facetsToUrl`/`urlToFacets`, `describeFacets` (chips).
6. `FE/hooks/useSearchUrlState.ts` (+test) — facet params, generalised `calib`, `hasSearch`.
7. `FE/services/mastService.ts` — `filters` on target/coordinates bodies + cache keys, `searchByFacets`.
8. `FE/components/mast/hooks/useMastSearch.ts` (+test) — `run(parsed | null, …)`: null + criteria → `searchByFacets`; `defaultWindowApplied` on the outcome; `'facets'` search type.
9. `FE/components/mast/FilterRail.tsx` + `.css` (+test), `ActiveFilterChips.tsx` + `.css`.
10. `FE/components/mast/MastSearch.tsx` — rail layout, chips, facet-only run, "Last 90 days" chip.
11. `e2e/mast-search.spec.ts` — one facet-only scenario.

## Tests

`mastCriteria` round-trip and criteria building; `useSearchUrlState` facet round-trip + `searchKey` includes facets; `FilterRail` renders per instrument, Apply disabled when unchanged, chips removable; `useMastSearch` facet-only path; `MastSearch` auto-runs `/search?inst=MIRI&dpt=cube` and sends `filters` with a target search; Python: default window applied, explicit dates override, truncation flag, whitelist rejects `pagesize`, recent-releases unchanged.

## Out of scope

Sky map / `view=split` (Phase 5), draw-to-search (Phase 6), server paging past the cap, "browse by target" index (follow-up issue in the parent plan).
