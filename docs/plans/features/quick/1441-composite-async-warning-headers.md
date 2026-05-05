# Plan: Surface composite warning headers on async export

**Issue**: #1441
**Complexity**: Quick-medium (plumbing through 3 layers, no new logic)

## Problem

The sync composite path (`/api/composite/generate-nchannel`) forwards engine `X-Composite-*` memory-budget headers, so wizard users see the "downscaled" warning banner once #882 PR-3 shipped.

The async export path (`CompositeBackgroundService` → `/api/composite/export-nchannel`) drops the headers when persisting bytes to storage. Users get the same downscaled output with no warning. Same data, different transparency.

Three call sites in `pages/GuidedCreate.tsx` and one in `components/wizard/CompositePreviewStep.tsx` already have explicit `// tracked in #1441` TODO comments next to `apiClient.getBlob('/api/jobs/{id}/result')` calls.

## Fix

Persist the engine's forwarded headers on the `JobStatus` record at completion, then re-emit them on the result download response (`GET /api/jobs/{id}/result`). Frontend reads headers via a new `apiClient.getBlobWithHeaders` and reuses the existing `parseCompositeWarning(headers)` and `<CompositeWarningBanner>`.

The HTTP `/result` response is the carrier of choice — it mirrors the sync wizard's pattern (where the engine's headers ride the same response that delivers the bytes), keeps a single source of truth, and avoids fan-out to a SignalR-shaped second copy that the frontend would never read because the bytes still need to be fetched.

## Files Changed

### Backend

| File | Change |
|------|--------|
| `Models/JobStatus.cs` | Add `Dictionary<string, string>? ResultWarningHeaders` |
| `Services/IJobTracker.cs` | Extend `CompleteBlobJobAsync` with optional `IReadOnlyDictionary<string, string>? warningHeaders = null` |
| `Services/JobTracker.cs` | Persist headers on completion |
| `Services/CompositeBackgroundService.cs` | Pass `compositeResult.Headers` (drops `// Tracked as follow-up.`) |
| `Controllers/JobsController.cs` | Re-emit X-Composite-* headers on `GET /api/jobs/{id}/result` |

### Frontend

| File | Change |
|------|--------|
| `services/apiClient.ts` | Add `getBlobWithHeaders` (mirror of `postBlobWithHeaders`) |
| `components/wizard/CompositePreviewStep.tsx` | Switch download to `getBlobWithHeaders`, parse warning, render `<CompositeWarningBanner />` |
| `pages/GuidedCreate.tsx` | Three async-path `apiClient.getBlob` call sites switch to `getBlobWithHeaders`; feed into existing `setCompositeWarning` (drops three `// Tracked in #1441` comments). Adds a `cancelled` flag around each `subscribeToJobProgress.onCompleted` body so a unmount mid-fetch doesn't apply the result on a torn-down component |

### Tests

| File | Change |
|------|--------|
| `Services/CompositeBackgroundServiceTests.cs` | Verify `compositeResult.Headers` propagated to `CompleteBlobJobAsync` |
| `Services/JobTrackerTests.cs` | Verify stored on `JobStatus` + emitted on `NotifyCompleted` |
| `Controllers/JobsControllerTests.cs` | Verify `/result` response carries X-Composite-* headers |

## Verification

- `dotnet build` clean; new + existing unit tests pass
- `vitest run` clean for frontend
- E2E: trigger an async export of a known-large composite (NGC 3324 superset), confirm warning banner shows on download with the same shapes as the sync path
- Backwards compat: mosaic + embedding background services pass `null` for `warningHeaders` (default), no behavior change

## Risk

- **Risk**: Low-medium. Touches `IJobTracker` (used by import, composite, mosaic, embedding background services), but the new parameter is optional with a `null` default — existing call sites unchanged. Adds an optional field to `JobStatus` (nullable Bson serialization handles missing field on existing documents). SignalR payload gets a new optional field.
- **Rollback**: `git revert`. Headers continue to be dropped exactly as before.
