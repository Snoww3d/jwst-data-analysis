# CE Phase 1 — Day-1 Spike Report

**Date:** 2026-07-06
**Plan:** [`community-edition-v1.md`](community-edition-v1.md) (Phase 1) · Epic #1403
**Environment:** local dev stack (Docker), real MAST-imported data (1456 `jwst_data` docs, 724 MAST files on disk)

## Spike 1 — BSON casing: **PASS, no seed normalization needed**

Read a real .NET-written `jwst_data` document via motor into a pydantic model
inside the engine container:

- `model_config = ConfigDict(alias_generator=to_pascal, populate_by_name=True, extra="ignore")`
  parses PascalCase docs directly (`FileName`, `IsPublic`, `ObservationBaseId`, …).
- Gotcha: `_id` needs an explicit `Field(alias="_id")` — `to_pascal` would produce `Id`.
- `model_dump(by_alias=True)` round-trips to PascalCase, so any Python-written
  metadata (seed export) stays .NET-compatible.
- Nested `Metadata` keys are already snake_case-ish (`mast_obs_id`, `mast_filters`, …) —
  passed through as a plain `dict`, no aliasing needed.
- Edge check: **0 of 1456** docs are missing `IsPublic` — the anonymous filter
  (`{"IsPublic": true}`) has no absent-field hazard in real data.

**Decision:** Phase 2 read models use `to_pascal` aliasing; `seed-ce.sh` exports
Mongo metadata as-is (no casing rewrite).

`motor==3.6.0` was already in `requirements.txt`; `app/db/` is a docstring stub — Phase 2 wires the client.

## Spike 2 — Contract fixtures: **captured, mixed casing confirmed**

Golden anonymous responses from the running .NET API are checked in under
`processing-engine/tests/contract/fixtures/`:

| Fixture | Endpoint | Casing |
|---|---|---|
| `get_discovery_featured.json` | `GET /api/discovery/featured` | camelCase |
| `post_mast_search_target.json` | `POST /api/mast/search/target` | **snake_case envelope**, verbatim MAST rows inside (mixed-case: `intentType`, `jpegURL`, `objID`, `obsid`, …) |
| `post_discovery_suggest_recipes.json` | `POST /api/discovery/suggest-recipes` | camelCase envelope |
| `post_jwstdata_check_availability.json` | `POST /api/jwstdata/check-availability` | camelCase |
| `get_jwstdata_list.json` (first 5 records) | `GET /api/jwstdata?includeArchived=false` | camelCase |
| `get_health.json` | `GET /api/health` | n/a (single-word keys) |

Findings that would have bitten Phase 2 silently:

- **The wire contract is mixed-casing.** .NET-serialized DTOs are camelCase; the
  MAST search response is a snake_case envelope wrapping verbatim MAST result
  rows that are themselves mixed-case (`intentType`, `jpegURL`, `objID`, plain
  `obsid`). FastAPI must therefore NOT blanket-camelize (or blanket-snake-case);
  it must match per-endpoint, and the MAST rows pass through untouched.
- Request-side details: `POST /api/mast/search/target` takes `calibLevel` as a
  **list** (`[3]`), `radius` must be a number in `[0.01, 10]` (null → 400);
  `suggest-recipes` takes the `toObservationInputs` shape
  (`{filter, instrument, observationId, tObsRelease, dataProductType, sRa, sDec}`,
  camelCase, from `observationUtils.ts:8`).

## Spike 3 — Route inventory → `CE_MODE` allowlist

See `docs/plans/features/ce-phase1-route-allowlist.md` (companion file in this PR)
for the endpoint-by-endpoint inventory with sources.

**New requirement surfaced:** the frontend composite payload sends **`dataIds`**
(Mongo document ids), not file paths — the .NET `CompositeController` resolves
ids → engine paths before proxying. The CE Python composite route must do the
same resolution (a `db/` lookup) — it is not a pure engine passthrough.

## Spike 4 — Render timing: **preview ~5s; forced hi-res up to ~111s; 413s are instant**

Sync `generate-nchannel` timings against real local data (dev machine — expect
2–4× slower on a small VPS):

| Case | Result |
|---|---|
| 800px preview, 3ch MIRI (Crab, NGC-3132 groups) | **4–5s cold**, 200 OK |
| 4096px export of the same (warm reproject cache) | **~2s** |
| Forced (`allow_force_downscale`) 6ch NIRCam mosaic (NGC-3324) | **110.8s**, 200 OK, 1.4MB JPEG |
| Memory-budget 413 rejections | < 1s (cheap, no compute wasted) |

**Critical curation finding:** every large NIRCam mosaic group tested —
including featured targets like Carina/NGC-3324 — **413s at the default budget**
(`MAX_COMPOSITE_MEMORY_BYTES=3e9`, fail threshold 0.85) regardless of requested
output size, because the preflight is computed on the reproject grid. Renders
only pass for modest footprints (MIRI, small NIRCam obs). Therefore:

1. **Phase 5 completeness gate must include a render preflight** per featured
   recipe (`/composite/estimate` verdict `ok`/`warn`), not just files-on-disk.
   Curate observation groups (e.g. MIRI Crab, NGC-3132) whose recipes actually
   render at the CE budget.
2. **CE should not expose `allow_force_downscale`** in v1 — a 2-minute-plus
   synchronous render per anonymous click is a self-DoS. Deny/clamp it in the
   CE composite route.
3. **nginx timeout recommendation: 120s** on `/api` compute routes. Passing
   renders finish in seconds (5s dev ≈ 10–20s VPS); 120s gives generous
   headroom without letting a stuck render hold a connection for minutes.
   Pair with the render semaphore (Phase 4).

## Phase 2 implications (summary)

- Read models: `to_pascal` aliases; explicit `_id` alias; no seed normalization.
- Contract tests: fixture-diff per endpoint; per-endpoint casing (no global policy).
- Composite route: `dataIds → FilePath` resolution via the read repository;
  reject `allow_force_downscale` under `CE_MODE`.
- Seed tooling: completeness gate = files present **and** estimate verdict passes.
