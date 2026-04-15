"""
FastAPI routes for RGB composite image generation.
"""

import gc
import io
import logging
import os
import re
from dataclasses import dataclass, field
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
from app.processing.filters import astropy_gaussian_filter
from app.storage.helpers import resolve_fits_path

from .auto_stretch import auto_stretch_params
from .cache import CompositeCache
from .color_mapping import (
    apply_saturation_vibrancy,
    blend_instrument_groups,
    blend_luminance,
    combine_channels_to_rgb,
    hue_to_rgb_weights,
    linear_to_srgb,
)
from .models import (
    ChannelColor,
    ChannelConfig,
    NChannelCompositeRequest,
    NChannelConfig,
    OverallAdjustments,
    SharpeningConfig,
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
MAX_COMPOSITE_MEMORY_BYTES = int(os.environ.get("MAX_COMPOSITE_MEMORY_BYTES", str(3_000_000_000)))
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


@dataclass
class StretchResult:
    """Output of the stretch-and-map phase, separating color and luminance channels."""

    color_mapped: list[tuple[np.ndarray, tuple[float, float, float]]] = field(default_factory=list)
    color_ch_names: list[str] = field(default_factory=list)
    color_ch_instruments: list[str | None] = field(default_factory=list)
    lum_data: np.ndarray | None = None
    lum_weight: float = 1.0


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

    row_indices = np.where(rows)[0]
    col_indices = np.where(cols)[0]
    if len(row_indices) == 0 or len(col_indices) == 0:
        return rgb

    r_min, r_max = row_indices[0], row_indices[-1]
    c_min, c_max = col_indices[0], col_indices[-1]

    cropped = rgb[r_min : r_max + 1, c_min : c_max + 1]
    if cropped.shape != rgb.shape:
        logger.info(
            f"Auto-crop: {rgb.shape[1]}x{rgb.shape[0]} → {cropped.shape[1]}x{cropped.shape[0]}"
        )
    return cropped


def _render_debug_masks(
    ch_names: list[str],
    reprojected: dict[str, np.ndarray],
    request: "NChannelCompositeRequest",
) -> Response:
    """Render per-channel coverage masks as a multi-panel PNG.

    Each channel gets a grayscale panel: white=covered, black=no coverage.
    Panels are arranged horizontally with labels.
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
        coverage = (reprojected[ch_name] != 0).astype(np.float64)
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

    Raises:
        ValueError: If max_pixels <= 0 or data is not 2D.
    """
    if max_pixels <= 0:
        raise ValueError(f"max_pixels must be positive, got {max_pixels}")
    if data.ndim != 2:
        raise ValueError(f"Expected 2D array, got shape {data.shape}")
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
    except (ValueError, RuntimeError) as e:
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


def apply_sharpening(
    rgb_array: np.ndarray,
    config: SharpeningConfig,
    coverage_mask: np.ndarray | None = None,
) -> np.ndarray:
    """
    Apply unsharp masking to an RGB composite using luma-weighted detail.

    Computes Rec.709 luma (0.2126/0.7152/0.0722) on the gamma-encoded sRGB
    RGB array, blurs it with a Gaussian kernel, and applies the
    ``amount * (orig - blurred)`` delta back to every channel. These are the
    linear-space BT.709 coefficients applied to gamma-encoded data — a
    widely-used approximation (Photoshop, GIMP) that preserves color
    balance and avoids the chroma noise that per-R/G/B sharpening causes.

    Pixels whose absolute luma delta falls below ``threshold`` are left
    untouched, which protects the noise floor from being sharpened along
    with real detail. When ``coverage_mask`` is supplied, pixels outside
    the reprojection footprint are left untouched so sharpening halos
    don't bleed past the image border — dark-sky pixels *inside* the
    footprint (which can legitimately be (0,0,0) after background
    neutralization + stretch) still receive the sharpening delta.

    Args:
        rgb_array: RGB array [H, W, 3] in [0, 1].
        config: Sharpening parameters (radius, amount, threshold).
        coverage_mask: Optional 2D bool array marking in-footprint pixels.
            If ``None``, falls back to "any channel > 0", which is safe for
            single-instrument composites without background neutralization
            but less accurate for the typical pipeline path.

    Returns:
        Sharpened RGB array [H, W, 3] clipped to [0, 1]. If ``amount`` is 0,
        returns the input unchanged.
    """
    if config.amount <= 0.0:
        return rgb_array

    logger.debug(
        f"Applying unsharp mask: radius={config.radius}, "
        f"amount={config.amount}, threshold={config.threshold}"
    )

    # Rec.709 luma on gamma-encoded sRGB — the common unsharp-mask approximation.
    luminance = 0.2126 * rgb_array[..., 0] + 0.7152 * rgb_array[..., 1] + 0.0722 * rgb_array[..., 2]

    blurred = astropy_gaussian_filter(luminance, sigma=config.radius)
    delta = luminance - blurred

    if config.threshold > 0.0:
        # Zero out sub-threshold deltas so noise isn't amplified.
        delta[np.abs(delta) < config.threshold] = 0.0

    if coverage_mask is None:
        coverage_mask = np.any(rgb_array > 0.0, axis=-1)
    delta = delta * coverage_mask

    sharpened = rgb_array + config.amount * delta[..., np.newaxis]
    return np.clip(sharpened, 0.0, 1.0)


def _build_coverage_mask(reprojected: dict[str, np.ndarray]) -> np.ndarray:
    """Union of per-channel coverage masks from raw reprojected data.

    A pixel is considered covered if any channel has a non-zero raw value
    at that location. Reprojection fills no-coverage pixels with exactly
    zero, so this distinguishes in-footprint dark-sky pixels (which may
    also be zero after background neutralization) from true no-coverage
    borders because at least one channel's raw data is non-zero in the
    former case.
    """
    mask: np.ndarray | None = None
    for data in reprojected.values():
        ch_mask = data != 0
        mask = ch_mask if mask is None else (mask | ch_mask)
    assert mask is not None, "reprojected must contain at least one channel"
    return mask


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


def _detect_channel_instruments(
    channels: list[NChannelConfig],
) -> list[str | None]:
    """Detect the instrument for each channel via lightweight header reads.

    Needed for instrument-aware auto-stretch and resolution blur,
    even on cache hits where we skip the full WCS collection.
    Gracefully defaults to None if the file can't be resolved or read
    (e.g. during tests with mock caches and synthetic file paths).

    Args:
        channels: Channel configurations from the request.

    Returns:
        List of instrument names (e.g. "NIRCAM", "MIRI") or None per channel.
    """
    instruments: list[str | None] = []
    for ch_config in channels:
        try:
            first_path = resolve_fits_path(ch_config.file_paths[0])
            _, _, _, instrument = load_fits_wcs_shape_and_instrument(first_path)
            instruments.append(instrument)
        except (ValueError, OSError, HTTPException):
            instruments.append(None)
    return instruments


def _reproject_all_channels(
    request: NChannelCompositeRequest,
    channel_instruments: list[str | None],
    input_budget: int,
) -> dict[str, np.ndarray]:
    """Reproject all channels onto a common WCS grid.

    Resolves file paths, collects WCS headers, computes a memory-aware
    output grid, and reprojects each channel (single-file or streaming
    multi-file) onto it.

    Args:
        request: The composite request with channel configurations.
        channel_instruments: Per-channel instrument names (for memory budget).
        input_budget: Max pixels per input image before downscaling.

    Returns:
        Dict mapping channel name to 2D reprojected float64 array.
    """
    n = len(request.channels)

    # Resolve all file paths and channel names upfront
    all_channel_info: list[tuple[str, list[Path]]] = []
    for idx, ch_config in enumerate(request.channels):
        ch_name = ch_config.label or f"ch{idx}"
        local_paths = _sort_files_by_quality([resolve_fits_path(fp) for fp in ch_config.file_paths])
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
            detail="Could not determine common WCS for channels. Verify all files have valid WCS headers.",
        ) from e

    # Downscale output grid if total channel memory exceeds budget.
    # Peak memory model (2D float64 arrays, each = grid_pixels × 8 B):
    #   N stored channel arrays (reprojected, kept until combine)
    #   4 reproject working arrays (output, footprint, 2 coord transforms)
    #   1 input data array
    #   3 RGB result arrays (combine_channels_to_rgb → [H,W,3])
    #   3 base_rgb arrays (instrument blending → [H,W,3])
    #   ~1 headroom for temporaries
    # 500 MB overhead covers process baseline + numpy fragmentation.
    OVERHEAD_BYTES = 500_000_000
    total_out_pixels = shape_out[0] * shape_out[1]
    available_for_grids = max(MAX_COMPOSITE_MEMORY_BYTES - OVERHEAD_BYTES, 100_000_000)
    effective_arrays = n + 12  # N channels + 4 reproject + 1 input + 6 blend + 1 headroom
    max_pixels_per_channel = available_for_grids // (effective_arrays * BYTES_PER_PIXEL)
    est_memory_mb = effective_arrays * total_out_pixels * BYTES_PER_PIXEL / (
        1024 * 1024
    ) + OVERHEAD_BYTES / (1024 * 1024)
    logger.info(
        f"MEMORY BUDGET: {effective_arrays} arrays ({n} ch + {effective_arrays - n} work) × "
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
                    detail=f"No usable image data for channel {ch_name}.",
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
                    return downscale_for_composite(*load_fits_2d_with_wcs(p), max_pixels=budget)

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
                    detail=f"Failed to combine channel {ch_name}. The input files may be incompatible.",
                ) from e

            reprojected_channels[ch_name] = channel_data

        logger.info(f"Channel {ch_name} shape: {reprojected_channels[ch_name].shape}")
        log_memory(f"after-channel-{ch_name}")

    log_memory("after-all-channels")
    logger.info(f"All {n} channels reprojected to common grid: {shape_out}")
    return reprojected_channels


