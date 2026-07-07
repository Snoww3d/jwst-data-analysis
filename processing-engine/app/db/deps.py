"""FastAPI dependencies for the CE read layer (overridable in tests)."""

from collections.abc import Callable

from app.db.client import get_database
from app.db.repository import JwstDataReadRepository


def get_repository() -> JwstDataReadRepository:
    return JwstDataReadRepository(get_database()["jwst_data"])


def get_file_exists() -> Callable[[str], bool]:
    """Existence check for a relative storage key (check-availability).

    Imported lazily so unit tests never touch the storage factory.
    """
    from app.storage.factory import get_storage_provider

    provider = get_storage_provider()
    return provider.exists
