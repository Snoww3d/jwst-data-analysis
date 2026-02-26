# Job Queue + WebSocket Progress

## Context

All long-running operations use 500ms HTTP polling for progress. MAST downloads already have a job-based pattern (enqueue, poll, completion), but composite and mosaic generation are fully synchronous — the HTTP request blocks for up to 10 minutes. There's no server-push infrastructure.

**Goal:** Replace polling with SignalR (WebSocket) push, make composite/mosaic generation async with job IDs, and unify all job tracking into one system.

## Non-Goals

- No Redis/RabbitMQ in this phase
- No processing-engine WebSocket changes (stays HTTP-only)
- No breaking changes to existing import endpoints until cleanup phase

## Current State

| Operation | Duration | Pattern | Progress |
|-----------|----------|---------|----------|
| MAST download | Minutes | Async job + polling | Byte-level, 500ms polls |
| Composite gen | 2-60s | Synchronous HTTP | None (spinner) |
| Mosaic gen | 10-60+s | Synchronous HTTP | None (spinner) |
| Mosaic save | 10-60+s | Synchronous HTTP | None (spinner) |

**Existing patterns to reuse:**
- `ThumbnailQueue` + `ThumbnailBackgroundService` — proven `Channel<T>` + `BackgroundService` pattern (`Services/ThumbnailQueue.cs`, `Services/ThumbnailBackgroundService.cs`)
- `ImportJobTracker` — singleton `ConcurrentDictionary<string, ImportJobStatus>` with 30-min cleanup, cancellation token support (`Services/ImportJobTracker.cs`)
- `IStorageProvider` — storage abstraction with `WriteAsync`, `ReadStreamAsync`, `DeleteAsync`, `ListAsync` (`Services/Storage/IStorageProvider.cs`)
- CORS already has `.AllowCredentials()` (required for SignalR)
- MongoDB already in use (`jwst_data`, `users` collections) — no new infrastructure for adding a `jobs` collection
- Processing engine downloads already use `asyncio.create_task()` background jobs

## Hard Decisions (locked before coding)

1. **Job ownership is mandatory** — every job stores `OwnerUserId`. Authorization checked on subscribe, status fetch, cancel, and result retrieval. Anonymous users only hit sync preview endpoints; async operations require authentication.
2. **MongoDB persistence** — job metadata persisted to `jobs` collection. Survives restarts. In-memory `ConcurrentDictionary` remains as hot cache, MongoDB is the durable source of truth.
3. **Results via IStorageProvider** — async job results written to `tmp/jobs/{jobId}/result.{ext}`, not raw filesystem paths. Cleanup via `ListAsync("tmp/jobs/")` + `DeleteAsync`.
4. **Sync/async split is intent-based, not dimension-based** — preview endpoints (called by the preview button) stay synchronous. Export/download/save endpoints (called by export and save buttons) return `202 Accepted` with `{ jobId }`. The caller's intent determines the path, not an arbitrary width threshold. This is cleaner because processing time depends on channel count, file sizes, and engine load — not just output width.
5. **Backpressure is explicit** — bounded channels; `TryWrite()` failure returns `429 Too Many Requests` with `Retry-After` header.
6. **Compatibility first** — old import polling endpoints remain until Phase 6.
7. **Result TTL extends on access** — completed jobs expire 30 minutes after last access (not after completion). Each `GET /api/jobs/{jobId}/result` resets the TTL. `ExpiresAt` is included in the `JobCompleted` event so the frontend can display a countdown or warning. The reaper deletes both the job metadata and IStorageProvider artifacts when TTL passes.

## Canonical Job Contract

### JobStatus (API DTO)

**Core fields (all job types):**
- `JobId`, `JobType` (import/composite/mosaic), `State`, `Description`
- `OwnerUserId`
- `ProgressPercent` (0-100), `Stage`, `Message`
- `Error` (null unless failed)
- `CreatedAt`, `StartedAt`, `UpdatedAt`, `CompletedAt`, `ExpiresAt`
- `CancelRequested`

