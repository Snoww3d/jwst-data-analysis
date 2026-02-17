"""
Factory for creating storage provider instances.

Reads STORAGE_PROVIDER and STORAGE_BASE_PATH from environment variables
and returns a singleton StorageProvider.
"""

import logging
import os
import threading

from .local_storage import LocalStorage
from .provider import StorageProvider


logger = logging.getLogger(__name__)

_instance: StorageProvider | None = None
_lock = threading.Lock()


def get_storage_provider() -> StorageProvider:
    """
    Get the singleton storage provider instance.

    Supports 'local' (default) and 's3' provider types.
    """
    global _instance
    if _instance is not None:
        return _instance

    with _lock:
        # Double-check after acquiring lock
        if _instance is not None:
            return _instance

        provider_type = os.environ.get("STORAGE_PROVIDER", "local").lower()

        if provider_type == "local":
            base_path = os.environ.get("STORAGE_BASE_PATH", "/app/data")
            _instance = LocalStorage(base_path=base_path)
            logger.info("Initialized local storage provider (base_path=%s)", base_path)
        elif provider_type == "s3":
            from .s3_storage import S3Storage

            _instance = S3Storage()
            logger.info("Initialized S3 storage provider")
        else:
            raise ValueError(f"Unknown storage provider: {provider_type}. Supported: local, s3")

        return _instance
