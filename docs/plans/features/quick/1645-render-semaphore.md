# 1645 — Global render semaphore (bound concurrent composite/mosaic renders)

**Issue:** #1645 · **Risk:** low · **CE deploy blocker** (plan: `docs/plans/features/community-edition-v1.md` Phase 4)

## Problem

Synchronous renders run in-request with no concurrency bound. The #882 memory
budget (`MAX_COMPOSITE_MEMORY_BYTES` → 413) is per-request; N parallel renders
× ~budget bytes each OOM the box. Nothing limits render concurrency anywhere
in the stack.

## Approach

New `app/render_gate.py`: a process-global `threading.BoundedSemaphore` gating
the heavy render endpoints. Requests that can't get a slot within a bounded
wait get **429 + Retry-After** instead of piling up.

**Slot count scales with the memory budget**: when `MAX_CONCURRENT_RENDERS` is
unset/0, slots = `clamp(container_memory_limit / MAX_COMPOSITE_MEMORY_BYTES,
1, 4)` (cgroup v2/v1 detection; fallback 2 when no limit is readable).
Explicit `MAX_CONCURRENT_RENDERS=N` overrides. Startup warns when
`slots × budget > container limit`.

## Changes

- `processing-engine/app/render_gate.py` — new: `RenderGate`, `render_gated`
  decorator (sync handlers), `get_render_gate()` lazy singleton +
  `reset_render_gate()` for tests, cgroup limit detection, env parsing via
  `app.config` helpers (#1383 pattern).
- `processing-engine/app/composite/routes.py` — gate `/generate-nchannel`
  (decorator) and the `/generate-nchannel-stream` worker thread (context
  manager inside `run_pipeline`; existing `except HTTPException` already emits
  the 429 as an NDJSON error event).
- `processing-engine/app/mosaic/routes.py` — gate `/generate` and
  `/generate-observation` (decorator).
- `processing-engine/main.py` — resolve the gate at import (fail fast on bad
  env, log the resolved slot count).
- `docker/.env.example` — document `MAX_CONCURRENT_RENDERS`,
  `RENDER_QUEUE_WAIT_SECONDS`, `RENDER_RETRY_AFTER_SECONDS` next to the memory
  sizing table.
- `processing-engine/tests/test_render_gate.py` — new (red-green).

Unthrottled by design: `/composite/estimate`, `/composite/analyze-channels`,
`/mosaic/footprint`, thumbnails/previews — cheap, no reproject+combine work.

## Env knobs

| Var | Default | Meaning |
|---|---|---|
| `MAX_CONCURRENT_RENDERS` | 0 (auto) | 0/unset = derive from memory; N>0 = exactly N slots; negative = startup error |
| `RENDER_QUEUE_WAIT_SECONDS` | 10 | Max wait for a slot before 429 |
| `RENDER_RETRY_AFTER_SECONDS` | 30 | `Retry-After` header value on 429 |

## Test plan

- Unit: slot resolution (explicit, auto from mocked cgroup limit, clamps,
  fallback, negative → `EnvVarError`); gate acquire/timeout/release; 429
  carries `Retry-After`.
- Integration: `/composite/generate-nchannel` and `/mosaic/generate` return
  429 when the gate is exhausted (deterministic via patched gate + events);
  render inside the limit unaffected.
- Full suite: `docker exec jwst-processing python -m pytest`.
