"""
Bounded LRU cache for the MAST download directory.

`data/mast` grew unbounded — `download_products(..., cache=True)` and the
chunked/S3 downloaders accumulate FITS forever, while
`DownloadStateManager` prunes only the `.download_state/` JSON. This module
puts a byte budget on the FITS themselves, evicting least-recently-*accessed*
files after a download completes.

Everything evicted is re-downloadable from MAST. Never evicted:

* `.download_state/` (or anything else under a dot-directory)
* `.part` files and any file a live downloader is currently writing
* pinned files — see `MastCache.is_pinned`
* anything that is not a FITS data file

Disabled by default (`MAST_CACHE_ENABLED=false`): with the flag off,
`evict_if_needed()` returns immediately without touching the filesystem.
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path

from app.config import bool_env, nonnegative_int_env
from app.storage.lru_evictor import EvictionResult, evict_to_budget


logger = logging.getLogger(__name__)

# 60 GB. Large enough that a normal working set survives, small enough that a
# 195 GB accumulation gets reclaimed.
DEFAULT_MAX_BYTES = 60 * 1024**3

# Suffixes we consider evictable science data. `.part` is deliberately absent:
# a partially downloaded `foo.fits.part` ends in `.part`, not `.fits`.
FITS_SUFFIXES = (".fits", ".fit", ".fits.gz", ".fit.gz", ".fits.bz2")


def _is_fits(path: Path) -> bool:
    name = path.name.lower()
    return name.endswith(FITS_SUFFIXES)


def _has_hidden_component(relative: Path) -> bool:
    """True if any path segment starts with a dot (`.download_state/…`)."""
    return any(part.startswith(".") for part in relative.parts)


class MastCache:
    """Byte-budgeted, atime-LRU view over the MAST download directory."""

    def __init__(
        self,
        download_dir: str | Path,
        *,
        max_bytes: int | None = None,
        enabled: bool | None = None,
        pin_manifest_path: str | Path | None = None,
        in_flight_paths: Callable[[], Iterable[str]] | None = None,
    ):
        """
        Args:
            download_dir: Root of the MAST downloads (e.g. `/app/data/mast`).
            max_bytes: Byte budget. Defaults to `MAST_CACHE_MAX_BYTES`.
            enabled: Master switch. Defaults to `MAST_CACHE_ENABLED` (false).
            pin_manifest_path: Manifest of never-evict paths. Defaults to
                `MAST_CACHE_PIN_MANIFEST`.
            in_flight_paths: Called at each eviction to get the local paths
                live downloaders are currently writing. Kept as a callable so
                the set is read fresh rather than snapshotted at construction.
        """
        self._download_dir = Path(download_dir)
        self._max_bytes = (
            max_bytes
            if max_bytes is not None
            else nonnegative_int_env("MAST_CACHE_MAX_BYTES", DEFAULT_MAX_BYTES)
        )
        self._enabled = enabled if enabled is not None else bool_env("MAST_CACHE_ENABLED", False)
        raw_manifest = (
            pin_manifest_path
            if pin_manifest_path is not None
            else os.environ.get("MAST_CACHE_PIN_MANIFEST", "")
        )
        self._pin_manifest_path = Path(raw_manifest) if raw_manifest else None
        self._in_flight_paths = in_flight_paths
        self._lock = threading.Lock()
        self._pinned: frozenset[Path] | None = None

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def max_bytes(self) -> int:
        return self._max_bytes

    # --- Pinning -----------------------------------------------------------
    #
    # EXTENSION POINT. `is_pinned` is the single place that decides "this file
    # must never be evicted". Today it means "listed in the manifest at
    # MAST_CACHE_PIN_MANIFEST" (the CE seed bundle's files.txt). The rule is
    # expected to become "referenced by any CE recipe" — when it does, replace
    # the body of `_load_pinned_paths` (or `is_pinned` itself) and nothing else
    # in this module or its callers needs to change.

    def is_pinned(self, path: Path) -> bool:
        """True if `path` must survive eviction."""
        return path.resolve() in self._pinned_paths()

    def reload_pins(self) -> None:
        """Drop the cached manifest so the next eviction re-reads it."""
        with self._lock:
            self._pinned = None

    def _pinned_paths(self) -> frozenset[Path]:
        if self._pinned is None:
            self._pinned = self._load_pinned_paths()
        return self._pinned

    def _load_pinned_paths(self) -> frozenset[Path]:
        """Read the pin manifest into a set of resolved absolute paths.

        Manifest entries are newline-separated relative paths. Blank lines and
        `#` comments are ignored. Entries in the reference manifest are written
        relative to the *data* root (`mast/jw…/x_i2d.fits`), but entries
        relative to the download dir itself are just as plausible, so each line
        is resolved against both — a manifest miss silently un-pins real
        science data, which is the expensive direction to be wrong in.
        """
        if self._pin_manifest_path is None:
            return frozenset()
        try:
            lines = self._pin_manifest_path.read_text(encoding="utf-8").splitlines()
        except OSError:
            logger.warning(
                "MAST cache: pin manifest %s could not be read — treating as empty. "
                "No file is pinned; eviction will proceed on LRU order alone.",
                self._pin_manifest_path,
                exc_info=True,
            )
            return frozenset()

        bases = (self._download_dir, self._download_dir.parent)
        pinned: set[Path] = set()
        for raw in lines:
            entry = raw.strip()
            if not entry or entry.startswith("#"):
                continue
            candidate = Path(entry)
            if candidate.is_absolute():
                pinned.add(candidate.resolve())
                continue
            for base in bases:
                pinned.add((base / candidate).resolve())

        logger.info(
            "MAST cache: loaded %d pinned path(s) from %s",
            len(pinned),
            self._pin_manifest_path,
        )
        return frozenset(pinned)

    # --- Eviction ----------------------------------------------------------

    def evict_if_needed(self) -> EvictionResult | None:
        """
        Evict least-recently-accessed FITS until within budget.

        Returns None when the cache is disabled — a genuine no-op that does not
        even walk the directory.
        """
        if not self._enabled:
            return None

        with self._lock:
            try:
                protected = self._in_flight_protected()
            except Exception:  # noqa: BLE001 - provider is caller-supplied
                # Fail closed: if we cannot tell what is being written right
                # now, evict nothing rather than risk deleting a live download.
                logger.warning(
                    "MAST cache: could not read in-flight downloads — skipping eviction",
                    exc_info=True,
                )
                return None
            result = evict_to_budget(
                self._evictable_candidates(),
                self._max_bytes,
                is_protected=lambda path: path.resolve() in protected or self.is_pinned(path),
                label="MAST cache",
            )
        return result

    def _in_flight_protected(self) -> frozenset[Path]:
        """Resolved paths (plus `.part` siblings) that downloaders are writing."""
        if self._in_flight_paths is None:
            return frozenset()
        raw_paths = list(self._in_flight_paths())
        protected: set[Path] = set()
        for raw in raw_paths:
            if not raw:
                continue
            path = Path(raw)
            protected.add(path.resolve())
            protected.add(Path(f"{path}.part").resolve())
        return frozenset(protected)

    def _evictable_candidates(self) -> Iterator[Path]:
        """Yield FITS files under the download dir that are safe to consider."""
        root = self._download_dir
        if not root.is_dir():
            return

        resolved_root = root.resolve()
        for path in root.rglob("*"):
            if not path.is_file() or path.is_symlink():
                continue
            if not _is_fits(path):
                continue
            try:
                relative = path.resolve().relative_to(resolved_root)
            except (OSError, ValueError):
                # Escaped the download dir (symlinked tree, race). Not ours.
                continue
            if _has_hidden_component(relative):
                # Covers `.download_state/` and any other bookkeeping dir.
                continue
            yield path


__all__ = ["DEFAULT_MAX_BYTES", "FITS_SUFFIXES", "MastCache"]
