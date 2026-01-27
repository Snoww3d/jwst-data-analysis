"""
Background Estimation and Subtraction Module

Provides functions for estimating and subtracting background from astronomical images.
Uses photutils for 2D background estimation with sigma clipping.

Reference: docs/JWST_Image_Processing_Research.pdf Section 3.1
"""

import numpy as np
from numpy.typing import NDArray
from typing import Tuple, Optional, Dict, Any
import logging

from photutils.background import Background2D, MedianBackground, SExtractorBackground
from astropy.stats import SigmaClip

logger = logging.getLogger(__name__)


def estimate_background(
    data: NDArray[np.floating],
    box_size: int = 50,
    filter_size: int = 3,
    sigma_clip: float = 3.0,
    maxiters: int = 10,
    coverage_mask: Optional[NDArray[np.bool_]] = None,
    fill_value: float = 0.0
) -> Tuple[NDArray[np.floating], NDArray[np.floating]]:
    """
    Estimate 2D background using mesh-based approach with sigma clipping.

    Uses photutils Background2D to divide the image into boxes, estimate
    local background in each box using robust statistics, and interpolate
    to create a full-resolution background model.

    Args:
        data: 2D numpy array of image data
        box_size: Size of boxes for local estimation in pixels (default: 50)
        filter_size: Median filter window size for smoothing (default: 3)
        sigma_clip: Sigma threshold for outlier rejection (default: 3.0)
        maxiters: Maximum iterations for sigma clipping (default: 10)
        coverage_mask: Boolean mask where True indicates no coverage (default: None)
        fill_value: Value for masked regions in output (default: 0.0)

    Returns:
        Tuple of (background, background_rms):
            - background: 2D background model same shape as input
            - background_rms: 2D background noise (RMS) model

    Raises:
        ValueError: If data is not 2D or box_size is invalid

    Example:
        >>> background, rms = estimate_background(image_data, box_size=64)
        >>> subtracted = image_data - background
    """
    if data.ndim != 2:
        raise ValueError(f"Data must be 2D, got {data.ndim}D")

    if box_size <= 0 or box_size > min(data.shape):
        raise ValueError(f"box_size must be positive and <= image dimensions, got {box_size}")

    logger.info(f"Estimating background with box_size={box_size}, filter_size={filter_size}")

    sigma_clip_obj = SigmaClip(sigma=sigma_clip, maxiters=maxiters)
    bkg_estimator = MedianBackground()

    try:
        bkg = Background2D(
            data,
            box_size=box_size,
            filter_size=filter_size,
            sigma_clip=sigma_clip_obj,
            bkg_estimator=bkg_estimator,
            coverage_mask=coverage_mask,
            fill_value=fill_value
        )

        logger.info(f"Background median: {bkg.background_median:.4f}, RMS median: {bkg.background_rms_median:.4f}")

        return bkg.background, bkg.background_rms

    except Exception as e:
        logger.error(f"Background estimation failed: {e}")
        raise


def estimate_background_simple(
    data: NDArray[np.floating],
    sigma: float = 3.0,
    maxiters: int = 5
) -> Tuple[float, float]:
    """
    Estimate scalar background using sigma-clipped statistics.

    Faster alternative for images with relatively uniform backgrounds.
    Uses iterative sigma clipping to compute robust mean and standard deviation.

    Args:
        data: 2D numpy array of image data
        sigma: Sigma threshold for clipping (default: 3.0)
        maxiters: Maximum iterations (default: 5)

    Returns:
        Tuple of (background_value, background_rms):
            - background_value: Scalar background estimate
            - background_rms: Scalar background noise estimate

    Example:
        >>> bkg_val, bkg_rms = estimate_background_simple(image_data)
        >>> threshold = bkg_val + 3 * bkg_rms
    """
    from astropy.stats import sigma_clipped_stats

    mean, median, std = sigma_clipped_stats(data, sigma=sigma, maxiters=maxiters)

    logger.info(f"Simple background: median={median:.4f}, std={std:.4f}")

    return float(median), float(std)


def subtract_background(
    data: NDArray[np.floating],
    background: NDArray[np.floating]
) -> NDArray[np.floating]:
    """
    Subtract background from image data.

    Performs element-wise subtraction with proper handling of NaN values.

    Args:
        data: 2D numpy array of image data
        background: 2D background model (same shape as data) or scalar

    Returns:
        Background-subtracted image

    Raises:
        ValueError: If shapes don't match (when background is array)
    """
    if isinstance(background, np.ndarray):
        if data.shape != background.shape:
            raise ValueError(f"Shape mismatch: data {data.shape} vs background {background.shape}")

    return data - background


def create_background_mask(
    data: NDArray[np.floating],
    threshold_sigma: float = 3.0,
    npixels: int = 5
) -> NDArray[np.bool_]:
    """
    Create a mask of sources to exclude from background estimation.

    Uses simple thresholding to identify bright regions that should be
    excluded when computing background statistics.

    Args:
        data: 2D numpy array of image data
        threshold_sigma: Sigma above background for source detection (default: 3.0)
        npixels: Minimum connected pixels to be considered a source (default: 5)

    Returns:
        Boolean mask where True indicates source pixels to exclude
    """
    from scipy.ndimage import binary_dilation, label

    # Get rough background estimate
    bkg_val, bkg_rms = estimate_background_simple(data)

    # Threshold for sources
    threshold = bkg_val + threshold_sigma * bkg_rms

    # Create initial mask
    source_mask = data > threshold

    # Label connected regions and filter small ones
    labeled, num_features = label(source_mask)

    # Keep only regions with enough pixels
    final_mask = np.zeros_like(source_mask)
    for i in range(1, num_features + 1):
        region = labeled == i
        if np.sum(region) >= npixels:
            final_mask |= region

    # Dilate slightly to include source wings
    final_mask = binary_dilation(final_mask, iterations=2)

    logger.info(f"Created source mask: {np.sum(final_mask)} pixels masked")

    return final_mask


def get_background_statistics(
    data: NDArray[np.floating],
    background: NDArray[np.floating],
    background_rms: NDArray[np.floating]
) -> Dict[str, Any]:
    """
    Compute summary statistics for background estimation results.

    Args:
        data: Original image data
        background: Estimated background
        background_rms: Estimated background RMS

    Returns:
        Dictionary with background statistics
    """
    return {
        'background_median': float(np.nanmedian(background)),
        'background_mean': float(np.nanmean(background)),
        'background_std': float(np.nanstd(background)),
        'background_rms_median': float(np.nanmedian(background_rms)),
        'background_rms_mean': float(np.nanmean(background_rms)),
        'data_fraction_above_3sigma': float(
            np.sum(data > background + 3 * background_rms) / data.size
        ),
        'original_median': float(np.nanmedian(data)),
        'subtracted_median': float(np.nanmedian(data - background))
    }
