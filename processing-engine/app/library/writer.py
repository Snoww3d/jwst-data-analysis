"""Write path into the .NET-era ``jwst_data`` collection.

Deliberately separate from ``app/db/repository.py``: that class is read-only and
every accessor there enforces ``IsPublic``, an invariant worth keeping intact.
This module is the only place the engine creates library records.

Documents are PascalCase (no convention pack) — see the repository docstring.
Field names and types here are matched against live records so the .NET tier can
still deserialize them; in particular ``FileSize`` is written as an explicit
BSON Int64 because the C# model types it as ``long``.
"""

from datetime import UTC, datetime
from typing import Any

from bson import Int64, ObjectId
from bson.errors import InvalidId


class JwstDataWriteRepository:
    def __init__(self, collection) -> None:
        self._col = collection

    async def find_by_path(self, file_path: str, user_id: str) -> dict | None:
        """Existing record for this storage key and owner, if any.

        Saving is idempotent: a double-click, or re-saving the same output from
        a second browser tab, should return the record already created rather
        than litter the library with duplicates.
        """
        return await self._col.find_one({"FilePath": file_path, "UserId": user_id})

    async def parents_for(self, data_ids: list[str]) -> list[dict]:
        """Minimal records for the library items a run consumed.

        Only what lineage needs: the observation an output should be filed
        under, and the exposure a per-exposure product came from. Deliberately
        projected — these documents carry ThumbnailData blobs.
        """
        oids: list[ObjectId] = []
        for data_id in data_ids:
            try:
                oids.append(ObjectId(data_id))
            except (InvalidId, TypeError):
                continue  # unreadable id contributes no lineage, never raises
        if not oids:
            return []
        projection = {"_id": 1, "FileName": 1, "ObservationBaseId": 1}
        docs = [d async for d in self._col.find({"_id": {"$in": oids}}, projection)]
        # Preserve the caller's order — DerivedFrom is built from this, and
        # Mongo's $in returns natural order, so two identical saves would
        # otherwise record the same parents in different orders.
        rank = {data_id: i for i, data_id in enumerate(data_ids)}
        return sorted(docs, key=lambda d: rank.get(str(d["_id"]), len(rank)))

    async def create_from_calibration_output(
        self,
        *,
        file_path: str,
        file_name: str,
        size_bytes: int,
        user_id: str,
        metadata: dict[str, Any],
        thumbnail: bytes | None = None,
        description: str | None = None,
        processing_level: str | None = None,
        derived_from: list[str] | None = None,
        observation_base_id: str | None = None,
        parent_id: str | None = None,
        exposure_id: str | None = None,
    ) -> str:
        """Insert a calibration output as a library record; returns its id.

        Private by default (``IsPublic: False``). The .NET read path filters to
        owner-or-public, so the owner sees it in ``/library`` and the full
        ImageViewer while nobody else does — calibration outputs are personal
        working products, not published data.

        ``processing_level``, ``derived_from`` and ``observation_base_id`` are
        what make an output usable rather than merely stored: the level says
        what the file now IS (and therefore what can be run on it next), and
        the lineage says which library items produced it. Without them a run's
        output lands as an anonymous record, detached from its own inputs.
        """
        now = datetime.now(UTC)
        doc: dict[str, Any] = {
            "FileName": file_name,
            "DataType": "image",
            "UploadDate": now,
            "Description": description or "Calibration pipeline output",
            "Metadata": metadata,
            "FilePath": file_path,
            "FileSize": Int64(size_bytes),
            "ProcessingStatus": "completed",
            "Tags": ["calibration"],
            "UserId": user_id,
            "FileFormat": "fits",
            "IsValidated": False,
            "IsPublic": False,
            "SharedWith": [],
            "IsArchived": False,
            "Version": 1,
            "DerivedFrom": list(derived_from or []),
            "IsViewable": True,
        }
        # Only set when known: a null level is honest, whereas defaulting to
        # "unknown" would be indistinguishable from a real classification.
        if processing_level:
            doc["ProcessingLevel"] = processing_level
        if observation_base_id:
            doc["ObservationBaseId"] = observation_base_id
        if parent_id:
            doc["ParentId"] = parent_id
        if exposure_id:
            doc["ExposureId"] = exposure_id
        if thumbnail is not None:
            doc["ThumbnailData"] = thumbnail
            doc["ThumbnailGeneratedAt"] = now

        result = await self._col.insert_one(doc)
        return str(result.inserted_id)
