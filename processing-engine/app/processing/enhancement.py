"""
Image Enhancement Module

Provides functions for contrast enhancement and dynamic range scaling
optimized for astronomical images with extreme dynamic ranges.

Reference: docs/JWST_Image_Processing_Research.pdf Section 3.3
"""

import numpy as np
from numpy.typing import NDArray
from typing import Tuple, Optional, Literal, Union
import logging

from astropy.visualization import (
    ZScaleInterval,
    MinMaxInterval,
    AsinhStretch,
    LogStretch,
    SqrtStretch,
    LinearStretch,
    HistEqStretch,
    PowerStretch,
    ImageNormalize
)

logger = logging.getLogger(__name__)

# Type alias for stretch methods
StretchMethod = Literal['zscale', 'asinh', 'log', 'sqrt', 'linear', 'histogram_eq', 'power']


def normalize_to_range(
    data: NDArray[np.floating],
    vmin: Optional[float] = None,
    vmax: Optional[float] = None
) -> NDArray[np.floating]:
    """
    Normalize data to 0-1 range.

    Args:
        data: Input array
        vmin: Minimum value (default: data minimum)
        vmax: Maximum value (default: data maximum)

    Returns:
        Normalized array in range [0, 1]
    """
    if vmin is None:
        vmin = np.nanmin(data)
    if vmax is None:
        vmax = np.nanmax(data)

    if vmax == vmin:
        return np.zeros_like(data)

    return np.clip((data - vmin) / (vmax - vmin), 0, 1)


def zscale_stretch(
    data: NDArray[np.floating],
    contrast: float = 0.25,
    n_samples: int = 1000
) -> Tuple[NDArray[np.floating], float, float]:
    """
    Apply ZScale interval determination and normalize.

    The ZScale algorithm (from IRAF) samples pixels and fits a line to
    determine optimal display limits. Standard for astronomical imaging.

    Args:
        data: 2D numpy array of image data
        contrast: Contrast parameter (0-1, default: 0.25)
        n_samples: Number of pixels to sample (default: 1000)

    Returns:
        Tuple of (normalized_data, vmin, vmax)

    Example:
        >>> stretched, vmin, vmax = zscale_stretch(image_data, contrast=0.2)
    """
    logger.info(f"Applying ZScale stretch with contrast={contrast}")

    interval = ZScaleInterval(contrast=contrast, n_samples=n_samples)
    vmin, vmax = interval.get_limits(data)

    normalized = normalize_to_range(data, vmin, vmax)

    logger.info(f"ZScale limits: vmin={vmin:.4f}, vmax={vmax:.4f}")

    return normalized, float(vmin), float(vmax)


def asinh_stretch(
    data: NDArray[np.floating],
    a: float = 0.1,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None
) -> NDArray[np.floating]:
    """
    Apply inverse hyperbolic sine stretch.

    Excellent for high dynamic range images like galaxies where you need
    to see both faint outer regions and bright cores.

    The 'a' parameter controls the transition from linear to logarithmic:
    - Small a (0.01): More aggressive compression
    - Large a (1.0): More linear behavior

    Args:
        data: 2D numpy array of image data
        a: Softening parameter (default: 0.1)
        vmin: Minimum value for normalization (default: data min)
        vmax: Maximum value for normalization (default: data max)

    Returns:
        Stretched image in range [0, 1]

    Example:
        >>> stretched = asinh_stretch(galaxy_image, a=0.05)
    """
    logger.info(f"Applying asinh stretch with a={a}")

    # First normalize to 0-1
    normalized = normalize_to_range(data, vmin, vmax)

    # Apply asinh stretch
    stretch = AsinhStretch(a=a)
    return stretch(normalized)


def log_stretch(
    data: NDArray[np.floating],
    a: float = 1000.0,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None
) -> NDArray[np.floating]:
    """
    Apply logarithmic stretch.

    Good for images with extended emission spanning many orders of magnitude.
    The 'a' parameter controls the steepness of the stretch.

    Args:
        data: 2D numpy array of image data
        a: Log parameter (default: 1000.0)
        vmin: Minimum value for normalization (default: data min)
        vmax: Maximum value for normalization (default: data max)

    Returns:
        Stretched image in range [0, 1]

    Example:
        >>> stretched = log_stretch(nebula_image, a=500)
    """
    logger.info(f"Applying log stretch with a={a}")

    normalized = normalize_to_range(data, vmin, vmax)
    stretch = LogStretch(a=a)
    return stretch(normalized)


def sqrt_stretch(
    data: NDArray[np.floating],
    vmin: Optional[float] = None,
    vmax: Optional[float] = None
) -> NDArray[np.floating]:
    """
    Apply square root stretch.

    Moderate compression of dynamic range. Good general-purpose stretch
    for images without extreme brightness variations.

    Args:
        data: 2D numpy array of image data
        vmin: Minimum value for normalization (default: data min)
        vmax: Maximum value for normalization (default: data max)

    Returns:
        Stretched image in range [0, 1]
    """
    logger.info("Applying sqrt stretch")

    normalized = normalize_to_range(data, vmin, vmax)
    stretch = SqrtStretch()
    return stretch(normalized)


