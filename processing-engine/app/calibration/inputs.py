"""Resolve library data ids to storage keys for a calibration run (#1751).

Why ids and not paths: the library DTO deliberately does not publish
``FilePath`` — it is an internal storage location — so a client physically
cannot send one, which is why every library-input path in the UI was silently
empty. Sending ids instead fixes that AND removes the "client supplies a raw
path" surface that #1719 is about: the key is now derived server-side from a
document the caller is allowed to read.

Visibility mirrors the .NET FilterAccessibleData rule: a caller may use their
own items or public ones; an Admin may use any.
"""

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException

from app.db.access import to_relative_key


class InputResolutionError(Exception):
    """A requested input can't be used — message is safe to show the caller."""


async def resolve_input_data_ids(
    collection,
    data_ids: list[str],
    *,
    user_id: str,
    is_admin: bool = False,
) -> list[str]:
    """Map library ids to relative storage keys, preserving the caller's order.

    Raises InputResolutionError when an id is unknown, not visible to the
    caller, or has no file behind it — never silently drops one, because a
    calibration run that quietly used fewer inputs than requested would
    produce a wrong mosaic with no indication why.
    """
    if not data_ids:
        return []

    oids: dict[str, ObjectId] = {}
    for data_id in data_ids:
        if not isinstance(data_id, str):
            raise InputResolutionError("inputDataIds must be strings")
        try:
            oids[data_id] = ObjectId(data_id)
        except (InvalidId, TypeError) as exc:
            raise InputResolutionError(f"not a valid library id: {data_id}") from exc

    docs = [d async for d in collection.find({"_id": {"$in": list(oids.values())}})]
    by_id = {str(d["_id"]): d for d in docs}

    keys: list[str] = []
    for data_id in data_ids:
        doc = by_id.get(data_id)
        # Unknown and not-visible collapse to the same message on purpose —
        # distinguishing them would let a caller probe for ids.
        if doc is None:
            raise InputResolutionError(f"library item not found: {data_id}")
        if not (is_admin or doc.get("IsPublic") is True or doc.get("UserId") == user_id):
            raise InputResolutionError(f"library item not found: {data_id}")
        file_path = doc.get("FilePath")
        if not file_path:
            raise InputResolutionError(f"library item has no file to calibrate: {data_id}")
        keys.append(to_relative_key(file_path))
    return keys


def as_http_error(exc: InputResolutionError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))
