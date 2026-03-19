# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Unit tests for output-aware downscaling in the composite pipeline.

Tests verify that the input pixel budget is derived from the requested
output dimensions, so previews process much faster while exports retain
full quality.
"""

import numpy as np
from astropy.wcs import WCS

from app.composite.routes import (
    BYTES_PER_PIXEL,
    MAX_COMPOSITE_MEMORY_BYTES,
    MAX_INPUT_PIXELS,
    MIN_PREVIEW_PIXELS,
    PREVIEW_OVERSAMPLE,
    downscale_for_composite,
)


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
        assert MAX_COMPOSITE_MEMORY_BYTES == 2_500_000_000


class TestMemoryBudgetDownscale:
    """Tests for the channel-aware memory budget (issue #874).

    The budget formula: max_pixels_per_channel = memory_bytes // (n_channels * BYTES_PER_PIXEL).
    This ensures total memory across all channels stays within the configured limit.
    """

    def _max_pixels(self, n_channels: int, memory_bytes: int = MAX_COMPOSITE_MEMORY_BYTES) -> int:
        return memory_bytes // (n_channels * BYTES_PER_PIXEL)

    def test_single_channel_gets_full_budget(self):
        """1 channel gets the entire memory budget worth of pixels."""
        px = self._max_pixels(1)
        # 2.5 GB / 8 bytes = 312.5M pixels
        assert px == 312_500_000

    def test_three_channels_classic_rgb(self):
        """3 channels (classic RGB) each get ~104M pixels."""
        px = self._max_pixels(3)
        assert px == 104_166_666

    def test_many_channels_reduces_budget(self):
        """17 channels (worst case from issue) get ~18M pixels each."""
        px = self._max_pixels(17)
        assert px == 18_382_352
        # Total memory: 17 * 18.4M * 8 ≈ 2.5 GB — within budget
        total_bytes = 17 * px * BYTES_PER_PIXEL
        assert total_bytes <= MAX_COMPOSITE_MEMORY_BYTES

    def test_total_memory_never_exceeds_budget(self):
        """For any channel count 1-20, total memory stays within budget."""
        for n in range(1, 21):
            px = self._max_pixels(n)
            total = n * px * BYTES_PER_PIXEL
            assert total <= MAX_COMPOSITE_MEMORY_BYTES, f"Exceeded budget for {n} channels"

    def test_larger_memory_allows_more_pixels(self):
        """Doubling memory budget doubles the per-channel pixel allowance."""
        base = self._max_pixels(4)
        doubled = self._max_pixels(4, memory_bytes=MAX_COMPOSITE_MEMORY_BYTES * 2)
        assert doubled == base * 2

    def test_quality_scales_with_hardware(self):
        """16 GB budget with 17 channels allows ~117M px/channel — full quality."""
        big_budget = 16_000_000_000
        px = self._max_pixels(17, memory_bytes=big_budget)
        assert px > 100_000_000  # > 100M pixels = no meaningful quality loss
