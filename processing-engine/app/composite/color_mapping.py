"""
N-channel color mapping engine for multi-filter JWST composites.

Maps N filters to RGB via hue-based color assignment. Each filter gets a color
(hue or explicit RGB weight), and their contributions are summed to produce
a final RGB image.
"""

import colorsys
import math

import numpy as np
from numpy.typing import NDArray
from scipy.ndimage import distance_transform_edt


def hue_to_rgb_weights(hue_degrees: float) -> tuple[float, float, float]:
    """Convert a hue angle (in degrees) to RGB weights.

    Uses HSV→RGB conversion with full saturation and value to produce
    a pure-color weight vector suitable for tinting astronomical data.

    Args:
        hue_degrees: Hue angle in degrees (0-360). Values outside this
            range are wrapped via modulo 360.

    Returns:
        Tuple of (r, g, b) weights, each in [0, 1].
    """
    hue_normalized = (hue_degrees % 360) / 360.0
    r, g, b = colorsys.hsv_to_rgb(hue_normalized, 1.0, 1.0)
    return (r, g, b)


def wavelength_to_hue(wavelength_um: float) -> float:
    """Map a JWST filter wavelength to a hue angle.

    Uses log-scale mapping across the JWST wavelength range (0.6-28 µm).
    Shorter wavelengths map to blue (270°), longer to red (0°).
    The hue range is 0-270°, skipping magenta which has no physical
    wavelength equivalent.

    Log scale ensures NIRCam (0.7-5 µm) and MIRI (5-28 µm) each get
    a balanced portion of the color space.

    Args:
        wavelength_um: Filter wavelength in micrometers. Values outside
            the 0.6-28 µm range are clamped to the boundaries.

    Returns:
        Hue angle in degrees (0-270).
    """
    wl_min = 0.6
    wl_max = 28.0
    hue_max = 270.0

    clamped = max(wl_min, min(wl_max, wavelength_um))

    log_min = math.log(wl_min)
    log_max = math.log(wl_max)
    log_wl = math.log(clamped)

    # Normalize to [0, 1] where 0 = shortest, 1 = longest
    t = (log_wl - log_min) / (log_max - log_min)

    # Invert: shortest wavelength → highest hue (blue), longest → 0 (red)
    hue = hue_max * (1.0 - t)

    return hue


NASA_PALETTE: list[tuple[str, float]] = [
    ("Purple", 280.0),
    ("Blue", 240.0),
    ("Cyan", 180.0),
    ("Green", 120.0),
    ("Yellow", 60.0),
    ("Orange", 30.0),
    ("Red", 0.0),
]
"""NASA/STScI discrete color palette for JWST composites.
Matches the convention used in official NASA press releases:
shortest wavelength → blue end, longest → red end."""

_NASA_PALETTE_INDICES: dict[int, list[int]] = {
    1: [6],  # Red
    2: [1, 6],  # Blue, Red
    3: [1, 3, 6],  # Blue, Green, Red
    4: [1, 3, 5, 6],  # Blue, Green, Orange, Red
    5: [0, 1, 3, 5, 6],  # Purple, Blue, Green, Orange, Red
    6: [0, 1, 3, 4, 5, 6],  # Purple, Blue, Green, Yellow, Orange, Red
    7: [0, 1, 2, 3, 4, 5, 6],  # All seven
}


def chromatic_order_hues(n: int) -> list[float]:
    """Assign hues from the NASA/STScI discrete color palette for N filters.

    Implements the chromatic ordering convention used in official NASA
    press releases (e.g. Cranium Nebula, Pillars of Creation). Filters
    are assumed to be sorted by wavelength ascending before calling —
    the first filter gets the shortest-wavelength color, the last gets red.

    For 1-7 filters, uses hand-picked subsets that match NASA practice.
    For 8+ filters, uses all 7 palette hues plus evenly interpolated
    extras between adjacent entries.

    Args:
        n: Number of filters (must be >= 1).

    Returns:
        List of N hue angles in degrees, ordered from blue/purple to red.

    Raises:
        ValueError: If n < 1.
    """
    if n < 1:
        raise ValueError("Need at least 1 filter for chromatic ordering")

    indices = _NASA_PALETTE_INDICES.get(n)
    if indices is not None:
        return [NASA_PALETTE[i][1] for i in indices]

    # N > 7: use all 7 palette hues plus interpolated extras
    base = [h for _, h in NASA_PALETTE]
    extras = n - 7
    gaps = sorted(
        [(i, base[i] - base[i + 1]) for i in range(len(base) - 1)],
        key=lambda x: -x[1],
    )
    insertions: dict[int, int] = {}
    for e in range(extras):
        gap_idx = gaps[e % len(gaps)][0]
        insertions[gap_idx] = insertions.get(gap_idx, 0) + 1
    result: list[float] = []
    for i, h in enumerate(base):
        result.append(h)
        count = insertions.get(i, 0)
        for j in range(1, count + 1):
            result.append(h - (h - base[i + 1]) * j / (count + 1))
    return result