def _apply_resolution_blur(
    reprojected: dict[str, np.ndarray],
    channel_instruments: list[str | None],
    request: NChannelCompositeRequest,
) -> None:
    """Apply Gaussian blur to coarser-resolution channels in mixed-instrument composites.

    When instruments with different pixel scales are combined on the
    same fine grid, coarser instruments (MIRI) get upsampled — the
    interpolation creates artificially smooth data that looks blurry
    and amplifies noise when stretched.  Applying a Gaussian blur
    matching the pixel scale ratio makes the resolution difference
    honest rather than an artifact of upsampling.

    Mutates ``reprojected`` in place — blurred channels replace originals.

    Args:
        reprojected: Dict mapping channel name to reprojected 2D data.
        channel_instruments: Per-channel instrument names.
        request: The composite request (for wavelength metadata).
    """
    unique_instruments = {i for i in channel_instruments if i is not None}
    if len(unique_instruments) <= 1:
        return

    ch_wavelengths = [ch_config.wavelength_um for ch_config in request.channels]
    pixel_scales = [
        get_pixel_scale(inst, wl)
        for inst, wl in zip(channel_instruments, ch_wavelengths, strict=False)
    ]
    known_scales = [
        s for s, inst in zip(pixel_scales, channel_instruments, strict=False) if inst is not None
    ]
    finest_scale = min(known_scales)
    logger.info(
        f"Mixed instruments detected: {unique_instruments}, "
        f'finest pixel scale: {finest_scale:.3f}"/px'
    )

    ch_names_list = list(reprojected.keys())
    for idx, ch_name in enumerate(ch_names_list):
        ch_scale = pixel_scales[idx]
        ratio = ch_scale / finest_scale
        if ratio > 1.5:
            sigma = ratio
            logger.info(
                f"Applying resolution blur to {ch_name}: "
                f'scale={ch_scale:.3f}"/px, ratio={ratio:.1f}x, sigma={sigma:.1f}'
            )
            channel_data = reprojected[ch_name]
            zero_mask = channel_data == 0
            blurred = gaussian_filter(channel_data, sigma=sigma)
            blurred[zero_mask] = 0.0  # Preserve coverage boundary
            reprojected[ch_name] = blurred


