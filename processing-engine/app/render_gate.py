"""Global render concurrency gate (#1645).

The per-request memory budget (#882, ``MAX_COMPOSITE_MEMORY_BYTES`` -> 413)
caps how big one render can be, but nothing bounds how many renders run at
once — N parallel synchronous renders can OOM the container regardless of the
per-request budget. This module provides a process-global semaphore around
the heavy render endpoints (composite/mosaic generation): requests that cannot
get a slot within a bounded wait receive **429 + Retry-After** instead of
piling up.

Configuration:

- ``MAX_CONCURRENT_RENDERS``: 0/unset = auto (see below); N>0 = exactly N
  slots; negative or non-integer = startup error.
- Auto mode scales with the memory budget: ``clamp(container_memory_limit /
  MAX_COMPOSITE_MEMORY_BYTES, 1, 4)``, falling back to 2 slots when no
  container limit is readable. The sizing invariant covers the *composite*
  budget; mosaic renders share the same slots but their per-render memory is
  governed by ``MAX_MOSAIC_OUTPUT_PIXELS`` — keep that conservative, since a
  slot's "cost" is modeled as one composite budget.
- ``RENDER_QUEUE_WAIT_SECONDS`` (default 10): how long a request may wait for
  a slot before giving up with 429.
- ``RENDER_RETRY_AFTER_SECONDS`` (default 30): the ``Retry-After`` hint sent
  with the 429.

Slot counts are resolved once at process start (first use); the memory budget
itself stays live-tunable per #882.

The gate is per *process*: it is only a true global limit because the engine
runs uvicorn with ``--workers 1`` (see the Dockerfile CMD). Raising the worker
count multiplies effective render concurrency by the worker count.

Async route handlers must wait via :meth:`RenderGate.acquire_async` (used by
the :func:`render_gated` decorator) so waiters park on the event loop; the
blocking :meth:`RenderGate.slot` is for code already running in a worker
thread (the streaming pipeline).
"""

from __future__ import annotations

import asyncio
import functools
import logging
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.config import EnvVarError, float_env, int_env


logger = logging.getLogger(__name__)

# Mirrors the composite pipeline's default budget (app/composite/routes.py).
# Not imported from there to keep this module dependency-free of the routers
# that decorate their endpoints with it.
_DEFAULT_MEMORY_BUDGET_BYTES = 3_000_000_000

_AUTO_SLOT_FALLBACK = 2
_AUTO_SLOT_MAX = 4

# How often an async waiter re-checks the semaphore. Coarse enough to be
# cheap, fine enough that a freed slot is picked up promptly relative to
# render durations (tens of seconds).
_ASYNC_POLL_SECONDS = 0.1

# cgroup v2 then v1; values above this sentinel mean "no limit set".
_CGROUP_LIMIT_FILES = (
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
)
_CGROUP_UNLIMITED_SENTINEL = 1 << 60


def detect_container_memory_limit_bytes() -> int | None:
    """Best-effort read of the container's memory limit from cgroups.

    Returns None outside a limited container (bare metal, "max", unreadable).
    """
    for candidate in _CGROUP_LIMIT_FILES:
        try:
            raw = Path(candidate).read_text().strip()
        except OSError:
            continue
        if raw.isdigit():
            value = int(raw)
            if 0 < value < _CGROUP_UNLIMITED_SENTINEL:
                return value
    return None


def _configured_slot_count() -> int:
    """Read and validate MAX_CONCURRENT_RENDERS (0 = auto)."""
    configured = int_env("MAX_CONCURRENT_RENDERS", 0)
    if configured < 0:
        raise EnvVarError(
            f"Environment variable MAX_CONCURRENT_RENDERS={configured} must be >= 0 "
            "(0 = auto-derive from container memory and MAX_COMPOSITE_MEMORY_BYTES)."
        )
    return configured


def resolve_slot_count(detected_limit_bytes: int | None, configured: int | None = None) -> int:
    """Resolve the render slot count from env + detected container memory.

    Explicit ``MAX_CONCURRENT_RENDERS`` > 0 wins. 0/unset derives the count
    from the composite memory budget so total worst-case render memory stays
    within the container: ``clamp(limit / budget, 1, 4)``.
    """
    if configured is None:
        configured = _configured_slot_count()
    if configured > 0:
        return configured

    if detected_limit_bytes is None:
        return _AUTO_SLOT_FALLBACK

    budget = int_env("MAX_COMPOSITE_MEMORY_BYTES", _DEFAULT_MEMORY_BUDGET_BYTES)
    derived = detected_limit_bytes // max(budget, 1)
    return max(1, min(_AUTO_SLOT_MAX, derived))


