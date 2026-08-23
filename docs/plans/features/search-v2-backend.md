# MAST Search v2 — Phase 0: backend fixes

**Branch:** `feature/search-v2-backend` · Phase 0 of the MAST Search v2 plan (Phases 1–6 follow as their own PRs). Python-only by design; the .NET gateway only gains passthrough fields.

## Problem

The MAST "radius" search is an uncorrected RA/Dec **box**: `s_ra = [ra−r, ra+r]` narrows toward the poles (at Dec 80 a 0.5° radius covers ~1/6 of the cone in RA) and breaks across RA 0/360. The 500-row page cap is logged but invisible to clients. The CE facade strips `filters` wholesale (unauthenticated override vector for `pagesize`/`obs_collection`), so no criteria can be sent at all. `calib_level` defaults to `[2, 3]` in the Python models while the product default is level 3.

## Changes

1. `processing-engine/app/mast/mast_service.py`
   - `_bbox_criteria(ra, dec, r)` — pure: clamp dec ±90, `ra_half = min(r / max(cos δ, 1e-6), 180)`; drop `s_ra` (dec band only) when the RA range crosses 0/360 or `|δ| + r ≥ 90`.
   - `_filter_by_separation(rows, ra, dec, r)` — centre-in-cone via `astropy.coordinates.angular_separation`; rows missing `s_ra`/`s_dec` are kept.
   - `_search_cone(...)` shared by `search_by_target` and `search_by_coordinates`; `mode='cone'` (default) post-filters, `'box'` returns raw bbox hits (Phase 6 draw-to-search).
   - `MastSearchResult(rows, truncated, page_size)` returned by every search method; `_warn_if_truncated` returns the bool. `DEFAULT_PAGE_SIZE = int_env("MAST_PAGE_SIZE", 500)`.
2. `processing-engine/app/mast/models.py`
   - `MastCriteria` (`extra='forbid'`): `instrument_name, filters, dataproduct_type, intentType, target_classification, proposal_id, proposal_pi` → `list[str]` (`^[A-Za-z0-9_./*-]+$`, ≤20); `t_min, t_max, t_exptime` → `tuple[float, float]` lo ≤ hi. Never `pagesize, obs_collection, s_ra, s_dec, t_obs_release, calib_level`.
   - `filters: MastCriteria | None` on target + coordinate requests; `mode: Literal['cone','box'] = 'cone'` on coordinate (null → cone for the .NET tier).
   - `MastSearchResponse.truncated: bool = False`, `page_size: int = 0`. `calib_level` default `[3]` on target/coordinate/program.
3. `processing-engine/app/mast/api_routes.py` — drop `snake.pop("filters")`; the `filters` subtree is passed verbatim through `camel_to_snake_keys` (CAOM names are data, `intentType` must not become `intent_type`). `app/db/casing.py` gains `verbatim_keys` on `camel_to_snake_keys`.
4. `processing-engine/app/mast/routes.py` — thread `truncated`/`page_size` into every `MastSearchResponse`; target cache key includes filters; `query_params` echo `filters`/`mode`.
5. `.NET` (`MastModels.cs`, `MastService.cs`) — pure passthrough: `Filters` (`Dictionary<string, JsonElement>?`) + `Mode` on the request DTOs, `Truncated`/`PageSize` on `MastSearchResponse`. No logic.
6. `scripts/prefetch_discovery.py` — `.rows` on the new result type.

## Tests

`tests/test_mast_search_geometry.py` (bbox dec 0/80, wrap, pole; cone keep/drop/missing; whitelist accept/reject incl. `pagesize`, regex, arity, lo>hi, ≤20; truncated flag incl. raw-page-vs-filtered and box mode). Contract tests: `filters` → 400 on `pagesize`, verbatim `intentType`, `truncated`/`page_size` in the envelope, calib default `[3]`, obs-id `calib_level` None. Fixture `post_mast_search_target.json` updated.

## Out of scope

Server-side polygon queries, astroquery upgrade, paging past the cap, .NET default `CalibLevel = [2, 3]` (frontend sends it explicitly; follow-up), frontend changes (Phases 1–6).