def _load_reprojected_channels(
    request: NChannelCompositeRequest,
    channel_instruments: list[str | None],
    input_budget: int,
) -> dict[str, np.ndarray]:
    """Load reprojected channel data from cache, or compute via full pipeline.

    Cache check order: exact budget match → any-budget fallback → full reproject.
    On cache miss, reprojects all channels, applies resolution blur for
    mixed-instrument composites, and stores the result.

    Args:
        request: The composite request.
        channel_instruments: Per-channel instrument names.
        input_budget: Max pixels per input image before downscaling.

    Returns:
        Dict mapping channel name to 2D reprojected float64 array.
    """
    channel_paths = [ch.file_paths for ch in request.channels]
    cache_key = _cache.make_key_nchannel(channel_paths, input_budget)

    cached = _cache.get(cache_key)
    if cached is not None:
        logger.info("N-channel cache HIT — skipping load/mosaic/reproject")
        return cached

    fallback = _cache.get_any_budget(channel_paths)
    if fallback is not None:
        logger.info("N-channel cache HIT (different budget) — reusing cached data")
        return fallback

    reprojected = _reproject_all_channels(request, channel_instruments, input_budget)
    _apply_resolution_blur(reprojected, channel_instruments, request)
    _cache.put(cache_key, reprojected, channel_paths)
    logger.info("N-channel cache MISS — full pipeline completed, result cached")
    return reprojected