class RenderGate:
    """Bounded semaphore that turns render-slot exhaustion into HTTP 429."""

    def __init__(self, slots: int, wait_seconds: float, retry_after_seconds: int):
        self.slots = slots
        self.wait_seconds = wait_seconds
        self.retry_after_seconds = retry_after_seconds
        self._semaphore = threading.BoundedSemaphore(slots)

    def _busy_exception(self) -> HTTPException:
        return HTTPException(
            status_code=429,
            detail=(
                "The server is busy rendering other images right now. Please try again in a moment."
            ),
            headers={"Retry-After": str(self.retry_after_seconds)},
        )

    @contextmanager
    def slot(self) -> Iterator[None]:
        """Hold a render slot for the duration of the block, or raise 429.

        Blocking — only for code already running in a worker thread (e.g. the
        streaming pipeline). Async handlers must use :meth:`acquire_async` so
        the wait does not pin a threadpool thread.
        """
        if not self._semaphore.acquire(timeout=self.wait_seconds):
            raise self._busy_exception()
        try:
            yield
        finally:
            self._semaphore.release()

    async def acquire_async(self) -> None:
        """Acquire a slot from the event loop without blocking any thread.

        Polls the semaphore non-blockingly with short async sleeps up to
        ``wait_seconds``, so waiters cost the event loop a timer instead of
        occupying a threadpool thread (which would starve cheap endpoints
        that share the pool). Raises 429 when the wait window elapses.
        """
        deadline = time.monotonic() + self.wait_seconds
        while True:
            if self._semaphore.acquire(blocking=False):
                return
            if time.monotonic() >= deadline:
                raise self._busy_exception()
            await asyncio.sleep(_ASYNC_POLL_SECONDS)

    def release(self) -> None:
        self._semaphore.release()


_gate: RenderGate | None = None
_gate_lock = threading.Lock()


def get_render_gate() -> RenderGate:
    """Return the process-global gate, resolving configuration on first use."""
    global _gate
    if _gate is None:
        with _gate_lock:
            if _gate is None:
                detected = detect_container_memory_limit_bytes()
                configured = _configured_slot_count()
                slots = resolve_slot_count(detected, configured)
                gate = RenderGate(
                    slots=slots,
                    wait_seconds=float_env("RENDER_QUEUE_WAIT_SECONDS", 10.0),
                    retry_after_seconds=int_env("RENDER_RETRY_AFTER_SECONDS", 30),
                )
                budget = int_env("MAX_COMPOSITE_MEMORY_BYTES", _DEFAULT_MEMORY_BUDGET_BYTES)
                if detected is not None and slots * budget > detected:
                    logger.warning(
                        "Render gate: %d slots x %d-byte composite budget exceeds the "
                        "container memory limit (%d bytes) — concurrent worst-case "
                        "renders can OOM. Lower MAX_CONCURRENT_RENDERS or "
                        "MAX_COMPOSITE_MEMORY_BYTES.",
                        slots,
                        budget,
                        detected,
                    )
                logger.info(
                    "Render gate ready: %d slot(s) (%s), queue wait %.1fs, Retry-After %ds",
                    slots,
                    "explicit MAX_CONCURRENT_RENDERS"
                    if configured > 0
                    else "auto from memory budget",
                    gate.wait_seconds,
                    gate.retry_after_seconds,
                )
                _gate = gate
                return gate
    return _gate


def reset_render_gate() -> None:
    """Drop the cached gate so the next use re-reads the environment (tests)."""
    global _gate
    with _gate_lock:
        _gate = None


def render_gated(func: Callable[..., Any]) -> Callable[..., Any]:
    """Gate a synchronous route handler behind a render slot.

    The wrapper is async: it waits for a slot on the event loop (no threadpool
    thread is pinned while queueing), then runs the sync handler body in the
    threadpool exactly as Starlette would have.
    """

    @functools.wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        gate = get_render_gate()
        await gate.acquire_async()
        try:
            # run_in_threadpool uses anyio's non-abandoning to_thread.run_sync:
            # even if this task is cancelled, the await does not resume until
            # the sync render thread completes, so the release below cannot
            # free a slot while its render is still consuming memory.
            return await run_in_threadpool(func, *args, **kwargs)
        finally:
            gate.release()

    return wrapper
