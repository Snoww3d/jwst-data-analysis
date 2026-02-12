"""
FastAPI routes for RGB composite image generation.
"""

import io
import logging
import os
from pathlib import Path

import numpy as np
from astropy.wcs import WCS
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from PIL import Image
from reproject import reproject_interp
from reproject.mosaicking import find_optimal_celestial_wcs
from scipy.ndimage import zoom

from app.mosaic.mosaic_engine import generate_mosaic, load_fits_2d_with_wcs
from app.processing.enhancement import (
    asinh_stretch,
    histogram_equalization,
    log_stretch,
    normalize_to_range,
    power_stretch,
    sqrt_stretch,
    zscale_stretch,
)

from .models import ChannelConfig, CompositeRequest, OverallAdjustments


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/composite", tags=["Composite"])

# Security: Define allowed data directory for file access
ALLOWED_DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data")).resolve()
MAX_COMPOSITE_REPROJECT_PIXELS = int(os.environ.get("MAX_COMPOSITE_REPROJECT_PIXELS", "64000000"))
# Max pixels per input image before downscaling for composite processing.
# The final output is at most 4096x4096 = 16M pixels, so 16M intermediates
# are more than sufficient quality. This prevents OOM when mixing instruments
# with very different pixel scales (e.g. MIRI ~4M px vs NIRCam ~123M px).
MAX_INPUT_PIXELS = int(os.environ.get("MAX_COMPOSITE_INPUT_PIXELS", "16000000"))


def downscale_for_composite(data: np.ndarray, wcs: WCS) -> tuple[np.ndarray, WCS]:
    """
    Downscale an image if it exceeds MAX_INPUT_PIXELS.

    Uses scipy zoom to reduce resolution and adjusts WCS metadata
    (CDELT, CRPIX) to match the new pixel grid.

    Args:
        data: 2D image array
        wcs: WCS for the image

    Returns:
        Tuple of (possibly downscaled data, adjusted WCS)
    """
    total_pixels = data.shape[0] * data.shape[1]
    if total_pixels <= MAX_INPUT_PIXELS:
        return data, wcs

    factor = (MAX_INPUT_PIXELS / total_pixels) ** 0.5
    new_shape = (int(data.shape[0] * factor), int(data.shape[1] * factor))
    logger.info(
        f"Downscaling {data.shape[1]}x{data.shape[0]} "
        f"({total_pixels:,} px) -> {new_shape[1]}x{new_shape[0]} "
        f"({new_shape[0] * new_shape[1]:,} px) for composite"
    )

    downscaled = zoom(data, factor, order=1)

    # Adjust WCS to reflect the new pixel scale
    header = wcs.to_header()
    scale = 1.0 / factor
    if "CDELT1" in header:
        header["CDELT1"] *= scale
        header["CDELT2"] *= scale
    if "CD1_1" in header:
        header["CD1_1"] *= scale
        header["CD1_2"] *= scale
        header["CD2_1"] *= scale
        header["CD2_2"] *= scale
    if "CRPIX1" in header:
        header["CRPIX1"] *= factor
        header["CRPIX2"] *= factor

    new_wcs = WCS(header, naxis=2).celestial
    return downscaled, new_wcs


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


def apply_tone_curve(data: np.ndarray, curve: str) -> np.ndarray:
    """
    Apply a tone-curve preset to normalized data in [0, 1].

    Args:
        data: Normalized input array.
        curve: Curve preset name.

    Returns:
        Curve-adjusted array in [0, 1].
    """
    normalized = np.clip(data, 0, 1)
    curve_name = curve.lower()

    if curve_name == "linear":
        return normalized
    if curve_name == "s_curve":
        # Smoothstep curve: boosts midtone contrast.
        return np.clip(normalized * normalized * (3.0 - 2.0 * normalized), 0, 1)
    if curve_name == "inverse_s":
        # Inverse smoothstep: flattens midtone contrast.
        return np.clip(0.5 + np.arcsin(2.0 * normalized - 1.0) / np.pi, 0, 1)
    if curve_name == "shadows":
        # Lift shadows.
        return np.clip(np.power(normalized, 0.7), 0, 1)
    if curve_name == "highlights":
        # Roll off bright values.
        return np.clip(np.power(normalized, 1.3), 0, 1)

    logger.warning(f"Unknown tone curve '{curve}', falling back to linear")
    return normalized


def apply_stretch_method(
    data: np.ndarray,
    stretch: str,
    gamma: float,
    asinh_a: float,
) -> np.ndarray:
    """
    Apply a stretch algorithm and return normalized output in [0, 1].

    Args:
        data: Input 2D channel data.
        stretch: Stretch method name.
        gamma: Gamma value (used when stretch=power).
        asinh_a: Asinh softening parameter.

    Returns:
        Stretched image in [0, 1].
    """
    stretch_name = stretch.lower()

    if stretch_name == "zscale":
        stretched, _, _ = zscale_stretch(data)
        return stretched
    if stretch_name == "asinh":
        return asinh_stretch(data, a=asinh_a)
    if stretch_name == "log":
        return log_stretch(data)
    if stretch_name == "sqrt":
        return sqrt_stretch(data)
    if stretch_name == "power":
        return power_stretch(data, power=1.0 / gamma if gamma != 0 else 1.0)
    if stretch_name == "histeq":
        return histogram_equalization(data)
    if stretch_name == "linear":
        return normalize_to_range(data)

    logger.warning(f"Unknown stretch '{stretch}', falling back to zscale")
    stretched, _, _ = zscale_stretch(data)
    return stretched


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
        stretched = apply_stretch_method(data, stretch, config.gamma, config.asinh_a)
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

    # Apply tone curve preset
    stretched = apply_tone_curve(stretched, config.curve)

    return np.clip(stretched, 0, 1)