def _resolve_feather_strength(
    request: NChannelCompositeRequest,
    channel_instruments: list[str | None],
) -> tuple[float, bool]:
    """Determine the effective feather strength for this composite.

    None (default) = auto-decide based on instrument mix.
    0 = user explicitly disabled feathering.
    >0 = user explicitly set a value.

    Args:
        request: The composite request.
        channel_instruments: Per-channel instrument names.

    Returns:
        Tuple of (effective_feather, auto_feathered).
    """
    if request.feather_strength is not None:
        return request.feather_strength, False

    unique_instruments = {i for i in channel_instruments if i is not None}
    if len(unique_instruments) > 1:
        ch_wavelengths = [ch.wavelength_um for ch in request.channels]
        known_scales = [
            get_pixel_scale(inst, wl)
            for inst, wl in zip(channel_instruments, ch_wavelengths, strict=False)
            if inst is not None
        ]
        scale_ratio = max(known_scales) / min(known_scales)
        effective_feather = min(0.3, 0.05 * scale_ratio)
        logger.info(
            f"Auto-feathering enabled: scale_ratio={scale_ratio:.2f}, "
            f"effective_feather={effective_feather:.3f}"
        )
        return effective_feather, True

    return 0.0, False


def _stretch_and_map_channels(
    request: NChannelCompositeRequest,
    stretch_input: dict[str, np.ndarray],
    channel_instruments: list[str | None],
) -> StretchResult:
    """Apply stretch functions and separate channels into color vs luminance groups.

    For each channel: compute auto-stretch params (if requested), apply
    stretch + levels, resolve color assignment, and categorize as either
    a color channel (with RGB weights) or a luminance channel.

    Args:
        request: The composite request with channel configurations.
        stretch_input: Dict mapping channel name to pre-stretch 2D data.
        channel_instruments: Per-channel instrument names (for auto-stretch).

    Returns:
        StretchResult with color-mapped channels and optional luminance data.

    Raises:
        HTTPException: If more than one luminance channel or no color channels.
    """
    # Validate: at most one luminance channel
    lum_count = sum(1 for ch in request.channels if ch.color.luminance)
    if lum_count > 1:
        raise HTTPException(
            status_code=422,
            detail="At most one luminance channel is allowed per composite",
        )

    logger.info("Applying stretch and color mapping")
    result = StretchResult()
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
            result.lum_data = stretched
            result.lum_weight = ch_config.weight
            logger.info(f"Channel {ch_name} assigned as luminance (blend={result.lum_weight})")
        else:
            # Color channel — apply per-channel weight
            if ch_config.weight != 1.0:
                stretched = np.clip(stretched * ch_config.weight, 0, 1)
            result.color_mapped.append((stretched, rgb_weights))
            result.color_ch_names.append(ch_name)
            result.color_ch_instruments.append(
                channel_instruments[idx] if idx < len(channel_instruments) else None
            )

    if not result.color_mapped:
        raise HTTPException(
            status_code=422,
            detail="At least one color channel (hue or rgb) is required",
        )

    return result


