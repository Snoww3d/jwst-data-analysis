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
