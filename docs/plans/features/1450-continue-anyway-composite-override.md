# 1450 — "Continue anyway" override for composite memory-budget 413

## Problem

When the composite engine projects a heavy downscale (output side < `COMPOSITE_DOWNSCALE_FAIL_THRESHOLD`, default 0.85), it returns HTTP 413 with a detailed message and the frontend surfaces only a "Retry Processing" button. Retry without changing inputs hits the same 413 — the user has no in-app path forward short of editing env vars.

Example (NGC 346, NIRCam guided flow):

> Composite output would shrink to 38% of requested side length (4353x3417 from 11399x8949). Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB; COMPOSITE_DOWNSCALE_FAIL_THRESHOLD = 0.85. To allow this composite: lower COMPOSITE_DOWNSCALE_FAIL_THRESHOLD, raise MAX_COMPOSITE_MEMORY_BYTES, or reduce inputs (fewer files / fewer channels).

## Solution overview

Add an explicit per-request opt-in (`allow_force_downscale`) that suppresses the 413 and applies the projected downscale. The result page surfaces a new `forced` verdict status with a provenance-aware warning banner so the user always knows when they're looking at a force-downscaled image — including later cache-hit users who didn't opt in themselves but receive the previously force-downscaled cached result.

CEO + eng review caught three correctness gaps in the original proposal that are folded into the scope: cache provenance, async-path 413 detection (pre-existing bug), and banner copy mismatch.

## Decisions (CEO + eng review)

| ID | Decision |
|---|---|
| Mode | C — Hold scope, bulletproof |
| D-1 | Cache writes force-downscaled results AND stores `original_shape` provenance; `_verdict_for_cached` emits `forced` status when shapes differ |
| D-2 | New verdict status value `"forced"` (alongside `ok`/`warn`/`fail`) — explicit semantics, applies on opt-in path AND cache hits of previously-forced data |
| D-3 | `ProcessingErrorMessages.ToUserMessage` adds a `MEMORY_BUDGET:` prefix on `CompositeBudgetExceededException` (matches existing `NO_PRODUCTS:` / `S3_UNAVAILABLE:` convention) |

## NOT in scope