def rgb_to_hsl(rgb: NDArray) -> tuple[NDArray, NDArray, NDArray]:
    """Convert an RGB image to HSL components.

    Vectorized conversion from RGB to Hue, Saturation, Lightness.

    Args:
        rgb: 3D numpy array [H, W, 3] with values in [0, 1].

    Returns:
        Tuple of (H, S, L) arrays, each shape [H, W], values in [0, 1].
        H is normalized to [0, 1] (divide by 360 to match colorsys convention).
    """
    r = rgb[:, :, 0]
    g = rgb[:, :, 1]
    b = rgb[:, :, 2]

    c_max = np.maximum(np.maximum(r, g), b)
    c_min = np.minimum(np.minimum(r, g), b)
    delta = c_max - c_min

    # Lightness
    lightness = (c_max + c_min) / 2.0

    # Saturation
    saturation = np.where(
        delta == 0,
        0.0,
        delta / (1.0 - np.abs(2.0 * lightness - 1.0) + 1e-10),
    )
    saturation = np.clip(saturation, 0.0, 1.0)

    # Hue (normalized to [0, 1])
    hue = np.zeros_like(delta)
    mask_r = (delta > 0) & (c_max == r)
    mask_g = (delta > 0) & (c_max == g) & ~mask_r
    mask_b = (delta > 0) & (c_max == b) & ~mask_r & ~mask_g

    hue[mask_r] = (((g[mask_r] - b[mask_r]) / delta[mask_r]) % 6) / 6.0
    hue[mask_g] = (((b[mask_g] - r[mask_g]) / delta[mask_g]) + 2) / 6.0
    hue[mask_b] = (((r[mask_b] - g[mask_b]) / delta[mask_b]) + 4) / 6.0
    hue = np.clip(hue, 0.0, 1.0)

    return hue, saturation, lightness


def hsl_to_rgb(h: NDArray, s: NDArray, lightness: NDArray) -> NDArray:
    """Convert HSL components to an RGB image.

    Vectorized conversion from Hue, Saturation, Lightness to RGB.

    Args:
        h: Hue array [H, W], values in [0, 1].
        s: Saturation array [H, W], values in [0, 1].
        lightness: Lightness array [H, W], values in [0, 1].

    Returns:
        3D numpy array [H, W, 3] with values in [0, 1].
    """
    c = (1.0 - np.abs(2.0 * lightness - 1.0)) * s
    h6 = h * 6.0
    x = c * (1.0 - np.abs(h6 % 2 - 1.0))
    m = lightness - c / 2.0

    r = np.zeros_like(h)
    g = np.zeros_like(h)
    b = np.zeros_like(h)

    # Sector 0: [0, 1)
    mask = (h6 >= 0) & (h6 < 1)
    r[mask] = c[mask]
    g[mask] = x[mask]
    # Sector 1: [1, 2)
    mask = (h6 >= 1) & (h6 < 2)
    r[mask] = x[mask]
    g[mask] = c[mask]
    # Sector 2: [2, 3)
    mask = (h6 >= 2) & (h6 < 3)
    g[mask] = c[mask]
    b[mask] = x[mask]
    # Sector 3: [3, 4)
    mask = (h6 >= 3) & (h6 < 4)
    g[mask] = x[mask]
    b[mask] = c[mask]
    # Sector 4: [4, 5)
    mask = (h6 >= 4) & (h6 < 5)
    r[mask] = x[mask]
    b[mask] = c[mask]
    # Sector 5: [5, 6]
    mask = (h6 >= 5) & (h6 <= 6)
    r[mask] = c[mask]
    b[mask] = x[mask]

    rgb = np.stack([r + m, g + m, b + m], axis=-1)
    return np.clip(rgb, 0.0, 1.0)


def blend_luminance(color_rgb: NDArray, luminance: NDArray, weight: float = 1.0) -> NDArray:
    """Blend a luminance channel into a colored RGB image via HSL.

    Replaces the lightness component of the color image with the luminance
    data, preserving the hue and saturation from the color channels.
    This is the standard LRGB compositing technique used in astrophotography.

    Args:
        color_rgb: RGB image [H, W, 3] with values in [0, 1].
        luminance: 2D luminance array [H, W] with values in [0, 1].
        weight: Blend weight (0 = keep original lightness, 1 = full replace).

    Returns:
        Blended RGB image [H, W, 3] with values in [0, 1].
    """
    h, s, l_orig = rgb_to_hsl(color_rgb)
    l_new = l_orig * (1.0 - weight) + luminance * weight
    l_new = np.clip(l_new, 0.0, 1.0)
    return hsl_to_rgb(h, s, l_new)


