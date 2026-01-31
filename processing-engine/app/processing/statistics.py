"""
Statistical Analysis Module

Provides functions for computing robust statistics on astronomical images.
Includes sigma-clipped statistics and robust estimators for characterizing
images with outliers and source contamination.

Reference: docs/JWST_Image_Processing_Research.pdf Section 3.5
"""

import logging
from typing import Any

import numpy as np
from astropy.stats import biweight_location, biweight_scale, mad_std, sigma_clipped_stats
from numpy.typing import NDArray


logger = logging.getLogger(__name__)


def compute_basic_stats(
    data: NDArray[np.floating], mask: NDArray[np.bool_] | None = None
) -> dict[str, float]:
    """
    Compute basic statistics with NaN handling.

    Args:
        data: 2D numpy array of image data
        mask: Boolean mask where True indicates pixels to exclude (optional)

    Returns:
        Dictionary with: min, max, mean, median, std, sum, n_pixels, n_nan
    """
    valid_data = data[~mask & ~np.isnan(data)] if mask is not None else data[~np.isnan(data)]

    n_nan = np.sum(np.isnan(data))

    if valid_data.size == 0:
        logger.warning("No valid data for statistics computation")
        return {
            "min": float("nan"),
            "max": float("nan"),
            "mean": float("nan"),
            "median": float("nan"),
            "std": float("nan"),
            "sum": float("nan"),
            "n_pixels": 0,
            "n_nan": int(n_nan),
        }

    return {
        "min": float(np.min(valid_data)),
        "max": float(np.max(valid_data)),
        "mean": float(np.mean(valid_data)),
        "median": float(np.median(valid_data)),
        "std": float(np.std(valid_data)),
        "sum": float(np.sum(valid_data)),
        "n_pixels": int(valid_data.size),
        "n_nan": int(n_nan),
    }


def compute_robust_stats(
    data: NDArray[np.floating],
    sigma: float = 3.0,
    maxiters: int = 5,
    mask: NDArray[np.bool_] | None = None,
) -> dict[str, float]:
    """
    Compute sigma-clipped statistics for robust estimates.

    Iteratively clips outliers beyond sigma threshold to get
    statistics unbiased by bright sources or artifacts.

    Args:
        data: 2D numpy array of image data
        sigma: Sigma threshold for clipping (default: 3.0)
        maxiters: Maximum clipping iterations (default: 5)
        mask: Boolean mask where True indicates pixels to exclude

    Returns:
        Dictionary with: clipped_mean, clipped_median, clipped_std
    """
    if mask is not None:
        masked_data = np.ma.array(data, mask=mask | np.isnan(data))
    else:
        masked_data = np.ma.array(data, mask=np.isnan(data))

    mean, median, std = sigma_clipped_stats(masked_data, sigma=sigma, maxiters=maxiters)

    return {
        "clipped_mean": float(mean),
        "clipped_median": float(median),
        "clipped_std": float(std),
        "sigma": sigma,
        "maxiters": maxiters,
    }


def compute_advanced_stats(
    data: NDArray[np.floating], mask: NDArray[np.bool_] | None = None
) -> dict[str, float]:
    """
    Compute advanced robust statistics.

    Includes biweight estimators which are highly resistant to outliers.

    Args:
        data: 2D numpy array of image data
        mask: Boolean mask where True indicates pixels to exclude

    Returns:
        Dictionary with: biweight_location, biweight_scale, mad_std
    """
    valid_data = data[~mask & ~np.isnan(data)] if mask is not None else data[~np.isnan(data)]

    if valid_data.size < 10:
        logger.warning("Insufficient data for advanced statistics")
        return {
            "biweight_location": float("nan"),
            "biweight_scale": float("nan"),
            "mad_std": float("nan"),
        }

    return {
        "biweight_location": float(biweight_location(valid_data)),
        "biweight_scale": float(biweight_scale(valid_data)),
        "mad_std": float(mad_std(valid_data)),
    }


def compute_statistics(
    data: NDArray[np.floating], mask: NDArray[np.bool_] | None = None, sigma: float = 3.0
) -> dict[str, Any]:
    """
    Compute comprehensive statistics combining all methods.

    This is the main function to use for complete image characterization.

    Args:
        data: 2D numpy array of image data
        mask: Boolean mask where True indicates pixels to exclude
        sigma: Sigma threshold for clipped statistics

    Returns:
        Dictionary containing all statistics:
            - Basic: min, max, mean, median, std, sum
            - Robust: clipped_mean, clipped_median, clipped_std
            - Advanced: biweight_location, biweight_scale, mad_std
            - Metadata: n_pixels, n_nan, shape

    Example:
        >>> stats = compute_statistics(image_data)
        >>> print(f"Background estimate: {stats['clipped_median']:.2f}")
    """
    logger.info("Computing comprehensive statistics")

    # Basic stats
    basic = compute_basic_stats(data, mask)

    # Robust stats
    robust = compute_robust_stats(data, sigma=sigma, mask=mask)

    # Advanced stats
    advanced = compute_advanced_stats(data, mask)

    # Combine all
    result = {
        # Basic
        "min": basic["min"],
        "max": basic["max"],
        "mean": basic["mean"],
        "median": basic["median"],
        "std": basic["std"],
        "sum": basic["sum"],
        # Robust (sigma-clipped)
        "clipped_mean": robust["clipped_mean"],
        "clipped_median": robust["clipped_median"],
        "clipped_std": robust["clipped_std"],
        # Advanced (biweight)
        "biweight_location": advanced["biweight_location"],
        "biweight_scale": advanced["biweight_scale"],
        "mad_std": advanced["mad_std"],
        # Metadata
        "n_pixels": basic["n_pixels"],
        "n_nan": basic["n_nan"],
        "shape": list(data.shape),
        "dtype": str(data.dtype),
    }

    return result


