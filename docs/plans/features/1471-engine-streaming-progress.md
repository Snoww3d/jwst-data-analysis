# Plan: Engine streaming progress + log panel (Phase 2)

**Issue**: #1471
**Branch**: `feature/composite-engine-streaming`
**Stacked on**: `feature/composite-async-preview` (PR #1472, Phase 1)
**Complexity**: Medium-large (engine + backend + frontend, new transport at engine→backend boundary)

## Problem

Phase 1 (#1470, PR #1472) wired the wizard preview onto the async job queue and surfaced **coarse-grained** stages (queued → mosaic → generating). For a typical 3-channel curated recipe the engine still spends 30–60 s in a single "generating" stage doing per-channel reproject + stretch + combine — that's a long single-label silence on every composite, not just multi-tile cases.

Phase 2 adds a streaming progress channel from the engine to the backend so the UI can show per-channel events ("Reprojecting F277W (1 of 3) — 1:23") plus a developer-detail log panel for the full ~36 lines the engine already emits to docker stdout.

## Decisions (from `/plan-eng-review`)

- **DECISION-1 — Stream format**: NDJSON (`application/x-ndjson`), one JSON object per line. Progress events: `{"event":"progress", stage, filter, index, total, rss_mb, message}`. Terminal events: `{"event":"complete", "image_b64":"...", "content_type":"image/jpeg"}` or `{"event":"error", "detail":"..."}`. The image is base64-encoded — ~33% overhead is acceptable for the simplicity of a single-endpoint, line-delimited response.
- **DECISION-2 — Buffer delivery**: SignalR carries the latest message only (single string, fits in existing `JobStatus.Message`). Frontend `useJobProgress` maintains a local rolling buffer capped at 50 entries. On SignalR reconnect or initial mount, frontend calls `GET /api/jobs/{id}` once to rehydrate from a new `JobStatus.Messages: string[]` field that the backend maintains server-side.
- **DECISION-3 — Engine endpoint shape**: Separate `POST /composite/generate-nchannel-stream` route. Sync `/composite/generate-nchannel` stays untouched per the "non-streaming still works" acceptance criterion. Backend `CompositeService` always uses the streaming endpoint when an `onProgress` callback is wired (i.e. on the async preview / export paths from Phase 1).

## Files Changed

### Engine
| File | Change |
|------|--------|
| `processing-engine/app/composite/routes.py` | Add `POST /composite/generate-nchannel-stream` returning `StreamingResponse` (NDJSON). Reuse the existing nchannel pipeline; thread a `progress_emitter` callable through the call sites that today log per-channel info. |
| `processing-engine/app/composite/progress.py` (new, ~40 lines) | `ProgressEmitter` helper: an asyncio `Queue`-backed bridge that lets pipeline code call `emit(stage, filter, index, total, rss_mb, message)` while a generator yields NDJSON lines. Also exposes a no-op variant for the sync endpoint. |
| `processing-engine/tests/test_composite_streaming.py` (new) | Event ordering, terminal `complete`, terminal `error`, mid-stream client disconnect handling. |

### Backend
| File | Change |
|------|--------|
| `backend/JwstDataAnalysis.API/Services/CompositeService.cs` | Switch `GenerateNChannelCompositeAsync` from `PostAsync` (buffered) to `SendAsync(..., HttpCompletionOption.ResponseHeadersRead)` when streaming endpoint is targeted. Read NDJSON line-by-line; per progress event call `onProgress(pct, stage, msg)`; on `complete` event decode b64 image; on `error` event throw with detail. |
| `backend/JwstDataAnalysis.API/Models/JobStatus.cs` | Add `Messages: List<string>` (additive; default empty). |
| `backend/JwstDataAnalysis.API/Services/JobTracker.cs` | `UpdateProgressAsync` appends the message to `JobStatus.Messages` when non-empty and not equal to the previous entry (de-dupe consecutive duplicates). Cap at 50 most-recent. |
| `backend/JwstDataAnalysis.API/Services/IJobTracker.cs` | No signature change — `Messages` flows through `JobStatus`. |
| `backend/JwstDataAnalysis.API.Tests/Services/CompositeServiceTests.cs` | Stream consumer happy path, partial chunk handling, malformed event line, server-side timeout while waiting on next event, mid-stream cancellation. |
| `backend/JwstDataAnalysis.API.Tests/Services/JobTrackerTests.cs` | Messages list grows with progress; capped at 50; consecutive duplicates collapsed. |

### Frontend
| File | Change |
|------|--------|
| `frontend/jwst-frontend/src/hooks/useJobProgress.ts` | Maintain a local `messages: string[]` buffer (cap 50). On mount and on `onreconnected`, fetch `GET /api/jobs/{id}` and rehydrate buffer from `messages` field. Append `progress.message` on each progress event when distinct from the last entry. Expose `messages` in the hook's return value. |
| `frontend/jwst-frontend/src/components/wizard/LogPanel.tsx` (new, ~80 lines) | Collapsed-by-default disclosure ("Show details ▸"). Open: scrollable timestamped buffer, auto-scroll to bottom, monospace font. |
| `frontend/jwst-frontend/src/components/wizard/LogPanel.css` (new) | Buffer styling. |
| `frontend/jwst-frontend/src/components/wizard/CompositePreviewStep.tsx` | Render `<LogPanel messages={previewMessages} />` below the loading status line on the async path. Pass `messages` from the new hook return. |
| `frontend/jwst-frontend/src/types/JobTypes.ts` | Add `messages?: string[]` to `ImportJobStatus` (or whichever interface the GET endpoint uses). |
| `frontend/jwst-frontend/src/hooks/useJobProgress.test.ts` | Buffer growth, dedup, cap, reconnect rehydration. |
| `frontend/jwst-frontend/src/components/wizard/LogPanel.test.tsx` (new) | Collapsed/expanded states, buffer overflow truncation, auto-scroll. |

## Behavior

### Engine `POST /composite/generate-nchannel-stream`
- Request body: same `NChannelCompositeRequest` as `generate-nchannel`.
- Response: `200 OK` + `Content-Type: application/x-ndjson`.
- Each line is one event:
  - `{"event":"progress", "stage":"reproject"|"stretch"|..., "filter":"F277W", "index":3, "total":4, "rss_mb":669, "message":"Reprojecting F277W to common grid (3417x4353)"}`
  - Terminal: `{"event":"complete", "image_b64":"<base64>", "content_type":"image/jpeg"}` OR `{"event":"error", "detail":"..."}`
- Client disconnect (cancellation) is detected via FastAPI's `request.is_disconnected()` polled at event boundaries — emitter exits cleanly without raising.

### Backend stream consumer
- `CompositeService.GenerateNChannelCompositeAsync` opens an `HttpResponseMessage` with `ResponseHeadersRead`, reads the body stream line-by-line via `StreamReader.ReadLineAsync`.
- On each `progress` line: `await onProgress(progressPct, stage, message)` (existing callback). `progressPct` is computed from `index/total` per stage with stage-specific weights so the bar advances monotonically.
- On `complete` line: decode `image_b64`, return `CompositeResult(bytes, headers)`.
- On `error` line: throw `InvalidOperationException(detail)` (mapped to user message via `ProcessingErrorMessages.ToUserMessage`).
- On unexpected stream end without terminal event: throw `HttpRequestException("Engine stream ended without completion event")`.

### Backend message buffer
- `JobStatus.Messages` is a server-side list, capped at 50 most-recent entries, consecutive duplicates collapsed.
- `JobTracker.UpdateProgressAsync` appends `message` to the list when it's non-empty and different from the last entry.
- `JobsController.GetJob` already returns `JobStatus`; `Messages` rides along on the existing GET response automatically.
- SignalR hub continues to send the latest progress event (single message) — no payload-size change. Frontend maintains its own local buffer from the per-event messages.

### Frontend
- `useJobProgress` exposes `messages: string[]` in addition to existing fields.
- On mount when `jobId` becomes non-null, fetch `GET /api/jobs/{jobId}` once and seed `messages` from the response (`status.messages ?? []`). Same on `onreconnected`.
- On each progress event, append `progress.message` to the local buffer if non-empty and different from the last entry. Cap at 50.
- `<LogPanel messages={messages}>` renders nothing when collapsed except the disclosure button. Open: monospace `<pre>` block, scrollable, auto-scrolls to bottom on new entries unless the user has scrolled up.

## Test Plan

### Engine (pytest)
- [ ] `test_streaming_emits_per_channel_events` — 3-channel composite emits ≥3 reproject events, ≥3 stretch events, in order
- [ ] `test_streaming_terminal_complete_carries_image` — final line is `complete` event with non-empty `image_b64` decodable to a valid PNG/JPEG
- [ ] `test_streaming_terminal_error_on_invalid_input` — final line is `error` event with detail; no `complete`
- [ ] `test_streaming_client_disconnect_cancels_cleanly` — client closes connection mid-stream, generator exits without raising into the FastAPI app
- [ ] `docker exec jwst-processing python -m pytest`

### Backend (xUnit + Moq)
- [ ] `GenerateNChannelComposite_Streaming_HappyPath_ReturnsImageBytes` — stub `HttpMessageHandler` to emit 3 progress lines + complete; assert image bytes returned, onProgress called 3 times
- [ ] `GenerateNChannelComposite_Streaming_ErrorEvent_Throws` — stub error event; assert thrown exception's user message preserves detail
- [ ] `GenerateNChannelComposite_Streaming_StreamEndsWithoutTerminal_Throws`
- [ ] `GenerateNChannelComposite_Streaming_PartialChunk_AssemblesLine` — stub stream that splits a JSON line across two read buffers; assert single onProgress call
- [ ] `JobTracker_UpdateProgress_AppendsToMessagesBuffer`
- [ ] `JobTracker_UpdateProgress_CapsBufferAt50`
- [ ] `JobTracker_UpdateProgress_DedupesConsecutiveDuplicates`
- [ ] `dotnet test`

### Frontend (Vitest)
- [ ] `useJobProgress` — buffer grows on each distinct progress message
- [ ] `useJobProgress` — buffer caps at 50 entries
- [ ] `useJobProgress` — buffer dedupes consecutive duplicate messages
- [ ] `useJobProgress` — reconnect rehydrates buffer from `GET /api/jobs/{id}`
- [ ] `LogPanel` — collapsed by default; click toggles open
- [ ] `LogPanel` — renders all buffered messages monospace with timestamps
- [ ] `LogPanel` — buffer overflow truncation visual (scrollable, auto-scroll to bottom)
- [ ] `npm run lint && npm run typecheck && npm run test`

### E2E (Playwright)
- [ ] `guided-create.spec.ts` — authenticated wizard preview shows per-channel stage transitions; the Show details disclosure opens the LogPanel; the panel contains at least 3 timestamped lines for a 3-channel composite

### Manual verification
- [ ] `docker compose up -d --build`
- [ ] Authenticated wizard, generate a 3+ channel curated recipe — verify the status line transitions through per-channel events ("Reprojecting F277W (1 of 3) — 0:14") and the LogPanel disclosure shows ~36 entries when expanded
- [ ] Disconnect SignalR mid-job (kill backend, restart) — verify the LogPanel rehydrates from `GET /api/jobs/{id}` on reconnect

## Risk & Rollback

- **Risk: Medium.** New transport at the engine→backend boundary. Streaming HTTP responses interact with timeouts, proxies, and error handling differently from buffered HTTP. The b64 image decode adds a CPU step on the backend. The new `JobStatus.Messages` field grows `JobStatus` document size in MongoDB by up to ~5KB per job (50 lines × ~100 chars).
- **Rollback**: revert the PR. Backend goes back to buffered `PostAsync` against `generate-nchannel`; engine streaming endpoint becomes dead code (additive, no callers); frontend LogPanel disappears, falling back to Phase 1's stage label + elapsed time.

## Out of Scope

- ETA badge / `eta_seconds` extension to `/composite/estimate` — separate issue (estimation needs telemetry, different problem).
- Removing the sync `/composite/generate-nchannel` endpoint — separate cleanup issue once we audit non-wizard callers.
- LogPanel filtering/severity coloring — engine logs are uniform `logger.info`; if needed later, add as a follow-up.

## Stacking strategy

This branch (`feature/composite-engine-streaming`) is stacked on `feature/composite-async-preview` (PR #1472). When #1472 merges:
1. `git fetch origin && git rebase origin/main` on this branch.
2. Resolve any conflicts (likely none — Phase 2 mostly adds new files; the only Phase 1 file Phase 2 touches is `CompositeService.cs`).
3. Force-push to refresh the PR.

If #1472 needs material changes during review, the rebase here gets larger but the boundary is well-defined (Phase 2 only adds; Phase 1 is the changing layer).
