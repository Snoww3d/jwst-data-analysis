# Fix #1524 — FAISS lock held during model-load retry backoff

**Branch**: `fix/1524-faiss-lock-during-retry`
**Type**: Bug fix (concurrency), processing-engine, priority: high
**Complexity**: Low (single module + tests)

## Problem

`EmbeddingService._ensure_model()` runs a bounded retry loop with `time.sleep()`
backoff (1s, 4s, 16s — up to ~21s) introduced in #1513/#1102. Every public path
(`embed`, `embed_batch`, `search`) acquires `self._lock` (the FAISS index lock)
and *then* calls `_encode` → `_ensure_model`. So a transient HuggingFace
rate-limit on first use makes the retrying thread sleep **while holding
`self._lock`**, blocking all concurrent semantic queries for the full backoff
window — a service-wide availability outage.

## Fix

1. Add a dedicated `self._model_load_lock`, separate from the FAISS index lock.
2. Rewrite `_ensure_model` with double-checked locking on `_model_load_lock`
   (fast-path boolean read, then lock + re-check, then the retry loop).
3. Call `self._ensure_model()` **before** acquiring `self._lock` in `embed`,
   `embed_batch`, and `search`, so the slow load happens outside the FAISS lock.
   - `search` keeps a lock-free empty-index fast path (snapshotting `self._index`)
     so it doesn't load the model just to search an empty index, and re-checks
     emptiness under the lock.
   - `embed_batch` wraps the pre-lock load in `except (OSError, ValueError,
     RuntimeError)` to preserve its "errors list" contract (OSError is the
     canonical transient failure).
4. `_encode` still calls `_ensure_model()` — now a fast no-op since callers
   pre-load — kept as defense for any future internal caller.

## Tests (TDD)

- `test_faiss_lock_not_held_during_model_load` — records `self._lock.locked()` at
  model-construction time; was `[True]` (red), now `[False]` (green).
- `test_concurrent_callers_load_model_once` — Barrier(8) + slow ctor forces
  contention; asserts exactly one construction (double-checked locking).
- `test_embed_batch_load_failure_returns_errors_not_raises` — OSError load
  failure surfaces as the errors list, not a 500.

## Verification

`docker exec jwst-processing python -m pytest tests/test_embedding_service.py` —
16 passed. Ruff clean.