def _combine_to_rgb(
    mapped: StretchResult,
    reprojected: dict[str, np.ndarray],
    request: NChannelCompositeRequest,
    effective_feather: float,
    channel_instruments: list[str | None],
) -> np.ndarray:
    """Combine stretched color channels into a final RGB array.

    Handles instrument-level blending for multi-instrument composites,
    luminance blending (LRGB), and optional overall post-stack adjustments.

    Args:
        mapped: Stretch results with color/luminance channel data.
        reprojected: Raw reprojected channel data (for coverage masks).
        request: The composite request (for overall adjustments).
        effective_feather: Feather strength (0 = disabled).
        channel_instruments: Per-channel instrument names.

    Returns:
        RGB array [H, W, 3] with values in [0, 1].
    """
    unique_instruments = {i for i in channel_instruments if i is not None}
    is_multi_instrument = len(unique_instruments) > 1
    unique_color_instruments = {i for i in mapped.color_ch_instruments if i is not None}
    use_instrument_blending = (
        is_multi_instrument
        and len(unique_color_instruments) > 1
        and effective_feather > 0
        and len(mapped.color_mapped) > 1
    )

    # When luminance blending is needed, keep RGB in linear space so
    # that blend_luminance mixes linear luminance with linear color.
    # Gamma is applied after luminance blending (or immediately if no lum).
    needs_lum = mapped.lum_data is not None
    defer_gamma = needs_lum

    if use_instrument_blending:
        logger.info(
            f"Using instrument-level blending for {len(unique_color_instruments)} "
            f"instrument groups ({', '.join(sorted(unique_color_instruments))})"
        )
        rgb_array = blend_instrument_groups(
            channels=mapped.color_mapped,
            instruments=mapped.color_ch_instruments,
            reprojected=reprojected,
            ch_names=mapped.color_ch_names,
            feather_fraction=effective_feather,
            _apply_gamma=not defer_gamma,
        )
    else:
        rgb_array = combine_channels_to_rgb(
            mapped.color_mapped,
            _apply_gamma=not defer_gamma,
        )
    log_memory("after-combine-rgb")

    # Blend luminance if present (both rgb_array and lum_data are linear)
    if needs_lum:
        logger.info("Blending luminance channel into RGB composite")
        rgb_array = blend_luminance(rgb_array, mapped.lum_data, mapped.lum_weight)
        rgb_array = linear_to_srgb(rgb_array)

    # Apply optional global post-stack adjustments
    if request.overall is not None:
        rgb_array = apply_overall_adjustments(rgb_array, request.overall)

    return rgb_array


def _render_debug_masks_response(
    request: NChannelCompositeRequest,
    reprojected: dict[str, np.ndarray],
    channel_instruments: list[str | None],
    effective_feather: float,
) -> Response:
    """Build the debug-masks response with diagnostic headers.

    Derives color channel names from the request (skipping luminance
    channels) and delegates to ``_render_debug_masks`` for the actual
    panel rendering.

    Args:
        request: The composite request.
        reprojected: Raw reprojected channel data.
        channel_instruments: Per-channel instrument names.
        effective_feather: Current feather strength.

    Returns:
        Response with per-channel coverage mask panels.
    """
    # Derive color channel names from request config (skip luminance)
    color_ch_names = [
        ch.label or f"ch{idx}" for idx, ch in enumerate(request.channels) if not ch.color.luminance
    ]
    color_ch_instruments = [
        channel_instruments[idx]
        for idx, ch in enumerate(request.channels)
        if not ch.color.luminance
    ]

    response = _render_debug_masks(color_ch_names, reprojected, request)

    # Add instrument blending warning header if applicable
    unique_instruments = {i for i in channel_instruments if i is not None}
    unique_color_instruments = {i for i in color_ch_instruments if i is not None}
    is_multi_instrument = len(unique_instruments) > 1
    use_instrument_blending = (
        is_multi_instrument
        and len(unique_color_instruments) > 1
        and effective_feather > 0
        and len(color_ch_names) > 1
    )
    if use_instrument_blending:
        response.headers["X-Debug-Warning"] = (
            "instrument-blending-active: per-channel masks shown but "
            "actual compositing uses instrument-level blended masks"
        )

    return response


