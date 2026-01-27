"""
Noise Reduction Filters Module

Provides functions for filtering and smoothing astronomical images.
Includes both scipy-based filters and astropy convolution for NaN handling.

Reference: docs/JWST_Image_Processing_Research.pdf Section 3.2
"""

import numpy as np
from numpy.typing import NDArray
from typing import Optional, Literal, Union
import logging

from scipy.ndimage import gaussian_filter as scipy_gaussian
from scipy.ndimage import median_filter as scipy_median
from scipy.ndimage import uniform_filter
from astropy.convolution import convolve, Gaussian2DKernel, Box2DKernel

logger = logging.getLogger(__name__)

# Type alias for filter methods
FilterMethod = Literal['gaussian', 'median', 'box', 'astropy_gaussian', 'astropy_box']


def gaussian_filter(
    data: NDArray[np.floating],
    sigma: float = 1.0,
    mode: str = 'reflect',
    truncate: float = 4.0
) -> NDArray[np.floating]:
    """
    Apply Gaussian smoothing filter using scipy.

    WARNING: This filter propagates NaN values. For JWST data with NaN pixels,
    use astropy_gaussian_filter instead.

    Args:
        data: 2D numpy array of image data
        sigma: Standard deviation of Gaussian kernel in pixels (default: 1.0)
        mode: Boundary handling mode (default: 'reflect')
        truncate: Truncate filter at this many sigmas (default: 4.0)

    Returns:
        Filtered image

    Example:
        >>> smoothed = gaussian_filter(image_data, sigma=2.0)
    """
    logger.info(f"Applying Gaussian filter with sigma={sigma}")
    return scipy_gaussian(data, sigma=sigma, mode=mode, truncate=truncate)


def median_filter(
    data: NDArray[np.floating],
    size: int = 3,
    mode: str = 'reflect'
) -> NDArray[np.floating]:
    """
    Apply median filter for noise reduction.

    Effective for salt-and-pepper noise and cosmic ray artifacts.
    WARNING: Propagates NaN values.

    Args:
        data: 2D numpy array of image data
        size: Size of the median filter kernel (default: 3)
        mode: Boundary handling mode (default: 'reflect')

    Returns:
        Filtered image

    Example:
        >>> cleaned = median_filter(image_data, size=5)
    """
    logger.info(f"Applying median filter with size={size}")
    return scipy_median(data, size=size, mode=mode)


def box_filter(
    data: NDArray[np.floating],
    size: int = 3,
    mode: str = 'reflect'
) -> NDArray[np.floating]:
    """
    Apply uniform (box) filter for smoothing.

    Simple averaging filter. WARNING: Propagates NaN values.

    Args:
        data: 2D numpy array of image data
        size: Size of the box kernel (default: 3)
        mode: Boundary handling mode (default: 'reflect')

    Returns:
        Filtered image
    """
    logger.info(f"Applying box filter with size={size}")
    return uniform_filter(data, size=size, mode=mode)


def astropy_gaussian_filter(
    data: NDArray[np.floating],
    sigma: float = 1.0,
    nan_treatment: Literal['interpolate', 'fill'] = 'interpolate',
    fill_value: float = 0.0,
    preserve_nan: bool = False
) -> NDArray[np.floating]:
    """
    Apply Gaussian smoothing using astropy convolution.

    RECOMMENDED for JWST data: Properly handles NaN values by ignoring them
    during convolution and optionally interpolating across them.

    Args:
        data: 2D numpy array of image data
        sigma: Standard deviation of Gaussian kernel in pixels (default: 1.0)
        nan_treatment: How to handle NaN values:
            - 'interpolate': Replace NaN with interpolated values
            - 'fill': Replace NaN with fill_value
        fill_value: Value to use when nan_treatment='fill' (default: 0.0)
        preserve_nan: If True, preserve NaN locations in output (default: False)

    Returns:
        Filtered image with NaN values handled

    Example:
        >>> smoothed = astropy_gaussian_filter(jwst_image, sigma=1.5)
    """
    logger.info(f"Applying astropy Gaussian filter with sigma={sigma}, nan_treatment={nan_treatment}")

    kernel = Gaussian2DKernel(x_stddev=sigma)

    result = convolve(
        data,
        kernel,
        nan_treatment=nan_treatment,
        fill_value=fill_value,
        preserve_nan=preserve_nan
    )

    return result


