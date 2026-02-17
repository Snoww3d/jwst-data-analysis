"""
FastAPI routes for RGB composite image generation.
"""

import io
import logging
import os

import numpy as np
from astropy.stats import sigma_clipped_stats
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
from app.storage.helpers import resolve_fits_path

from .cache import CompositeCache
from .color_mapping import blend_luminance, combine_channels_to_rgb, hue_to_rgb_weights
from .models import (
    ChannelColor,
    ChannelConfig,
    NChannelCompositeRequest,
    OverallAdjustments,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/composite", tags=["Composite"])

# Module-level cache persists across requests within the same worker process.
_cache = CompositeCache()

MAX_COMPOSITE_REPROJECT_PIXELS = int(os.environ.get("MAX_COMPOSITE_REPROJECT_PIXELS", "64000000"))
# Max pixels per input image before downscaling for composite processing.
# The final output is at most 4096x4096 = 16M pixels, so 16M intermediates
# are more than sufficient quality. This prevents OOM when mixing instruments
# with very different pixel scales (e.g. MIRI ~4M px vs NIRCam ~123M px).
MAX_INPUT_PIXELS = int(os.environ.get("MAX_COMPOSITE_INPUT_PIXELS", "16000000"))
# Output-aware downscaling: for small preview requests we shrink the input
# budget proportionally so previews are fast while exports stay full quality.
PREVIEW_OVERSAMPLE = 4  # 4x oversampling gives good quality for the final resize
MIN_PREVIEW_PIXELS = 500_000  # floor to avoid too-tiny intermediates


def downscale_for_composite(
    data: np.ndarray, wcs: WCS, max_pixels: int = MAX_INPUT_PIXELS
) -> tuple[np.ndarray, WCS]:
    """
    Downscale an image if it exceeds the pixel budget.

    Uses scipy zoom to reduce resolution and adjusts WCS metadata
    (CDELT, CRPIX) to match the new pixel grid.

    Args:
        data: 2D image array
        wcs: WCS for the image
        max_pixels: Maximum pixel budget (defaults to MAX_INPUT_PIXELS)

    Returns:
        Tuple of (possibly downscaled data, adjusted WCS)
    """
    total_pixels = data.shape[0] * data.shape[1]
    if total_pixels <= max_pixels:
        return data, wcs

    factor = (max_pixels / total_pixels) ** 0.5
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
    max_reproject_pixels: int = MAX_COMPOSITE_REPROJECT_PIXELS,
) -> tuple[dict[str, np.ndarray], tuple[int, int]]:
    """
    Reproject RGB channels onto a shared celestial WCS grid.

    Args:
        channels: Mapping of channel name to (data, WCS) tuples.
        max_reproject_pixels: Maximum allowed pixels for the reprojected output.

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
    if total_pixels > max_reproject_pixels:
        raise ValueError(
            f"Composite output would be {total_pixels:,} pixels "
            f"(max {max_reproject_pixels:,}). "
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


def neutralize_raw_backgrounds(
    channels: dict[str, np.ndarray],
) -> dict[str, np.ndarray]:
    """
    Subtract per-channel sky background from raw (linear) reprojected data.

    This operates on unstretched data — the correct stage for background
    neutralization, matching how professional tools (PixInsight, etc.) work.
    The stretch algorithm then sees data where sky = 0 and naturally maps
    the background to black without double-stretching artifacts.

    Returns new arrays (does not modify the cached originals).

    Args:
        channels: Dict of channel name to raw 2D reprojected data.

    Returns:
        New dict with background-subtracted arrays.
    """
    result = {}
    for name, data in channels.items():
        # Exclude zero-coverage pixels (from reprojection footprint gaps)
        valid = data[data > 0]
        if valid.size == 0:
            result[name] = data.copy()
            continue

        _, median, _ = sigma_clipped_stats(valid, sigma=3.0, maxiters=5)
        shifted = data - median
        np.clip(shifted, 0, None, out=shifted)
        logger.info(f"Background neutralization: {name} sky median = {median:.6g}")
        result[name] = shifted

    return result


def resolve_channel_color(color: ChannelColor) -> tuple[float, float, float] | None:
    """Resolve a ChannelColor to an (r, g, b) weight tuple, or None for luminance."""
    if color.luminance:
        return None
    if color.rgb is not None:
        return color.rgb
    return hue_to_rgb_weights(color.hue)


@router.post("/generate-nchannel")
async def generate_nchannel_composite(request: NChannelCompositeRequest):
    """
    Generate an RGB composite image from N FITS channels with color mapping.

    Each channel gets a color assignment (hue or explicit RGB weights).
    Channels are stretched independently, then combined via weighted
    color mapping into a single RGB image.

    Returns:
        Binary image data with appropriate content type
    """
    try:
        n = len(request.channels)
        output_pixels = request.width * request.height
        input_budget = min(
            MAX_INPUT_PIXELS,
            max(output_pixels * PREVIEW_OVERSAMPLE, MIN_PREVIEW_PIXELS),
        )
        logger.info(
            f"Generating N-channel composite ({n} channels, "
            f"output={request.width}x{request.height}, "
            f"input_budget={input_budget:,} px)"
        )

        # Check cache
        cache_key = _cache.make_key_nchannel(
            [ch.file_paths for ch in request.channels],
            input_budget,
        )
        cached = _cache.get(cache_key)

        if cached is not None:
            logger.info("N-channel cache HIT — skipping load/mosaic/reproject")
            reprojected_channels = cached
        else:
            # Load, downscale, and optionally mosaic each channel
            raw_channels: dict[str, tuple[np.ndarray, WCS]] = {}
            for idx, ch_config in enumerate(request.channels):
                ch_name = ch_config.label or f"ch{idx}"
                local_paths = [resolve_fits_path(fp) for fp in ch_config.file_paths]
                logger.info(f"Loading channel {ch_name}: {len(local_paths)} file(s)")

                try:
                    file_data = [
                        downscale_for_composite(*load_fits_2d_with_wcs(p), max_pixels=input_budget)
                        for p in local_paths
                    ]
                except ValueError as e:
                    raise HTTPException(status_code=400, detail=str(e)) from e

                if len(file_data) == 1:
                    raw_channels[ch_name] = file_data[0]
                else:
                    try:
                        mosaic_array, _footprint, wcs_out = generate_mosaic(
                            file_data, combine_method="mean"
                        )
                        raw_channels[ch_name] = (mosaic_array, wcs_out)
                    except ValueError as e:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Failed to combine channel {ch_name} files: {e}",
                        ) from e

                logger.info(f"Channel {ch_name} shape: {raw_channels[ch_name][0].shape}")

            try:
                reprojected_channels, target_shape = reproject_channels_to_common_wcs(raw_channels)
            except ValueError as e:
                error_msg = str(e)
                if "Could not determine common WCS" in error_msg:
                    raise HTTPException(status_code=400, detail=error_msg) from e
                if "pixels" in error_msg and "max" in error_msg:
                    raise HTTPException(status_code=413, detail=error_msg) from e
                raise HTTPException(
                    status_code=500, detail=f"Composite reprojection failed: {e}"
                ) from e

            logger.info(f"Reprojected {n} channels to common WCS grid: {target_shape}")
            _cache.put(cache_key, reprojected_channels)
            logger.info("N-channel cache MISS — full pipeline completed, result cached")

        # Background neutralization (pre-stretch)
        if request.background_neutralization:
            logger.info("Applying background neutralization (pre-stretch)")
            stretch_input = neutralize_raw_backgrounds(reprojected_channels)
        else:
            stretch_input = reprojected_channels

        # Validate: at most one luminance channel
        lum_count = sum(1 for ch in request.channels if ch.color.luminance)
        if lum_count > 1:
            raise HTTPException(
                status_code=422,
                detail="At most one luminance channel is allowed per composite",
            )

        # Stretch each channel and separate into color vs luminance groups
        logger.info("Applying stretch and color mapping")
        color_mapped: list[tuple[np.ndarray, tuple[float, float, float]]] = []
        lum_data: np.ndarray | None = None
        lum_weight: float = 1.0
        ch_names = list(stretch_input.keys())

        for idx, ch_config in enumerate(request.channels):
            ch_name = ch_names[idx]
            stretched = apply_stretch(stretch_input[ch_name], ch_config)

            rgb_weights = resolve_channel_color(ch_config.color)

            if rgb_weights is None:
                # Luminance channel — apply weight as blend strength
                lum_data = stretched
                lum_weight = ch_config.weight
                logger.info(f"Channel {ch_name} assigned as luminance (blend={lum_weight})")
            else:
                # Color channel — apply per-channel weight
                if ch_config.weight != 1.0:
                    stretched = np.clip(stretched * ch_config.weight, 0, 1)
                color_mapped.append((stretched, rgb_weights))

        # Combine color channels into RGB
        if not color_mapped:
            raise HTTPException(
                status_code=422,
                detail="At least one color channel (hue or rgb) is required",
            )
        rgb_array = combine_channels_to_rgb(color_mapped)

        # Blend luminance if present
        if lum_data is not None:
            logger.info("Blending luminance channel into RGB composite")
            rgb_array = blend_luminance(rgb_array, lum_data, lum_weight)

        # Apply optional global post-stack adjustments
        if request.overall is not None:
            rgb_array = apply_overall_adjustments(rgb_array, request.overall)

        # Flip vertically for correct astronomical orientation
        rgb_array = np.flipud(rgb_array)

        # Convert to 8-bit image
        rgb_8bit = (np.clip(rgb_array, 0, 1) * 255).astype(np.uint8)
        image = Image.fromarray(rgb_8bit, mode="RGB")

        if (image.width, image.height) != (request.width, request.height):
            image = image.resize((request.width, request.height), Image.Resampling.LANCZOS)

        buf = io.BytesIO()
        if request.output_format == "jpeg":
            image.save(buf, format="JPEG", quality=request.quality)
            media_type = "image/jpeg"
        else:
            image.save(buf, format="PNG", optimize=True)
            media_type = "image/png"

        buf.seek(0)

        logger.info(
            f"N-channel composite generated: {request.width}x{request.height} "
            f"{request.output_format}, {n} channels, "
            f"size: {buf.getbuffer().nbytes} bytes"
        )

        return Response(content=buf.getvalue(), media_type=media_type)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating N-channel composite: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"N-channel composite generation failed: {str(e)}"
        ) from e
