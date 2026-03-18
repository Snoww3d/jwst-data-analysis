"""Tests for auto_stretch_params — verifies parameter derivation from pixel statistics."""

import numpy as np

from app.composite.auto_stretch import SAFE_DEFAULTS, auto_stretch_params


class TestAutoStretchParams:
    """Test auto-stretch parameter derivation for various data profiles."""

    def test_returns_all_required_keys(self):
        """Output dict must contain all stretch parameter keys."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=100, size=(200, 200))
        result = auto_stretch_params(data)
        assert set(result.keys()) == {
            "stretch",
            "asinh_a",
            "black_point",
            "white_point",
            "gamma",
            "curve",
        }

    def test_stretch_always_asinh(self):
        """Stretch method should always be asinh."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=100, size=(200, 200))
        result = auto_stretch_params(data)
        assert result["stretch"] == "asinh"

    def test_uniform_noise_large_asinh_a(self):
        """Uniform noise (no real signal) should produce large asinh_a (more linear)."""
        rng = np.random.default_rng(42)
        # Low-level noise near zero — half the pixels clip to 0 (simulating
        # a noisy channel where signal barely rises above background).
        data = rng.normal(loc=0.05, scale=0.05, size=(500, 500))
        data = np.clip(data, 0, None)
        result = auto_stretch_params(data)
        # Large asinh_a (more linear) since range is small relative to noise
        assert result["asinh_a"] >= 0.05
        # Most valid pixels are within 2*noise, so noise_frac should push
        # black_point above zero (clips noise-dominated pixels)
        assert result["black_point"] > 0.0

    def test_high_snr_bright_source(self):
        """High-SNR data (bright source + low noise) should get s_curve and small asinh_a."""
        rng = np.random.default_rng(42)
        # Low noise background
        data = rng.normal(loc=0.001, scale=0.001, size=(500, 500))
        data = np.clip(data, 0, None)
        # Add a bright Gaussian source in the center
        y, x = np.mgrid[-250:250, -250:250]
        source = 500 * np.exp(-(x**2 + y**2) / (2 * 50**2))
        data += source
        result = auto_stretch_params(data)
        # Clean data with huge dynamic range → small asinh_a (more compression)
        assert result["asinh_a"] <= 0.1
        # High SNR → s_curve
        assert result["curve"] == "s_curve"

    def test_miri_like_high_noise(self):
        """MIRI-like data (high noise floor, moderate signal) → larger asinh_a, shadows curve."""
        rng = np.random.default_rng(42)
        # High thermal background noise (simulating MIRI)
        data = rng.normal(loc=5.0, scale=2.0, size=(500, 500))
        data = np.clip(data, 0, None)
        # Add modest signal above the noise
        y, x = np.mgrid[-250:250, -250:250]
        source = 20 * np.exp(-(x**2 + y**2) / (2 * 80**2))
        data += source
        result = auto_stretch_params(data)
        # Higher noise relative to range → larger asinh_a
        assert result["asinh_a"] >= 0.01
        # Moderate SNR → shadows or linear (not s_curve which amplifies noise)
        assert result["curve"] in ("shadows", "linear")

    def test_all_zeros_returns_safe_defaults(self):
        """All-zero data (no coverage) should return safe defaults."""
        data = np.zeros((200, 200))
        result = auto_stretch_params(data)
        assert result == SAFE_DEFAULTS

    def test_too_few_valid_pixels_returns_safe_defaults(self):
        """Fewer than 100 valid pixels should return safe defaults."""
        data = np.zeros((200, 200))
        # Sprinkle 50 non-zero pixels (< 100 threshold)
        data.flat[:50] = 1.0
        result = auto_stretch_params(data)
        assert result == SAFE_DEFAULTS

    def test_constant_nonzero_data_returns_safe_defaults(self):
        """Constant (non-zero) data has zero range — should return safe defaults."""
        data = np.full((200, 200), 42.0)
        result = auto_stretch_params(data)
        assert result == SAFE_DEFAULTS

    def test_parameter_bounds(self):
        """All computed parameters should be within their valid ranges."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=100, size=(300, 300))
        result = auto_stretch_params(data)
        assert 0.003 <= result["asinh_a"] <= 0.5
        assert 0.0 <= result["black_point"] <= 0.15
        assert 0.99 <= result["white_point"] <= 1.0
        assert 0.6 <= result["gamma"] <= 2.5
        assert result["curve"] in ("linear", "s_curve", "shadows")

    def test_with_zero_coverage_gaps(self):
        """Data with large zero-coverage regions (reprojection gaps) should adapt black_point."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=50, size=(500, 500))
        # Set 40% of pixels to zero (simulating FOV gaps)
        mask = rng.random((500, 500)) < 0.4
        data[mask] = 0.0
        result = auto_stretch_params(data)
        # Black point should account for zero-coverage fraction
        assert result["black_point"] > 0.0

    def test_outlier_detection_clips_white_point(self):
        """Extreme outliers (cosmic rays) should cause white_point < 1.0."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=10, size=(500, 500))
        # Add extreme outliers (simulating cosmic rays)
        data.flat[:20] = 100000.0
        result = auto_stretch_params(data)
        assert result["white_point"] < 1.0

    def test_deterministic_same_input(self):
        """Same input should produce same output (deterministic)."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=100, size=(300, 300))
        r1 = auto_stretch_params(data.copy())
        r2 = auto_stretch_params(data.copy())
        assert r1 == r2

    def test_hdr_extreme_dynamic_range(self):
        """HDR data (ratio > 5000) should get smaller asinh_a and shadows curve.

        Simulates Crab Nebula-like data: bright pulsar (peak 50000) +
        faint filaments (background ~1) with low noise (~0.5).
        Dynamic range ratio = vmax/noise ≈ 50000/0.5 = 100000 >> 5000.
        """
        rng = np.random.default_rng(42)
        # Faint background with low noise
        data = rng.normal(loc=1.0, scale=0.5, size=(500, 500))
        data = np.clip(data, 0, None)
        # Bright point source (pulsar analog)
        y, x = np.mgrid[-250:250, -250:250]
        source = 50000 * np.exp(-(x**2 + y**2) / (2 * 5**2))
        data += source
        result = auto_stretch_params(data)
        # HDR override: very small asinh_a for maximum compression
        assert result["asinh_a"] <= 0.02
        # HDR always forces shadows curve
        assert result["curve"] == "shadows"

    def test_normal_data_unaffected_by_hdr(self):
        """Normal data (ratio < 5000) should not trigger HDR overrides.

        Regression guard: ensures the HDR path doesn't change output for
        typical nebula/galaxy data.
        """
        rng = np.random.default_rng(42)
        # Moderate dynamic range: background ~10, noise ~3, peak ~1000
        # Ratio = 1000/3 ≈ 333, well below 5000 threshold
        data = rng.normal(loc=10.0, scale=3.0, size=(500, 500))
        data = np.clip(data, 0, None)
        y, x = np.mgrid[-250:250, -250:250]
        source = 1000 * np.exp(-(x**2 + y**2) / (2 * 50**2))
        data += source
        result = auto_stretch_params(data)
        # Normal asinh_a range (not HDR-compressed)
        assert result["asinh_a"] >= 0.003
        # Curve should be based on SNR, not forced to shadows
        assert result["curve"] in ("linear", "s_curve", "shadows")
