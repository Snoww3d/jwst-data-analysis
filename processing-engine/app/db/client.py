"""Lazy motor client for the single-backend migration (ADR 0001 Phase 2).

CE runs with read-only Mongo credentials; the URI comes from the environment.
Fail-fast validation of these settings is tracked in #1653.
"""

import os

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase


_client: AsyncIOMotorClient | None = None

DEFAULT_DATABASE = "jwst_data_analysis"


class MongoNotConfiguredError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(
            "MONGODB_URI is not set. The CE read layer requires a MongoDB "
            "connection string (read-only credentials are sufficient)."
        )


def get_database() -> AsyncIOMotorDatabase:
    global _client
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise MongoNotConfiguredError()
    if _client is None:
        _client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=5000)
    return _client[os.environ.get("MONGODB_DATABASE", DEFAULT_DATABASE)]


def reset_client() -> None:
    """Drop the cached client (tests / URI rotation)."""
    global _client
    if _client is not None:
        _client.close()
    _client = None
