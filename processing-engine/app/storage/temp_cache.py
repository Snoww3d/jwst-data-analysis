"""
LRU temp file cache for S3 downloads.

When the processing engine runs with S3 storage, FITS files must be
downloaded to local disk for astropy to open them. This cache avoids
re-downloading frequently accessed files by keeping them in a bounded
local directory with LRU eviction.
"""

import contextlib
import logging
import os
import threading
from pathlib import Path


logger = logging.getLogger(__name__)

# Default 2GB cache budget
DEFAULT_MAX_BYTES = int(os.environ.get("STORAGE_TEMP_CACHE_MAX_BYTES", str(2 * 1024**3)))
DEFAULT_CACHE_DIR = Path(os.environ.get("STORAGE_TEMP_CACHE_DIR", "/tmp/jwst-cache"))


class TempFileCache:
    """Thread-safe LRU file cache with configurable size budget."""

    def __init__(
        self,
        cache_dir: Path = DEFAULT_CACHE_DIR,
        max_bytes: int = DEFAULT_MAX_BYTES,
    ):
        self._cache_dir = cache_dir
        self._max_bytes = max_bytes
        self._lock = threading.Lock()
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    @property
    def cache_dir(self) -> Path:
        return self._cache_dir

    def get(self, key: str) -> Path | None:
        """Return cached file path if it exists, updating access time."""
        local_path = self._key_to_path(key)
        if local_path.exists():
            # Touch to update access time for LRU
            local_path.touch()
            return local_path
        return None

    def put(self, key: str) -> Path:
        """
        Reserve a cache slot for a key and return the local path to write to.

        Caller is responsible for writing the file content. After writing,
        the file is considered cached. Call evict() after writing if needed.
        """
        local_path = self._key_to_path(key)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        return local_path

    def evict_if_needed(self) -> int:
        """
        Remove oldest files until total cache size is within budget.

        Returns the number of files evicted.
        """
        with self._lock:
            files = self._get_cached_files()
            total_size = sum(f.stat().st_size for f in files)

            if total_size <= self._max_bytes:
                return 0

            # Sort by access time (oldest first)
            files.sort(key=lambda f: f.stat().st_atime)

            evicted = 0
            for f in files:
                if total_size <= self._max_bytes:
                    break
                try:
                    size = f.stat().st_size
                    f.unlink()
                    total_size -= size
                    evicted += 1
                    logger.debug("Evicted cached file: %s (%d bytes)", f, size)
                except OSError:
                    pass  # File may have been deleted by another thread

            if evicted > 0:
                logger.info(
                    "Cache eviction: removed %d files, %d bytes remaining (budget: %d)",
                    evicted,
                    total_size,
                    self._max_bytes,
                )

            # Clean up empty directories
            self._cleanup_empty_dirs()
            return evicted

    def _key_to_path(self, key: str) -> Path:
        """Convert a storage key to a local cache path."""
        # Preserve the key structure as subdirectories
        return self._cache_dir / key

    def _get_cached_files(self) -> list[Path]:
        """List all files in the cache directory."""
        return [f for f in self._cache_dir.rglob("*") if f.is_file()]

    def _cleanup_empty_dirs(self) -> None:
        """Remove empty directories from the cache tree."""
        for dirpath in sorted(self._cache_dir.rglob("*"), reverse=True):
            if dirpath.is_dir():
                with contextlib.suppress(OSError):
                    dirpath.rmdir()  # Only succeeds if empty