FEATHER_FRACTION = 0.15  # Fraction of the smaller image dimension used as feather radius
MIN_FEATHER_RADIUS = 20  # Minimum feather radius in pixels
FULL_COVERAGE_THRESHOLD = 0.95  # Channels covering >95% of pixels skip feathering


def compute_feather_weights(
    data: NDArray,
    radius: int | None = None,
    fraction: float = FEATHER_FRACTION,
) -> NDArray | None:
    """Compute smooth feather weights that taper from 1.0 at the interior
    to 0.0 at the coverage boundary.

    Uses a Euclidean distance transform from the edge of the coverage mask
    (``data != 0``).  Pixels more than *radius* pixels from the boundary
    get weight 1.0; pixels at the boundary get weight 0.0; and everything
    in between is linearly interpolated.

    Channels that cover the full image (>95% non-zero pixels) return
    ``None`` to signal that no feathering is needed.

    Args:
        data: 2D array of reprojected pixel values. Zeros indicate no
            coverage (from ``data[footprint == 0] = 0`` in reprojection).
        radius: Distance in pixels over which the taper is applied.
            If None, automatically computed from *fraction* and the smaller
            image dimension.  A value of 0 disables feathering and returns
            a binary mask.
        fraction: Fraction of the smaller image dimension to use as the
            feather radius (0.0-1.0).  0 disables feathering entirely.

    Returns:
        2D float64 array in [0, 1] (same shape as *data*), or None if
        the channel has full coverage and no feathering is needed.
    """
    mask = data != 0
    coverage = mask.sum() / mask.size
    if coverage >= FULL_COVERAGE_THRESHOLD:
        return None

    if not mask.any():
        return np.zeros(data.shape, dtype=np.float64)

    if fraction <= 0:
        return mask.astype(np.float64)

    if radius is None:
        radius = max(int(min(data.shape) * fraction), MIN_FEATHER_RADIUS)

    if radius <= 0:
        return mask.astype(np.float64)

    dist = distance_transform_edt(mask)
    weights = np.clip(dist / radius, 0.0, 1.0)
    return weights


def combine_channels_to_rgb(
    channels: list[tuple[NDArray, tuple[float, float, float]]],
    coverage_masks: list[NDArray] | None = None,
) -> NDArray:
    """Combine N stretched channels into a single RGB image.

    Each channel contributes to the final image weighted by its RGB color.
    When ``coverage_masks`` are provided (float arrays in [0, 1], e.g.
    from :func:`compute_feather_weights`), each channel's data is
    multiplied by its mask before accumulation.  This tapers data near
    FOV boundaries, producing smooth transitions instead of hard edges
    under global per-component normalization.

    Args:
        channels: List of (data, rgb_weights) tuples where:
            - data: 2D numpy array [H, W] of stretched pixel values
            - rgb_weights: (r, g, b) tuple of color weights, each in [0, 1]
        coverage_masks: Optional list of float 2D arrays in [0, 1], one
            per channel.  Typically produced by :func:`compute_feather_weights`.
            If None, data is used as-is.

    Returns:
        3D numpy array [H, W, 3] with values in [0, 1], dtype float64.

    Raises:
        ValueError: If channels list is empty or array shapes don't match.
    """
    if not channels:
        raise ValueError("At least one channel is required")

    # Validate all arrays have the same 2D shape
    ref_shape = channels[0][0].shape
    if len(ref_shape) != 2:
        raise ValueError(f"Channel data must be 2D, got shape {ref_shape}")

    for i, (data, _) in enumerate(channels[1:], start=1):
        if data.shape != ref_shape:
            raise ValueError(
                f"Channel {i} shape {data.shape} doesn't match channel 0 shape {ref_shape}"
            )

    if coverage_masks is not None:
        if len(coverage_masks) != len(channels):
            raise ValueError(
                f"coverage_masks length ({len(coverage_masks)}) must match "
                f"channels length ({len(channels)})"
            )
        for i, m in enumerate(coverage_masks):
            if m.shape != ref_shape:
                raise ValueError(
                    f"coverage_masks[{i}] shape {m.shape} doesn't match channel shape {ref_shape}"
                )

    h, w = ref_shape
    rgb = np.zeros((h, w, 3), dtype=np.float64)

    for i, (data, (wr, wg, wb)) in enumerate(channels):
        arr = data.astype(np.float64)
        if coverage_masks is not None:
            arr = arr * coverage_masks[i]

        rgb[:, :, 0] += arr * wr
        rgb[:, :, 1] += arr * wg
        rgb[:, :, 2] += arr * wb

    # Per-component normalization to [0, 1]
    for c in range(3):
        component = rgb[:, :, c]
        c_max = component.max()
        if c_max > 0:
            component /= c_max

    return rgb