**Result fields (populated on completion):**
- `ResultKind` — `blob` (binary file to download) or `data_id` (MongoDB record reference)
- `ResultStorageKey` — IStorageProvider key for blob results
- `ResultContentType` — MIME type (e.g., `image/png`)
- `ResultFilename` — suggested download filename
- `ResultDataId` — for mosaic save (references the saved data record)

**Type-specific fields (stored in `Metadata` dictionary):**
- Import jobs: `DownloadedBytes`, `TotalBytes`, `SpeedBytesPerSec`, `EtaSeconds`, `FileProgress`
- Composite/mosaic: no extra fields needed initially

**State machine:** `queued` → `running` → `completed` | `failed` | `cancelled`

## Architecture

```
Frontend (React)
    |
    |-- SignalR WebSocket --> .NET Hub (push progress)
    |                              |
    +-- REST fallback -------> .NET Controllers
                                   |
                              JobTracker (unified, MongoDB-backed)
                                   |
                          +--------+--------+
                          |        |        |
                     Composite  Mosaic   Import
                     Queue      Queue    (existing, adapted)
                          |        |        |
                     Background Background  Task.Run
                     Service    Service    (existing)
                          |        |        |
                          +--------+--------+
                                   |
                          Processing Engine (HTTP, unchanged)
```

**Key decisions:**
- **SignalR groups** (`job-{jobId}`) — multiple tabs work, reconnection requests `JobSnapshot`
- **Hub events:** `JobProgress`, `JobCompleted`, `JobFailed`, `JobSnapshot` (full state on reconnect)
- **No new infrastructure** — MongoDB (existing) + in-memory channels. Redis backplane is one line if horizontal scaling is ever needed
- **Processing engine unchanged** — stays HTTP-only. Backend is the sole WebSocket hub
- **Graceful degradation** — `useJobProgress` hook tries SignalR first, falls back to 500ms polling
- **Startup reconciliation** — on server start, mark any `queued`/`running` jobs in MongoDB as `failed` with reason `service_restart`
- **Cancellation asymmetry** — MAST imports support real cancellation (processing engine has cancel endpoint). Composite/mosaic cancel means "don't deliver the result" — the background service checks `CancelRequested` before calling the processing engine, and again after the call returns (to skip storage write). The processing engine computation may still run to completion if cancel arrives mid-processing

