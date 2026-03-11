"""
FastAPI routes for RGB composite image generation.
"""

import gc
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
from scipy.ndimage import rotate as ndimage_rotate
from scipy.ndimage import zoom

from app.diagnostics import log_memory
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
from .color_mapping import (
    blend_luminance,
    combine_channels_to_rgb,
    compute_feather_weights,
    hue_to_rgb_weights,
)
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


def _auto_crop(rgb: np.ndarray, threshold: float = 0.005) -> np.ndarray:
    """Crop black borders from an RGB float array.

    Finds the bounding box of pixels where any channel exceeds the
    threshold and returns the cropped region.  Falls back to the
    original array if no non-black pixels are found.
    """
    mask = np.any(rgb > threshold, axis=2)
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)

    if not rows.any() or not cols.any():
        return rgb

    r_min, r_max = np.where(rows)[0][[0, -1]]
    c_min, c_max = np.where(cols)[0][[0, -1]]

    cropped = rgb[r_min : r_max + 1, c_min : c_max + 1]
    if cropped.shape != rgb.shape:
        logger.info(
            f"Auto-crop: {rgb.shape[1]}x{rgb.shape[0]} → {cropped.shape[1]}x{cropped.shape[0]}"
        )
    return cropped


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
    num_channels = len(channels)
    total_reproject_budget = total_pixels * num_channels

    # Adaptive downscaling: treat max_reproject_pixels as a total budget
    # across all channels. For 3 channels each gets ~21M px (full quality);
    # for 8 channels each gets ~8M px (automatically reduced). The final
    # output is resized to request dimensions anyway, so quality loss is minimal.
    if total_reproject_budget > max_reproject_pixels:
        target_per_channel = max_reproject_pixels // num_channels
        factor = (target_per_channel / total_pixels) ** 0.5
        shape_out = (int(shape_out[0] * factor), int(shape_out[1] * factor))
        wcs_out.wcs.cdelt /= factor
        wcs_out.wcs.crpix *= factor
        total_pixels = shape_out[0] * shape_out[1]
        logger.info(
            f"Downscaled output grid to {shape_out[1]}x{shape_out[0]} "
            f"for {num_channels} channels (budget: {max_reproject_pixels:,} px total)"
        )

    est_mb = num_channels * total_pixels * 8 / (1024 * 1024)
    logger.info(
        f"Reprojecting {num_channels} channels to "
        f"{shape_out[1]}x{shape_out[0]} (est. {est_mb:.0f} MB)"
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
        del footprint
        gc.collect()

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
def generate_nchannel_composite(request: NChannelCompositeRequest):
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
        log_memory("composite-start")
        logger.info(
            f"Generating N-channel composite ({n} channels, "
            f"output={request.width}x{request.height}, "
            f"input_budget={input_budget:,} px)"
        )

        # Check cache — exact budget first, then any budget as fallback
        channel_paths = [ch.file_paths for ch in request.channels]
        cache_key = _cache.make_key_nchannel(channel_paths, input_budget)
        cached = _cache.get(cache_key)

        if cached is not None:
            logger.info("N-channel cache HIT — skipping load/mosaic/reproject")
            reprojected_channels = cached
        elif (fallback := _cache.get_any_budget(channel_paths)) is not None:
            logger.info("N-channel cache HIT (different budget) — reusing cached data")
            reprojected_channels = fallback
        else:
            # Load, downscale, and optionally mosaic each channel
            raw_channels: dict[str, tuple[np.ndarray, WCS]] = {}
            for idx, ch_config in enumerate(request.channels):
                ch_name = ch_config.label or f"ch{idx}"
                local_paths = [resolve_fits_path(fp) for fp in ch_config.file_paths]
                logger.info(f"Loading channel {ch_name}: {len(local_paths)} file(s)")

                # Scale per-file budget by file count to cap total memory.
                # With 158 files at 16M px each, raw arrays alone would need ~19 GB.
                # Dividing by file count keeps total pre-mosaic memory bounded.
                n_files = len(local_paths)
                per_file_budget = max(input_budget // max(n_files, 1), MIN_PREVIEW_PIXELS)
                if n_files > 1:
                    logger.info(
                        f"Channel {ch_name}: {n_files} files, "
                        f"per-file budget={per_file_budget:,} px "
                        f"(total budget={input_budget:,} px)"
                    )

                file_data = []
                for p in local_paths:
                    try:
                        file_data.append(
                            downscale_for_composite(
                                *load_fits_2d_with_wcs(p), max_pixels=per_file_budget
                            )
                        )
                    except ValueError as e:
                        logger.warning(f"Skipping non-image file {p}: {e}")

                if not file_data:
                    raise HTTPException(
                        status_code=400,
                        detail=f"No usable image data for channel {ch_name}",
                    )

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
                log_memory(f"after-load-{ch_name}")

            log_memory("before-reproject")
            try:
                reprojected_channels, target_shape = reproject_channels_to_common_wcs(raw_channels)
            except ValueError as e:
                error_msg = str(e)
                if "Could not determine common WCS" in error_msg:
                    raise HTTPException(status_code=400, detail=error_msg) from e
                raise HTTPException(
                    status_code=500, detail=f"Composite reprojection failed: {e}"
                ) from e

            del raw_channels
            gc.collect()

            log_memory("after-reproject-gc")
            logger.info(f"Reprojected {n} channels to common WCS grid: {target_shape}")
            _cache.put(cache_key, reprojected_channels, channel_paths)
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
        color_ch_names: list[str] = []
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
                color_ch_names.append(ch_name)

        # Combine color channels into RGB
        if not color_mapped:
            raise HTTPException(
                status_code=422,
                detail="At least one color channel (hue or rgb) is required",
            )

        # Compute feather weights from the COMPOSITE boundary (union of all
        # channel coverages) rather than per-channel.  Per-channel feathering
        # causes color fringing when same-instrument channels have slightly
        # different FOV boundaries.
        composite_feather_mask: np.ndarray | None = None
        if request.feather_strength > 0 and len(color_mapped) > 1:
            ref_shape = color_mapped[0][0].shape
            union_coverage = np.zeros(ref_shape, dtype=bool)
            for ch_name in color_ch_names:
                union_coverage |= reprojected_channels[ch_name] != 0
            composite_feather_mask = compute_feather_weights(
                union_coverage.astype(np.float64),
                fraction=request.feather_strength,
            )

        if composite_feather_mask is not None:
            masks = [composite_feather_mask] * len(color_mapped)
            rgb_array = combine_channels_to_rgb(color_mapped, coverage_masks=masks)
        else:
            rgb_array = combine_channels_to_rgb(color_mapped)
        log_memory("after-combine-rgb")

        # Blend luminance if present
        if lum_data is not None:
            logger.info("Blending luminance channel into RGB composite")
            rgb_array = blend_luminance(rgb_array, lum_data, lum_weight)

        # Apply optional global post-stack adjustments
        if request.overall is not None:
            rgb_array = apply_overall_adjustments(rgb_array, request.overall)

        # Flip vertically for correct astronomical orientation
        rgb_array = np.flipud(rgb_array)

        # Auto-crop black borders from WCS reprojection padding.
        # The reprojected grid is aligned to celestial North, so rotated
        # detector data leaves black triangular corners that waste space.
        rgb_array = _auto_crop(rgb_array)

        # Apply rotation if requested (before 8-bit conversion for quality)
        if abs(request.rotation_degrees) > 0.01:
            # Negate: CSS rotate is CW-positive, scipy is CCW-positive
            rgb_array = ndimage_rotate(
                rgb_array,
                -request.rotation_degrees,
                axes=(0, 1),
                reshape=True,
                order=1,
                cval=0.0,
            )

        # Convert to 8-bit image
        rgb_8bit = (np.clip(rgb_array, 0, 1) * 255).astype(np.uint8)
        image = Image.fromarray(rgb_8bit, mode="RGB")

        # Scale + zoom/pan + place on exact-dimension canvas
        target_w, target_h = request.width, request.height
        base_scale = min(target_w / image.width, target_h / image.height)
        effective_scale = base_scale * request.crop_zoom
        scaled_w = max(1, round(image.width * effective_scale))
        scaled_h = max(1, round(image.height * effective_scale))

        if (scaled_w, scaled_h) != (image.width, image.height):
            image = image.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)

        # Create black canvas at exact target dimensions
        canvas = Image.new("RGB", (target_w, target_h), (0, 0, 0))

        # Compute paste offset from zoom + pan (crop_center_x/y)
        if scaled_w > target_w:
            x_offset = -int(request.crop_center_x * (scaled_w - target_w))
        else:
            x_offset = (target_w - scaled_w) // 2

        if scaled_h > target_h:
            y_offset = -int(request.crop_center_y * (scaled_h - target_h))
        else:
            y_offset = (target_h - scaled_h) // 2

        canvas.paste(image, (x_offset, y_offset))
        image = canvas

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
