"""
Abstract base class for storage providers.

All file I/O in the processing engine should go through a StorageProvider
so the backend can be swapped between local filesystem and S3.
"""

from abc import ABC, abstractmethod
from pathlib import Path


class StorageProvider(ABC):
    """Abstract storage provider interface."""

    @abstractmethod
    def read_to_temp(self, key: str) -> Path:
        """
        Ensure the file is available locally and return a local Path.

        For local storage this returns the actual path (no copy).
        For cloud storage this would download to a temp file.

        Args:
            key: Relative storage key (e.g. "mast/obs_id/file.fits")

        Returns:
            Path to a local file that can be opened by astropy/numpy.
        """

    @abstractmethod
    def write_from_path(self, key: str, local_path: Path) -> None:
        """
        Write a local file into storage at the given key.

        Args:
            key: Relative storage key
            local_path: Path to the local file to upload
        """

    @abstractmethod
    def write_from_bytes(self, key: str, data: bytes) -> None:
        """
        Write raw bytes into storage at the given key.

        Args:
            key: Relative storage key
            data: The bytes to write
        """

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Check whether a key exists in storage."""

    @abstractmethod
    def delete(self, key: str) -> None:
        """Delete a file from storage."""

    @abstractmethod
    def presigned_url(self, key: str, expiry: int = 900) -> str | None:
        """
        Generate a pre-signed URL for direct client download.

        Returns None when the provider does not support pre-signed URLs.
        """

    @abstractmethod
    def resolve_local_path(self, key: str) -> Path:
        """
        Resolve a key to an absolute local filesystem path.

        Only supported by local storage. Cloud providers should raise
        NotImplementedError.
        """