## API + Hub Contracts

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/jobs` | GET | List caller's jobs (filtered by status, type). Safety net for page refresh |
| `/api/jobs/{jobId}` | GET | Unified job status (polling fallback) |
| `/api/jobs/{jobId}/cancel` | POST | Cancel any cancellable job |
| `/api/jobs/{jobId}/result` | GET | Stream blob result (authorized, resets TTL) |
| `/hubs/job-progress` | SignalR | WebSocket push |

Hub client methods: `SubscribeToJob(jobId)`, `UnsubscribeFromJob(jobId)`
Hub server events: `JobProgress`, `JobCompleted`, `JobFailed`, `JobSnapshot`

## Implementation Notes

**Docker/proxy WebSocket config:** If Docker Compose has a reverse proxy (nginx, traefik) in front of the .NET API, it needs WebSocket passthrough (`Upgrade` and `Connection` headers). Verify during Phase 1 — if it's direct port forwarding, no action needed.

**Import backpressure gap:** Import jobs stay as `Task.Run` (existing) and don't go through `Channel<T>`. The processing engine is the natural bottleneck for imports. This is an accepted inconsistency — not worth the migration cost in this phase.

**Structured logging:** Every job lifecycle event should be logged with structured fields: `Job {JobId} created by {UserId}, type={JobType}`, `Job {JobId} completed in {Duration}ms`, `Job {JobId} failed: {Error}`. Queue depth logged on enqueue/dequeue for observability.

## Implementation Phases

### Phase 1: SignalR Infrastructure (PR)
Purely additive — no behavioral changes.

**Backend (new):**
- `Hubs/JobProgressHub.cs` — hub with `[Authorize]`, `SubscribeToJob(jobId)`, `UnsubscribeFromJob(jobId)`. Ownership guard on subscribe. Server pushes `JobProgress`, `JobCompleted`, `JobFailed`, `JobSnapshot` to groups
- `Services/IJobProgressNotifier.cs` + `JobProgressNotifier.cs` — wraps `IHubContext<JobProgressHub>`, provides `NotifyProgressAsync()`, `NotifyCompletedAsync()`, `NotifyFailedAsync()`, `SendSnapshotAsync()`
- `Models/JobProgressModels.cs` — `JobProgressUpdate`, `JobCompletionUpdate`, `JobFailureUpdate`, `JobSnapshotUpdate`

**Backend (modify):**
- `Program.cs` — `builder.Services.AddSignalR()`, `app.MapHub<JobProgressHub>("/hubs/job-progress")`, register `IJobProgressNotifier`, add JWT `OnMessageReceived` handler to extract token from query string for hub route
- `JwstDataAnalysis.API.csproj` — SignalR is built into .NET 10, likely no extra package needed

**Frontend (new):**
- `src/services/signalRService.ts` — connection manager with auto-reconnect, `subscribeToJob()` returns unsubscribe function. **Token must be fetched dynamically** via `accessTokenFactory: () => getAccessToken()` on each connection/reconnect — do NOT capture the token once at creation time (it may expire during long-running jobs)
- `src/types/JobTypes.ts` — `JobProgressUpdate`, `JobCompletionUpdate`, `JobFailureUpdate`, `JobSnapshotUpdate` types

**Frontend (modify):**
- `package.json` — add `@microsoft/signalr`

**Tests (this phase):**
- Hub connection with valid JWT succeeds
- Hub connection without JWT is rejected
- `SubscribeToJob` with non-owned jobId is rejected
- `JobProgressNotifier` sends to correct SignalR group
- Verify WebSocket connects through Docker networking (manual: devtools Network tab)

### Phase 2: Unified Job Tracker (PR)
Generalize `ImportJobTracker` into universal `JobTracker`. MongoDB-backed with in-memory cache. Ownership enforced. Pushes to SignalR on every state change.

**Backend (new):**
- `Services/IJobTracker.cs` — `CreateJob(type, description, userId)`, `UpdateProgress()`, `UpdateByteProgress()`, `CompleteJob()`, `FailJob()`, `CancelJob()`, `GetJob(jobId, userId)` (authorized), `GetJobsForUser(userId, status?, type?)` (list endpoint backing)
- `Services/JobTracker.cs` — `ConcurrentDictionary` hot cache + MongoDB `jobs` collection as durable store. Injects `IJobProgressNotifier`, auto-pushes on mutation. 30-min TTL after last access (not after completion). Background reaper cleans expired jobs + IStorageProvider artifacts
- `Controllers/JobsController.cs` — `GET /api/jobs` (list, filtered by owner + optional status/type query params), `GET /api/jobs/{jobId}` (status), `POST /api/jobs/{jobId}/cancel`, `GET /api/jobs/{jobId}/result` (stream blob, resets TTL). All endpoints check job ownership
- `Models/JobStatus.cs` — unified status model per canonical contract above
- Startup reconciliation: `IHostedService` that marks `queued`/`running` MongoDB jobs as `failed` on boot

**Backend (modify):**
- `ImportJobTracker.cs` — becomes thin dual-write adapter: writes to both old in-memory tracker AND new `IJobTracker` with `jobType = "import"`. Existing callers unchanged
- `Program.cs` — register `IJobTracker` as singleton, register reaper background service

**Tests (this phase):**
- `JobTracker` CRUD: create, update progress, complete, fail, cancel
- MongoDB persistence: create job, restart (clear in-memory cache), verify job loads from MongoDB
- Startup reconciliation: seed `running` job in MongoDB, trigger reconciliation, verify it's marked `failed`
- Ownership enforcement: `GetJob` with wrong userId returns null/403
- `GET /api/jobs` returns only caller's jobs, respects status/type filters
- Result TTL: verify `ExpiresAt` resets on result access
- Reaper: verify expired jobs + storage artifacts are cleaned up

**Docs (this phase):**
- `key-files.md` — add `JobsController`, `JobTracker`, `IJobTracker`, `JobStatus`, `JobProgressNotifier`, `JobProgressHub`
- `backend-development.md` — add to controllers/services list, add `/api/jobs` endpoints
- `architecture.md` — update Backend Service Layer diagram with JobTracker + queues
- `quick-reference.md` — add `/api/jobs`, `/api/jobs/{jobId}`, `/api/jobs/{jobId}/cancel`, `/api/jobs/{jobId}/result`

### Phase 3: MAST Frontend Migration (PR)
Migrate both polling consumers (WhatsNewPanel + MastSearch) in one PR — they use identical polling patterns and the same hook.

**Frontend (new):**
- `src/hooks/useJobProgress.ts` — React hook: tries SignalR subscription, falls back to polling `GET /api/jobs/{jobId}` at 500ms. Handles `JobSnapshot` on reconnect. Returns `{ progress, error, isComplete, cancel }`. On failure/cancel, surfaces error state for the component to render (toast, inline error, etc.)

**Frontend (modify):**
- `WhatsNewPanel.tsx` — replace polling loop with `useJobProgress(jobId)`
- `MastSearch.tsx` — replace 3 inline polling loops with `useJobProgress(jobId)`. Covers single import, resume, cancel, and bulk import flows. Progress modal UI unchanged

**Backend:** No changes needed — Phase 2's dual-write adapter already pushes on every update.

**Tests (this phase):**
- `useJobProgress` hook: subscribes via SignalR, receives progress updates
- `useJobProgress` hook: falls back to polling when SignalR unavailable
- `useJobProgress` hook: handles reconnect with `JobSnapshot` catch-up

### Phase 4: Async Composite Generation (PR)
Make composite exports non-blocking. Previews stay synchronous.

**Backend (new):**
- `Services/CompositeQueue.cs` — bounded `Channel<CompositeJobItem>(10)` (same pattern as `ThumbnailQueue`). `TryWrite()` failure -> 429
- `Services/CompositeBackgroundService.cs` — reads queue, checks `CancelRequested` before calling processing engine, calls existing `CompositeService.GenerateNChannelCompositeAsync()`, checks `CancelRequested` again after return (skip storage write if cancelled), writes result via `IStorageProvider` to `tmp/jobs/{jobId}/result.{format}`, updates `IJobTracker`

**Backend (modify):**
- `CompositeController.cs`:
  - Preview endpoint — stays synchronous (existing behavior unchanged)
  - Export endpoint — returns `202 Accepted` with `{ jobId }`, enqueues to `CompositeQueue`
  - Result retrieval via `JobsController.GetResult` (no separate endpoint needed)
- `Program.cs` — register queue + background service

**Frontend (modify):**
- `compositeService.ts` — handle dual response (blob for sync preview, JSON with jobId for async export)
- `CompositePreviewStep.tsx` — preview unchanged; export shows progress via `useJobProgress`, fetches result from `/api/jobs/{jobId}/result` on completion. Error/cancel states shown inline in the export modal

**Tests (this phase):**
- Export returns 202 with jobId
- Preview stays synchronous (returns image bytes directly)
- Queue-full returns 429 with Retry-After header
- Background service writes result to IStorageProvider on completion
- Cancelled job: background service skips storage write
- `GET /api/jobs/{jobId}/result` streams the stored blob

**Docs (this phase):**
- `backend-development.md` — update composite endpoint docs (sync preview + async export)
- `quick-reference.md` — update composite endpoints

### Phase 5: Async Mosaic Generation (PR)
Same pattern as Phase 4 for mosaics.

**Backend (new):**
- `Services/MosaicQueue.cs` — bounded `Channel<MosaicJobItem>(10)`
- `Services/MosaicBackgroundService.cs` — reads queue, checks `CancelRequested`, calls existing `MosaicService` methods, checks `CancelRequested` after return

**Backend (modify):**
- `MosaicController.cs`:
  - `POST /api/mosaic/generate` — sync for preview, async for export
  - `POST /api/mosaic/generate-and-save` — always async (heavy operation). Returns 202 + jobId. Completion result includes `ResultDataId` (the saved data record)
  - Result retrieval via `JobsController.GetResult`
- `Program.cs` — register queue + background service

**Frontend (modify):**
- `mosaicService.ts` — handle dual response
- `MosaicPreviewStep.tsx` — async save shows progress, notifies on completion with saved data ID. Error/cancel states shown inline

**Tests (this phase):**
- Generate-and-save returns 202 with jobId
- Preview stays synchronous
- Completion includes `ResultDataId` for saved mosaic
- Queue-full returns 429

**Docs (this phase):**
- `backend-development.md` — update mosaic endpoint docs (sync preview + async export/save)
- `quick-reference.md` — update mosaic endpoints

### Phase 6: Cleanup + Polish (PR)
- Remove dead polling code from `MastSearch.tsx`, `WhatsNewPanel.tsx`
- Remove `ImportJobTracker` dual-write adapter — `IJobTracker` is now the sole source of truth (only if parity is validated; otherwise defer)
- Add connection status indicator in app header (connected/reconnecting/disconnected)
- Mark old `GET /api/mast/import-progress/{jobId}` as `[Obsolete]` in Swagger
- Handle edge cases: browser sleep (SignalR auto-reconnects + `JobSnapshot` catch-up), server restart (startup reconciliation already handles this)

**Docs (this phase):**
- `architecture.md` — final diagram update showing SignalR + job system
- `frontend-development.md` — document `useJobProgress` hook, `signalRService`, connection lifecycle
- `desktop-requirements.md` — note WebSocket requirement
- `development-plan.md` — mark completed tasks

## New Files Summary

**Backend (~13 new files):**
- `Hubs/JobProgressHub.cs`
- `Services/IJobTracker.cs`, `Services/JobTracker.cs`
- `Services/IJobProgressNotifier.cs`, `Services/JobProgressNotifier.cs`
- `Services/JobReaperBackgroundService.cs`
- `Services/StartupReconciliationService.cs`
- `Services/CompositeQueue.cs`, `Services/CompositeBackgroundService.cs`
- `Services/MosaicQueue.cs`, `Services/MosaicBackgroundService.cs`
- `Controllers/JobsController.cs`
- `Models/JobProgressModels.cs`, `Models/JobStatus.cs`

**Frontend (~3 new files):**
- `src/services/signalRService.ts`
- `src/hooks/useJobProgress.ts`
- `src/types/JobTypes.ts`

## Risk

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1 | Low | Purely additive SignalR setup, nothing changes behavior |
| 2 | Low | Additive job tracker + MongoDB collection. Import adapter is dual-write (old + new) |
| 3 | Low-Medium | Both polling consumers migrated. Polling fallback active if SignalR fails |
| 4 | Medium | Sync->async for composite. Preview stays sync. Export path is new |
| 5 | Medium | Sync->async for mosaic. Same pattern as Phase 4 |
| 6 | Low | Removing dead code + adapter teardown |

Each phase is a separate PR. Revert any single phase without affecting others. System works at every phase boundary because old polling endpoints are preserved until Phase 6.

## Go/No-Go Criteria

Before merging Phase 6 (final cleanup), all of these must pass:
- [ ] Authorization tests pass for hub subscribe, job status, job result, and cancel
- [ ] Startup reconciliation marks in-flight jobs as failed on restart
- [ ] Async composite export: 202 -> progress -> result download (end-to-end)
- [ ] Async mosaic save: 202 -> progress -> saved data ID returned (end-to-end)
- [ ] Queue-full returns 429 with Retry-After
- [ ] No regression in import resume/cancel workflows
- [ ] Polling fallback works when SignalR connection is unavailable
- [ ] Result TTL extends on access, reaper cleans expired results
- [ ] Job list endpoint returns correct jobs for authenticated user
- [ ] All documentation updated per phase (not deferred)

## Verification

After each phase:
1. Run full compliance check (`/compliance-check`)
2. Phase 1: verify WebSocket connection opens in browser devtools (Network -> WS), JWT auth works on hub, Docker proxy passes WebSocket traffic
3. Phase 3: WhatsNewPanel + MastSearch import progress arrives via WebSocket (no polling in Network tab)
4. Phase 4: composite export returns 202, progress streams via WebSocket, result downloads correctly
5. Phase 5: mosaic export returns 202, generate-and-save returns saved data ID on completion
6. Phase 6: verify no `setInterval` polling calls remain in frontend code
