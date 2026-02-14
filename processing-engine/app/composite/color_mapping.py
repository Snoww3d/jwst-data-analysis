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


def combine_channels_to_rgb(
    channels: list[tuple[NDArray, tuple[float, float, float]]],
) -> NDArray:
    """Combine N stretched channels into a single RGB image.

    Each channel contributes to the final image weighted by its RGB color.
    The result is normalized per-component (R, G, B independently) to [0, 1].

    Args:
        channels: List of (data, rgb_weights) tuples where:
            - data: 2D numpy array [H, W] of stretched pixel values
            - rgb_weights: (r, g, b) tuple of color weights, each in [0, 1]

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

    h, w = ref_shape
    rgb = np.zeros((h, w, 3), dtype=np.float64)

    for data, (wr, wg, wb) in channels:
        arr = data.astype(np.float64)
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