def astropy_box_filter(
    data: NDArray[np.floating],
    size: int = 3,
    nan_treatment: Literal['interpolate', 'fill'] = 'interpolate',
    fill_value: float = 0.0,
    preserve_nan: bool = False
) -> NDArray[np.floating]:
    """
    Apply box (uniform) filter using astropy convolution.

    Properly handles NaN values.

    Args:
        data: 2D numpy array of image data
        size: Size of the box kernel (default: 3)
        nan_treatment: How to handle NaN values (default: 'interpolate')
        fill_value: Value for fill treatment (default: 0.0)
        preserve_nan: If True, preserve NaN locations (default: False)

    Returns:
        Filtered image
    """
    logger.info(f"Applying astropy box filter with size={size}")

    kernel = Box2DKernel(size)

    return convolve(
        data,
        kernel,
        nan_treatment=nan_treatment,
        fill_value=fill_value,
        preserve_nan=preserve_nan
    )


def reduce_noise(
    data: NDArray[np.floating],
    method: FilterMethod = 'astropy_gaussian',
    **kwargs
) -> NDArray[np.floating]:
    """
    Unified interface for noise reduction filters.

    Dispatches to the appropriate filter function based on method.

    Args:
        data: 2D numpy array of image data
        method: Filter method to use:
            - 'gaussian': scipy Gaussian (fast, but propagates NaN)
            - 'median': scipy median (good for cosmic rays, propagates NaN)
            - 'box': scipy box/uniform filter (propagates NaN)
            - 'astropy_gaussian': astropy Gaussian (handles NaN, recommended)
            - 'astropy_box': astropy box filter (handles NaN)
        **kwargs: Method-specific parameters:
            - sigma: For Gaussian filters (default: 1.0)
            - size: For median/box filters (default: 3)
            - nan_treatment: For astropy filters (default: 'interpolate')

    Returns:
        Filtered image

    Raises:
        ValueError: If unknown method specified

    Example:
        >>> # For JWST data with NaN values
        >>> filtered = reduce_noise(data, method='astropy_gaussian', sigma=1.5)

        >>> # For quick smoothing of clean data
        >>> filtered = reduce_noise(data, method='gaussian', sigma=2.0)
    """
    method_map = {
        'gaussian': gaussian_filter,
        'median': median_filter,
        'box': box_filter,
        'astropy_gaussian': astropy_gaussian_filter,
        'astropy_box': astropy_box_filter
    }

    if method not in method_map:
        raise ValueError(f"Unknown filter method: {method}. Choose from: {list(method_map.keys())}")

    filter_func = method_map[method]

    # Map common parameter names
    if method in ('gaussian', 'astropy_gaussian'):
        # These use 'sigma'
        pass
    elif method in ('median', 'box', 'astropy_box'):
        # These use 'size', but might receive 'kernel_size'
        if 'kernel_size' in kwargs and 'size' not in kwargs:
            kwargs['size'] = kwargs.pop('kernel_size')

    return filter_func(data, **kwargs)


def unsharp_mask(
    data: NDArray[np.floating],
    sigma: float = 2.0,
    amount: float = 1.0
) -> NDArray[np.floating]:
    """
    Apply unsharp masking for edge enhancement.

    Subtracts a blurred version of the image to enhance high-frequency details.

    Args:
        data: 2D numpy array of image data
        sigma: Sigma for Gaussian blur (default: 2.0)
        amount: Strength of sharpening effect (default: 1.0)

    Returns:
        Sharpened image

    Example:
        >>> sharp = unsharp_mask(image_data, sigma=3.0, amount=1.5)
    """
    logger.info(f"Applying unsharp mask with sigma={sigma}, amount={amount}")

    # Use astropy convolution for NaN-safe blurring
    blurred = astropy_gaussian_filter(data, sigma=sigma)

    # Unsharp mask formula: original + amount * (original - blurred)
    return data + amount * (data - blurred)


def sigma_clip_pixels(
    data: NDArray[np.floating],
    sigma: float = 5.0,
    maxiters: int = 3
) -> NDArray[np.floating]:
    """
    Replace outlier pixels with local median using sigma clipping.

    Identifies pixels that deviate significantly from their local neighborhood
    and replaces them with the local median value.

    Args:
        data: 2D numpy array of image data
        sigma: Sigma threshold for outlier detection (default: 5.0)
        maxiters: Maximum iterations (default: 3)

    Returns:
        Image with outliers replaced
    """
    from astropy.stats import sigma_clipped_stats

    logger.info(f"Sigma clipping pixels with sigma={sigma}")

    result = data.copy()

    for _ in range(maxiters):
        mean, median, std = sigma_clipped_stats(result, sigma=sigma)

        # Find outliers
        outliers = np.abs(result - median) > sigma * std

        if not np.any(outliers):
            break

        # Replace with local median
        local_med = scipy_median(result, size=3)
        result[outliers] = local_med[outliers]

    n_replaced = np.sum(np.abs(result - data) > 0)
    logger.info(f"Replaced {n_replaced} outlier pixels")

    return result
