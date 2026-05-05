# Plan: Async composite preview path (Phase 1)

**Issue**: #1470
**Branch**: `feature/composite-async-preview`
**Complexity**: Medium (backend + frontend, multi-consumer)
**Phase 2**: #1471 (engine streaming + log panel) — depends on this

## Problem

Wizard composite preview (`CompositePreviewStep.generatePreview`) calls the sync `/api/composite/generate-nchannel` endpoint. On a long composite the user sees a fake `useSimulatedProgress` spinner with no real signal — up to ~150 s of silence on multi-tile recipes. After #1458 most curated recipes are single-tile, but full-survey and non-curated multi-tile cases still hit this.

Async job infrastructure already exists for the export path: `CompositeBackgroundService` consumes `CompositeQueue`, `CompositeService.GenerateNChannelCompositeAsync` already accepts `onProgress(pct, stage, msg)`, and the frontend uses `useJobProgress` + `getBlobWithHeaders('/api/jobs/{id}/result')`. Phase 1 wires the wizard preview onto that same path.

## Scope decision: authenticated only

`JobProgressHub` is `[Authorize]` — anonymous users cannot subscribe to SignalR. So the new async endpoint requires auth (matching `export-nchannel`), and anonymous wizard users keep the sync endpoint. Authenticated users (the documented motivating case) get progress; anonymous users see no regression. Phase 2 can revisit if anonymous progress becomes a requirement.

## Decisions (from `/plan-eng-review`)

- **DECISION-1 — Preview cancellation**: When the frontend `AbortController` fires (slider tweak supersedes a pending preview), call `POST /api/jobs/{jobId}/cancel` from the abort handler. `CompositeBackgroundService` already checks `IsCancelRequested` between stages — obsolete jobs exit cleanly without burning engine cycles.
- **DECISION-2 — Stage labels**: Frontend constant `STAGE_LABELS: Record<string, string>` in `CompositePreviewStep.tsx` (or shared util) maps backend stage strings (`"queued"`, `"generating"`, `"mosaic"`, etc.) to user-friendly labels with raw value as fallback. No backend churn.
- **DECISION-3 — Job-listing pollution**: Add `JobTypes.CompositePreview = "composite-preview"` (sibling of `JobTypes.Composite`). `JobsController.ListJobs` already supports `?type=` filter, so any future "my jobs" UI can exclude preview noise. No current frontend listing consumer, so no other call sites need updating.

## Files Changed

| File | Change |
|------|--------|
| `backend/JwstDataAnalysis.API/Models/JobStatus.cs` | Add `JobTypes.CompositePreview = "composite-preview"` constant |
| `backend/JwstDataAnalysis.API/Controllers/CompositeController.cs` | Add `POST generate-nchannel-async` mirroring `export-nchannel`. 202 + `{ jobId }`. Auth required. Uses `JobTypes.CompositePreview`. |
| `backend/JwstDataAnalysis.API/Controllers/CompositeController.Log.cs` | Add `LogPreviewQueued` source-generated logger |
| `backend/JwstDataAnalysis.API.Tests/Controllers/CompositeControllerTests.cs` | Cover queued, validation error, queue full, unauthenticated, JobType=composite-preview |
| `frontend/jwst-frontend/src/services/compositeService.ts` | Add `generateNChannelPreviewAsync(channels, options) → { jobId }` |
| `frontend/jwst-frontend/src/services/compositeService.test.ts` | Cover request shape + endpoint + return value |
| `frontend/jwst-frontend/src/components/wizard/CompositePreviewStep.tsx` | Authenticated path uses async + `useJobProgress` + `getBlobWithHeaders`; anonymous path unchanged. Replace `useSimulatedProgress` with real progress on the async path. Render `{label} · {elapsed}` status line. Wire `AbortController` to call `POST /api/jobs/{id}/cancel`. Add `STAGE_LABELS` constant. |

GuidedCreate intentionally **not changed** — the export and regenerate paths there already split authenticated→async / anonymous→sync (`GuidedCreate.tsx:602, 720, 878`). They're already the correct shape for Phase 1; no migration needed.

