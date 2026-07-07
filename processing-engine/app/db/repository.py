"""Read-only repository over the .NET-era ``jwst_data`` collection.

Documents are PascalCase (no BsonElement attrs, no convention pack — Phase 1
spike). Anonymous/CE visibility is IsPublic only, mirroring the .NET
FilterAccessibleData anonymous branch; every accessor here enforces it, so a
route cannot forget the filter.
"""

from bson import ObjectId
from bson.errors import InvalidId


class JwstDataReadRepository:
    def __init__(self, collection) -> None:
        self._col = collection

    async def get_public_list(self, *, include_archived: bool) -> list[dict]:
        docs = [d async for d in self._col.find({"IsPublic": True})]
        if not include_archived:
            docs = [d for d in docs if not d.get("IsArchived")]
        return docs

    async def get_public_by_id(self, data_id: str) -> dict | None:
        try:
            oid = ObjectId(data_id)
        except (InvalidId, TypeError):
            return None
        return await self._col.find_one({"_id": oid, "IsPublic": True})

    async def get_public_by_ids(self, data_ids: list[str]) -> dict[str, dict]:
        """Batch id lookup (single $in query), public docs only. Returns a
        map of str(_id) -> doc; unknown/private ids are simply absent."""
        oids = []
        for data_id in data_ids:
            try:
                oids.append(ObjectId(data_id))
            except (InvalidId, TypeError):
                continue  # absent from result -> caller treats as not found
        if not oids:
            return {}
        docs = [d async for d in self._col.find({"_id": {"$in": oids}, "IsPublic": True})]
        return {str(d["_id"]): d for d in docs}

    async def get_public_thumbnail(self, data_id: str) -> bytes | None:
        doc = await self.get_public_by_id(data_id)
        if doc is None:
            return None
        thumb = doc.get("ThumbnailData")
        return bytes(thumb) if thumb is not None else None

    async def get_public_by_observation_base_id(self, obs_id: str) -> list[dict]:
        """ObservationBaseId lookup with the .NET mast_obs_id fallback.

        Mirrors MongoDBService.cs:609 exactly: the fallback fires only when
        the UNFILTERED base-id query is empty; the anonymous IsPublic filter
        is applied afterwards (FilterAccessibleData order).
        """
        docs = [d async for d in self._col.find({"ObservationBaseId": obs_id})]
        if not docs:
            docs = [d async for d in self._col.find({"Metadata.mast_obs_id": obs_id})]
        return [d for d in docs if d.get("IsPublic")]
