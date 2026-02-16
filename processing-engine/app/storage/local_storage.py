"""
Local filesystem storage provider.

Resolves storage keys relative to a base path (default /app/data).
"""

import os
import shutil
from pathlib import Path

from .provider import StorageProvider


class LocalStorage(StorageProvider):
    """Local filesystem implementation of StorageProvider."""

    def __init__(self, base_path: str = "/app/data"):
        self._base_path = Path(base_path)

    def read_to_temp(self, key: str) -> Path:
        """Return the actual local path (no temp copy needed for local storage)."""
        return self.resolve_local_path(key)

    def write_from_path(self, key: str, local_path: Path) -> None:
        """Copy a local file into storage at the given key."""
        target = self._base_path / key
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.resolve() != Path(local_path).resolve():
            shutil.copy2(local_path, target)

    def write_from_bytes(self, key: str, data: bytes) -> None:
        """Write raw bytes into storage."""
        target = self._base_path / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def exists(self, key: str) -> bool:
        """Check whether a file exists at the given key."""
        return (self._base_path / key).exists()

    def delete(self, key: str) -> None:
        """Delete a file from storage."""
        path = self._base_path / key
        if path.exists():
            os.remove(path)

    def presigned_url(self, key: str, expiry: int = 900) -> str | None:  # noqa: ARG002
        """Local storage does not support pre-signed URLs."""
        return None

    def resolve_local_path(self, key: str) -> Path:
        """Resolve a key to an absolute local path."""
        return self._base_path / key