`POST /api/jobs/{jobId}/cancel` is **not** new — already exists in `JobsController.cs:78`. Frontend just adopts it.

## Behavior

### Backend `POST /api/composite/generate-nchannel-async`
- Auth required (returns 401 anonymous).
- Request body: same `NChannelCompositeRequestDto` as `generate-nchannel` and `export-nchannel`.
- Response: `202 { jobId, status: "queued" }`.
- Validation reuses `ValidateNChannelRequest` — 400 on invalid input.
- 429 + `Retry-After: 5` if `CompositeQueue.TryEnqueue` fails (queue full).
- Job description distinguishes preview from export: `"N-channel composite preview ({n} channel(s))"`.

### Frontend
- `generateNChannelPreviewAsync` builds the same DTO as `generateNChannelPreview` (preview-size, jpeg, q=85) and POSTs to the new endpoint.
- `CompositePreviewStep.generatePreview`:
  - If authenticated → call async endpoint, subscribe via `useJobProgress`, fetch blob from `/api/jobs/{id}/result` on completion, parse warning headers as today.
  - If anonymous → unchanged sync path.
- Stage label: when preview is generating on the async path, render `{stage} · {elapsed mm:ss}` above the progress bar. `stage` is whatever `JobProgressUpdate.stage` carries (today: `"generating"`, `"queued"`, plus inline-mosaic stages emitted from `CompositeService.cs:588, 612`).
- `useSimulatedProgress` replaced by real `jobProgress.progress` on the async path; remains as fallback for the anonymous sync path.

## Test Plan

### Backend (xUnit + Moq)
- [ ] `GenerateNChannelCompositeAsync_ValidRequest_Returns202WithJobId`
- [ ] `GenerateNChannelCompositeAsync_ValidRequest_CreatesJobWithCompositePreviewType`
- [ ] `GenerateNChannelCompositeAsync_NoChannels_Returns400`
- [ ] `GenerateNChannelCompositeAsync_QueueFull_Returns429WithRetryAfter` (and marks job failed exactly once)
- [ ] `GenerateNChannelCompositeAsync_Anonymous_Returns401`
- [ ] Run `dotnet test` — no regressions

### Frontend (Vitest)
- [ ] `compositeService.test.ts` — `generateNChannelPreviewAsync` posts to `/api/composite/generate-nchannel-async` with the expected body and returns `{ jobId }`
- [ ] `CompositePreviewStep` — authenticated branch calls async path; abort triggers job cancel POST
- [ ] `CompositePreviewStep` — anonymous branch unchanged
- [ ] `STAGE_LABELS` map — known stages render labels, unknown stages fall back to raw value
- [ ] `npm run lint && npm run typecheck && npm run test`

### E2E (Playwright)
- [ ] `guided-create.spec.ts` — Authenticated wizard composite generation completes (now via async path), preview renders correctly, no regressions in the export step.

### Manual verification
- [ ] `docker compose up -d --build`
- [ ] As authenticated user, generate a curated recipe composite — verify progress bar advances on real events (not simulation), stage label updates, elapsed time ticks.
- [ ] Nudge a slider 5x in 2 s — verify earlier preview jobs get cancelled (engine logs show short-circuit, queue stays shallow); only the latest result repaints.
- [ ] Trigger slider tweaks (`regenerateComposite`) — already async on the existing path; confirm no regression.
- [ ] As anonymous user, verify sync preview still works.

## Risk & Rollback

- **Risk**: Low. Reuses existing async infrastructure (`CompositeBackgroundService`, `IJobTracker`, `useJobProgress`, `/api/jobs/{id}/result`). Sync endpoint untouched. Anonymous path unchanged.
- **Rollback**: Frontend reverts `CompositePreviewStep` authenticated branch to call sync `generateNChannelPreview` — the sync endpoint stays in place and continues to serve.

## Out of Scope (Phase 2 — #1471)

- Engine→backend streaming progress channel
- Per-channel fine-grained events
- `<LogPanel>` collapsible developer-detail surface
- ETA badge / `eta_seconds` extension to `/composite/estimate`
- Removing the sync endpoint (only after Phase 2 lands and we verify no remaining wizard path calls it)
