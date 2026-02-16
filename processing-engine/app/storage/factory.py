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

    Currently only supports 'local'. Future providers (e.g. 's3')
    can be added here.
    """
    global _instance
    if _instance is not None:
        return _instance

    with _lock:
        # Double-check after acquiring lock
        if _instance is not None:
            return _instance

        provider_type = os.environ.get("STORAGE_PROVIDER", "local").lower()
        base_path = os.environ.get("STORAGE_BASE_PATH", "/app/data")

        if provider_type == "local":
            _instance = LocalStorage(base_path=base_path)
            logger.info(f"Initialized local storage provider (base_path={base_path})")
        else:
            raise ValueError(f"Unknown storage provider: {provider_type}. Supported: local")

        return _instance
