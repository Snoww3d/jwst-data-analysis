"""
Shared atime-LRU eviction over a byte budget.

Two callers need the same algorithm over different file sets: the S3 temp
cache (`temp_cache.TempFileCache`) and the MAST download cache
(`app.mast.cache.MastCache`). The algorithm lives here once; each caller
supplies its own candidate list and its own protection predicate.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EvictionResult:
    """Outcome of one eviction pass."""

    evicted_count: int
    bytes_freed: int
    remaining_bytes: int
    max_bytes: int
    failed_count: int

    @property
    def within_budget(self) -> bool:
        return self.remaining_bytes <= self.max_bytes


def evict_to_budget(
    candidates: Iterable[Path],
    max_bytes: int,
    *,
    is_protected: Callable[[Path], bool] | None = None,
    label: str = "cache",
) -> EvictionResult:
    """
    Delete least-recently-accessed files until the total is within ``max_bytes``.

    Protected files are never deleted but still count toward the total — they
    occupy disk just the same, so a heavily pinned cache can legitimately end
    up over budget. That case is logged as a warning rather than forced.

    Args:
        candidates: Files eligible for consideration. The caller is responsible
            for restricting this to files it is safe to delete.
        max_bytes: Byte budget for the whole candidate set.
        is_protected: Returns True for files that must survive this pass.
        label: Name used in log lines, e.g. "MAST cache".
    """
    sized: list[tuple[Path, int, float]] = []
    total_bytes = 0

    for path in candidates:
        try:
            stat = path.stat()
        except OSError:
            # Vanished or unreadable between listing and stat — not our problem.
            continue
        total_bytes += stat.st_size
        if is_protected is not None and is_protected(path):
            continue
        sized.append((path, stat.st_size, stat.st_atime))

    if total_bytes <= max_bytes:
        return EvictionResult(
            evicted_count=0,
            bytes_freed=0,
            remaining_bytes=total_bytes,
            max_bytes=max_bytes,
            failed_count=0,
        )

    # Oldest access time first.
    sized.sort(key=lambda entry: entry[2])

    bytes_freed = 0
    evicted = 0
    failed = 0
    remaining = total_bytes

    for path, size, _atime in sized:
        if remaining <= max_bytes:
            break
        try:
            path.unlink()
        except OSError:
            failed += 1
            logger.warning("%s: failed to evict %s", label, path, exc_info=True)
            continue
        remaining -= size
        bytes_freed += size
        evicted += 1
        logger.info("%s: evicted %s (%d bytes)", label, path, size)

    result = EvictionResult(
        evicted_count=evicted,
        bytes_freed=bytes_freed,
        remaining_bytes=remaining,
        max_bytes=max_bytes,
        failed_count=failed,
    )

    if evicted or failed:
        logger.info(
            "%s eviction: removed %d files, freed %d bytes, %d bytes remaining "
            "(budget %d, %d failures)",
            label,
            evicted,
            bytes_freed,
            remaining,
            max_bytes,
            failed,
        )

    if not result.within_budget:
        logger.warning(
            "%s still %d bytes over budget after eviction "
            "(%d bytes remaining, budget %d) — protected or undeletable files",
            label,
            remaining - max_bytes,
            remaining,
            max_bytes,
        )

    return result
