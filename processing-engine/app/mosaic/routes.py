"""
FastAPI routes for WCS-aware mosaic image generation.
"""

import io
import logging
import math
import os
from datetime import datetime, timezone

import numpy as np
from astropy.io import fits
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from PIL import Image

from app.diagnostics import log_memory
from app.exceptions import MosaicError
from app.instruments import (
    DEFAULT_FOV_RADIUS_ARCMIN as _DEFAULT_FOV_RADIUS_ARCMIN,
)
from app.instruments import (
    INSTRUMENT_FOV_RADIUS_ARCMIN as _INSTRUMENT_FOV_RADIUS_ARCMIN,
)
from app.processing.enhancement import (
    asinh_stretch,
    histogram_equalization,
    log_stretch,
    normalize_to_range,
    power_stretch,
    sqrt_stretch,
    zscale_stretch,
)
from app.render_gate import render_gated
from app.storage.helpers import (
    MAX_FITS_FILE_SIZE_BYTES,
    resolve_fits_path,
    validate_fits_file_size,
)

from .models import (
    FootprintRequest,
    FootprintResponse,
    MosaicFileConfig,
    MosaicRequest,
    ObservationMosaicRequest,
)
from .mosaic_engine import (
    generate_mosaic,
    generate_mosaic_batched,
    get_footprints_from_wcs,
    load_fits_2d_with_wcs,
    load_fits_2d_with_wcs_and_header,
    load_fits_wcs_shape_and_instrument,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mosaic", tags=["Mosaic"])

# Resource limits
MAX_MOSAIC_OUTPUT_PIXELS = int(
    os.environ.get("MAX_MOSAIC_OUTPUT_PIXELS", "64000000")
)  # Default 64M pixels

# Valid colormaps
VALID_CMAPS = {
    "grayscale",
    "gray",
    "inferno",
    "magma",
    "viridis",
    "plasma",
    "hot",
    "cool",
    "rainbow",
    "jet",
}

# Source FITS keywords copied when values are consistent across all inputs.
COMMON_SOURCE_HEADER_KEYS = (
    "TELESCOP",
    "INSTRUME",
    "DETECTOR",
    "FILTER",
    "PUPIL",
    "CHANNEL",
    "BAND",
    "EXP_TYPE",
    "TARGNAME",
    "OBS_ID",
    "PROPOSID",
    "PI_NAME",
    "RADESYS",
    "EQUINOX",
    "DATE-OBS",
    "TIME-OBS",
    "MJD-OBS",
    "MJD-END",
    "EXPSTART",
    "EXPEND",
    "EXPTIME",
    "XPOSURE",
    "EFFEXPTM",
    "BUNIT",
)

# Compact summaries for values that may vary between source files.
DISTINCT_SOURCE_KEYWORDS = {
    "INSTRUME": "SRCINST",
    "DETECTOR": "SRCDETS",
    "FILTER": "SRCFILT",
    "TARGNAME": "SRCTARG",
    "OBS_ID": "SRCOBS",
    "PROPOSID": "SRCPROP",
}


def _truncate(value: str, max_len: int) -> str:
    """Truncate a string to a max length without raising for short values."""
    return value if len(value) <= max_len else f"{value[: max_len - 3]}..."


def _card_value_to_string(value: object) -> str:
    """Convert FITS card values to a compact string representation."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _normalize_compare_value(value: object) -> str:
    """Normalize card values for cross-file equality checks."""
    return _card_value_to_string(value).strip().upper()


def _common_header_value(source_headers: list[fits.Header], key: str) -> object | None:
    """Return a value only when every source header has the same non-empty value."""
    values = []
    for header in source_headers:
        if key not in header:
            continue
        value = header.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        values.append(value)

    if not values:
        return None

    first = values[0]
    first_norm = _normalize_compare_value(first)
    if all(_normalize_compare_value(value) == first_norm for value in values[1:]):
        return first
    return None


def _distinct_header_values(source_headers: list[fits.Header], key: str) -> list[str]:
    """Return unique non-empty values for a header key across all source files."""
    seen = set()
    ordered_values: list[str] = []

    for header in source_headers:
        if key not in header:
            continue
        value = _card_value_to_string(header.get(key)).strip()
        if not value:
            continue
        normalized = value.upper()
        if normalized in seen:
            continue
        seen.add(normalized)
        ordered_values.append(value)

    return ordered_values


def _summarize_values(values: list[str], max_len: int = 68) -> str | None:
    """Join values for a FITS card while respecting the card length budget."""
    if not values:
        return None

    joined = "|".join(values)
    if len(joined) <= max_len:
        return joined

    preview = "|".join(values[:3])
    return _truncate(f"{preview}|...({len(values)} values)", max_len)


def _build_source_metadata_hdu(
    source_headers: list[fits.Header],
    source_file_names: list[str],
) -> fits.BinTableHDU | None:
    """Build a table extension containing source header cards for provenance."""
    src_indices: list[int] = []
    file_names: list[str] = []
    keywords: list[str] = []
    values: list[str] = []
    comments: list[str] = []

    for index, (file_name, source_header) in enumerate(
        zip(source_file_names, source_headers, strict=True),
        start=1,
    ):
        for card in source_header.cards:
            keyword = card.keyword.strip()
            if keyword == "END":
                continue

            src_indices.append(index)
            file_names.append(_truncate(file_name, 120))
            keywords.append(_truncate(keyword, 32))
            values.append(_truncate(_card_value_to_string(card.value), 512))
            comments.append(_truncate(card.comment or "", 256))

    if not src_indices:
        return None

    file_width = max(1, max(len(name) for name in file_names))
    keyword_width = max(1, max(len(keyword) for keyword in keywords))
    value_width = max(1, max(len(value) for value in values))
    comment_width = max(1, max(len(comment) for comment in comments))

    columns = fits.ColDefs(
        [
            fits.Column(name="SRCINDEX", format="J", array=np.array(src_indices, dtype=np.int32)),
            fits.Column(name="FILENAME", format=f"A{file_width}", array=np.array(file_names)),
            fits.Column(name="KEYWORD", format=f"A{keyword_width}", array=np.array(keywords)),
            fits.Column(name="VALUE", format=f"A{value_width}", array=np.array(values)),
            fits.Column(name="COMMENT", format=f"A{comment_width}", array=np.array(comments)),
        ]
    )

    hdu = fits.BinTableHDU.from_columns(columns, name="SRCMETA")
    hdu.header["NINPUTS"] = (len(source_file_names), "Number of source FITS files")
    hdu.header["METAVERS"] = ("1.0", "Source metadata table format")
    return hdu


def _annotate_mosaic_header(
    header: fits.Header,
    source_headers: list[fits.Header],
    source_file_names: list[str],
    combine_method: str,
) -> None:
    """Attach provenance and science metadata for generated FITS mosaics."""
    header["EXTNAME"] = ("MOSAIC", "Generated WCS mosaic image")
    header["ORIGIN"] = ("JWST-DA", "JWST Data Analysis")
    header["CREATOR"] = ("jwst-processing-engine", "Mosaic generation service")
    header["DATE"] = (
        datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "FITS creation date (UTC)",
    )
    header["MOSAIC"] = (True, "This file is a generated mosaic")
    header["NINPUTS"] = (len(source_file_names), "Number of source FITS files")
    header["COMBMETH"] = (combine_method, "Method used to combine overlapping pixels")

    for idx, source_name in enumerate(source_file_names, start=1):
        header[f"SRC{idx:04d}"] = (_truncate(source_name, 68), "Input source FITS file")

    for key in COMMON_SOURCE_HEADER_KEYS:
        common_value = _common_header_value(source_headers, key)
        if common_value is not None:
            header[key] = (common_value, "Copied from source FITS metadata")

    for source_key, header_key in DISTINCT_SOURCE_KEYWORDS.items():
        values = _distinct_header_values(source_headers, source_key)
        summary = _summarize_values(values)
        if summary:
            header[header_key] = (summary, f"Distinct {source_key} values in sources")

    header.add_history(
        _truncate(
            f"Generated from {len(source_file_names)} inputs using combine={combine_method}",
            68,
        )
    )
    for idx, (source_name, source_header) in enumerate(
        zip(source_file_names, source_headers, strict=True),
        start=1,
    ):
        details = [f"src{idx}:{source_name}"]
        for key in ("INSTRUME", "FILTER", "TARGNAME", "OBS_ID", "PROPOSID"):
            value = source_header.get(key)
            if value is not None and str(value).strip():
                details.append(f"{key}={value}")
        header.add_history(_truncate("; ".join(details), 68))


def apply_stretch(data: np.ndarray, config: MosaicFileConfig) -> np.ndarray:
    """
    Apply stretch and level adjustments to image data.

    Args:
        data: 2D numpy array of image data
        config: File configuration with stretch settings

    Returns:
        Stretched data in range [0, 1]
    """
    stretch = config.stretch.lower()

    try:
        if stretch == "zscale":
            stretched, _, _ = zscale_stretch(data)
        elif stretch == "asinh":
            stretched = asinh_stretch(data, a=config.asinh_a)
        elif stretch == "log":
            stretched = log_stretch(data)
        elif stretch == "sqrt":
            stretched = sqrt_stretch(data)
        elif stretch == "power":
            stretched = power_stretch(data, power=1.0 / config.gamma if config.gamma != 0 else 1.0)
        elif stretch == "histeq":
            stretched = histogram_equalization(data)
        elif stretch == "linear":
            stretched = normalize_to_range(data)
        else:
            logger.warning(f"Unknown stretch '{stretch}', falling back to zscale")
            stretched, _, _ = zscale_stretch(data)
    except (ValueError, RuntimeError) as e:
        logger.warning(f"Stretch {stretch} failed: {e}, falling back to zscale")
        stretched, _, _ = zscale_stretch(data)

    # Apply black/white point clipping
    if config.black_point > 0.0 or config.white_point < 1.0:
        bp_value = np.percentile(stretched, config.black_point * 100)
        wp_value = np.percentile(stretched, config.white_point * 100)
        if wp_value > bp_value:
            stretched = np.clip((stretched - bp_value) / (wp_value - bp_value), 0, 1)
        else:
            stretched = np.clip(stretched, 0, 1)

    # Apply gamma correction (skip for power stretch which already uses gamma)
    if stretch != "power" and config.gamma != 1.0:
        stretched = np.power(np.clip(stretched, 0, 1), 1.0 / config.gamma)

    return np.clip(stretched, 0, 1)


@router.post("/generate")
@render_gated
def generate_mosaic_image(request: MosaicRequest):
    """
    Generate a WCS-aware mosaic image from 2+ FITS files.

    Files are reprojected onto a common WCS grid and combined using the
    specified method (mean/median/sum). The stretch from the first file's
    config is applied to the combined mosaic.

    Returns:
        Binary image data (PNG, JPEG, or FITS) with appropriate content type
    """
    log_memory("mosaic-start")
    logger.info(f"Generating mosaic from {len(request.files)} files")

    # Validate colormap
    cmap = request.cmap
    if cmap not in VALID_CMAPS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid colormap '{cmap}'. Must be one of: {', '.join(sorted(VALID_CMAPS))}",
        )

    # Resolve and load all files via storage layer
    file_data = []
    source_headers: list[fits.Header] = []
    source_file_names: list[str] = []
    for file_config in request.files:
        local_path = resolve_fits_path(file_config.file_path)
        validate_fits_file_size(local_path, max_bytes=MAX_FITS_FILE_SIZE_BYTES)

        try:
            data, wcs, source_header = load_fits_2d_with_wcs_and_header(local_path)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        file_data.append((data, wcs))
        source_headers.append(source_header)
        source_file_names.append(local_path.name)
        logger.info(f"Loaded: {local_path.name}, shape={data.shape}")

    # Generate mosaic
    log_memory("before-mosaic-generate")
    try:
        mosaic_array, footprint_array, wcs_out = generate_mosaic(
            file_data,
            combine_method=request.combine_method,
            max_output_pixels=MAX_MOSAIC_OUTPUT_PIXELS,
        )
    except MosaicError as e:
        error_msg = str(e)
        if "Could not determine common WCS" in error_msg:
            raise HTTPException(status_code=400, detail=error_msg) from e
        if "pixels" in error_msg and "max" in error_msg:
            raise HTTPException(
                status_code=413,
                detail=f"Mosaic output too large: exceeds MAX_MOSAIC_OUTPUT_PIXELS ({MAX_MOSAIC_OUTPUT_PIXELS:,})",
            ) from e
        raise HTTPException(
            status_code=500,
            detail="Mosaic reprojection failed. Please retry or try different input files.",
        ) from e

    log_memory("after-mosaic-generate")
    logger.info(f"Mosaic generated: shape={mosaic_array.shape}")

    if request.output_format == "fits":
        if request.width is not None or request.height is not None:
            raise HTTPException(
                status_code=400,
                detail="Width/height resizing is not supported for FITS output",
            )

        # Preserve native mosaic data and mark no-coverage pixels as NaN.
        fits_data = mosaic_array.astype(np.float32, copy=True)
        fits_data[footprint_array == 0] = np.nan

        primary_hdu = fits.PrimaryHDU(data=fits_data, header=wcs_out.to_header())
        _annotate_mosaic_header(
            primary_hdu.header,
            source_headers=source_headers,
            source_file_names=source_file_names,
            combine_method=request.combine_method,
        )

        buf = io.BytesIO()
        hdus = [primary_hdu]
        source_metadata_hdu = _build_source_metadata_hdu(source_headers, source_file_names)
        if source_metadata_hdu is not None:
            hdus.append(source_metadata_hdu)

        fits.HDUList(hdus).writeto(buf, overwrite=True)
        buf.seek(0)

        logger.info(
            f"Mosaic output: {fits_data.shape[1]}x{fits_data.shape[0]} fits, "
            f"{len(request.files)} files, combine={request.combine_method}, "
            f"size: {buf.getbuffer().nbytes} bytes"
        )

        return Response(content=buf.getvalue(), media_type="application/fits")

    # Apply stretch from first file's config to the combined mosaic
    stretched = apply_stretch(mosaic_array, request.files[0])

    # Mask no-coverage areas as black using footprint
    stretched[footprint_array == 0] = 0.0

    # Flip vertically for correct astronomical orientation (origin='lower')
    stretched = np.flipud(stretched)

    # Apply colormap
    if cmap == "grayscale":
        cmap = "gray"

    import matplotlib.pyplot as plt

    colormap = plt.get_cmap(cmap)
    rgb_array = colormap(stretched)[:, :, :3]  # Drop alpha channel

    # Mask no-coverage areas as black (colormap may have mapped 0 to non-black)
    footprint_flipped = np.flipud(footprint_array)
    for c in range(3):
        rgb_array[:, :, c][footprint_flipped == 0] = 0.0

    # Convert to 8-bit
    rgb_8bit = (rgb_array * 255).astype(np.uint8)

    # Create PIL Image
    image = Image.fromarray(rgb_8bit, mode="RGB")

    # Resize if requested
    if request.width is not None and request.height is not None:
        image = image.resize((request.width, request.height), Image.Resampling.LANCZOS)
    elif request.width is not None:
        ratio = request.width / image.width
        new_height = int(image.height * ratio)
        image = image.resize((request.width, new_height), Image.Resampling.LANCZOS)
    elif request.height is not None:
        ratio = request.height / image.height
        new_width = int(image.width * ratio)
        image = image.resize((new_width, request.height), Image.Resampling.LANCZOS)

    # Save to buffer
    buf = io.BytesIO()
    if request.output_format == "jpeg":
        image.save(buf, format="JPEG", quality=request.quality)
        media_type = "image/jpeg"
    else:
        image.save(buf, format="PNG", optimize=True)
        media_type = "image/png"

    buf.seek(0)

    logger.info(
        f"Mosaic output: {image.width}x{image.height} {request.output_format}, "
        f"{len(request.files)} files, combine={request.combine_method}, "
        f"size: {buf.getbuffer().nbytes} bytes"
    )

    return Response(content=buf.getvalue(), media_type=media_type)


def _angular_separation_arcmin(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Compute angular separation between two sky positions in arcminutes.

    Uses the Vincenty formula for numerical stability at small separations.
    """
    ra1_r, dec1_r = math.radians(ra1), math.radians(dec1)
    ra2_r, dec2_r = math.radians(ra2), math.radians(dec2)
    dra = ra2_r - ra1_r

    sin_dec1, cos_dec1 = math.sin(dec1_r), math.cos(dec1_r)
    sin_dec2, cos_dec2 = math.sin(dec2_r), math.cos(dec2_r)
    sin_dra, cos_dra = math.sin(dra), math.cos(dra)

    num = math.sqrt(
        (cos_dec2 * sin_dra) ** 2 + (cos_dec1 * sin_dec2 - sin_dec1 * cos_dec2 * cos_dra) ** 2
    )
    den = sin_dec1 * sin_dec2 + cos_dec1 * cos_dec2 * cos_dra
    sep_rad = math.atan2(num, den)
    return math.degrees(sep_rad) * 60.0


def _detect_overlap_warning(footprints: list[dict]) -> str | None:
    """Check if footprints form spatially disconnected groups.

    Uses single-linkage clustering on footprint centers, similar to
    recipe_engine.group_by_spatial_overlap(). Returns a user-facing
    warning string if files form 2+ disconnected groups, else None.
    """
    n = len(footprints)
    if n < 2:
        return None

    # Union-Find
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(n):
        for j in range(i + 1, n):
            inst_i = (footprints[i].get("instrument") or "").upper()
            inst_j = (footprints[j].get("instrument") or "").upper()
            fov_i = _INSTRUMENT_FOV_RADIUS_ARCMIN.get(inst_i, _DEFAULT_FOV_RADIUS_ARCMIN)
            fov_j = _INSTRUMENT_FOV_RADIUS_ARCMIN.get(inst_j, _DEFAULT_FOV_RADIUS_ARCMIN)
            sep = _angular_separation_arcmin(
                footprints[i]["center_ra"],
                footprints[i]["center_dec"],
                footprints[j]["center_ra"],
                footprints[j]["center_dec"],
            )
            if sep < fov_i + fov_j:
                union(i, j)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        root = find(i)
        groups.setdefault(root, []).append(i)

    if len(groups) < 2:
        return None

    # Build a structured warning: summary line + one line per group
    group_lines = []
    for idx, indices in enumerate(groups.values(), 1):
        instruments = sorted(
            {(footprints[i].get("instrument") or "unknown").upper() for i in indices}
        )
        file_paths = [footprints[i].get("file_path", "") for i in indices]
        labels = [p.rsplit("/", 1)[-1] if "/" in p else p for p in file_paths if p]
        group_lines.append(f"Group {idx}: {', '.join(labels)} ({', '.join(instruments)})")

    return (
        f"These {n} files form {len(groups)} spatially disconnected groups"
        " — the composite may have large gaps.\n"
        + "\n".join(group_lines)
        + "\nConsider compositing each group separately."
    )


@router.post("/footprint", response_model=FootprintResponse)
def get_mosaic_footprint(request: FootprintRequest):
    """
    Get WCS footprint polygons (RA/Dec corners) for FITS files.

    Used for previewing coverage area before generating a mosaic or composite.
    Also detects spatial overlap gaps between instruments and returns a warning
    if files form disconnected spatial groups.

    Returns:
        JSON with footprints (corner coordinates), bounding box, file count,
        and optional overlap_warning
    """
    logger.info(f"Computing footprints for {len(request.file_paths)} files")

    # Load only WCS headers and shapes — no pixel data needed for footprints.
    # This avoids the file-size limit since only a few KB of headers are read,
    # even for multi-GB FITS files.
    footprint_entries = []
    for file_path in request.file_paths:
        local_path = resolve_fits_path(file_path)

        try:
            wcs, height, width, instrument = load_fits_wcs_shape_and_instrument(local_path)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        footprint_entries.append((wcs, height, width, file_path, instrument))

    # Compute footprints from WCS + shape (no pixel data)
    footprint_list, bounding_box = get_footprints_from_wcs(footprint_entries)

    # Detect spatial overlap gaps between files
    overlap_warning = _detect_overlap_warning(footprint_list)

    return FootprintResponse(
        footprints=footprint_list,
        bounding_box=bounding_box,
        n_files=len(footprint_entries),
        overlap_warning=overlap_warning,
    )


@router.post("/generate-observation")
@render_gated
def generate_observation_mosaic(request: ObservationMosaicRequest):
    """Generate an observation-level mosaic from many per-detector FITS files.

    Uses hierarchical batched mosaicking for large file counts to stay within
    memory limits. Always outputs FITS format.
    """
    log_memory("obs-mosaic-start")

    total_files = len(request.file_paths)
    per_file_budget = max(request.max_output_pixels // total_files, 100_000)
    logger.info(f"Observation mosaic: {total_files} files, per_file_budget={per_file_budget:,} px")

    # Load all files with per-file downscaling
    file_data = []
    for i, rel_path in enumerate(request.file_paths):
        local_path = resolve_fits_path(rel_path)
        validate_fits_file_size(local_path, max_bytes=MAX_FITS_FILE_SIZE_BYTES)

        try:
            data, wcs = load_fits_2d_with_wcs(local_path)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        # Downscale if needed to stay within per-file pixel budget
        current_pixels = data.shape[0] * data.shape[1]
        if current_pixels > per_file_budget:
            scale = (per_file_budget / current_pixels) ** 0.5
            new_h = max(1, int(data.shape[0] * scale))
            new_w = max(1, int(data.shape[1] * scale))
            # Use PIL mode "F" for float32 to preserve astronomical pixel values
            data = np.array(
                Image.fromarray(data.astype(np.float32), mode="F").resize(
                    (new_w, new_h), Image.Resampling.LANCZOS
                )
            )
            # Rescale WCS to match new pixel grid (CRPIX is 1-based in FITS)
            new_wcs = wcs.deepcopy()
            new_wcs.wcs.crpix = (new_wcs.wcs.crpix - 1) * scale + 1
            if new_wcs.wcs.has_cd():
                new_wcs.wcs.cd = new_wcs.wcs.cd / scale
            elif hasattr(new_wcs.wcs, "cdelt"):
                new_wcs.wcs.cdelt = new_wcs.wcs.cdelt / scale
            if hasattr(new_wcs, "pixel_shape"):
                new_wcs.pixel_shape = (new_w, new_h)
            if hasattr(new_wcs, "_naxis"):
                new_wcs._naxis = [new_w, new_h]
            wcs = new_wcs
            logger.debug(
                f"Downscaled file {i + 1}: {current_pixels:,} -> "
                f"{new_h * new_w:,} px (scale={scale:.3f})"
            )

        file_data.append((data, wcs))
        if (i + 1) % 20 == 0:
            log_memory(f"obs-mosaic-loaded-{i + 1}/{total_files}")

    log_memory("obs-mosaic-all-loaded")

    # Use batched mosaicking when file count exceeds batch size
    use_batched = total_files > request.batch_size
    if use_batched:
        mosaic_array, footprint, output_wcs = generate_mosaic_batched(
            file_data,
            request.combine_method,
            request.max_output_pixels,
            request.batch_size,
        )
    else:
        mosaic_array, footprint, output_wcs = generate_mosaic(
            file_data,
            request.combine_method,
            request.max_output_pixels,
        )

    # Free source data
    del file_data

    log_memory("obs-mosaic-after-generate")

    # Mask no-coverage areas
    mosaic_array[footprint == 0] = 0

    # Build FITS output
    header = output_wcs.to_header()
    header["ORIGIN"] = "JWST-DataAnalysis"
    header["CREATOR"] = "observation-mosaic-generator"
    header["DATE"] = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
    header["NCOMBINE"] = total_files
    header["COMBMETH"] = request.combine_method
    header["HIERARCH OBS_MOSAIC"] = True

    hdu = fits.PrimaryHDU(data=mosaic_array.astype(np.float32), header=header)

    buf = io.BytesIO()
    hdu.writeto(buf, overwrite=True)
    buf.seek(0)

    log_memory("obs-mosaic-complete")

    return Response(
        content=buf.getvalue(),
        media_type="application/fits",
        headers={"Content-Disposition": "attachment; filename=observation-mosaic.fits"},
    )
