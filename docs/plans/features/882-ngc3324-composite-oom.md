# 882 — NGC-3324 Composite OOM Fix (3-PR Train)

## Problem

NGC-3324 walkthrough recipes (multi-instrument and NIRCAM-only) fail with OOM kills on memory-constrained hosts (~4GB processing-engine container). The F090W filter has 158 individual files producing a 33M+ pixel mosaic that exceeds the memory budget.

Symptoms:
- `recipe-walkthrough.py --target NGC-3324` → all recipes fail with "response ended prematurely"
- Backend logs: `System.Net.Http.HttpIOException: The response ended prematurely`
- Processing engine container is OOM-killed mid-request

Root causes:
1. `effective_arrays = n + 12` undercounts the transient memory peak during `reproject_interp` (2 coordinate transform arrays + ~1 map_coords buffer + headroom = +5 unaccounted arrays)
2. The current downscale-to-fit policy is **silent** — operators see degraded output without explanation
3. The memory model is **unverified** — no integration test measures real RSS during composite generation
4. **`<4GB VPS targets` are unsupported** — Hetzner CX11-class hosts (the cheapest CE deploy target) still OOM with the 3GB composite budget
5. Operator-facing tuning knobs (`MAX_COMPOSITE_MEMORY_BYTES`) exist in code but are not exposed in `docker-compose.yml` or documented in `.env.example`

## Solution overview

Hybrid downscale policy: **fail-fast on heavy reductions**, warn-and-proceed on mild reductions, with operator-tunable thresholds and a new pre-flight estimate endpoint so callers can check feasibility before submitting work.

## Decisions (from CEO + eng review)

