"""
Auto-detect optimal stretch parameters from channel pixel statistics.

Analyzes each channel's noise, dynamic range, and signal distribution
to compute stretch params that adapt to the actual data — no manual tuning.

Based on Lupton et al. (2004) asinh magnitude system, adapted for our
composite pipeline where black/white points are percentiles of post-stretch data.
"""

import logging

import numpy as np
from astropy.stats import sigma_clipped_stats


logger = logging.getLogger(__name__)

# Safe defaults matching NASA Press preset — used when data is degenerate
SAFE_DEFAULTS = {
    "stretch": "asinh",
    "asinh_a": 0.02,
    "black_point": 0.02,
    "white_point": 0.995,
    "gamma": 1.2,
    "curve": "s_curve",
}


def auto_stretch_params(data: np.ndarray, instrument: str | None = None) -> dict:
    """Compute optimal stretch parameters from a 2D post-background-neutralized array.

    Input: 2D array where background ≈ 0, signal > 0, zeros = no coverage.
    Output: dict with keys: stretch, asinh_a, black_point, white_point, gamma, curve.

    Args:
        data: 2D array of reprojected pixel values.
        instrument: Optional JWST instrument name (e.g. "MIRI", "NIRCAM").
            When provided, applies instrument-specific adjustments to the
            computed parameters.

    Algorithm:
    1. Extract valid (>0) pixels, compute noise via sigma-clipped stats
    2. Derive asinh_a from noise/signal_range ratio (controls linear-log transition)
    3. Derive black_point from zero-coverage fraction + noise fraction
    4. Derive white_point from outlier ratio (clips hot pixels/cosmic rays)
    5. Simulate stretch, compute gamma to target median brightness ≈ 0.28
    6. Choose tone curve based on SNR
    7. Apply instrument-specific adjustments (MIRI needs more compression)
    """
    valid = data[data > 0]
    n_valid = valid.size

    # Edge case: not enough valid pixels for meaningful statistics
    if n_valid < 100:
        logger.warning(f"auto_stretch: only {n_valid} valid pixels, using safe defaults")
        return dict(SAFE_DEFAULTS)

    # Compute noise (1σ after sigma clipping)
    _, _, noise = sigma_clipped_stats(valid, sigma=3.0)

    # Dynamic range bounds on valid (>0) pixels — excludes zero-coverage gaps
    # that would inflate signal_range and over-compress the stretch
    vmin, vmax = np.nanpercentile(valid, [0.1, 99.9])
    signal_range = vmax - vmin

    # Edge case: constant data or zero range
    if signal_range < 1e-10 or noise < 1e-15:
        logger.warning("auto_stretch: constant/zero-range data, using safe defaults")
        return dict(SAFE_DEFAULTS)

    # --- asinh_a: transition from linear → log at ~2× noise level ---
    # Small a = more compression (good for clean data with huge dynamic range)
    # Large a = more linear (preserves noisy data without amplifying noise)
    asinh_a = np.clip(2.0 * noise / signal_range, 0.003, 0.5)

    # --- HDR detection: extreme dynamic range needs more compression ---
    # Typical nebulae: ratio 100-1000.  Crab Nebula with bright pulsar: 10000+.
    # Standard asinh_a doesn't compress enough for these — bright core saturates
    # while faint filaments vanish.
    dynamic_range_ratio = vmax / max(noise, 1e-15)
    is_hdr = dynamic_range_ratio > 5000

    if is_hdr:
        asinh_a = np.clip(noise / signal_range, 0.003, 0.02)
        logger.info(
            f"auto_stretch: HDR detected (dynamic_range={dynamic_range_ratio:.0f}), "
            f"overriding asinh_a={float(asinh_a):.4f}"
        )

    # --- black_point: clip noise-dominated pixels to black ---
    total_pixels = data.size
    zero_frac = np.sum(data == 0) / total_pixels  # no-coverage fraction
    coverage_frac = 1.0 - zero_frac
    noise_frac = np.sum((valid > 0) & (valid < 2.0 * noise)) / max(n_valid, 1)
    # Keep 30% of noise pixels as subtle texture, clip the rest
    black_point = np.clip(zero_frac + coverage_frac * noise_frac * 0.7, 0.0, 0.15)

    # --- white_point: clip outliers (cosmic rays, hot pixels) ---
    p999 = np.nanpercentile(valid, 99.9)
    p9999 = np.nanpercentile(valid, 99.99)
    outlier_ratio = p9999 / max(p999, 1e-15)
    if outlier_ratio > 3.0:
        white_point = 0.99
    elif outlier_ratio > 1.5:
        white_point = 0.995
    else:
        white_point = 1.0

    # --- gamma: target median brightness ≈ 0.28 in output (STScI guideline) ---
    # Simulate the stretch on a sample to find the actual median, then compute gamma
    sample = valid
    if n_valid > 50000:
        rng = np.random.default_rng(42)
        sample = rng.choice(valid, 50000, replace=False)

    # Quick asinh stretch simulation
    sample_shifted = sample - vmin
    sample_norm = sample_shifted / max(signal_range, 1e-15)
    stretched_sample = np.arcsinh(sample_norm / float(asinh_a)) / np.arcsinh(1.0 / float(asinh_a))
    stretched_sample = np.clip(stretched_sample, 0, 1)

    stretched_median = np.median(stretched_sample)
    target_median = 0.28

    if stretched_median > 0.01:
        # gamma = log(target) / log(actual) — maps actual median to target
        gamma = np.clip(np.log(target_median) / np.log(stretched_median), 0.6, 2.5)
    else:
        gamma = 2.0  # Very dark data — boost aggressively

    # HDR override: boost midtones to lift faint filaments alongside bright core
    if is_hdr:
        gamma = np.clip(gamma * 1.3, 0.8, 2.5)

    # --- curve: based on SNR ---
    snr = p999 / max(noise, 1e-15)
    if is_hdr:
        curve = "shadows"  # HDR: always lift faint detail
    elif snr > 100:
        curve = "s_curve"  # Clean data — boost midtone contrast
    elif snr > 10:
        curve = "shadows"  # Moderate — gently lift faint detail
    else:
        curve = "linear"  # Noisy — no curve (would amplify noise)

    result = {
        "stretch": "asinh",
        "asinh_a": round(float(asinh_a), 4),
        "black_point": round(float(black_point), 4),
        "white_point": round(float(white_point), 4),
        "gamma": round(float(gamma), 2),
        "curve": curve,
    }

    # Instrument-specific adjustments — MIRI has higher thermal background
    # and wider dynamic range than NIRCAM, needing more aggressive compression.
    if instrument is not None:
        inst = instrument.upper()
        if inst == "MIRI":
            result["asinh_a"] = round(min(result["asinh_a"], 0.015), 4)
            result["gamma"] = round(min(result["gamma"] * 1.15, 2.5), 2)
            logger.info(
                f"auto_stretch: MIRI adjustment -> a={result['asinh_a']} gamma={result['gamma']}"
            )

    logger.info(
        f"auto_stretch: noise={noise:.2e} range={signal_range:.2e} "
        f"SNR={snr:.0f} instrument={instrument} "
        f"-> a={result['asinh_a']} bp={result['black_point']} "
        f"wp={result['white_point']} gamma={result['gamma']} curve={result['curve']}"
    )

    return result