- Recipe walkthrough preflight "Try anyway" — filed as #1451 (depends on this PR)
- Per-request `failThreshold` / `memoryLimit` overrides
- Admin panel toggle for env vars
- Default fail threshold change
- Hard `side_factor` floor on force-downscale (trust user — projected shape shown on button)
- Tile streaming integration (#1423)
- Per-filter file cap (#1424)
- E2E coverage (page-level integration tests cover the retry roundtrip)

## File-by-file changes

### Engine (Python)

| File | Change |
|---|---|
| `processing-engine/app/composite/models.py` | Add `allow_force_downscale: bool = False` to `NChannelCompositeRequest`. Widen `MemoryBudgetVerdict.status` literal to `Literal["ok", "warn", "fail", "forced"]`. Widen `EstimateResponse.status` to match. |
| `processing-engine/app/composite/cache.py` | Cache entry tuple grows from `(channels, ts, fingerprint)` to `(channels, ts, fingerprint, original_shape)`. `put` accepts an `original_shape: tuple[int, int] \| None` arg; `get` and `get_any_budget` return `(channels, original_shape)` tuples. |
| `processing-engine/app/composite/routes.py` | `_compute_memory_budget(..., raise_on_fail)` returns `status="forced"` (not `"fail"`) when `raise_on_fail=False` AND `side_factor < fail_threshold`. `_reproject_all_channels` honors `request.allow_force_downscale` (passes `raise_on_fail=not allow_force_downscale`); applies downscale on `forced` like it does on `warn`. `_load_reprojected_channels` plumbs `original_shape` into `_cache.put`. `_verdict_for_cached` uses cached `original_shape` to emit `status="forced"` + `wasDownscaled=true` when `cached_shape != original_shape`. `_encode_and_respond` emits `X-Composite-Budget-Status: forced` header. Engine log line marks force-downscale opt-in events. |
| `processing-engine/tests/test_composite_downscale.py` | New cases: `_compute_memory_budget` with `raise_on_fail=False` returns `forced` (not `fail`) on heavy reduction; `raise_on_fail=True` regression guard for 413. |
| `processing-engine/tests/test_composite_cache.py` *(may exist; verify)* | New cases: `put` stores `original_shape`; `get` returns it; `_verdict_for_cached` returns `forced` when shapes differ. |
| `processing-engine/tests/test_composite_routes.py` *(or `test_composite.py`; locate)* | New cases: full request with `allow_force_downscale=true` → 200 + `X-Composite-Budget-Status: forced` headers; default still 413; subsequent default request hits cache → 200 + `forced` header (provenance). |

### .NET

| File | Change |
|---|---|
| `backend/JwstDataAnalysis.API/Models/NChannelCompositeRequestDto.cs` *(verify path)* | Add `AllowForceDownscale: bool` field with snake_case JSON mapping. |
| `backend/JwstDataAnalysis.API/Services/ProcessingErrorMessages.cs` | Add `CompositeBudgetExceededException ex => $"MEMORY_BUDGET:{ex.Message}"` case before the `_ =>` fallback. |
| `backend/JwstDataAnalysis.API.Tests/Services/ProcessingErrorMessagesTests.cs` *(may exist; create if not)* | Verify `CompositeBudgetExceededException` produces `MEMORY_BUDGET:` prefix; verify other exception types fall through unchanged. |
| `backend/JwstDataAnalysis.API.Tests/Services/CompositeServiceTests.cs` | Verify `AllowForceDownscale=true` serializes as `allow_force_downscale: true` in the engine payload. |

### Frontend

| File | Change |
|---|---|
| `frontend/jwst-frontend/src/types/CompositeTypes.ts` | Widen `CompositeWarning.budgetStatus` to `'ok' \| 'warn' \| 'fail' \| 'forced'`. Add `allowForceDownscale?: boolean` to `NChannelCompositeRequest` and `NChannelExportOptions` (and `NChannelPreviewOptions` if it exists). |
| `frontend/jwst-frontend/src/services/compositeService.ts` | `parseCompositeWarning` accepts `forced` as a valid status. Pass `allowForceDownscale` through `generateNChannelComposite`, `exportNChannelComposite`, `exportNChannelCompositeAsync`, `generateNChannelPreview`. |
| `frontend/jwst-frontend/src/services/compositeService.test.ts` | New cases: `parseCompositeWarning` maps `'forced'` correctly. |
| `frontend/jwst-frontend/src/components/CompositeWarningBanner.tsx` | Branch for `forced` status with bespoke copy: "Output force-downscaled to fit memory budget" plus the existing size text. Note: opt-in vs cache-hit-of-forced cases share one title — the engine has no signal to distinguish "this request opted in" from "you're getting a cached force-downscaled result," and adding one (e.g. `X-Composite-Forced-Cause`) was scoped out as not worth the contract complexity. The shared copy is accurate for both: the user either just clicked Continue anyway (and the title confirms it) or they got a previously force-downscaled cached result (and the title informs them honestly). |
| `frontend/jwst-frontend/src/components/CompositeWarningBanner.test.tsx` | New cases: forced branch renders correct copy; existing fail branch unchanged. |
| `frontend/jwst-frontend/src/components/guided/ProcessStep.tsx` | Accept `onContinueAnyway?: () => void` and `forceProjectedShape?: [number, number]` props. When error has `MEMORY_BUDGET:` prefix OR matches the engine's "Composite output would shrink" pattern (sync path), strip the prefix for display and render "Continue anyway → 4353×3417" button alongside "Retry Processing". |
| `frontend/jwst-frontend/src/components/guided/ProcessStep.test.tsx` *(may exist; create if not)* | Button visibility + label + click callback fires. |
| `frontend/jwst-frontend/src/pages/GuidedCreate.tsx` | Sync (anonymous) path: detect `ApiError 413` (existing) → parse projected shape from `err.message` → wire `onContinueAnyway` to `startProcessing` with `allowForceDownscale: true`. Async path: detect `MEMORY_BUDGET:` prefix on `status.error` → strip prefix → parse shape → same retry. Reset `allowForceDownscale` to default on a fresh user-initiated retry (request-scoped). |
| `frontend/jwst-frontend/src/components/wizard/CompositePreviewStep.tsx` | Mirror the Continue anyway treatment for the wizard preview path (currently catches `err.status === 413`). |

### Helper extracted to keep DRY

A small `parseMemoryBudgetError(message: string)` helper in `compositeService.ts` returns `{ projectedShape: [number, number] | null, displayMessage: string }` — used by both ProcessStep and CompositePreviewStep. Stripping the `MEMORY_BUDGET:` prefix and the regex parse for `(WIDTHxHEIGHT from ...)` live in one place.

## Test plan

Unit + integration listed above. Manual verification:

- Docker rebuild required: YES (engine model + .NET DTO + frontend types all change).
- Anonymous flow: NGC 346 NIRCam guided → 413 → "Continue anyway → 4353×3417" → smaller image + `forced` banner.
- Authenticated flow: same scenario via async job queue (verifies the `MEMORY_BUDGET:` prefix path).
- Second authenticated default request on the same paths: cache hit returns `forced` banner without recomputing.

## Docs to update

- `docs/architecture/` — composite memory-budget flow, if documented (add `forced` status + opt-in path).
- `docs/standards/backend-development.md` — note the `MEMORY_BUDGET:` error-prefix convention alongside existing prefixes.
- `docs/standards/processing-engine.md` *(or equivalent)* — `allow_force_downscale` request field + `forced` verdict status.

## Implementation order

1. **Engine**: cache provenance → `_compute_memory_budget` returns `forced` → `_reproject_all_channels` honors flag → `_verdict_for_cached` emits `forced` on shape mismatch → headers → tests.
2. **.NET**: DTO field → `ProcessingErrorMessages` case → tests.
3. **Frontend**: type widening → `parseCompositeWarning` → service plumbing → banner branch → `parseMemoryBudgetError` helper → ProcessStep button → CompositePreviewStep button → page-level wiring → tests.
4. Self-review (code-reviewer agent), iterate to clean.
5. Compose PR with full test plan checklist.