| ID | Decision |
|---|---|
| Mode | B — Selective expansion (hold OOM-fix scope, surface alternatives to silent downscale) |
| EXP-1 | Hybrid policy: HTTP 413 on heavy downscale, warn-and-proceed on mild |
| EXP-2 | RSS-instrumented integration test with `@pytest.mark.memory` opt-in marker |
| EXP-3 | Tuning table in `.env.example` for 2GB / 4GB / 8GB+ hosts (no cgroup auto-detection) |
| EXP-4 | Frontend toast on 413 + warning surface on mild downscale |
| EXP-5 | New `POST /composite/estimate` endpoint + `recipe-walkthrough.py` pre-flight |
| ARCH-1 | 3-PR train: engine → backend → frontend+script |
| ARCH-2 | Warning channel: HTTP response headers (`X-Composite-*`), not JSON-wrapped image |
| ARCH-3 | `/composite/estimate` accepts full `NChannelCompositeRequest` payload |
| RISK-1 | Memory test runs on-touch (composite/** paths-filter) + nightly cron |
| RISK-2 | `COMPOSITE_DOWNSCALE_FAIL_THRESHOLD` default = 0.85 (strict) |

## NOT in scope

- **Tile-based streaming** — the only "real" fix for super-large mosaics. Filed as #1423. Defer to post-CE-deploy.
- **Per-filter file count cap** — alternative to tiling. Filed as #1424. Defer to real-user feedback.
- **Cgroup auto-detection** — rejected; documented presets are simpler.
- **WCS header caching for estimate** — defer; revisit if walkthrough becomes painfully slow.

## PR Train

### PR 1 — Processing Engine (this branch)

`feature/882-ngc3324-composite-oom-engine`

**Goal:** ship the OOM-killing fix with backend-callable contract complete. Even if PR2/PR3 stall, this PR alone replaces silent OOM-kill with structured 413 errors.

**Changes:**

| File | Change |
|---|---|
| `processing-engine/app/composite/routes.py` | bump `effective_arrays = n + 12 → n + 17`; add `COMPOSITE_DOWNSCALE_FAIL_THRESHOLD` env var; new `MemoryBudgetVerdict` dataclass; new `_compute_common_wcs` helper; new `_compute_memory_budget` helper; new `POST /composite/estimate` endpoint; plumb verdict through `_reproject_all_channels` → `_load_reprojected_channels` → `generate_nchannel_composite` → `_encode_and_respond`; emit `X-Composite-*` response headers on warn |
| `processing-engine/app/composite/models.py` | add `EstimateResponse` Pydantic model |
| `processing-engine/tests/test_composite_downscale.py` | update `n + 12 → n + 17`; add `TestMemoryBudgetVerdict` class |
| `processing-engine/tests/test_composite_estimate.py` *(new)* | unit tests for the estimate endpoint |
| `processing-engine/tests/test_composite_memory_rss.py` *(new)* | RSS-instrumented opt-in integration test |
| `processing-engine/tests/test_analyze_channels.py` | update mock helpers to return `(dict, verdict)` tuples |
| `processing-engine/tests/conftest.py` | add fixture: 5 small WCS-bearing synthetic FITS files for memory test |
| `processing-engine/pyproject.toml` | register `memory` pytest marker |
| `docker/docker-compose.yml` | expose `MAX_COMPOSITE_MEMORY_BYTES` + `COMPOSITE_DOWNSCALE_FAIL_THRESHOLD` env vars on processing-engine service |
| `docker/.env.example` | new "Composite Memory Budget" section with tuning table |
| `.github/workflows/processing-engine-memory-test.yml` *(new)* | paths-filter + nightly cron + workflow_dispatch |

**Behavior change:** With `COMPOSITE_DOWNSCALE_FAIL_THRESHOLD=0.85` default, targets that previously succeeded with mild silent downscale will start returning HTTP 413 with an actionable detail message. Operators must either lower the threshold, raise `MAX_COMPOSITE_MEMORY_BYTES`, or use a larger host.

### PR 2 — Backend (.NET)

`feature/882-ngc3324-composite-oom-backend`

**Goal:** propagate engine 413 + warning headers through the .NET API to the HTTP client.

**Required CORS update:** PR-1 sets new `X-Composite-Was-Downscaled`, `X-Composite-Original-Shape`, `X-Composite-Output-Shape`, `X-Composite-Side-Factor` response headers on `/composite/generate-nchannel`. Browsers won't expose them to JS unless they're listed in the .NET `WithExposedHeaders(...)` CORS policy. **PR-2 must add these to the gateway's expose-headers list, otherwise PR-3 frontend reads will silently return undefined.** Processing-engine has no CORSMiddleware (sits behind the .NET gateway in production), so PR-1 doesn't own this fix.

**Changes:**

| File | Change |
|---|---|
| `backend/JwstDataAnalysis.API/Program.cs` (or wherever CORS is configured) | add `X-Composite-Was-Downscaled`, `X-Composite-Original-Shape`, `X-Composite-Output-Shape`, `X-Composite-Side-Factor` to `WithExposedHeaders(...)` |
| `backend/JwstDataAnalysis.API/Services/CompositeService.cs` | propagate processing-engine 413 with detail message; forward `X-Composite-*` headers to caller response |
| `backend/JwstDataAnalysis.API/Controllers/CompositeController.cs` | add 413 handler in catch block (mirrors existing 503/504 pattern); new `POST /api/composite/estimate` proxy action |
| `backend/JwstDataAnalysis.API/Models/CompositeModels.cs` | add `CompositeEstimateRequest`, `CompositeEstimateResponse` DTOs |
| `backend/JwstDataAnalysis.API.Tests/Controllers/CompositeControllerTests.cs` | new tests for 413 mapping + estimate proxy |
| `backend/JwstDataAnalysis.API.Tests/Services/CompositeServiceTests.cs` | new tests for header propagation + 413 surface |

### PR 3 — Frontend + Recipe Walkthrough

`feature/882-ngc3324-composite-oom-frontend`

**Goal:** end-to-end UX. First-time CE users see actionable diagnostics, not opaque errors.

**Changes:**

| File | Change |
|---|---|
| `frontend/jwst-frontend/src/types/CompositeTypes.ts` | add `CompositeEstimateResponse`, `CompositeWarning` types |
| `frontend/jwst-frontend/src/components/CompositeWizard.tsx` | toast on 413 with knob hints; warning surface in result panel |
| `frontend/jwst-frontend/src/components/guided/ResultStep.tsx` | warning surface for guided flow |
| `frontend/jwst-frontend/src/components/CompositeWizard.test.tsx` | tests for 413 path + warning surface |
| `scripts/recipe-walkthrough.py` | call `/api/composite/estimate` before each recipe; skip with reason if 413 |

## Test Plan

(See per-PR test plans in respective PR descriptions.)

## Rollout

1. PR 1 lands → processing engine returns clean 413 instead of OOM kill (recipe walkthrough sees "response ended prematurely" replaced by HTTP 413)
2. PR 2 lands → backend forwards 413 cleanly
3. PR 3 lands → CE users see actionable error UI + walkthrough pre-flights

Each PR can ship independently of the others. PR 1 alone is a meaningful improvement.

## Future work (deferred)

- #1423 tile-based streaming
- #1424 per-filter file count cap
- WCS header cache for repeated estimate calls (only if walkthrough timing becomes a problem)
