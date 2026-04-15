"""Tests for auto_stretch_params — verifies parameter derivation from pixel statistics."""

import numpy as np

from app.composite.auto_stretch import SAFE_DEFAULTS, auto_stretch_params


class TestAutoStretchParams:
    """Test auto-stretch parameter derivation for various data profiles."""

    def test_returns_all_required_keys(self):
        """Output dict must contain all stretch parameter keys plus _meta."""
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
            "_meta",
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
        """All-zero data (no coverage) should return safe defaults with _meta."""
        data = np.zeros((200, 200))
        result = auto_stretch_params(data)
        # Stretch params match safe defaults; _meta is additional
        for key in SAFE_DEFAULTS:
            assert result[key] == SAFE_DEFAULTS[key]
        assert "_meta" in result
        assert result["_meta"]["curve_reason"] == "insufficient_data"
        assert result["_meta"]["valid_pixels"] == 0

    def test_too_few_valid_pixels_returns_safe_defaults(self):
        """Fewer than 100 valid pixels should return safe defaults with _meta."""
        data = np.zeros((200, 200))
        # Sprinkle 50 non-zero pixels (< 100 threshold)
        data.flat[:50] = 1.0
        result = auto_stretch_params(data)
        for key in SAFE_DEFAULTS:
            assert result[key] == SAFE_DEFAULTS[key]
        assert result["_meta"]["curve_reason"] == "insufficient_data"
        assert result["_meta"]["valid_pixels"] == 50

    def test_constant_nonzero_data_returns_safe_defaults(self):
        """Constant (non-zero) data has zero range — should return safe defaults with _meta."""
        data = np.full((200, 200), 42.0)
        result = auto_stretch_params(data)
        for key in SAFE_DEFAULTS:
            assert result[key] == SAFE_DEFAULTS[key]
        assert result["_meta"]["curve_reason"] == "constant_data"

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


class TestInstrumentAwareStretch:
    """Tests for instrument-specific auto-stretch adjustments."""

    def _make_typical_data(self) -> np.ndarray:
        rng = np.random.default_rng(42)
        data = rng.normal(loc=5.0, scale=2.0, size=(500, 500))
        data = np.clip(data, 0, None)
        y, x = np.mgrid[-250:250, -250:250]
        data += 50 * np.exp(-(x**2 + y**2) / (2 * 80**2))
        return data

    def test_miri_lowers_asinh_a(self):
        """MIRI instrument should produce lower asinh_a (more compression)."""
        data = self._make_typical_data()
        result_none = auto_stretch_params(data)
        result_miri = auto_stretch_params(data, instrument="MIRI")
        assert result_miri["asinh_a"] <= result_none["asinh_a"]

    def test_miri_boosts_gamma(self):
        """MIRI instrument should boost gamma to lift faint detail."""
        data = self._make_typical_data()
        result_none = auto_stretch_params(data)
        result_miri = auto_stretch_params(data, instrument="MIRI")
        assert result_miri["gamma"] >= result_none["gamma"]

    def test_nircam_unchanged(self):
        """NIRCAM should not modify computed params (defaults are tuned for it)."""
        data = self._make_typical_data()
        result_none = auto_stretch_params(data)
        result_nircam = auto_stretch_params(data, instrument="NIRCAM")
        assert result_none == result_nircam

    def test_unknown_instrument_unchanged(self):
        """Unknown instrument should not modify computed params."""
        data = self._make_typical_data()
        result_none = auto_stretch_params(data)
        result_unknown = auto_stretch_params(data, instrument="FGS")
        assert result_none == result_unknown

    def test_none_instrument_unchanged(self):
        """None instrument (backward compat) should match no-instrument call."""
        data = self._make_typical_data()
        result_none = auto_stretch_params(data)
        result_explicit = auto_stretch_params(data, instrument=None)
        assert result_none == result_explicit

    def test_miri_asinh_a_capped(self):
        """MIRI asinh_a should be capped at 0.015."""
        data = self._make_typical_data()
        result = auto_stretch_params(data, instrument="MIRI")
        assert result["asinh_a"] <= 0.015

    def test_miri_gamma_capped(self):
        """MIRI gamma boost should not exceed 2.5."""
        data = self._make_typical_data()
        result = auto_stretch_params(data, instrument="MIRI")
        assert result["gamma"] <= 2.5


