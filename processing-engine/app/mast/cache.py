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

`MAST_CACHE_DRY_RUN=true` enables the cache in plan-only mode: every file that
would be evicted is logged with its size and a running total, and nothing is
deleted. Run this first against any directory that holds real data.
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


class PinManifestUnavailableError(RuntimeError):
    """A pin manifest is configured but could not be read.

    Deliberately fatal to an eviction pass. The manifest exists to say "never
    delete these"; proceeding without it would evict exactly the files the
    operator configured it to protect, so a pass that cannot read it is
    abandoned rather than run unpinned.
    """


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
        dry_run: bool | None = None,
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
            dry_run: Log the full eviction plan and delete nothing. Defaults to
                `MAST_CACHE_DRY_RUN` (false).
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
        self._dry_run = dry_run if dry_run is not None else bool_env("MAST_CACHE_DRY_RUN", False)
        self._in_flight_paths = in_flight_paths
        self._lock = threading.Lock()
        self._pinned: frozenset[Path] | None = None
        self._pin_manifest_stamp: tuple[int, int] | None = None

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def max_bytes(self) -> int:
        return self._max_bytes

    @property
    def dry_run(self) -> bool:
        """True when eviction only logs its plan and deletes nothing."""
        return self._dry_run

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
        self._pinned = None
        self._pin_manifest_stamp = None

    def _manifest_stamp(self) -> tuple[int, int] | None:
        """(mtime_ns, size) of the manifest, or None if it is not readable."""
        if self._pin_manifest_path is None:
            return None
        try:
            stat = self._pin_manifest_path.stat()
        except OSError:
            return None
        return (stat.st_mtime_ns, stat.st_size)

    def _pinned_paths(self) -> frozenset[Path]:
        """Pinned paths, re-read whenever the manifest changes on disk.

        An operator who edits the manifest to protect more files must not have
        to restart the engine for it to take effect — the window between the
        edit and the restart is precisely when the newly-pinned files would be
        deleted.
        """
        stamp = self._manifest_stamp()
        if self._pinned is None or stamp != self._pin_manifest_stamp:
            self._pinned = self._load_pinned_paths()
            self._pin_manifest_stamp = stamp
        return self._pinned

    def _load_pinned_paths(self) -> frozenset[Path]:
        """Read the pin manifest into a set of resolved absolute paths.

        Entries are newline-separated POSIX paths relative to the **data root**
        — the parent of the download dir. That base is not a guess: the bundle
        generator writes these paths with
        `os.path.relpath(file, os.path.dirname(mast.download_dir))`
        (`processing-engine/scripts/seed_ce.py`) and the host script consumes
        them with `rsync --files-from=files.txt "$DATA_ROOT/"`
        (`scripts/seed-ce.sh`), where `DATA_ROOT` is `<project>/data`. Hence
        every line reads `mast/jw…/x_i2d.fits`.

        Blank lines and `#` comments are ignored. Entries that do not land
        under the download dir are kept as pins — pinning too much is safe —
        but logged, because an inert pin means a file the operator believes is
        protected is not.
        """
        if self._pin_manifest_path is None:
            return frozenset()
        try:
            lines = self._pin_manifest_path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            raise PinManifestUnavailableError(
                f"pin manifest {self._pin_manifest_path} could not be read"
            ) from exc

        data_root = self._download_dir.parent
        resolved_download_dir = self._download_dir.resolve()

        pinned: set[Path] = set()
        outside: list[str] = []
        for raw in lines:
            entry = raw.strip()
            if not entry or entry.startswith("#"):
                continue
            candidate = Path(entry)
            resolved = (
                candidate.resolve()
                if candidate.is_absolute()
                else (data_root / candidate).resolve()
            )
            pinned.add(resolved)
            if not resolved.is_relative_to(resolved_download_dir):
                outside.append(entry)

        if outside:
            logger.warning(
                "MAST cache: %d pin manifest entry/entries do not resolve under %s "
                "and therefore protect nothing — check they are written relative to "
                "the data root (%s), e.g. 'mast/<obs>/<file>_i2d.fits'. First few: %s",
                len(outside),
                resolved_download_dir,
                data_root,
                outside[:5],
            )

        logger.info(
            "MAST cache: loaded %d pinned path(s) from %s (base %s)",
            len(pinned),
            self._pin_manifest_path,
            data_root,
        )
        return frozenset(pinned)

    # --- Eviction ----------------------------------------------------------

    def evict_if_needed(self) -> EvictionResult | None:
        """
        Evict least-recently-accessed FITS until within budget.

        Returns None when the cache is disabled — a genuine no-op that does not
        even walk the directory. Under `MAST_CACHE_DRY_RUN` the full plan is
        computed and logged but nothing is deleted.
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

            try:
                pinned = self._pinned_paths()
            except PinManifestUnavailableError:
                # Fail closed, as above: without the pin list we cannot tell
                # protected science data from disposable data.
                logger.warning(
                    "MAST cache: pin manifest unreadable — skipping eviction",
                    exc_info=True,
                )
                return None

            def is_protected(path: Path) -> bool:
                resolved = path.resolve()
                return resolved in protected or resolved in pinned

            result = evict_to_budget(
                self._evictable_candidates(),
                self._max_bytes,
                is_protected=is_protected,
                label="MAST cache",
                dry_run=self._dry_run,
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


__all__ = [
    "DEFAULT_MAX_BYTES",
    "FITS_SUFFIXES",
    "MastCache",
    "PinManifestUnavailableError",
]