def power_stretch(
    data: NDArray[np.floating],
    power: float = 0.5,
    vmin: Optional[float] = None,
    vmax: Optional[float] = None
) -> NDArray[np.floating]:
    """
    Apply power law stretch.

    Generalizes sqrt (power=0.5) and allows fine control.
    - power < 1: Compresses bright end (like sqrt)
    - power > 1: Compresses faint end

    Args:
        data: 2D numpy array of image data
        power: Exponent for power law (default: 0.5)
        vmin: Minimum value for normalization
        vmax: Maximum value for normalization

    Returns:
        Stretched image in range [0, 1]
    """
    logger.info(f"Applying power stretch with power={power}")

    normalized = normalize_to_range(data, vmin, vmax)
    stretch = PowerStretch(power)
    return stretch(normalized)


def histogram_equalization(
    data: NDArray[np.floating],
    vmin: Optional[float] = None,
    vmax: Optional[float] = None
) -> NDArray[np.floating]:
    """
    Apply histogram equalization.

    Stretches the histogram to use the full dynamic range,
    maximizing contrast across all intensity levels.

    Args:
        data: 2D numpy array of image data
        vmin: Minimum value for normalization
        vmax: Maximum value for normalization

    Returns:
        Stretched image in range [0, 1]
    """
    logger.info("Applying histogram equalization")

    # Get valid data for histogram computation
    valid_data = data[~np.isnan(data)]

    if vmin is not None and vmax is not None:
        valid_data = np.clip(valid_data, vmin, vmax)

    stretch = HistEqStretch(valid_data)
    normalized = normalize_to_range(data, vmin, vmax)

    return stretch(normalized)


def enhance_image(
    data: NDArray[np.floating],
    method: StretchMethod = 'zscale',
    **kwargs
) -> NDArray[np.floating]:
    """
    Unified interface for image enhancement.

    Args:
        data: 2D numpy array of image data
        method: Enhancement method:
            - 'zscale': ZScale interval (default, good for general use)
            - 'asinh': Asinh stretch (high dynamic range)
            - 'log': Logarithmic stretch (extended emission)
            - 'sqrt': Square root stretch (moderate compression)
            - 'linear': Linear stretch (no compression)
            - 'histogram_eq': Histogram equalization (maximize contrast)
            - 'power': Power law stretch (customizable)
        **kwargs: Method-specific parameters:
            - contrast: For zscale (default: 0.25)
            - a: For asinh (default: 0.1) or log (default: 1000)
            - power: For power stretch (default: 0.5)
            - vmin, vmax: Manual intensity limits

    Returns:
        Enhanced image normalized to [0, 1]

    Raises:
        ValueError: If unknown method specified

    Example:
        >>> # Standard astronomical display
        >>> display = enhance_image(data, method='zscale')

        >>> # High dynamic range galaxy
        >>> display = enhance_image(data, method='asinh', a=0.05)
    """
    if method == 'zscale':
        result, _, _ = zscale_stretch(data, **kwargs)
        return result
    elif method == 'asinh':
        return asinh_stretch(data, **kwargs)
    elif method == 'log':
        return log_stretch(data, **kwargs)
    elif method == 'sqrt':
        return sqrt_stretch(data, **kwargs)
    elif method == 'linear':
        return normalize_to_range(data, kwargs.get('vmin'), kwargs.get('vmax'))
    elif method == 'histogram_eq':
        return histogram_equalization(data, **kwargs)
    elif method == 'power':
        return power_stretch(data, **kwargs)
    else:
        raise ValueError(f"Unknown enhancement method: {method}")


def adjust_brightness_contrast(
    data: NDArray[np.floating],
    brightness: float = 0.0,
    contrast: float = 1.0
) -> NDArray[np.floating]:
    """
    Adjust brightness and contrast of normalized image.

    Should be applied after stretch/normalization.

    Args:
        data: Normalized image (0-1 range)
        brightness: Brightness adjustment (-1 to 1, default: 0)
        contrast: Contrast multiplier (>0, default: 1.0)

    Returns:
        Adjusted image clipped to [0, 1]
    """
    # Apply contrast around midpoint
    result = (data - 0.5) * contrast + 0.5

    # Apply brightness
    result = result + brightness

    return np.clip(result, 0, 1)


def create_rgb_image(
    r_data: NDArray[np.floating],
    g_data: NDArray[np.floating],
    b_data: NDArray[np.floating],
    stretch_method: StretchMethod = 'asinh',
    **kwargs
) -> NDArray[np.floating]:
    """
    Create RGB composite from three channels.

    Applies the same stretch to all channels for consistent colors.

    Args:
        r_data: Red channel data
        g_data: Green channel data
        b_data: Blue channel data
        stretch_method: Enhancement method (default: 'asinh')
        **kwargs: Parameters for stretch method

    Returns:
        RGB image array of shape (height, width, 3) in range [0, 1]
    """
    logger.info(f"Creating RGB composite with {stretch_method} stretch")

    r_stretched = enhance_image(r_data, method=stretch_method, **kwargs)
    g_stretched = enhance_image(g_data, method=stretch_method, **kwargs)
    b_stretched = enhance_image(b_data, method=stretch_method, **kwargs)

    return np.stack([r_stretched, g_stretched, b_stretched], axis=-1)


def apply_colormap(
    data: NDArray[np.floating],
    colormap: str = 'viridis'
) -> NDArray[np.floating]:
    """
    Apply a matplotlib colormap to normalized data.

    Args:
        data: Normalized image (0-1 range)
        colormap: Name of matplotlib colormap (default: 'viridis')

    Returns:
        RGBA image array of shape (height, width, 4) in range [0, 1]
    """
    import matplotlib.pyplot as plt

    cmap = plt.get_cmap(colormap)
    return cmap(data)
