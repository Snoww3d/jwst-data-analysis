"""Global render concurrency gate (CE plan Phase 4).

The per-request memory budgets (`MAX_COMPOSITE_MEMORY_BYTES` for composites,
`MAX_MOSAIC_OUTPUT_PIXELS` for mosaics) stop ONE oversized render — they do
nothing about N normal-sized renders at once. On a public no-auth box, N
parallel renders each within budget can still sum past physical memory, and a
curl loop against any synchronous render endpoint is a one-liner OOM takedown.

This module owns a SINGLE global slot pool shared across every heavy render
path — composite generate (sync + NDJSON stream + CE `/api` facade) and mosaic
generate (`/mosaic/generate`, `/mosaic/generate-observation`). Sharing one pool
is deliberate: composites and mosaics contend for the same physical RAM, so the
cap must bound their COMBINED concurrency, not each in isolation. A request that
can't get a slot queues briefly, then fails fast with 429 + Retry-After.

Env knobs (documented in docker/.env.example). The generic ``RENDER_*`` names
are primary; the older composite-specific names are still honoured as fallbacks
so existing configs keep working:

- ``MAX_CONCURRENT_RENDERS``   (fallback ``MAX_CONCURRENT_COMPOSITES``, default 2)
- ``RENDER_QUEUE_WAIT_SECONDS`` (fallback ``COMPOSITE_QUEUE_WAIT_SECONDS``, default 15)
- ``RENDER_QUEUE_DEPTH``        (fallback ``COMPOSITE_QUEUE_DEPTH``, default 4)
"""

import contextlib
import os
import threading
import time

from fastapi import HTTPException

from app.config import float_env, int_env, positive_int_env


# NOTE: PipelineCancelled is imported lazily inside render_slot(), not at module
# top. Importing app.composite.progress here would drag in app.composite's
# package __init__ (which eagerly imports composite.routes → mosaic.routes →
# back to this module), a circular import at load time. This gate is a
# low-level module; it must not depend on composite at import time.


def _env_with_fallback(reader, primary: str, legacy: str, default):
    """Read ``primary`` if set, else the legacy name, else ``default``.

    Short-circuits on the primary's PRESENCE — a stale/malformed value under the
    legacy name never gets parsed (and so never crashes startup) when the new
    name is the one actually configured. A plain nested default like
    ``int_env(primary, int_env(legacy, default))`` parses both eagerly and loses
    that precedence.
    """
    if os.environ.get(primary) not in (None, ""):
        return reader(primary, default)
    return reader(legacy, default)


# Values are read at module load; docker/.env.example documents them. The older
# composite-specific env names are honoured as fallbacks (see #1645) so existing
# configs keep working. The slot count uses positive_int_env so a 0/negative
# value fails loudly at startup rather than silently 429ing every render.
MAX_CONCURRENT_RENDERS = _env_with_fallback(
    positive_int_env, "MAX_CONCURRENT_RENDERS", "MAX_CONCURRENT_COMPOSITES", 2
)
RENDER_QUEUE_WAIT_SECONDS = _env_with_fallback(
    float_env, "RENDER_QUEUE_WAIT_SECONDS", "COMPOSITE_QUEUE_WAIT_SECONDS", 15.0
)
# How many renders may WAIT for a slot (beyond the ones rendering). Waiters
# occupy worker threads, so this must stay small — an unbounded queue would let
# a request flood exhaust the shared thread pools and starve every other sync
# endpoint (the exact DoS this gate exists to prevent).
RENDER_QUEUE_DEPTH = _env_with_fallback(int_env, "RENDER_QUEUE_DEPTH", "COMPOSITE_QUEUE_DEPTH", 4)

_render_slots = threading.BoundedSemaphore(MAX_CONCURRENT_RENDERS)
_admission = threading.BoundedSemaphore(MAX_CONCURRENT_RENDERS + RENDER_QUEUE_DEPTH)

_AT_CAPACITY = "The image renderer is at capacity. Please retry in a few seconds."


def _busy(retry_after: float) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail=_AT_CAPACITY,
        headers={"Retry-After": str(max(1, int(retry_after)))},
    )


@contextlib.contextmanager
def render_slot(cancelled: threading.Event | None = None):
    """Hold one global render slot; 429 when saturated.

    Two-stage gate:
    1. ADMISSION (non-blocking): at most slots+queue_depth requests are in
       the building — everyone else 429s IMMEDIATELY, so waiters can never
       pile up and exhaust the shared worker pools.
    2. SLOT (sliced blocking): admitted requests wait up to
       RENDER_QUEUE_WAIT_SECONDS for a render slot in 0.5s slices,
       observing ``cancelled`` between slices so a disconnected streaming
       client stops waiting instead of holding a thread for the full window.

    Callers run in worker threads (sync routes use the Starlette threadpool,
    the stream route + CE facade use asyncio's executor), so blocking here
    never stalls the event loop.
    """
    wait = RENDER_QUEUE_WAIT_SECONDS
    if not _admission.acquire(blocking=False):
        raise _busy(wait)
    try:
        deadline = time.monotonic() + wait
        while True:
            if cancelled is not None and cancelled.is_set():
                # Lazy import — see module-level note on the circular import.
                from app.composite.progress import PipelineCancelled

                raise PipelineCancelled()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise _busy(wait)
            if _render_slots.acquire(timeout=min(0.5, remaining)):
                break
        try:
            yield
        finally:
            _render_slots.release()
    finally:
        _admission.release()
