"""Compute quality metrics for RGB composite images.

Scores composites on a 1-5 scale based on coverage, SNR, channel balance,
and histogram spread. Returned as HTTP headers so the frontend/backend can
display or store them without parsing the image.
"""

import logging

import numpy as np
from astropy.stats import sigma_clipped_stats


logger = logging.getLogger(__name__)


def compute_quality_metrics(rgb: np.ndarray) -> dict:
    """Compute quality metrics from a final RGB composite array.

    Args:
        rgb: Float array [0, 1], shape (H, W, 3).

    Returns:
        Dict with: quality_score (1-5), snr, channel_balance (0-1),
        histogram_spread (0-1), coverage_fraction (0-1).
    """
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        logger.warning(f"quality: unexpected shape {rgb.shape}, returning defaults")
        return _default_metrics()

    # Coverage: fraction of pixels where any channel has signal
    any_signal = np.any(rgb > 0.005, axis=2)
    coverage = float(np.mean(any_signal))

    if coverage < 0.001:
        logger.info("quality: near-zero coverage, returning minimum score")
        return _default_metrics(coverage=coverage)

    # Per-channel stats on non-zero pixels
    channel_snrs = []
    channel_medians = []
    for c in range(3):
        ch = rgb[:, :, c]
        valid = ch[ch > 0.005]
        if valid.size < 100:
            channel_snrs.append(0.0)
            channel_medians.append(0.0)
            continue
        mean, median, std = sigma_clipped_stats(valid, sigma=3.0)
        snr = float(mean / max(std, 1e-10))
        channel_snrs.append(snr)
        channel_medians.append(float(median))

    avg_snr = float(np.mean(channel_snrs))

    # Channel balance: how equal are the channel medians?
    nonzero_medians = [m for m in channel_medians if m > 0.005]
    if len(nonzero_medians) >= 2:
        balance = float(min(nonzero_medians) / max(nonzero_medians))
    else:
        balance = 0.0

    # Histogram spread: dynamic range of the composite
    p1 = float(np.percentile(rgb, 1))
    p99 = float(np.percentile(rgb, 99))
    spread = min(p99 - p1, 1.0)

    # Normalize SNR to 0-1 (SNR > 20 is excellent for composites)
    snr_norm = min(avg_snr / 20.0, 1.0)

    # Overall score: weighted combination
    score = 1.0 + 4.0 * (0.30 * snr_norm + 0.25 * balance + 0.25 * spread + 0.20 * coverage)
    score = float(np.clip(score, 1.0, 5.0))

    metrics = {
        "quality_score": round(score, 2),
        "snr": round(avg_snr, 2),
        "channel_balance": round(balance, 2),
        "histogram_spread": round(spread, 2),
        "coverage_fraction": round(coverage, 2),
    }
    logger.info(f"quality: {metrics}")
    return metrics


def _default_metrics(coverage: float = 0.0) -> dict:
    return {
        "quality_score": 1.0,
        "snr": 0.0,
        "channel_balance": 0.0,
        "histogram_spread": 0.0,
        "coverage_fraction": round(coverage, 2),
    }
