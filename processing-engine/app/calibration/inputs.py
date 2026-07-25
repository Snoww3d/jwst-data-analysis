"""Resolve library data ids to storage keys for a calibration run (#1751).

Why ids and not paths: the library DTO deliberately does not publish
``FilePath`` — it is an internal storage location — so a client physically
cannot send one, which is why every library-input path in the UI was silently
empty. Sending ids instead fixes that AND removes the "client supplies a raw
path" surface that #1719 is about: the key is now derived server-side from a
document the caller is allowed to read.

Visibility mirrors the .NET ``FilterAccessibleData`` rule (MongoDBService.cs):
a caller may use their own items, public ones, or ones shared with them; an
Admin may use any. This does NOT go through ``JwstDataReadRepository`` — that
class deliberately enforces the *anonymous* branch of the same rule (IsPublic
only), which is a different, stricter rule than the authenticated one needed
here.
"""

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException

from app.db.access import to_relative_key


# Enough to authorize and locate the file. Notably excludes ThumbnailData,
# which is a binary blob on every one of these documents.
_PROJECTION = {
    "_id": 1,
    "UserId": 1,
    "IsPublic": 1,
    "SharedWith": 1,
    "FilePath": 1,
    "IsArchived": 1,
}


class InputResolutionError(Exception):
    """A requested input can't be used — message is safe to show the caller."""


def _visible_to(doc: dict, *, user_id: str, is_admin: bool) -> bool:
    if is_admin or doc.get("IsPublic") is True or doc.get("UserId") == user_id:
        return True
    return user_id in (doc.get("SharedWith") or [])


async def resolve_input_data_ids(
    collection,
    data_ids: list[str],
    *,
    user_id: str,
    is_admin: bool = False,
) -> list[str]:
    """Map library ids to relative storage keys, preserving the caller's order.

    Raises InputResolutionError when an id is unknown, not visible to the
    caller, archived, duplicated, or has no file behind it — never silently
    drops or de-duplicates one, because a calibration run that quietly used a
    different set of inputs than requested would produce a wrong mosaic with
    no indication why.
    """
    if not data_ids:
        return []

    seen: set[str] = set()
    oids: list[ObjectId] = []
    for data_id in data_ids:
        if not isinstance(data_id, str):
            raise InputResolutionError("inputDataIds must be strings")
        if data_id in seen:
            # Associating the same exposure twice would double-weight it in
            # the mosaic, so this is a caller error rather than a no-op.
            raise InputResolutionError(f"duplicate library item: {data_id}")
        seen.add(data_id)
        try:
            oids.append(ObjectId(data_id))
        except (InvalidId, TypeError) as exc:
            raise InputResolutionError(f"not a valid library id: {data_id}") from exc

    docs = [d async for d in collection.find({"_id": {"$in": oids}}, _PROJECTION)]
    by_id = {str(d["_id"]): d for d in docs}

    keys: list[str] = []
    for data_id in data_ids:
        doc = by_id.get(data_id)
        # Unknown and not-visible collapse to the same message on purpose —
        # distinguishing them would let a caller probe for ids.
        if doc is None or not _visible_to(doc, user_id=user_id, is_admin=is_admin):
            raise InputResolutionError(f"library item not found: {data_id}")
        if doc.get("IsArchived"):
            raise InputResolutionError(f"library item is archived: {data_id}")
        file_path = doc.get("FilePath")
        if not file_path:
            raise InputResolutionError(f"library item has no file to calibrate: {data_id}")
        keys.append(to_relative_key(file_path))
    return keys


def as_http_error(exc: InputResolutionError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(exc))