def _encode_and_respond(
    rgb_array: np.ndarray,
    request: NChannelCompositeRequest,
    auto_feathered: bool,
    effective_feather: float,
) -> Response:
    """Encode the final RGB array into a Response with quality headers.

    Handles: vertical flip, auto-crop, quality metrics, rotation,
    8-bit conversion, zoom/pan/canvas placement, image encoding,
    and memory cleanup.

    Args:
        rgb_array: Final RGB array [H, W, 3] in [0, 1].
        request: The composite request (for output format, dimensions, framing).
        auto_feathered: Whether feathering was auto-detected.
        effective_feather: The feather strength used.

    Returns:
        Response with binary image data and quality/diagnostic headers.
    """
    n = len(request.channels)

    # Flip vertically for correct astronomical orientation
    rgb_array = np.flipud(rgb_array)

    # Auto-crop black borders from WCS reprojection padding
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

    # Release large intermediates before returning
    del rgb_array, rgb_8bit, image
    gc.collect()
    log_memory("composite-done")

    quality_headers = {
        "X-Quality-Score": str(quality["quality_score"]),
        "X-Quality-SNR": str(quality["snr"]),
        "X-Quality-Balance": str(quality["channel_balance"]),
        "X-Quality-Spread": str(quality["histogram_spread"]),
        "X-Quality-Coverage": str(quality["coverage_fraction"]),
        "X-Composite-Auto-Feather": str(auto_feathered).lower(),
        "X-Composite-Feather-Strength": f"{effective_feather:.3f}",
    }
    return Response(content=buf.getvalue(), media_type=media_type, headers=quality_headers)


# ---------------------------------------------------------------------------
# Route handler — thin orchestrator
# ---------------------------------------------------------------------------


@router.post("/generate-nchannel")
def generate_nchannel_composite(request: NChannelCompositeRequest):
    """Generate an RGB composite image from N FITS channels with color mapping.

    Each channel gets a color assignment (hue or explicit RGB weights).
    Channels are stretched independently, then combined via weighted
    color mapping into a single RGB image.

    Returns:
        Binary image data with appropriate content type.
    """
    input_budget = min(
        MAX_INPUT_PIXELS,
        max(request.width * request.height * PREVIEW_OVERSAMPLE, MIN_PREVIEW_PIXELS),
    )
    log_memory("composite-start")
    logger.info(
        f"Generating N-channel composite ({len(request.channels)} channels, "
        f"output={request.width}x{request.height}, "
        f"input_budget={input_budget:,} px)"
    )

    instruments = _detect_channel_instruments(request.channels)
    reprojected = _load_reprojected_channels(request, instruments, input_budget)
    feather, auto_feathered = _resolve_feather_strength(request, instruments)

    if request.debug_masks:
        return _render_debug_masks_response(request, reprojected, instruments, feather)

    if request.background_neutralization:
        logger.info("Applying cross-channel background neutralization (pre-stretch)")
        stretch_input = neutralize_raw_backgrounds(reprojected)
    else:
        stretch_input = reprojected

    mapped = _stretch_and_map_channels(request, stretch_input, instruments)
    rgb = _combine_to_rgb(mapped, reprojected, request, feather, instruments)
    if request.sharpening is not None and request.sharpening.amount > 0.0:
        rgb = apply_sharpening(
            rgb, request.sharpening, coverage_mask=_build_coverage_mask(reprojected)
        )
    if request.saturation is not None:
        rgb = apply_saturation_vibrancy(rgb, request.saturation)
    return _encode_and_respond(rgb, request, auto_feathered, feather)
