"""
FastAPI routes for RGB composite image generation.
"""

import gc
import io
import logging
import os
import re
from pathlib import Path

import numpy as np
from astropy.stats import sigma_clipped_stats
from astropy.wcs import WCS
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from PIL import Image
from reproject import reproject_interp
from reproject.mosaicking import find_optimal_celestial_wcs
from scipy.ndimage import gaussian_filter, zoom
from scipy.ndimage import rotate as ndimage_rotate

from app.diagnostics import log_memory
from app.instruments import get_pixel_scale
from app.mosaic.mosaic_engine import (
    load_fits_2d_with_wcs,
    load_fits_wcs_shape_and_instrument,
    streaming_reproject_and_combine,
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
from app.storage.helpers import resolve_fits_path

from .auto_stretch import auto_stretch_params
from .cache import CompositeCache
from .color_mapping import (
    blend_instrument_groups,
    blend_luminance,
    combine_channels_to_rgb,
    compute_feather_weights,
    hue_to_rgb_weights,
    linear_to_srgb,
)
from .models import (
    ChannelColor,
    ChannelConfig,
    NChannelCompositeRequest,
    OverallAdjustments,
)
from .quality import compute_quality_metrics


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/composite", tags=["Composite"])

# Module-level cache persists across requests within the same worker process.
_cache = CompositeCache()

# Memory budget for reprojection grid arrays in the composite pipeline.
# Default 2 GB — empirically sized for a 4 GB container. reproject_interp
# uses significant internal memory (coordinate transforms, interpolation
# buffers) beyond the output arrays, so this must be conservative.
# Increase via env var when deploying on larger machines — quality scales linearly.
# Will become admin-configurable when the admin panel ships.
MAX_COMPOSITE_MEMORY_BYTES = int(os.environ.get("MAX_COMPOSITE_MEMORY_BYTES", str(2_000_000_000)))
BYTES_PER_PIXEL = np.dtype(np.float64).itemsize  # 8 bytes
# Max pixels per input image before downscaling for composite processing.
# The final output is at most 4096x4096 = 16M pixels, so 16M intermediates
# are more than sufficient quality. This prevents OOM when mixing instruments
# with very different pixel scales (e.g. MIRI ~4M px vs NIRCam ~123M px).
MAX_INPUT_PIXELS = int(os.environ.get("MAX_COMPOSITE_INPUT_PIXELS", "16000000"))
# Output-aware downscaling: for small preview requests we shrink the input
# budget proportionally so previews are fast while exports stay full quality.
PREVIEW_OVERSAMPLE = 4  # 4x oversampling gives good quality for the final resize
MIN_PREVIEW_PIXELS = 500_000  # floor to avoid too-tiny intermediates


_C_PREFIX_RE = re.compile(r"-c\d{4}(?=_)")


def _sort_files_by_quality(paths: list[Path]) -> list[Path]:
    """Sort FITS paths: c-prefix (pipeline mosaics) first, then o-prefix.

    Pipeline mosaics (c-prefix) are higher quality pre-combined products.
    Processing them first seeds the accumulator with better data.
    """

    def sort_key(p: Path) -> int:
        return 0 if _C_PREFIX_RE.search(p.name) else 1

    return sorted(paths, key=sort_key)


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


def _render_debug_masks(
    ch_names: list[str],
    reprojected: dict[str, np.ndarray],
    feather_masks: list[np.ndarray | None],
    request: "NChannelCompositeRequest",
) -> Response:
    """Render per-channel coverage and feather masks as a multi-panel PNG.

    Each channel gets a grayscale panel: white=covered, black=no coverage,
    gray gradient shows the feather taper zone.  Panels are arranged
    horizontally with labels.
    """
    n = len(ch_names)
    ref_shape = reprojected[ch_names[0]].shape
    h, w = ref_shape

    # Scale panels to fit within request dimensions
    panel_w = max(request.width // max(n, 1), 64)
    panel_h = int(panel_w * h / max(w, 1))
    canvas_w = panel_w * n
    canvas_h = panel_h

    canvas = Image.new("L", (canvas_w, canvas_h), 0)
    for i, ch_name in enumerate(ch_names):
        # Coverage mask: non-zero pixels
        coverage = (reprojected[ch_name] != 0).astype(np.float64)
        # Overlay feather weights if available
        if i < len(feather_masks) and feather_masks[i] is not None:
            coverage = feather_masks[i]
        panel_8bit = (np.clip(coverage, 0, 1) * 255).astype(np.uint8)
        panel_img = Image.fromarray(np.flipud(panel_8bit), mode="L")
        panel_img = panel_img.resize((panel_w, panel_h), Image.Resampling.NEAREST)
        canvas.paste(panel_img, (i * panel_w, 0))

    buf = io.BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    buf.seek(0)

    label_header = ",".join(ch_names)
    return Response(
        content=buf.getvalue(),
        media_type="image/png",
        headers={"X-Debug-Channels": label_header},
    )


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

        # Detect instrument per channel (lightweight header read).
        # Needed for instrument-aware auto-stretch and resolution blur,
        # even on cache hits where we skip the full WCS collection.
        # Gracefully defaults to None if the file can't be resolved or read
        # (e.g. during tests with mock caches and synthetic file paths).
        channel_instruments: list[str | None] = []
        for ch_config in request.channels:
            try:
                first_path = resolve_fits_path(ch_config.file_paths[0])
                _, _, _, instrument = load_fits_wcs_shape_and_instrument(first_path)
                channel_instruments.append(instrument)
            except Exception:
                channel_instruments.append(None)

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
            # Resolve all file paths and channel names upfront
            all_channel_info: list[tuple[str, list[Path]]] = []
            for idx, ch_config in enumerate(request.channels):
                ch_name = ch_config.label or f"ch{idx}"
                local_paths = _sort_files_by_quality(
                    [resolve_fits_path(fp) for fp in ch_config.file_paths]
                )
                all_channel_info.append((ch_name, local_paths))
                logger.info(f"Channel {ch_name}: {len(local_paths)} file(s)")

            # Collect WCS headers from ALL files across ALL channels (lightweight,
            # no pixel data) to compute a single output grid covering everything.
            all_wcs_entries: list[tuple[tuple[int, int], WCS]] = []
            for _ch_name, local_paths in all_channel_info:
                for p in local_paths:
                    try:
                        wcs, h, w, _inst = load_fits_wcs_shape_and_instrument(p)
                        all_wcs_entries.append(((h, w), wcs))
                    except ValueError as e:
                        logger.warning(f"Skipping WCS for {p}: {e}")

            if not all_wcs_entries:
                raise HTTPException(status_code=400, detail="No usable WCS data in any channel")

            # Compute the single output grid covering all channels
            try:
                wcs_out, shape_out = find_optimal_celestial_wcs(all_wcs_entries)
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not determine common WCS for channels: {e}",
                ) from e

            # Downscale output grid if total channel memory exceeds budget.
            # Peak memory during reproject_interp for ONE channel:
            #   - output array (1 × grid pixels × 8 B)
            #   - footprint array (1 × grid pixels × 8 B)
            #   - 2 coordinate transform arrays for pixel mapping (2 × grid pixels × 8 B)
            #   - input data array (~input_budget pixels × 8 B)
            # Plus all previously-reprojected channel arrays stay in memory.
            # Plus stretch/combine phase needs ~3 more grid-sized arrays.
            # Total peak: N stored channels + 4 reproject working + 1 input ≈ (N + 5) arrays.
            # 500 MB overhead covers process baseline, numpy fragmentation, input data.
            OVERHEAD_BYTES = 500_000_000
            total_out_pixels = shape_out[0] * shape_out[1]
            available_for_grids = max(MAX_COMPOSITE_MEMORY_BYTES - OVERHEAD_BYTES, 100_000_000)
            effective_arrays = n + 5  # N channels + output + footprint + 2 coords + headroom
            max_pixels_per_channel = available_for_grids // (effective_arrays * BYTES_PER_PIXEL)
            est_memory_mb = effective_arrays * total_out_pixels * BYTES_PER_PIXEL / (
                1024 * 1024
            ) + OVERHEAD_BYTES / (1024 * 1024)
            logger.info(
                f"MEMORY BUDGET: {effective_arrays} arrays ({n} ch + 5 work) × "
                f"{total_out_pixels:,} px × {BYTES_PER_PIXEL} B = {est_memory_mb:.0f} MB "
                f"(limit: {MAX_COMPOSITE_MEMORY_BYTES / 1e6:.0f} MB, "
                f"max {max_pixels_per_channel:,} px/channel)"
            )
            if total_out_pixels > max_pixels_per_channel:
                factor = (max_pixels_per_channel / total_out_pixels) ** 0.5
                shape_out = (int(shape_out[0] * factor), int(shape_out[1] * factor))
                wcs_out.wcs.cdelt /= factor
                wcs_out.wcs.crpix *= factor
                total_out_pixels = shape_out[0] * shape_out[1]
                new_est_mb = n * total_out_pixels * BYTES_PER_PIXEL / (1024 * 1024)
                logger.info(
                    f"Output grid DOWNSCALED to {shape_out[1]}x{shape_out[0]} "
                    f"({total_out_pixels:,} px/channel, {new_est_mb:.0f} MB total)"
                )

            logger.info(
                f"Common output grid: {shape_out[1]}x{shape_out[0]} "
                f"({total_out_pixels:,} px) for {n} channels"
            )

            # Reproject each channel directly onto the final grid
            reprojected_channels: dict[str, np.ndarray] = {}
            for ch_name, local_paths in all_channel_info:
                n_files = len(local_paths)
                per_file_budget = max(input_budget // max(n_files, 1), MIN_PREVIEW_PIXELS)

                if n_files == 1:
                    # Single file: load, downscale, reproject to final grid
                    try:
                        data, file_wcs = downscale_for_composite(
                            *load_fits_2d_with_wcs(local_paths[0]),
                            max_pixels=per_file_budget,
                        )
                    except ValueError as e:
                        raise HTTPException(
                            status_code=400,
                            detail=f"No usable image data for channel {ch_name}: {e}",
                        ) from e

                    data[data == 0.0] = np.nan
                    reprojected, footprint = reproject_interp(
                        (data, file_wcs), wcs_out, shape_out=shape_out
                    )
                    reprojected = np.nan_to_num(reprojected, nan=0.0, posinf=0.0, neginf=0.0)
                    reprojected[footprint == 0] = 0.0
                    reprojected_channels[ch_name] = reprojected
                    del data, footprint
                    gc.collect()
                else:
                    # Multi-file: streaming reproject directly onto final grid.
                    # No MAX_MOSAIC_FILES cap — streaming uses O(1) tile memory.
                    def _make_load_fn(budget: int):
                        def load_fn(p: Path) -> tuple[np.ndarray, WCS]:
                            return downscale_for_composite(
                                *load_fits_2d_with_wcs(p), max_pixels=budget
                            )

                        return load_fn

                    try:
                        channel_data = streaming_reproject_and_combine(
                            file_paths=local_paths,
                            wcs_out=wcs_out,
                            shape_out=shape_out,
                            load_fn=_make_load_fn(per_file_budget),
                            background_match=request.background_neutralization,
                        )
                    except Exception as e:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Failed to combine channel {ch_name}: {e}",
                        ) from e

                    reprojected_channels[ch_name] = channel_data

                logger.info(f"Channel {ch_name} shape: {reprojected_channels[ch_name].shape}")
                log_memory(f"after-channel-{ch_name}")

            log_memory("after-all-channels")
            logger.info(f"All {n} channels reprojected to common grid: {shape_out}")

            # Resolution blur for mixed-instrument composites.
            # When instruments with different pixel scales are combined on the
            # same fine grid, coarser instruments (MIRI) get upsampled — the
            # interpolation creates artificially smooth data that looks blurry
            # and amplifies noise when stretched.  Applying a Gaussian blur
            # matching the pixel scale ratio makes the resolution difference
            # honest rather than an artifact of upsampling.
            unique_instruments = {i for i in channel_instruments if i is not None}
            if len(unique_instruments) > 1:
                ch_wavelengths = [ch_config.wavelength_um for ch_config in request.channels]
                # Per-channel pixel scales (including defaults for None instruments).
                # Used for resolution blur per channel and auto-feather computation.
                pixel_scales = [
                    get_pixel_scale(inst, wl)
                    for inst, wl in zip(channel_instruments, ch_wavelengths, strict=False)
                ]
                # Filter to only known instruments for accurate ratio computation
                known_scales = [
                    s
                    for s, inst in zip(pixel_scales, channel_instruments, strict=False)
                    if inst is not None
                ]
                finest_scale = min(known_scales)
                logger.info(
                    f"Mixed instruments detected: {unique_instruments}, "
                    f'finest pixel scale: {finest_scale:.3f}"/px'
                )
                ch_names_list = list(reprojected_channels.keys())
                for idx, ch_name in enumerate(ch_names_list):
                    ch_scale = pixel_scales[idx]
                    ratio = ch_scale / finest_scale
                    if ratio > 1.5:
                        sigma = ratio
                        logger.info(
                            f"Applying resolution blur to {ch_name}: "
                            f'scale={ch_scale:.3f}"/px, ratio={ratio:.1f}x, sigma={sigma:.1f}'
                        )
                        channel_data = reprojected_channels[ch_name]
                        zero_mask = channel_data == 0
                        blurred = gaussian_filter(channel_data, sigma=sigma)
                        blurred[zero_mask] = 0.0  # Preserve coverage boundary
                        reprojected_channels[ch_name] = blurred

            _cache.put(cache_key, reprojected_channels, channel_paths)
            logger.info("N-channel cache MISS — full pipeline completed, result cached")

        # Resolve effective feather strength.
        # None (default) = auto-decide based on instrument mix.
        # 0 = user explicitly disabled feathering.
        # >0 = user explicitly set a value.
        unique_instruments = {i for i in channel_instruments if i is not None}
        is_multi_instrument = len(unique_instruments) > 1
        auto_feathered = False

        if request.feather_strength is not None:
            effective_feather = request.feather_strength
        elif is_multi_instrument:
            # Adaptive: scale strength by pixel scale ratio between instruments.
            # Only use known-instrument scales to avoid default-scale distortion.
            ch_wavelengths = [ch.wavelength_um for ch in request.channels]
            known_scales = [
                get_pixel_scale(inst, wl)
                for inst, wl in zip(channel_instruments, ch_wavelengths, strict=False)
                if inst is not None
            ]
            scale_ratio = max(known_scales) / min(known_scales)
            effective_feather = min(0.3, 0.05 * scale_ratio)
            auto_feathered = True
            logger.info(
                f"Auto-feathering enabled: scale_ratio={scale_ratio:.2f}, "
                f"effective_feather={effective_feather:.3f}"
            )
        else:
            effective_feather = 0.0

        # Cross-channel background neutralization (pre-stretch).
        # For multi-file channels that used per-tile matching in streaming,
        # this second pass is a safety net — medians should be near 0.
        if request.background_neutralization:
            logger.info("Applying cross-channel background neutralization (pre-stretch)")
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
        color_ch_instruments: list[str | None] = []
        lum_data: np.ndarray | None = None
        lum_weight: float = 1.0
        ch_names = list(stretch_input.keys())

        # Auto-stretch: compute optimal params from data statistics.
        # Mutates ch_config fields directly — safe because validate_assignment is off
        # (Pydantic v2 default) and the stretch loop below consumes these same configs.
        for idx, ch_config in enumerate(request.channels):
            if ch_config.auto_stretch:
                ch_name = ch_names[idx]
                computed = auto_stretch_params(
                    stretch_input[ch_name],
                    instrument=channel_instruments[idx] if idx < len(channel_instruments) else None,
                )
                ch_config.stretch = computed["stretch"]
                ch_config.asinh_a = computed["asinh_a"]
                ch_config.black_point = computed["black_point"]
                ch_config.white_point = computed["white_point"]
                ch_config.gamma = computed["gamma"]
                ch_config.curve = computed["curve"]
                logger.info(f"Auto-stretch {ch_name}: {computed}")

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
                color_ch_instruments.append(
                    channel_instruments[idx] if idx < len(channel_instruments) else None
                )

        # Combine color channels into RGB
        if not color_mapped:
            raise HTTPException(
                status_code=422,
                detail="At least one color channel (hue or rgb) is required",
            )

        # Instrument-level blending for multi-instrument composites.
        # Groups channels by instrument, produces per-group RGB, then blends
        # with feathered instrument-level coverage masks.  This prevents the
        # color palette shift at instrument FOV boundaries that per-channel
        # feathering cannot fix (all channels from one instrument share the
        # same footprint and fade identically).
        #
        # For single-instrument composites this is a no-op — delegates
        # directly to combine_channels_to_rgb.
        unique_color_instruments = {i for i in color_ch_instruments if i is not None}
        use_instrument_blending = (
            is_multi_instrument
            and len(unique_color_instruments) > 1
            and effective_feather > 0
            and len(color_mapped) > 1
        )

        # Per-channel feathering (legacy path): used for single-instrument
        # composites or when instrument blending is not applicable.
        per_channel_masks: list[np.ndarray | None] = []
        if not use_instrument_blending and effective_feather > 0 and len(color_mapped) > 1:
            for ch_name in color_ch_names:
                ch_data = reprojected_channels[ch_name]
                coverage = (ch_data != 0).sum() / ch_data.size
                mask = compute_feather_weights(
                    ch_data,
                    fraction=effective_feather,
                    coverage_fraction=coverage,
                )
                per_channel_masks.append(mask)
        else:
            per_channel_masks = [None] * len(color_mapped)

        # Debug masks: return per-channel coverage visualization instead of
        # the composite image.  Each channel becomes a grayscale panel showing
        # white=covered, black=no coverage, gray gradient=feather zone.
        if request.debug_masks:
            response = _render_debug_masks(
                color_ch_names, reprojected_channels, per_channel_masks, request
            )
            if use_instrument_blending:
                response.headers["X-Debug-Warning"] = (
                    "instrument-blending-active: per-channel masks shown but "
                    "actual compositing uses instrument-level blended masks"
                )
            return response

        # When luminance blending is needed, keep RGB in linear space so
        # that blend_luminance mixes linear luminance with linear color.
        # Gamma is applied after luminance blending (or immediately if no lum).
        needs_lum = lum_data is not None
        defer_gamma = needs_lum

        if use_instrument_blending:
            logger.info(
                f"Using instrument-level blending for {len(unique_color_instruments)} "
                f"instrument groups ({', '.join(sorted(unique_color_instruments))})"
            )
            rgb_array = blend_instrument_groups(
                channels=color_mapped,
                instruments=color_ch_instruments,
                reprojected=reprojected_channels,
                ch_names=color_ch_names,
                feather_fraction=effective_feather,
                _apply_gamma=not defer_gamma,
            )
        else:
            # Single-instrument or no feathering: use per-channel masks
            effective_masks: list[np.ndarray] | None = None
            if any(m is not None for m in per_channel_masks):
                ref_shape = color_mapped[0][0].shape
                effective_masks = [
                    m if m is not None else np.ones(ref_shape, dtype=np.float64)
                    for m in per_channel_masks
                ]
            rgb_array = combine_channels_to_rgb(
                color_mapped,
                coverage_masks=effective_masks,
                _apply_gamma=not defer_gamma,
            )
        log_memory("after-combine-rgb")

        # Blend luminance if present (both rgb_array and lum_data are linear)
        if needs_lum:
            logger.info("Blending luminance channel into RGB composite")
            rgb_array = blend_luminance(rgb_array, lum_data, lum_weight)
            rgb_array = linear_to_srgb(rgb_array)

        # Apply optional global post-stack adjustments
        if request.overall is not None:
            rgb_array = apply_overall_adjustments(rgb_array, request.overall)

        # Flip vertically for correct astronomical orientation
        rgb_array = np.flipud(rgb_array)

        # Auto-crop black borders from WCS reprojection padding.
        # The reprojected grid is aligned to celestial North, so rotated
        # detector data leaves black triangular corners that waste space.
        rgb_array = _auto_crop(rgb_array)

        # Compute quality metrics before rotation (which adds black borders)
        quality = compute_quality_metrics(rgb_array)

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

        # Release large intermediates before returning — prevents memory
        # buildup across back-to-back requests (e.g. walkthrough batch).
        del stretch_input, color_mapped, rgb_array, rgb_8bit, image
        gc.collect()
        log_memory("composite-done")

        quality_headers = {
            "X-Quality-Score": str(quality["quality_score"]),
            "X-Quality-SNR": str(quality["snr"]),
            "X-Quality-Balance": str(quality["channel_balance"]),
            "X-Quality-Spread": str(quality["histogram_spread"]),
            "X-Quality-Coverage": str(quality["coverage_fraction"]),
            # Diagnostic headers for auto-feather decisions (debugging/logging only)
            "X-Composite-Auto-Feather": str(auto_feathered).lower(),
            "X-Composite-Feather-Strength": f"{effective_feather:.3f}",
        }
        return Response(content=buf.getvalue(), media_type=media_type, headers=quality_headers)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating N-channel composite: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"N-channel composite generation failed: {str(e)}"
        ) from e
