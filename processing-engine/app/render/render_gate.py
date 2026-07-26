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
  upstream. `/mosaic/generate-observation` has exactly TWO drivers, each a
  single-reader .NET channel: `MosaicBackgroundService` (the observation-mosaic
  job) and `CompositeBackgroundService` (the inline-mosaic step of a composite
  export, `CompositeService.GenerateObservationMosaicAsync`). So at most two
  such requests exist at once, by construction. Queued work must WAIT, not
  shed: 429ing it fails a queued job outright instead of merely delaying it.

  It still takes a REAL slot, so it stays inside the same combined RAM budget —
  exempting it would let it compete with composites unbounded, the exact failure
  this gate exists to prevent. Two extra bounds keep "waiting" from becoming its
  own DoS:

  * ``_background_admission`` (``RENDER_BACKGROUND_DEPTH``, default 2) is
    acquired NON-BLOCKING, so the number of threads ever parked waiting for a
    render slot stays constant. Blocking on the shared ``_admission`` instead
    would (a) let unbounded background callers pile up on the sync threadpool
    and (b) let an interactive flood barge past a waiting background caller
    indefinitely — CPython semaphores are not fair.
  * ``_background_slots`` (capacity 1) means at most ONE background render holds
    a slot at a time, so a long observation mosaic can never occupy every slot
    and 429 all interactive work for minutes.

Env knobs (documented in docker/.env.example). The generic ``RENDER_*`` names
are primary; the older composite-specific names are still honoured as fallbacks
so existing configs keep working:

- ``MAX_CONCURRENT_RENDERS``   (fallback ``MAX_CONCURRENT_COMPOSITES``, default 2)
- ``RENDER_QUEUE_WAIT_SECONDS`` (fallback ``COMPOSITE_QUEUE_WAIT_SECONDS``, default 15)
- ``RENDER_QUEUE_DEPTH``        (fallback ``COMPOSITE_QUEUE_DEPTH``, default 4)
- ``RENDER_BACKGROUND_WAIT_SECONDS`` (default 300) — how long a queued background
  render waits for a slot before giving up. A small fraction of the .NET client's
  30min per-attempt timeout, so a wait never eats the render's own budget (and
  never provokes the gateway's retry-on-timeout into duplicating a heavy render).
- ``RENDER_BACKGROUND_DEPTH`` (default 2) — how many background renders may be
  in the gate at once. Matches the number of upstream drivers.
"""

import contextlib
import os
import threading
import time

from fastapi import HTTPException

from app.config import int_env, positive_float_env, positive_int_env


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
    positive_float_env, "RENDER_QUEUE_WAIT_SECONDS", "COMPOSITE_QUEUE_WAIT_SECONDS", 15.0
)
# How many renders may WAIT for a slot (beyond the ones rendering). Waiters
# occupy worker threads, so this must stay small — an unbounded queue would let
# a request flood exhaust the shared thread pools and starve every other sync
# endpoint (the exact DoS this gate exists to prevent).
RENDER_QUEUE_DEPTH = _env_with_fallback(int_env, "RENDER_QUEUE_DEPTH", "COMPOSITE_QUEUE_DEPTH", 4)
# How long an already-serialized BACKGROUND render waits for a slot. Long, but
# bounded — an unbounded wait would hide a genuinely wedged slot forever — and a
# small fraction of the gateway's 30min per-attempt timeout, so the wait never
# eats the render's own budget.
RENDER_BACKGROUND_WAIT_SECONDS = positive_float_env("RENDER_BACKGROUND_WAIT_SECONDS", 300.0)
# How many background renders may be inside the gate at once. Defaults to 2, the
# number of upstream drivers (see the module docstring). This is the ONLY thing
# bounding parked background threads, so it must stay small.
RENDER_BACKGROUND_DEPTH = positive_int_env("RENDER_BACKGROUND_DEPTH", 2)

_render_slots = threading.BoundedSemaphore(MAX_CONCURRENT_RENDERS)
_admission = threading.BoundedSemaphore(MAX_CONCURRENT_RENDERS + RENDER_QUEUE_DEPTH)
# Background callers get their OWN non-blocking admission pool rather than
# blocking on _admission: blocking there would let them pile up unboundedly on
# the sync threadpool, and CPython's unfair semaphores would let an interactive
# flood barge past a waiting background caller until its deadline expired.
_background_admission = threading.BoundedSemaphore(RENDER_BACKGROUND_DEPTH)
# At most ONE background render may hold a render slot, so a long observation
# mosaic can never occupy every slot and 429 all interactive work for minutes.
_background_slots = threading.BoundedSemaphore(1)

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
    1. ADMISSION (always NON-BLOCKING): a bounded number of callers may be in
       the building — everyone else 429s IMMEDIATELY, so waiters can never pile
       up and exhaust the shared worker pools. Interactive callers use
       ``_admission`` (slots+queue_depth); background callers use their own
       ``_background_admission`` (``RENDER_BACKGROUND_DEPTH``), so the two can
       neither starve nor flood each other.
    2. SLOT (sliced blocking): admitted callers wait for a render slot in 0.5s
       slices, observing ``cancelled`` between slices, up to the deadline —
       ``RENDER_QUEUE_WAIT_SECONDS`` interactive, ``RENDER_BACKGROUND_WAIT_SECONDS``
       background.

    ``background=True`` marks queued work that must WAIT rather than shed load
    (see the module docstring). It additionally takes ``_background_slots`` so
    at most one background render occupies a slot at a time, and it still takes
    a real ``_render_slots`` permit, so it stays inside the same combined RAM
    budget as every interactive render.

    Callers run in worker threads (sync routes use the Starlette threadpool,
    the stream route + CE facade use asyncio's executor), so blocking here
    never stalls the event loop.
    """
    # The Retry-After hint is always the INTERACTIVE window: telling a client to
    # come back in 5 minutes because a background render blew its long deadline
    # is useless advice — by then the pool has long since churned.
    hint = RENDER_QUEUE_WAIT_SECONDS
    admission = _background_admission if background else _admission
    if not admission.acquire(blocking=False):
        raise _busy(hint)
    try:
        with contextlib.ExitStack() as stack:
            wait = RENDER_BACKGROUND_WAIT_SECONDS if background else RENDER_QUEUE_WAIT_SECONDS
            deadline = time.monotonic() + wait
            if background:
                if not _acquire_by(_background_slots, deadline, cancelled):
                    raise _busy(hint)
                stack.callback(_background_slots.release)
            # Deliberately the SAME deadline across both stages: it bounds the
            # caller's total wait, which is what the gateway timeout budget cares
            # about. A background caller that spent most of its window getting
            # past _background_slots gets correspondingly less time here.
            if not _acquire_by(_render_slots, deadline, cancelled):
                raise _busy(hint)
            stack.callback(_render_slots.release)
            yield
    finally:
        admission.release()
