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

NOTE ON PACKAGE PLACEMENT: this module lives in ``app/render/`` next to
``app/render/routes.py``, but that neighbour's endpoints (thumbnail, preview,
histogram, pixeldata) are deliberately NOT gated — they are small
single-file reads, not multi-file reproject/combine renders. Being in the same
package implies nothing about being covered; the gate applies exactly where
``render_slot`` is called.

Two admission policies:

- INTERACTIVE (default) — a caller that can't get in sheds load immediately
  (429 + Retry-After) so a client can back off. Correct for HTTP requests a
  human is waiting on.
- BACKGROUND (``background=True``) — queued work that is ALREADY serialized
  upstream (`/mosaic/generate-observation` is driven by the .NET
  `MosaicBackgroundService`, a single-reader channel at concurrency 1). Such
  work must WAIT, not shed: 429ing it fails a queued job outright instead of
  delaying it. It still takes a real slot (so it counts against the same RAM
  budget) and still blocks on admission, but with a long deadline
  (``RENDER_BACKGROUND_WAIT_SECONDS``) instead of failing fast.

Env knobs (documented in docker/.env.example). The generic ``RENDER_*`` names
are primary; the older composite-specific names are still honoured as fallbacks
so existing configs keep working:

- ``MAX_CONCURRENT_RENDERS``   (fallback ``MAX_CONCURRENT_COMPOSITES``, default 2)
- ``RENDER_QUEUE_WAIT_SECONDS`` (fallback ``COMPOSITE_QUEUE_WAIT_SECONDS``, default 15)
- ``RENDER_QUEUE_DEPTH``        (fallback ``COMPOSITE_QUEUE_DEPTH``, default 4)
- ``RENDER_BACKGROUND_WAIT_SECONDS`` (default 900) — how long queued background
  renders wait for a slot before giving up. Kept under the .NET client's 30min
  per-attempt timeout so the engine, not the gateway, decides the outcome.
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
# How long already-serialized BACKGROUND renders wait for a slot. Long, but
# bounded: an unbounded wait would hide a genuinely wedged slot forever.
RENDER_BACKGROUND_WAIT_SECONDS = float_env("RENDER_BACKGROUND_WAIT_SECONDS", 900.0)

_render_slots = threading.BoundedSemaphore(MAX_CONCURRENT_RENDERS)
_admission = threading.BoundedSemaphore(MAX_CONCURRENT_RENDERS + RENDER_QUEUE_DEPTH)

_AT_CAPACITY = "The image renderer is at capacity. Please retry in a few seconds."


def _busy(retry_after: float) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail=_AT_CAPACITY,
        headers={"Retry-After": str(max(1, int(retry_after)))},
    )


def _acquire_by(
    semaphore: threading.Semaphore,
    deadline: float,
    cancelled: threading.Event | None,
) -> bool:
    """Acquire ``semaphore`` before ``deadline``, in 0.5s slices.

    Slicing (rather than one long blocking acquire) is what lets us observe
    ``cancelled`` between attempts, so a disconnected streaming client stops
    waiting instead of pinning a worker thread for the whole window.
    Returns False on timeout; raises PipelineCancelled if cancelled.
    """
    while True:
        if cancelled is not None and cancelled.is_set():
            # Lazy import — see module-level note on the circular import.
            from app.composite.progress import PipelineCancelled

            raise PipelineCancelled()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        if semaphore.acquire(timeout=min(0.5, remaining)):
            return True


@contextlib.contextmanager
def render_slot(cancelled: threading.Event | None = None, *, background: bool = False):
    """Hold one global render slot; 429 when saturated.

    Two-stage gate:
    1. ADMISSION: at most slots+queue_depth callers are in the building.
       Interactive callers acquire NON-BLOCKING — everyone beyond that 429s
       IMMEDIATELY, so waiters can never pile up and exhaust the shared worker
       pools. Background callers block for admission on the long deadline
       (see below); they are already serialized upstream, so they cannot be
       the flood this bouncer exists to stop.
    2. SLOT (sliced blocking): admitted callers wait for a render slot in 0.5s
       slices, observing ``cancelled`` between slices.

    ``background=True`` marks queued work that must WAIT rather than shed load
    (see the module docstring): the deadline becomes
    RENDER_BACKGROUND_WAIT_SECONDS instead of RENDER_QUEUE_WAIT_SECONDS, and
    admission is blocking. It still consumes a real slot, so it stays inside
    the same combined RAM budget as every interactive render.

    Callers run in worker threads (sync routes use the Starlette threadpool,
    the stream route + CE facade use asyncio's executor), so blocking here
    never stalls the event loop.
    """
    wait = RENDER_BACKGROUND_WAIT_SECONDS if background else RENDER_QUEUE_WAIT_SECONDS
    # The Retry-After hint is always the INTERACTIVE window: telling a client to
    # come back in 15 minutes because a background render blew its long deadline
    # is useless advice — by then the pool has long since churned.
    hint = RENDER_QUEUE_WAIT_SECONDS
    deadline = time.monotonic() + wait
    if background:
        if not _acquire_by(_admission, deadline, cancelled):
            raise _busy(hint)
    elif not _admission.acquire(blocking=False):
        raise _busy(hint)
    try:
        if not _acquire_by(_render_slots, deadline, cancelled):
            raise _busy(hint)
        try:
            yield
        finally:
            _render_slots.release()
    finally:
        _admission.release()