def compute_histogram(
    data: NDArray[np.floating],
    bins: int = 256,
    range: tuple[float, float] | None = None,
    mask: NDArray[np.bool_] | None = None,
) -> dict[str, Any]:
    """
    Compute histogram of image data.

    Args:
        data: 2D numpy array of image data
        bins: Number of histogram bins (default: 256)
        range: (min, max) range for histogram (default: data range)
        mask: Boolean mask where True indicates pixels to exclude

    Returns:
        Dictionary with:
            - counts: Array of bin counts
            - bin_edges: Array of bin edges
            - bin_centers: Array of bin centers
    """
    valid_data = data[~mask & ~np.isnan(data)] if mask is not None else data[~np.isnan(data)]

    if range is None:
        range = (float(np.min(valid_data)), float(np.max(valid_data)))

    counts, bin_edges = np.histogram(valid_data, bins=bins, range=range)
    bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2

    return {
        "counts": counts.tolist(),
        "bin_edges": bin_edges.tolist(),
        "bin_centers": bin_centers.tolist(),
        "n_bins": bins,
        "range": range,
    }


def compute_percentiles(
    data: NDArray[np.floating],
    percentiles: list[float] = None,
    mask: NDArray[np.bool_] | None = None,
) -> dict[str, float]:
    """
    Compute percentiles of image data.

    Args:
        data: 2D numpy array of image data
        percentiles: List of percentiles to compute (default: standard set)
        mask: Boolean mask where True indicates pixels to exclude

    Returns:
        Dictionary mapping percentile names to values
    """
    if percentiles is None:
        percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99]
    valid_data = data[~mask & ~np.isnan(data)] if mask is not None else data[~np.isnan(data)]

    values = np.percentile(valid_data, percentiles)

    return {f"p{int(p)}": float(v) for p, v in zip(percentiles, values, strict=False)}


def compute_snr(
    data: NDArray[np.floating],
    background: float | None = None,
    noise: float | None = None,
    mask: NDArray[np.bool_] | None = None,
) -> dict[str, float]:
    """
    Estimate signal-to-noise ratio.

    Args:
        data: 2D numpy array of image data
        background: Background level (default: clipped median)
        noise: Noise level (default: clipped std)
        mask: Boolean mask for source exclusion

    Returns:
        Dictionary with: peak_snr, mean_snr, background, noise
    """
    if background is None or noise is None:
        robust = compute_robust_stats(data, mask=mask)
        if background is None:
            background = robust["clipped_median"]
        if noise is None:
            noise = robust["clipped_std"]

    if noise <= 0:
        logger.warning("Noise estimate <= 0, cannot compute SNR")
        return {
            "peak_snr": float("nan"),
            "mean_snr": float("nan"),
            "background": float(background),
            "noise": float(noise),
        }

    # Signal is data - background
    signal = data - background

    peak_signal = float(np.nanmax(signal))
    mean_signal = float(np.nanmean(signal[signal > 0])) if np.any(signal > 0) else 0.0

    return {
        "peak_snr": peak_signal / noise,
        "mean_snr": mean_signal / noise,
        "background": float(background),
        "noise": float(noise),
    }


def compare_images(
    data1: NDArray[np.floating], data2: NDArray[np.floating], mask: NDArray[np.bool_] | None = None
) -> dict[str, float]:
    """
    Compare two images and compute difference statistics.

    Useful for comparing before/after processing or different observations.

    Args:
        data1: First image array
        data2: Second image array (must match shape)
        mask: Boolean mask where True indicates pixels to exclude

    Returns:
        Dictionary with difference statistics

    Raises:
        ValueError: If shapes don't match
    """
    if data1.shape != data2.shape:
        raise ValueError(f"Shape mismatch: {data1.shape} vs {data2.shape}")

    diff = data1 - data2

    valid_diff = diff[~mask & ~np.isnan(diff)] if mask is not None else diff[~np.isnan(diff)]

    return {
        "mean_diff": float(np.mean(valid_diff)),
        "median_diff": float(np.median(valid_diff)),
        "std_diff": float(np.std(valid_diff)),
        "max_diff": float(np.max(np.abs(valid_diff))),
        "rms_diff": float(np.sqrt(np.mean(valid_diff**2))),
        "n_pixels": int(valid_diff.size),
    }
