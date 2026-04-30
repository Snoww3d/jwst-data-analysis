"""
In-memory cache for reprojected composite channel arrays.

Caches the expensive load → downscale → mosaic → reproject results so that
stretch-only parameter changes (the most common user interaction) can skip
those steps and return in ~100ms instead of seconds.
"""

import hashlib
import json
import logging
import os
import threading
import time
from collections import OrderedDict

import numpy as np


logger = logging.getLogger(__name__)

DEFAULT_TTL_SECONDS = 600  # 10 minutes
DEFAULT_MAX_ENTRIES = 3
DEFAULT_MAX_BYTES = 512 * 1024 * 1024  # 512 MB


class CompositeCache:
    """LRU cache for reprojected RGB channel arrays with TTL and memory limits."""

    def __init__(self) -> None:
        self._ttl = int(os.environ.get("COMPOSITE_CACHE_TTL_SECONDS", DEFAULT_TTL_SECONDS))
        self._max_entries = int(os.environ.get("COMPOSITE_CACHE_MAX_ENTRIES", DEFAULT_MAX_ENTRIES))
        self._max_bytes = int(os.environ.get("COMPOSITE_CACHE_MAX_BYTES", DEFAULT_MAX_BYTES))
        self._lock = threading.Lock()
        # OrderedDict preserves insertion order; we move accessed keys to the
        # end so the *first* key is the least-recently-used.
        # Values: (channels, timestamp, paths_fingerprint, original_shape)
        # original_shape carries provenance for force-downscaled entries so
        # later cache hits can surface the warning even when the user didn't
        # opt in to allow_force_downscale themselves. None for entries that
        # were not force-downscaled.
        self._store: OrderedDict[
            str,
            tuple[dict[str, np.ndarray], float, str, tuple[int, int] | None],
        ] = OrderedDict()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @staticmethod
    def make_key_nchannel(
        channel_paths: list[list[str]],
        input_budget: int,
    ) -> str:
        """Deterministic cache key from N-channel file paths + input budget."""
        payload = json.dumps(
            {
                "channels": [sorted(paths) for paths in channel_paths],
                "budget": input_budget,
            },
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode()).hexdigest()

    @staticmethod
    def _paths_fingerprint(channel_paths: list[list[str]]) -> str:
        """Budget-agnostic fingerprint of channel file paths."""
        payload = json.dumps(
            {"channels": [sorted(paths) for paths in channel_paths]},
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode()).hexdigest()

    def get(self, key: str) -> tuple[dict[str, np.ndarray], tuple[int, int] | None] | None:
        """Return (cached_channels, original_shape) or ``None`` on miss / expiry.

        original_shape is None for entries written without force-downscale
        provenance; non-None when the entry was produced by a force-downscale
        run so cache hits can surface the warning to default-flow users.
        """
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None

            channels, ts, _fp, original_shape = entry
            if time.monotonic() - ts > self._ttl:
                del self._store[key]
                logger.debug("Composite cache entry expired for key=%s…", key[:12])
                return None

            # Mark as recently used
            self._store.move_to_end(key)
            return channels, original_shape

    def get_any_budget(
        self, channel_paths: list[list[str]]
    ) -> tuple[dict[str, np.ndarray], tuple[int, int] | None] | None:
        """Return any cached entry for these channel paths, regardless of budget.

        Useful for exports: reuse preview-resolution cached data instead of
        reloading at full resolution (which can OOM on large composites).
        Returns (channels, original_shape) tuple — see ``get`` docstring.
        """
        fingerprint = self._paths_fingerprint(channel_paths)
        with self._lock:
            for key, (channels, ts, fp, original_shape) in list(self._store.items()):
                if time.monotonic() - ts > self._ttl:
                    continue
                if fp == fingerprint:
                    self._store.move_to_end(key)
                    return channels, original_shape
        return None

    def put(
        self,
        key: str,
        channels: dict[str, np.ndarray],
        channel_paths: list[list[str]] | None = None,
        original_shape: tuple[int, int] | None = None,
    ) -> None:
        """Store reprojected channels if within the memory budget.

        original_shape is the WCS-derived shape before any force-downscale was
        applied. Pass it when writing a force-downscaled result so later cache
        hits can emit the 'forced' verdict; leave None for normal entries.
        """
        entry_bytes = sum(arr.nbytes for arr in channels.values())

        if entry_bytes > self._max_bytes:
            logger.info(
                "Composite cache SKIP — entry too large (%s MB, limit %s MB)",
                entry_bytes // (1024 * 1024),
                self._max_bytes // (1024 * 1024),
            )
            return

        fingerprint = self._paths_fingerprint(channel_paths) if channel_paths else ""

        with self._lock:
            # Evict expired entries first
            self._evict_expired()

            # Evict LRU entries until we're under the memory cap
            current_bytes = self._total_bytes()
            while current_bytes + entry_bytes > self._max_bytes and self._store:
                evicted_key, _ = self._store.popitem(last=False)
                current_bytes = self._total_bytes()
                logger.debug("Composite cache evicted (memory) key=%s…", evicted_key[:12])

            # Evict LRU entries until we're under the max-entries cap
            while len(self._store) >= self._max_entries and self._store:
                evicted_key, _ = self._store.popitem(last=False)
                logger.debug("Composite cache evicted (count) key=%s…", evicted_key[:12])

            self._store[key] = (channels, time.monotonic(), fingerprint, original_shape)

    # ------------------------------------------------------------------
    # Internal helpers (caller must hold self._lock)
    # ------------------------------------------------------------------

    def _evict_expired(self) -> None:
        now = time.monotonic()
        expired = [k for k, (_, ts, _fp, _os) in self._store.items() if now - ts > self._ttl]
        for k in expired:
            del self._store[k]

    def _total_bytes(self) -> int:
        return sum(
            sum(arr.nbytes for arr in channels.values())
            for channels, _ts, _fp, _os in self._store.values()
        )
