"""
FastAPI routes for WCS-aware mosaic image generation.
"""

import io
import logging
import os
from pathlib import Path

import numpy as np
from astropy.io import fits
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from PIL import Image

from app.processing.enhancement import (
    asinh_stretch,
    histogram_equalization,
    log_stretch,
    normalize_to_range,
    power_stretch,
    sqrt_stretch,
    zscale_stretch,
)

from .models import (
    FootprintRequest,
    FootprintResponse,
    MosaicFileConfig,
    MosaicRequest,
)
from .mosaic_engine import generate_mosaic, get_footprints, load_fits_2d_with_wcs


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mosaic", tags=["Mosaic"])

# Security: Define allowed data directory for file access
ALLOWED_DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data")).resolve()

# Resource limits
MAX_FITS_FILE_SIZE_BYTES = int(os.environ.get("MAX_FITS_FILE_SIZE_MB", "2048")) * 1024 * 1024
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


def validate_file_path(file_path: str) -> Path:
    """
    Validate that a file path is within the allowed data directory.
    Prevents path traversal attacks.

    Args:
        file_path: The file path to validate (can be relative or absolute)

    Returns:
        Resolved Path object if valid

    Raises:
        HTTPException: 403 if path is outside allowed directory, 404 if file doesn't exist
    """
    try:
        requested_path = (ALLOWED_DATA_DIR / file_path).resolve()

        if not requested_path.is_relative_to(ALLOWED_DATA_DIR):
            logger.warning(f"Path traversal attempt blocked: {file_path}")
            raise HTTPException(
                status_code=403, detail="Access denied: path outside allowed directory"
            )

        if not requested_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {requested_path.name}")

        if not requested_path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")

        return requested_path

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Path validation error: {e}")
        raise HTTPException(status_code=400, detail="Invalid file path") from e


def validate_fits_file_size(file_path: Path) -> None:
    """
    Validate that a FITS file doesn't exceed the maximum allowed size.

    Args:
        file_path: Validated Path object to check

    Raises:
        HTTPException: 413 if file exceeds maximum size
    """
    file_size = file_path.stat().st_size
    if file_size > MAX_FITS_FILE_SIZE_BYTES:
        max_mb = MAX_FITS_FILE_SIZE_BYTES / (1024 * 1024)
        file_mb = file_size / (1024 * 1024)
        logger.warning(f"FITS file too large: {file_mb:.1f}MB (max {max_mb:.1f}MB)")
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {file_mb:.1f}MB exceeds maximum {max_mb:.1f}MB",
        )


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
    except Exception as e:
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
async def generate_mosaic_image(request: MosaicRequest):
    """
    Generate a WCS-aware mosaic image from 2+ FITS files.

    Files are reprojected onto a common WCS grid and combined using the
    specified method (mean/median/sum). The stretch from the first file's
    config is applied to the combined mosaic.

    Returns:
        Binary image data (PNG, JPEG, or FITS) with appropriate content type
    """
    try:
        logger.info(f"Generating mosaic from {len(request.files)} files")

        # Validate colormap
        cmap = request.cmap
        if cmap not in VALID_CMAPS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid colormap '{cmap}'. Must be one of: {', '.join(sorted(VALID_CMAPS))}",
            )

        # Validate and load all files
        file_data = []
        for file_config in request.files:
            validated_path = validate_file_path(file_config.file_path)
            validate_fits_file_size(validated_path)

            try:
                data, wcs = load_fits_2d_with_wcs(validated_path)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

            file_data.append((data, wcs))
            logger.info(f"Loaded: {validated_path.name}, shape={data.shape}")

        # Generate mosaic
        try:
            mosaic_array, footprint_array, wcs_out = generate_mosaic(
                file_data,
                combine_method=request.combine_method,
                max_output_pixels=MAX_MOSAIC_OUTPUT_PIXELS,
            )
        except ValueError as e:
            error_msg = str(e)
            if "Could not determine common WCS" in error_msg:
                raise HTTPException(status_code=400, detail=error_msg) from e
            if "pixels" in error_msg and "max" in error_msg:
                raise HTTPException(
                    status_code=413,
                    detail=f"Mosaic output too large: exceeds MAX_MOSAIC_OUTPUT_PIXELS ({MAX_MOSAIC_OUTPUT_PIXELS:,})",
                ) from e
            raise HTTPException(status_code=500, detail=f"Mosaic reprojection failed: {e}") from e

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

            hdu = fits.PrimaryHDU(data=fits_data, header=wcs_out.to_header())
            hdu.header["EXTNAME"] = "MOSAIC"

            buf = io.BytesIO()
            hdu.writeto(buf, overwrite=True)
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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating mosaic: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Mosaic generation failed: {str(e)}") from e


@router.post("/footprint", response_model=FootprintResponse)
async def get_mosaic_footprint(request: FootprintRequest):
    """
    Get WCS footprint polygons (RA/Dec corners) for FITS files.

    Used for previewing coverage area before generating a mosaic.

    Returns:
        JSON with footprints (corner coordinates), bounding box, and file count
    """
    try:
        logger.info(f"Computing footprints for {len(request.file_paths)} files")

        # Validate and load all files
        file_data = []
        for file_path in request.file_paths:
            validated_path = validate_file_path(file_path)
            validate_fits_file_size(validated_path)

            try:
                data, wcs = load_fits_2d_with_wcs(validated_path)
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

            file_data.append((data, wcs, file_path))

        # Compute footprints
        footprint_list, bounding_box = get_footprints(file_data)

        return FootprintResponse(
            footprints=footprint_list,
            bounding_box=bounding_box,
            n_files=len(file_data),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error computing footprints: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Footprint computation failed: {str(e)}"
        ) from e
