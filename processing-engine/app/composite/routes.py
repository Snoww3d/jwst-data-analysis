"""
FastAPI routes for RGB composite image generation.
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
from scipy import ndimage

from app.processing.enhancement import (
    asinh_stretch,
    histogram_equalization,
    log_stretch,
    normalize_to_range,
    power_stretch,
    sqrt_stretch,
    zscale_stretch,
)

from .models import ChannelConfig, CompositeRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/composite", tags=["Composite"])

# Security: Define allowed data directory for file access
ALLOWED_DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data")).resolve()


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


def load_fits_data(file_path: Path) -> np.ndarray:
    """
    Load 2D image data from a FITS file.

    Args:
        file_path: Path to the FITS file

    Returns:
        2D numpy array of image data

    Raises:
        HTTPException: If no valid image data found
    """
    with fits.open(file_path) as hdul:
        data = None
        for hdu in hdul:
            if hdu.data is not None and len(hdu.data.shape) >= 2:
                data = hdu.data.astype(np.float64)
                break

        if data is None:
            raise HTTPException(
                status_code=400,
                detail=f"No image data found in FITS file: {file_path.name}",
            )

        # Handle 3D+ data cubes - take middle slice
        while len(data.shape) > 2:
            mid_idx = data.shape[0] // 2
            data = data[mid_idx]

        # Handle NaN values
        data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)

        return data


def apply_stretch(data: np.ndarray, config: ChannelConfig) -> np.ndarray:
    """
    Apply stretch and level adjustments to channel data.

    Args:
        data: 2D numpy array of image data
        config: Channel configuration with stretch settings

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


def resample_to_shape(data: np.ndarray, target_shape: tuple[int, int]) -> np.ndarray:
    """
    Resample data to target shape using bilinear interpolation.

    Args:
        data: 2D numpy array
        target_shape: (height, width) tuple

    Returns:
        Resampled array
    """
    if data.shape == target_shape:
        return data

    zoom_factors = (target_shape[0] / data.shape[0], target_shape[1] / data.shape[1])
    return ndimage.zoom(data, zoom_factors, order=1)


@router.post("/generate")
async def generate_composite(request: CompositeRequest):
    """
    Generate an RGB composite image from 3 FITS files.

    Each channel can have independent stretch and level settings.
    The output is a PNG or JPEG image with the specified dimensions.

    Returns:
        Binary image data with appropriate content type
    """
    try:
        logger.info("Generating RGB composite image")

        # Validate all file paths
        red_path = validate_file_path(request.red.file_path)
        green_path = validate_file_path(request.green.file_path)
        blue_path = validate_file_path(request.blue.file_path)

        logger.info(f"Loading FITS files: R={red_path.name}, G={green_path.name}, B={blue_path.name}")

        # Load FITS data
        red_data = load_fits_data(red_path)
        green_data = load_fits_data(green_path)
        blue_data = load_fits_data(blue_path)

        logger.info(
            f"Loaded data shapes: R={red_data.shape}, G={green_data.shape}, B={blue_data.shape}"
        )

        # Check dimension compatibility - resample to smallest common size if needed
        shapes = [red_data.shape, green_data.shape, blue_data.shape]
        min_height = min(s[0] for s in shapes)
        min_width = min(s[1] for s in shapes)
        target_shape = (min_height, min_width)

        # Resample if dimensions don't match
        if red_data.shape != target_shape:
            logger.info(f"Resampling red channel from {red_data.shape} to {target_shape}")
            red_data = resample_to_shape(red_data, target_shape)

        if green_data.shape != target_shape:
            logger.info(f"Resampling green channel from {green_data.shape} to {target_shape}")
            green_data = resample_to_shape(green_data, target_shape)

        if blue_data.shape != target_shape:
            logger.info(f"Resampling blue channel from {blue_data.shape} to {target_shape}")
            blue_data = resample_to_shape(blue_data, target_shape)

        # Apply stretch to each channel
        logger.info("Applying stretch to channels")
        red_stretched = apply_stretch(red_data, request.red)
        green_stretched = apply_stretch(green_data, request.green)
        blue_stretched = apply_stretch(blue_data, request.blue)

        # Stack into RGB array (height, width, 3)
        rgb_array = np.stack([red_stretched, green_stretched, blue_stretched], axis=-1)

        # Flip vertically for correct astronomical orientation (origin='lower')
        rgb_array = np.flipud(rgb_array)

        # Convert to 8-bit for image output
        rgb_8bit = (rgb_array * 255).astype(np.uint8)

        # Create PIL Image
        image = Image.fromarray(rgb_8bit, mode="RGB")

        # Resize to requested dimensions
        if (image.width, image.height) != (request.width, request.height):
            image = image.resize((request.width, request.height), Image.Resampling.LANCZOS)

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
            f"Composite generated: {request.width}x{request.height} {request.output_format}, "
            f"size: {buf.getbuffer().nbytes} bytes"
        )

        return Response(content=buf.getvalue(), media_type=media_type)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating composite: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Composite generation failed: {str(e)}"
        ) from e
