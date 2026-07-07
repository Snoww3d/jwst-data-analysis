"""Shared anonymous-access resolution for CE /api facades."""

from fastapi import HTTPException

from app.db.repository import JwstDataReadRepository


_DATA_PREFIX = "/app/data/"
NOT_FOUND_MESSAGE = "The requested data was not found."


def to_relative_key(file_path: str) -> str:
    """StorageKeyHelper.ToRelativeKey parity: strip the container data prefix."""
    if file_path.lower().startswith(_DATA_PREFIX):
        return file_path[len(_DATA_PREFIX) :]
    return file_path


async def resolve_public_path(repo: JwstDataReadRepository, data_id: str) -> str:
    """dataId -> relative engine path, public docs only; 404 otherwise
    (anti-enumeration, .NET parity)."""
    doc = await repo.get_public_by_id(data_id)
    if doc is None or not doc.get("FilePath"):
        raise HTTPException(status_code=404, detail=NOT_FOUND_MESSAGE)
    return to_relative_key(doc["FilePath"])