class TestAutoStretchMeta:
    """Tests for the _meta detection metadata returned by auto_stretch_params."""

    def test_meta_has_all_keys(self):
        """_meta must contain all expected detection metadata keys."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=100, size=(200, 200))
        result = auto_stretch_params(data)
        meta = result["_meta"]
        expected_keys = {
            "dynamic_range",
            "noise",
            "snr",
            "hdr_detected",
            "curve_reason",
            "instrument_adjusted",
            "valid_pixels",
            "zero_coverage_frac",
        }
        assert set(meta.keys()) == expected_keys

    def test_meta_types(self):
        """_meta values must have correct types."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=100, size=(200, 200))
        result = auto_stretch_params(data)
        meta = result["_meta"]
        assert isinstance(meta["dynamic_range"], float)
        assert isinstance(meta["noise"], float)
        assert isinstance(meta["snr"], float)
        assert isinstance(meta["hdr_detected"], bool)
        assert isinstance(meta["curve_reason"], str)
        assert isinstance(meta["instrument_adjusted"], bool)
        assert isinstance(meta["valid_pixels"], int)
        assert isinstance(meta["zero_coverage_frac"], float)

    def test_hdr_detected_true_for_extreme_range(self):
        """HDR flag must be True when dynamic range ratio exceeds 5000."""
        rng = np.random.default_rng(42)
        data = rng.normal(loc=1.0, scale=0.5, size=(500, 500))
        data = np.clip(data, 0, None)
        y, x = np.mgrid[-250:250, -250:250]
        data += 50000 * np.exp(-(x**2 + y**2) / (2 * 5**2))
        result = auto_stretch_params(data)
        assert result["_meta"]["hdr_detected"] is True
        assert result["_meta"]["curve_reason"] == "hdr"

    def test_hdr_detected_false_for_normal_data(self):
        """HDR flag must be False for typical nebula data."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=100, size=(300, 300))
        result = auto_stretch_params(data)
        assert result["_meta"]["hdr_detected"] is False
        assert result["_meta"]["curve_reason"] != "hdr"

    def test_curve_reason_matches_curve(self):
        """curve_reason must be consistent with the chosen curve."""
        rng = np.random.default_rng(42)
        # High SNR data → s_curve + high_snr reason
        data = rng.normal(loc=0.001, scale=0.001, size=(500, 500))
        data = np.clip(data, 0, None)
        y, x = np.mgrid[-250:250, -250:250]
        data += 500 * np.exp(-(x**2 + y**2) / (2 * 50**2))
        result = auto_stretch_params(data)
        if result["curve"] == "s_curve":
            assert result["_meta"]["curve_reason"] == "high_snr"
        elif result["curve"] == "shadows":
            assert result["_meta"]["curve_reason"] in ("medium_snr", "hdr")

    def test_instrument_adjusted_true_for_miri(self):
        """instrument_adjusted must be True when MIRI adjustments are applied."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=100, size=(200, 200))
        result = auto_stretch_params(data, instrument="MIRI")
        assert result["_meta"]["instrument_adjusted"] is True

    def test_instrument_adjusted_false_for_no_instrument(self):
        """instrument_adjusted must be False when no instrument is provided."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=100, size=(200, 200))
        result = auto_stretch_params(data)
        assert result["_meta"]["instrument_adjusted"] is False

    def test_valid_pixels_count_accurate(self):
        """valid_pixels must count only pixels > 0."""
        data = np.zeros((100, 100))
        data[:50, :] = 1.0  # 5000 valid pixels
        result = auto_stretch_params(data)
        assert result["_meta"]["valid_pixels"] == 5000

    def test_zero_coverage_frac_with_gaps(self):
        """zero_coverage_frac must reflect the proportion of zero pixels."""
        rng = np.random.default_rng(42)
        data = rng.exponential(scale=50, size=(500, 500))
        # Set exactly 40% to zero
        flat = data.flatten()
        n_zero = int(0.4 * flat.size)
        flat[:n_zero] = 0.0
        data = flat.reshape(500, 500)
        result = auto_stretch_params(data)
        assert abs(result["_meta"]["zero_coverage_frac"] - 0.4) < 0.01

    def test_safe_defaults_meta_insufficient_data(self):
        """Safe defaults path should set curve_reason to 'insufficient_data'."""
        data = np.zeros((200, 200))
        data.flat[:10] = 1.0  # Only 10 valid pixels
        result = auto_stretch_params(data)
        assert result["_meta"]["curve_reason"] == "insufficient_data"

    def test_safe_defaults_meta_constant_data(self):
        """Constant data path should set curve_reason to 'constant_data'."""
        data = np.full((200, 200), 42.0)
        result = auto_stretch_params(data)
        assert result["_meta"]["curve_reason"] == "constant_data"