def apply_overall_adjustments(rgb_array: np.ndarray, overall: OverallAdjustments) -> np.ndarray:
    """
    Apply global stretch and levels adjustments to a stacked RGB array.

    Args:
        rgb_array: RGB array in [0, 1], shape (H, W, 3).
        overall: Global adjustments to apply.

    Returns:
        Adjusted RGB array in [0, 1].
    """
    adjusted = np.clip(rgb_array, 0, 1)
    stretch = overall.stretch.lower()

    try:
        for channel_idx in range(adjusted.shape[-1]):
            adjusted[..., channel_idx] = apply_stretch_method(
                adjusted[..., channel_idx],
                stretch,
                overall.gamma,
                overall.asinh_a,
            )
    except Exception as e:
        logger.warning(f"Overall stretch {stretch} failed: {e}, skipping overall stretch")

    if overall.black_point > 0.0 or overall.white_point < 1.0:
        bp_value = np.percentile(adjusted, overall.black_point * 100)
        wp_value = np.percentile(adjusted, overall.white_point * 100)
        if wp_value > bp_value:
            adjusted = np.clip((adjusted - bp_value) / (wp_value - bp_value), 0, 1)
        else:
            adjusted = np.clip(adjusted, 0, 1)

    if stretch != "power" and overall.gamma != 1.0:
        adjusted = np.power(np.clip(adjusted, 0, 1), 1.0 / overall.gamma)

    return np.clip(adjusted, 0, 1)


def reproject_channels_to_common_wcs(
    channels: dict[str, tuple[np.ndarray, WCS]],
) -> tuple[dict[str, np.ndarray], tuple[int, int]]:
    """
    Reproject RGB channels onto a shared celestial WCS grid.

    Args:
        channels: Mapping of channel name to (data, WCS) tuples.

    Returns:
        Tuple of (reprojected channels, output shape).

    Raises:
        ValueError: If common WCS cannot be determined or reprojection fails.
    """
    input_data = [(data, wcs) for data, wcs in channels.values()]

    try:
        wcs_out, shape_out = find_optimal_celestial_wcs(input_data)
    except Exception as e:
        raise ValueError(f"Could not determine common WCS for RGB channels: {e}") from e

    total_pixels = shape_out[0] * shape_out[1]
    if total_pixels > MAX_COMPOSITE_REPROJECT_PIXELS:
        raise ValueError(
            f"Composite output would be {total_pixels:,} pixels "
            f"(max {MAX_COMPOSITE_REPROJECT_PIXELS:,}). "
            f"Shape: {shape_out[1]}x{shape_out[0]}"
        )

    reprojected_channels: dict[str, np.ndarray] = {}
    for channel_name, (data, wcs) in channels.items():
        try:
            reprojected, footprint = reproject_interp((data, wcs), wcs_out, shape_out=shape_out)
        except Exception as e:
            raise ValueError(f"Failed to reproject {channel_name} channel: {e}") from e

        reprojected = np.nan_to_num(reprojected, nan=0.0, posinf=0.0, neginf=0.0)
        reprojected[footprint == 0] = 0.0
        reprojected_channels[channel_name] = reprojected

    return reprojected_channels, shape_out


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

        # Load and optionally combine files for each channel
        channels: dict[str, tuple[np.ndarray, WCS]] = {}
        for channel_name, channel_config in [
            ("red", request.red),
            ("green", request.green),
            ("blue", request.blue),
        ]:
            # Validate all file paths for this channel
            validated_paths = []
            for fp in channel_config.file_paths:
                validated_paths.append(validate_file_path(fp))

            logger.info(f"Loading {channel_name} channel: {len(validated_paths)} file(s)")

            # Load FITS data and downscale large images to prevent OOM
            try:
                file_data = [
                    downscale_for_composite(*load_fits_2d_with_wcs(p)) for p in validated_paths
                ]
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

            if len(file_data) == 1:
                data, wcs = file_data[0]
                channels[channel_name] = (data, wcs)
            else:
                # Mean-combine multiple files using mosaic engine
                try:
                    mosaic_array, _footprint, wcs_out = generate_mosaic(
                        file_data, combine_method="mean"
                    )
                    channels[channel_name] = (mosaic_array, wcs_out)
                except ValueError as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Failed to combine {channel_name} channel files: {e}",
                    ) from e

            logger.info(f"{channel_name} channel shape: {channels[channel_name][0].shape}")

        try:
            reprojected_channels, target_shape = reproject_channels_to_common_wcs(channels)
        except ValueError as e:
            error_msg = str(e)
            if "Could not determine common WCS" in error_msg:
                raise HTTPException(status_code=400, detail=error_msg) from e
            if "pixels" in error_msg and "max" in error_msg:
                raise HTTPException(status_code=413, detail=error_msg) from e
            raise HTTPException(
                status_code=500, detail=f"Composite reprojection failed: {e}"
            ) from e

        logger.info(f"Reprojected channels to common WCS grid: {target_shape}")

        # Apply stretch to each channel
        logger.info("Applying stretch to channels")
        red_stretched = apply_stretch(reprojected_channels["red"], request.red)
        green_stretched = apply_stretch(reprojected_channels["green"], request.green)
        blue_stretched = apply_stretch(reprojected_channels["blue"], request.blue)

        # Stack into RGB array (height, width, 3)
        rgb_array = np.stack([red_stretched, green_stretched, blue_stretched], axis=-1)

        # Apply optional global post-stack stretch/levels.
        if request.overall is not None:
            rgb_array = apply_overall_adjustments(rgb_array, request.overall)

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
        raise HTTPException(status_code=500, detail=f"Composite generation failed: {str(e)}") from e
