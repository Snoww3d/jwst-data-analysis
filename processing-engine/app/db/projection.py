"""Mongo document -> wire DTO projections (parity with .NET MapToDataResponse,
JwstDataController.cs:2322). The golden fixture get_jwstdata_list.json pins
the exact key set."""

from typing import Any

from app.db.casing import pascal_to_camel_keys


# PascalCase source fields copied through 1:1 (then camelized). Order matches
# the .NET DTO for reviewer diffing; JSON key order is not part of the contract.
_COPIED_FIELDS = [
    "FileName",
    "DataType",
    "UploadDate",
    "Description",
    "Metadata",
    "FileSize",
    "ProcessingStatus",
    "Tags",
    "UserId",
    "IsPublic",
    "Version",
    "FileFormat",
    "IsValidated",
    "LastAccessed",
    "IsArchived",
    "ArchivedDate",
    "ImageInfo",
    "SensorInfo",
    "SpectralInfo",
    "CalibrationInfo",
    "ProcessingLevel",
    "ObservationBaseId",
    "ExposureId",
    "ParentId",
    "DerivedFrom",
    "IsViewable",
    "SharedWith",
]

_LIST_DEFAULTS = {"Tags", "SharedWith", "DerivedFrom"}

# .NET Dictionary<string,...> fields serialize with DictionaryKeyPolicy=null —
# keys pass through AS STORED (only POCO property names camelize). These are
# the data-keyed dict fields in the JwstDataModel graph; their subtrees must
# not be case-mangled (e.g. WCS keys are FITS keywords like CRPIX1).
_VERBATIM_SUBTREES = {
    "Metadata",
    "WCS",
    "Statistics",
    "InstrumentSettings",
    "NoiseCharacteristics",
    "LineMeasurements",
    "CalibrationParameters",
    "Properties",
}


def _unwrap_bson_discriminators(obj: Any) -> Any:
    """Unwrap .NET BSON type discriminators: object-typed fields serialize as
    {"_t": "System.Collections...", "_v": <value>} and the .NET deserializer
    unwraps them invisibly. Found empirically on mosaic-generator Metadata
    (source_ids) during the live .NET-vs-Python list diff."""
    if isinstance(obj, dict):
        if set(obj.keys()) == {"_t", "_v"}:
            return _unwrap_bson_discriminators(obj["_v"])
        return {k: _unwrap_bson_discriminators(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_unwrap_bson_discriminators(v) for v in obj]
    return obj


def to_data_response(doc: dict) -> dict[str, Any]:
    """Project a raw jwst_data document to the camelCase DataResponse shape.

    Notable semantics from the .NET mapper:
    - thumbnail bytes are NEVER inlined; only hasThumbnail is derived
    - processingResultsCount / lastProcessed are computed from ProcessingResults
    - Metadata subtree passes through verbatim (mast_* keys)
    """
    src: dict[str, Any] = {}
    for field in _COPIED_FIELDS:
        default: Any = [] if field in _LIST_DEFAULTS else None
        src[field] = doc.get(field, default)
    if src["Metadata"] is None:
        src["Metadata"] = {}

    results = doc.get("ProcessingResults") or []
    processed_dates = [r.get("ProcessedDate") for r in results if r.get("ProcessedDate")]
    src["ProcessingResultsCount"] = len(results)
    src["LastProcessed"] = max(processed_dates) if processed_dates else None
    src["HasThumbnail"] = doc.get("ThumbnailData") is not None

    out = pascal_to_camel_keys(_unwrap_bson_discriminators(src), verbatim_keys=_VERBATIM_SUBTREES)
    out["id"] = str(doc["_id"])
    return out
