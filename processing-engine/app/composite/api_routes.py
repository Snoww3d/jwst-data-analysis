"""CE /api/composite facade (ADR 0001 Phase 2).

The frontend's composite request carries Mongo ``dataIds`` per channel — the
.NET tier resolves ids to engine file paths (with access checks), snake-cases
the body, and forwards only ``X-Composite-*``/``X-Quality-*`` response
headers. This facade replicates that behavior for the CE topology, plus one
CE hardening decision from the Phase 1 render-timing spike:
``allow_force_downscale`` is always stripped — a forced full-resolution
render measured 110.8s, which a public no-auth deployment cannot offer
synchronously.

Access control matches the .NET anonymous branch: any unknown, private, or
path-less dataId fails the whole request with 404 and a non-revealing
message (anti-enumeration).
"""

import asyncio
import os
from typing import Annotated

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import ValidationError

from app.composite.models import NChannelCompositeRequest
from app.composite.routes import generate_nchannel_composite as engine_generate
from app.db.casing import camel_to_snake_keys
from app.db.deps import get_repository
from app.db.repository import JwstDataReadRepository


router = APIRouter(prefix="/api/composite", tags=["Composite API"])

RepoDep = Annotated[JwstDataReadRepository, Depends(get_repository)]

_DATA_PREFIX = "/app/data/"
_NOT_FOUND = "The requested data was not found."
_FORWARD_PREFIXES = ("x-composite-", "x-quality-")


def _max_request_files() -> int:
    """Total input-file ceiling for one composite request. The memory budget
    caps OUTPUT pixels only; without this, an unauthenticated request could
    feed thousands of files into reprojection (CPU/IO amplification). The
    heaviest legitimate render measured in the Phase 1 spike used 68 files.
    Related follow-up: #1424 (per-filter file cap)."""
    return int(os.environ.get("MAX_COMPOSITE_REQUEST_FILES", "100"))


def _to_relative_key(file_path: str) -> str:
    if file_path.lower().startswith(_DATA_PREFIX):
        return file_path[len(_DATA_PREFIX) :]
    return file_path


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


def _validate_channel_configs(channels) -> None:
    """.NET ValidateChannelConfigs parity (CompositeController.cs:415) —
    exact messages, evaluated on the camelCase body like the .NET DTO."""
    if not isinstance(channels, list) or not channels:
        raise _bad_request("At least one channel configuration is required")
    total_files = 0
    for ch in channels:
        if not isinstance(ch, dict):
            raise _bad_request("At least one channel configuration is required")
        data_ids = ch.get("dataIds")
        if not isinstance(data_ids, list) or not data_ids:
            raise _bad_request("At least one DataId is required for each channel")
        total_files += len(data_ids)
        color = ch.get("color")
        if not isinstance(color, dict):
            # non-dict color would be a 400 at the .NET DTO binder too
            raise _bad_request("Color specification is required for each channel")
        hue, rgb = color.get("hue"), color.get("rgb")
        luminance = bool(color.get("luminance"))
        if hue is None and rgb is None and not luminance:
            raise _bad_request(
                "Either Hue, Rgb, or Luminance must be specified for each channel color"
            )
        if hue is not None and rgb is not None:
            raise _bad_request("Provide either Hue or Rgb, not both")
        if luminance and (hue is not None or rgb is not None):
            raise _bad_request("Luminance channel must not have Hue or Rgb")
    limit = _max_request_files()
    if total_files > limit:
        raise _bad_request(f"Too many input files: {total_files} exceeds maximum {limit}")


@router.post("/generate-nchannel")
async def api_generate_nchannel(body: dict, repo: RepoDep) -> Response:
    channels = body.get("channels")
    _validate_channel_configs(channels)

    # Resolve dataIds -> relative file paths, public data only, one batched
    # $in query. One bad id fails the whole request (no partial renders),
    # 404 without revealing whether the id exists.
    all_ids = [str(i) for ch in channels for i in ch["dataIds"]]
    docs_by_id = await repo.get_public_by_ids(all_ids)
    resolved: list[list[str]] = []
    for ch in channels:
        paths: list[str] = []
        for data_id in ch["dataIds"]:
            # normalize like the query side does — ObjectId accepts hex
            # case-insensitively but the batch map is keyed canonically
            try:
                key = str(ObjectId(str(data_id)))
            except (InvalidId, TypeError):
                raise HTTPException(status_code=404, detail=_NOT_FOUND) from None
            doc = docs_by_id.get(key)
            if doc is None or not doc.get("FilePath"):
                raise HTTPException(status_code=404, detail=_NOT_FOUND)
            paths.append(_to_relative_key(doc["FilePath"]))
        resolved.append(paths)

    snake = camel_to_snake_keys(body)
    for ch_snake, paths in zip(snake["channels"], resolved, strict=True):
        ch_snake.pop("data_ids", None)
        ch_snake["file_paths"] = paths
    # CE hardening: never allow forced downscale on the public edge
    snake["allow_force_downscale"] = False

    try:
        request = NChannelCompositeRequest.model_validate(snake)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors()) from exc

    # engine handler is sync CPU-bound — run off the event loop
    engine_resp = await asyncio.to_thread(engine_generate, request)

    headers = {
        name: value
        for name, value in engine_resp.headers.items()
        if name.lower().startswith(_FORWARD_PREFIXES)
    }
    fmt = request.output_format.lower()
    content_type = "image/jpeg" if fmt == "jpeg" else "image/png"
    headers["Content-Disposition"] = f'attachment; filename="composite-nchannel.{fmt}"'
    return Response(content=engine_resp.body, media_type=content_type, headers=headers)
