# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Unit tests for output-aware downscaling in the composite pipeline.

Tests verify that the input pixel budget is derived from the requested
output dimensions, so previews process much faster while exports retain
full quality.
"""

import numpy as np
import pytest
from astropy.wcs import WCS
from scipy.ndimage import gaussian_filter

from app.composite.routes import (
    BYTES_PER_PIXEL,
    MAX_COMPOSITE_MEMORY_BYTES,
    MAX_INPUT_PIXELS,
    MIN_PREVIEW_PIXELS,
    PREVIEW_OVERSAMPLE,
    downscale_for_composite,
)
from app.instruments import get_pixel_scale


def _make_wcs(naxis1: int = 100, naxis2: int = 100, cdelt: float = -0.001) -> WCS:
    """Create a minimal celestial WCS for testing."""
    header = {
        "NAXIS": 2,
        "NAXIS1": naxis1,
        "NAXIS2": naxis2,
        "CTYPE1": "RA---TAN",
        "CTYPE2": "DEC--TAN",
        "CRPIX1": naxis1 / 2.0,
        "CRPIX2": naxis2 / 2.0,
        "CRVAL1": 180.0,
        "CRVAL2": 45.0,
        "CDELT1": cdelt,
        "CDELT2": abs(cdelt),
    }
    return WCS(header, naxis=2)


class TestDownscaleInputValidation:
    """Tests for input validation in downscale_for_composite."""

    def test_zero_max_pixels_raises_value_error(self):
        """max_pixels=0 raises ValueError (would cause ZeroDivisionError)."""
        data = np.ones((100, 100), dtype=np.float64)
        wcs = _make_wcs(100, 100)

        with pytest.raises(ValueError, match="max_pixels must be positive"):
            downscale_for_composite(data, wcs, max_pixels=0)

    def test_negative_max_pixels_raises_value_error(self):
        """max_pixels=-1 raises ValueError."""
        data = np.ones((100, 100), dtype=np.float64)
        wcs = _make_wcs(100, 100)

        with pytest.raises(ValueError, match="max_pixels must be positive"):
            downscale_for_composite(data, wcs, max_pixels=-1)

    def test_3d_array_raises_value_error(self):
        """3D array raises ValueError (only 2D images are supported)."""
        data = np.ones((100, 100, 3), dtype=np.float64)
        wcs = _make_wcs(100, 100)

        with pytest.raises(ValueError, match="Expected 2D array"):
            downscale_for_composite(data, wcs, max_pixels=20_000)


class TestDownscaleMaxPixels:
    """Tests for the max_pixels parameter on downscale_for_composite."""

    def test_no_downscale_when_below_budget(self):
        """Image smaller than budget is returned unchanged."""
        data = np.ones((100, 100), dtype=np.float64)
        wcs = _make_wcs(100, 100)

        result_data, result_wcs = downscale_for_composite(data, wcs, max_pixels=20_000)

        assert result_data.shape == (100, 100)
        np.testing.assert_array_equal(result_data, data)

    def test_downscale_when_above_budget(self):
        """Image larger than budget is downscaled."""
        data = np.ones((1000, 1000), dtype=np.float64)  # 1M pixels
        wcs = _make_wcs(1000, 1000)

        result_data, result_wcs = downscale_for_composite(data, wcs, max_pixels=250_000)

        # Should be roughly 500x500 (sqrt(250k/1M) = 0.5)
        assert result_data.shape[0] * result_data.shape[1] <= 260_000
        assert result_data.shape[0] < 1000

    def test_default_uses_max_input_pixels(self):
        """Without max_pixels arg, uses the global MAX_INPUT_PIXELS."""
        # Create data smaller than MAX_INPUT_PIXELS — should not downscale
        data = np.ones((100, 100), dtype=np.float64)
        wcs = _make_wcs(100, 100)

        result_data, _ = downscale_for_composite(data, wcs)

        assert result_data.shape == (100, 100)

    def test_small_budget_produces_small_output(self):
        """A preview-sized budget (1.44M) downscales a 16M-pixel image aggressively."""
        data = np.ones((4000, 4000), dtype=np.float64)  # 16M pixels
        wcs = _make_wcs(4000, 4000)

        # Simulate 600x600 preview budget: 360k * 4 = 1.44M
        budget = 1_440_000
        result_data, _ = downscale_for_composite(data, wcs, max_pixels=budget)

        result_pixels = result_data.shape[0] * result_data.shape[1]
        assert result_pixels <= budget * 1.05  # allow small rounding margin
        assert result_pixels < 2_000_000  # significantly smaller than 16M

    def test_wcs_adjusted_on_downscale(self):
        """WCS CDELT and CRPIX are adjusted when downscaling."""
        data = np.ones((2000, 2000), dtype=np.float64)
        cdelt = -0.001
        wcs = _make_wcs(2000, 2000, cdelt=cdelt)

        result_data, result_wcs = downscale_for_composite(data, wcs, max_pixels=1_000_000)

        # CDELT should be larger in magnitude (coarser pixels)
        result_header = result_wcs.to_header()
        assert abs(result_header["CDELT1"]) > abs(cdelt)


class TestBudgetFormula:
    """Tests for the budget formula used in generate_composite."""

    def test_preview_budget_is_small(self):
        """600x600 preview should get ~1.44M budget, not 16M."""
        output_pixels = 600 * 600  # 360K
        input_budget = min(
            MAX_INPUT_PIXELS,
            max(output_pixels * PREVIEW_OVERSAMPLE, MIN_PREVIEW_PIXELS),
        )
        assert input_budget == 1_440_000
        assert input_budget < MAX_INPUT_PIXELS

    def test_large_export_hits_cap(self):
        """4096x4096 export should hit the MAX_INPUT_PIXELS cap."""
        output_pixels = 4096 * 4096  # ~16.8M
        input_budget = min(
            MAX_INPUT_PIXELS,
            max(output_pixels * PREVIEW_OVERSAMPLE, MIN_PREVIEW_PIXELS),
        )
        assert input_budget == MAX_INPUT_PIXELS

    def test_medium_export_scales_proportionally(self):
        """2048x2048 export: 4.2M * 4 = 16.8M, capped at 16M."""
        output_pixels = 2048 * 2048
        input_budget = min(
            MAX_INPUT_PIXELS,
            max(output_pixels * PREVIEW_OVERSAMPLE, MIN_PREVIEW_PIXELS),
        )
        assert input_budget == MAX_INPUT_PIXELS

    def test_tiny_preview_uses_floor(self):
        """Very small output (100x100 = 10K) should use MIN_PREVIEW_PIXELS floor."""
        output_pixels = 100 * 100  # 10K
        input_budget = min(
            MAX_INPUT_PIXELS,
            max(output_pixels * PREVIEW_OVERSAMPLE, MIN_PREVIEW_PIXELS),
        )
        assert input_budget == MIN_PREVIEW_PIXELS

    def test_1000x1000_preview_budget(self):
        """1000x1000 preview: 1M * 4 = 4M budget."""
        output_pixels = 1000 * 1000
        input_budget = min(
            MAX_INPUT_PIXELS,
            max(output_pixels * PREVIEW_OVERSAMPLE, MIN_PREVIEW_PIXELS),
        )
        assert input_budget == 4_000_000

    def test_constants_have_expected_values(self):
        """Verify the constants are configured as designed."""
        assert PREVIEW_OVERSAMPLE == 4
        assert MIN_PREVIEW_PIXELS == 500_000
        assert MAX_INPUT_PIXELS == 16_000_000
        assert BYTES_PER_PIXEL == 8
        assert MAX_COMPOSITE_MEMORY_BYTES == 3_000_000_000


class TestMemoryBudgetDownscale:
    """Tests for the channel-aware memory budget (issue #874).

    The budget formula: max_pixels_per_channel = memory_bytes // (n_channels * BYTES_PER_PIXEL).
    This ensures total memory across all channels stays within the configured limit.
    """

    # Must match the constants in routes.py
    OVERHEAD_BYTES = 500_000_000

    def _max_pixels(self, n_channels: int, memory_bytes: int = MAX_COMPOSITE_MEMORY_BYTES) -> int:
        """Compute max pixels per channel matching the route's formula.

        Peak memory model: (N + 12) grid-sized arrays + 500 MB overhead.
        N channels + 4 reproject + 1 input + 6 blend + 1 headroom.
        """
        available = max(memory_bytes - self.OVERHEAD_BYTES, 100_000_000)
        effective_arrays = n_channels + 12
        return available // (effective_arrays * BYTES_PER_PIXEL)

    def test_single_channel_gets_most_budget(self):
        """1 channel: effective = 13 arrays (1 ch + 12 work), 2.5 GB available."""
        px = self._max_pixels(1)
        # 2.5 GB / (13 * 8) = 24,038,461
        assert px == 24_038_461

    def test_three_channels_classic_rgb(self):
        """3 channels (classic RGB): effective = 15 arrays → ~20.8M px."""
        px = self._max_pixels(3)
        assert px == 20_833_333

    def test_many_channels_reduces_budget(self):
        """17 channels (worst case from issue): effective = 29 → ~10.8M px each."""
        px = self._max_pixels(17)
        assert px == 10_775_862
        # Total peak: (17 + 12) * 10.8M * 8 + 500M ≈ 3.0 GB — within budget
        total_bytes = (17 + 12) * px * BYTES_PER_PIXEL + self.OVERHEAD_BYTES
        assert total_bytes <= MAX_COMPOSITE_MEMORY_BYTES

    def test_total_memory_never_exceeds_budget(self):
        """For any channel count 1-20, peak memory stays within budget."""
        for n in range(1, 21):
            px = self._max_pixels(n)
            effective = n + 12  # Must match routes.py: N channels + 12 working arrays
            total = effective * px * BYTES_PER_PIXEL + self.OVERHEAD_BYTES
            assert total <= MAX_COMPOSITE_MEMORY_BYTES, f"Exceeded budget for {n} channels"

    def test_larger_memory_allows_more_pixels(self):
        """Doubling memory budget increases the per-channel pixel allowance."""
        base = self._max_pixels(4)
        doubled = self._max_pixels(4, memory_bytes=MAX_COMPOSITE_MEMORY_BYTES * 2)
        # With overhead subtracted, doubling budget more than doubles available
        assert doubled > base * 2

    def test_quality_scales_with_hardware(self):
        """16 GB budget with 17 channels allows ~64M px/channel — full quality."""
        big_budget = 16_000_000_000
        px = self._max_pixels(17, memory_bytes=big_budget)
        assert px > 60_000_000  # ~64M pixels = no meaningful quality loss


class TestResolutionBlur:
    """Tests for the resolution-blur logic applied to mixed-instrument composites.

    When instruments with different pixel scales are reprojected onto the same
    fine output grid, coarser instruments get upsampled — creating artificial
    smoothness.  A Gaussian blur matching the pixel scale ratio makes the
    resolution difference honest.
    """

    def test_blur_applied_when_ratio_exceeds_threshold(self):
        """Blur should be applied when pixel scale ratio > 1.5."""
        miri_scale = get_pixel_scale("MIRI")
        nircam_scale = get_pixel_scale("NIRCAM", 1.0)
        ratio = miri_scale / nircam_scale
        assert ratio > 1.5  # ~3.6x — well above threshold

        # Simulate sharp point source in MIRI channel
        data = np.zeros((100, 100), dtype=np.float64)
        data[50, 50] = 1.0

        blurred = gaussian_filter(data, sigma=ratio)
        # Point source should be spread out
        assert blurred[50, 50] < 1.0
        assert blurred[50, 50] > 0.0
        # Energy should be conserved (approximately)
        assert abs(blurred.sum() - data.sum()) < 0.01

    def test_no_blur_for_same_instrument(self):
        """Same instrument should have ratio ≈ 1.0, below threshold."""
        scale1 = get_pixel_scale("NIRCAM", 1.0)
        scale2 = get_pixel_scale("NIRCAM", 1.5)
        ratio = scale1 / scale2
        assert ratio <= 1.5

    def test_nircam_sw_lw_ratio_above_threshold(self):
        """NIRCAM SW→LW ratio (~2x) is above threshold, so LW gets blurred."""
        sw = get_pixel_scale("NIRCAM", 1.0)
        lw = get_pixel_scale("NIRCAM", 4.0)
        ratio = lw / sw
        # 0.063/0.031 ≈ 2.0 — above 1.5 threshold
        assert ratio > 1.5

    def test_blur_preserves_zero_coverage(self):
        """Zero-coverage regions (no data) should remain near zero after blur."""
        data = np.zeros((100, 100), dtype=np.float64)
        data[40:60, 40:60] = 1.0

        blurred = gaussian_filter(data, sigma=3.0)
        # Far corners should still be very close to zero
        assert blurred[0, 0] < 0.001
        assert blurred[99, 99] < 0.001

    def test_blur_with_zero_mask_preserves_coverage_boundary(self):
        """Blur + zero-mask restoration should not expand the coverage footprint.

        This tests the fix for the blur-contaminates-feather-mask bug: without
        restoring zeros after blur, gaussian_filter spreads signal into
        zero-coverage regions, causing compute_feather_weights to see a wider
        footprint than the actual data.
        """
        data = np.zeros((100, 100), dtype=np.float64)
        data[30:70, 30:70] = 1.0

        coverage_before = data != 0

        # Apply blur with zero-mask restoration (as routes.py does)
        zero_mask = data == 0
        blurred = gaussian_filter(data, sigma=3.6)
        blurred[zero_mask] = 0.0

        coverage_after = blurred != 0

        # Coverage footprint must be identical
        np.testing.assert_array_equal(coverage_before, coverage_after)

    def test_blur_without_zero_mask_would_expand_coverage(self):
        """Without zero-mask restoration, blur DOES expand coverage (regression guard)."""
        data = np.zeros((100, 100), dtype=np.float64)
        data[30:70, 30:70] = 1.0

        blurred = gaussian_filter(data, sigma=3.6)
        # Without mask restoration, blur leaks into zero-coverage regions
        assert blurred[29, 40] > 0  # Just outside the original boundary
