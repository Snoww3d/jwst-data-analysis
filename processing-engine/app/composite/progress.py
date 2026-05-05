"""Progress emission for the streaming composite endpoint.

The streaming route owns an asyncio.Queue that an event-stream generator
drains as NDJSON lines. The synchronous composite pipeline (run in a worker
thread) calls a `ProgressCallback` to push progress dicts into that queue.

When `progress` is `None`, helpers that accept it short-circuit — that's the
sync `/composite/generate-nchannel` path, which never opted into streaming.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any


# Sink for one structured progress event. The streaming route binds this to
# an asyncio.Queue via loop.call_soon_threadsafe; the sync route passes None.
ProgressCallback = Callable[[dict[str, Any]], None] | None


class PipelineCancelled(Exception):
    """Raised at a stage boundary when the streaming client disconnected.

    The streaming route checks this in `run_pipeline`'s exception handler
    and exits cleanly (no `error` event emitted, since nobody is listening).
    Pipeline helpers that accept a `progress` callback don't need to know
    about this — `emit_progress` raises it for them at every emit boundary.
    """


def emit_progress(
    progress: ProgressCallback,
    stage: str,
    message: str,
    *,
    filter: str | None = None,  # noqa: A002 - matches engine event schema; the param shadow is intentional
    index: int | None = None,
    total: int | None = None,
    rss_mb: float | None = None,
) -> None:
    """Emit a `progress` event if a callback is wired, no-op otherwise.

    Pipeline code calls this at stage boundaries. The shape mirrors the
    documented event schema in #1471 so backend stream-consumer tests can
    assert on field names.
    """
    if progress is None:
        return

    event: dict[str, Any] = {"event": "progress", "stage": stage, "message": message}
    if filter is not None:
        event["filter"] = filter
    if index is not None:
        event["index"] = index
    if total is not None:
        event["total"] = total
    if rss_mb is not None:
        event["rss_mb"] = rss_mb
    progress(event)
