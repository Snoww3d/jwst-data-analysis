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
from fastapi import HTTPException
from scipy.ndimage import gaussian_filter

from app.composite.routes import (
    _FIXED_WORKING_ARRAYS,
    BYTES_PER_PIXEL,
    COMPOSITE_DOWNSCALE_FAIL_THRESHOLD,
    MAX_COMPOSITE_MEMORY_BYTES,
    MAX_INPUT_PIXELS,
    MIN_PREVIEW_PIXELS,
    PREVIEW_OVERSAMPLE,
    MemoryBudgetVerdict,
    _compute_memory_budget,
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

        Peak memory model: (N + _FIXED_WORKING_ARRAYS) grid-sized arrays + 500 MB overhead.
        N channels + 4 reproject + 1 input + 6 blend + 1 headroom + 5 reproject_interp transient.
        """
        available = max(memory_bytes - self.OVERHEAD_BYTES, 100_000_000)
        effective_arrays = n_channels + _FIXED_WORKING_ARRAYS
        return available // (effective_arrays * BYTES_PER_PIXEL)

    def test_single_channel_gets_most_budget(self):
        """1 channel: effective = 18 arrays (1 ch + 17 work), 2.5 GB available."""
        px = self._max_pixels(1)
        # 2.5 GB / (18 * 8) = 17,361,111
        assert px == 17_361_111

    def test_three_channels_classic_rgb(self):
        """3 channels (classic RGB): effective = 20 arrays → ~15.6M px."""
        px = self._max_pixels(3)
        assert px == 15_625_000

    def test_five_channels_158_file_scenario(self):
        """5 channels (NGC-3324 nasa_press): effective = 22 → ~14.2M px each.

        Regression for #882: NGC-3324 with 158 F090W files at n=5 should fit
        in 4 GB container (3 GB composite budget) at ≤14.2M px/channel.
        """
        px = self._max_pixels(5)
        assert px == 14_204_545

    def test_many_channels_reduces_budget(self):
        """17 channels (worst case from issue): effective = 34 → ~9.2M px each."""
        px = self._max_pixels(17)
        assert px == 9_191_176
        # Total peak: (17 + _FIXED_WORKING_ARRAYS) * 9.2M * 8 + 500M ≈ 3.0 GB — within budget
        total_bytes = (17 + _FIXED_WORKING_ARRAYS) * px * BYTES_PER_PIXEL + self.OVERHEAD_BYTES
        assert total_bytes <= MAX_COMPOSITE_MEMORY_BYTES

    def test_total_memory_never_exceeds_budget(self):
        """For any channel count 1-20, peak memory stays within budget."""
        for n in range(1, 21):
            px = self._max_pixels(n)
            effective = n + _FIXED_WORKING_ARRAYS
            total = effective * px * BYTES_PER_PIXEL + self.OVERHEAD_BYTES
            assert total <= MAX_COMPOSITE_MEMORY_BYTES, f"Exceeded budget for {n} channels"

    def test_larger_memory_allows_more_pixels(self):
        """Doubling memory budget increases the per-channel pixel allowance."""
        base = self._max_pixels(4)
        doubled = self._max_pixels(4, memory_bytes=MAX_COMPOSITE_MEMORY_BYTES * 2)
        # With overhead subtracted, doubling budget more than doubles available
        assert doubled > base * 2

    def test_quality_scales_with_hardware(self):
        """16 GB budget with 17 channels allows ~57M px/channel — full quality."""
        big_budget = 16_000_000_000
        px = self._max_pixels(17, memory_bytes=big_budget)
        assert px > 50_000_000  # ~57M pixels = no meaningful quality loss


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


class TestMemoryBudgetVerdict:
    """Tests for the hybrid downscale policy in #882.

    `_compute_memory_budget(n, shape_out, fail_threshold)` returns:
      - status="ok" when shape_out fits within budget unchanged
      - status="warn" when shape_out must shrink, but side_factor >= fail_threshold
      - status="fail" when shape_out must shrink below fail_threshold (heavy reduction)
    """

    def test_ok_when_shape_fits_budget(self):
        """A small output shape fits within budget: status='ok', no shrink."""
        verdict = _compute_memory_budget(n=3, shape_out=(1000, 1000))
        assert verdict.status == "ok"
        assert verdict.output_shape == (1000, 1000)
        assert verdict.original_shape == (1000, 1000)
        assert verdict.side_factor == 1.0

    def test_warn_when_mild_downscale_above_threshold(self):
        """Mild downscale above threshold returns warn with shrunken shape."""
        # n=3, default budget allows ~15.6M px. Choose shape that requires ~10% shrink
        # Target side_factor = ~0.95, above default threshold of 0.85.
        # 15.6M px max → side ~3953. Use 4150x4150 → ~17.2M px → factor ~0.95.
        verdict = _compute_memory_budget(n=3, shape_out=(4150, 4150), fail_threshold=0.85)
        assert verdict.status == "warn"
        assert verdict.original_shape == (4150, 4150)
        assert verdict.output_shape != (4150, 4150)
        assert verdict.output_shape[0] < 4150
        assert 0.85 <= verdict.side_factor < 1.0

    def test_fail_when_heavy_downscale_below_threshold(self):
        """Heavy downscale below threshold raises HTTPException(413)."""
        # n=5, default budget allows ~14.2M px. Choose shape needing ~50% reduction.
        # 30000x30000 = 900M px → side_factor ≈ sqrt(14.2M / 900M) ≈ 0.126
        with pytest.raises(HTTPException) as exc_info:
            _compute_memory_budget(n=5, shape_out=(30000, 30000), fail_threshold=0.85)
        assert exc_info.value.status_code == 413
        assert "MAX_COMPOSITE_MEMORY_BYTES" in exc_info.value.detail
        assert "COMPOSITE_DOWNSCALE_FAIL_THRESHOLD" in exc_info.value.detail

    def test_threshold_zero_allows_any_downscale(self):
        """fail_threshold=0.0 means downscale never fails (only warns)."""
        verdict = _compute_memory_budget(n=5, shape_out=(30000, 30000), fail_threshold=0.0)
        assert verdict.status == "warn"
        assert verdict.side_factor < 0.5  # Heavy reduction

    def test_threshold_one_fails_on_any_downscale(self):
        """fail_threshold=1.0 means any downscale fails (strict)."""
        # Force a tiny downscale: shape just barely above budget
        # n=3 → max ~15.6M px → 4000x4000 = 16M px = needs ~1% shrink
        with pytest.raises(HTTPException) as exc_info:
            _compute_memory_budget(n=3, shape_out=(4000, 4000), fail_threshold=1.0)
        assert exc_info.value.status_code == 413

    def test_default_threshold_is_strict(self):
        """Default fail_threshold reads from env var (default 0.85)."""
        assert COMPOSITE_DOWNSCALE_FAIL_THRESHOLD == 0.85

    def test_158_file_ngc3324_scenario_fails_at_default(self):
        """Regression for #882: NGC-3324 nasa_press at n=5 with full WCS triggers 413.

        158 F090W files at native NIRCam pixel scale produce a ~5750x5750 grid
        (~33M px). At n=5 with 3 GB budget (max ~14.2M px), side_factor ≈ 0.65,
        well below the 0.85 default threshold.
        """
        with pytest.raises(HTTPException) as exc_info:
            _compute_memory_budget(n=5, shape_out=(5750, 5750))
        assert exc_info.value.status_code == 413

    def test_verdict_detail_includes_actionable_knobs(self):
        """413 detail must guide operator to the env vars they can tune."""
        try:
            _compute_memory_budget(n=5, shape_out=(30000, 30000))
            pytest.fail("expected HTTPException")
        except HTTPException as exc:
            assert "MAX_COMPOSITE_MEMORY_BYTES" in exc.detail
            assert "COMPOSITE_DOWNSCALE_FAIL_THRESHOLD" in exc.detail
            assert "MB" in exc.detail or "GB" in exc.detail  # current limit shown

    def test_warn_verdict_preserves_original_shape(self):
        """Warning verdicts must report both the requested and effective shape."""
        verdict = _compute_memory_budget(n=3, shape_out=(4150, 4150), fail_threshold=0.5)
        assert verdict.status == "warn"
        assert verdict.original_shape == (4150, 4150)
        assert verdict.output_shape[0] != 4150

    def test_shape_floor_avoids_zero(self):
        """Extreme shrink with fail_threshold=0 floors output dimensions at 1."""
        verdict = _compute_memory_budget(n=20, shape_out=(100000, 100000), fail_threshold=0.0)
        assert verdict.status == "warn"
        assert verdict.output_shape[0] >= 1
        assert verdict.output_shape[1] >= 1

    def test_memory_budget_verdict_dataclass_fields(self):
        """Sanity: dataclass has expected fields with correct types."""
        verdict = MemoryBudgetVerdict(
            status="ok",
            output_shape=(100, 100),
            original_shape=(100, 100),
            side_factor=1.0,
            detail="",
        )
        assert verdict.status == "ok"
        assert verdict.side_factor == 1.0

    def test_raise_on_fail_false_returns_fail_verdict(self):
        """raise_on_fail=False returns status='fail' instead of raising.

        Used by /composite/estimate so the recipe walkthrough preflight can
        report fail without taking down the request. Distinct from the
        force_downscale path which returns status='forced'.
        """
        verdict = _compute_memory_budget(
            n=5, shape_out=(30000, 30000), fail_threshold=0.85, raise_on_fail=False
        )
        assert verdict.status == "fail"
        assert verdict.original_shape == (30000, 30000)
        assert verdict.output_shape != (30000, 30000)
        assert verdict.side_factor < 0.85
        assert "MAX_COMPOSITE_MEMORY_BYTES" in verdict.detail

    def test_force_downscale_returns_forced_verdict(self):
        """force_downscale=True suppresses 413 and returns status='forced' with
        the projected downscale applied so the route can produce a smaller
        image instead of refusing."""
        verdict = _compute_memory_budget(
            n=5,
            shape_out=(30000, 30000),
            fail_threshold=0.85,
            force_downscale=True,
        )
        assert verdict.status == "forced"
        assert verdict.original_shape == (30000, 30000)
        assert verdict.output_shape != (30000, 30000)
        assert verdict.side_factor < 0.85
        assert "MAX_COMPOSITE_MEMORY_BYTES" in verdict.detail

    def test_force_downscale_no_pressure_returns_ok(self):
        """force_downscale=True with a shape that already fits is a no-op."""
        verdict = _compute_memory_budget(n=3, shape_out=(1000, 1000), force_downscale=True)
        assert verdict.status == "ok"
        assert verdict.side_factor == 1.0

    def test_force_downscale_with_mild_shrink_still_warns(self):
        """force_downscale only kicks in below fail_threshold; mild shrink stays
        a warn so the existing semantics for mild auto-downscale don't change."""
        verdict = _compute_memory_budget(
            n=3, shape_out=(4150, 4150), fail_threshold=0.85, force_downscale=True
        )
        assert verdict.status == "warn"
        assert 0.85 <= verdict.side_factor < 1.0

    def test_force_downscale_overrides_raise_on_fail(self):
        """If both flags are set, force_downscale wins — no 413, returns forced."""
        verdict = _compute_memory_budget(
            n=5,
            shape_out=(30000, 30000),
            fail_threshold=0.85,
            raise_on_fail=True,
            force_downscale=True,
        )
        assert verdict.status == "forced"


class TestCacheHitVerdict:
    """Tests for cache-hit revalidation against current budget (round-2 fix).

    `_verdict_for_cached(cached, n)` re-runs the budget math against the cached
    array shape so operator runtime tuning is honored — but clamps shapes to
    the actual cached shape so headers don't lie about a downscale that didn't
    happen on this request.
    """

    def test_cache_hit_returns_ok_when_within_budget(self):
        """Small cached shape under current budget returns status='ok'."""
        from app.composite.routes import _verdict_for_cached

        cached = {"ch0": np.zeros((100, 100), dtype=np.float64)}
        verdict = _verdict_for_cached(cached, n=3)
        assert verdict.status == "ok"
        assert verdict.output_shape == (100, 100)
        assert verdict.original_shape == (100, 100)

    def test_cache_hit_clamps_shapes_to_cached_when_budget_exceeded(self, monkeypatch):
        """Operator dropped budget after cache populated → status reflects new
        budget but shapes equal cached shape (no actual downscale on this request)."""
        from app.composite.routes import _verdict_for_cached

        monkeypatch.setenv("MAX_COMPOSITE_MEMORY_BYTES", "100000000")  # 100 MB — tight
        cached = {"ch0": np.zeros((4000, 4000), dtype=np.float64)}
        verdict = _verdict_for_cached(cached, n=3)
        # Status reflects current budget pressure
        assert verdict.status in ("warn", "fail")
        # Shapes reflect served reality, not hypothetical downscale
        assert verdict.output_shape == (4000, 4000)
        assert verdict.original_shape == (4000, 4000)
        assert verdict.side_factor == 1.0
        assert "served from cache" in verdict.detail

    def test_cache_hit_empty_returns_safe_default(self):
        """Defensive: empty cache (shouldn't happen) returns ok verdict."""
        from app.composite.routes import _verdict_for_cached

        verdict = _verdict_for_cached({}, n=3)
        assert verdict.status == "ok"
        assert verdict.side_factor == 1.0

    def test_cache_hit_non_2d_array_raises(self):
        """Defensive: non-2D cached array raises ValueError (corruption check)."""
        from app.composite.routes import _verdict_for_cached

        cached = {"ch0": np.zeros((100,), dtype=np.float64)}  # 1D
        with pytest.raises(ValueError, match="unexpected shape"):
            _verdict_for_cached(cached, n=3)

    def test_cache_hit_returns_forced_when_original_shape_differs(self):
        """When the cached entry was force-downscaled (original_shape provenance
        differs from the cached array shape), _verdict_for_cached returns
        status='forced' with both shapes so the warning banner can show the
        reduction even for users who didn't opt in this request."""
        from app.composite.routes import _verdict_for_cached

        # Cached at small (4000, 4000); originally would have been (10000, 10000).
        cached = {"ch0": np.zeros((4000, 4000), dtype=np.float64)}
        verdict = _verdict_for_cached(cached, n=3, original_shape=(10000, 10000))
        assert verdict.status == "forced"
        assert verdict.output_shape == (4000, 4000)
        assert verdict.original_shape == (10000, 10000)
        assert verdict.side_factor < 1.0

    def test_cache_hit_no_provenance_preserves_legacy_behavior(self):
        """Backward compat: when original_shape is None (legacy cache entry or
        not force-downscaled), _verdict_for_cached behaves as before."""
        from app.composite.routes import _verdict_for_cached

        cached = {"ch0": np.zeros((100, 100), dtype=np.float64)}
        verdict = _verdict_for_cached(cached, n=3, original_shape=None)
        assert verdict.status == "ok"
        assert verdict.output_shape == (100, 100)
        assert verdict.original_shape == (100, 100)

    def test_cache_hit_matching_original_shape_returns_ok(self):
        """If original_shape == cached_shape (no force-downscale happened), the
        verdict reflects current budget pressure normally — no 'forced'."""
        from app.composite.routes import _verdict_for_cached

        cached = {"ch0": np.zeros((100, 100), dtype=np.float64)}
        verdict = _verdict_for_cached(cached, n=3, original_shape=(100, 100))
        assert verdict.status == "ok"

    def test_force_downscale_run_then_default_cache_hit_emits_forced(self):
        """Integration test for the full provenance round-trip:

        1. A request with allow_force_downscale=True runs and populates the
           cache with original_shape provenance via _cache.put(..., original_shape=...).
        2. A subsequent default-flow request hits the cache and gets a
           'forced' verdict (not 'ok') so the warning banner fires.

        This is the load-bearing user-facing behavior promised by the plan:
        cache hits of force-downscaled entries can't silently serve smaller
        images to users who didn't opt in.
        """
        from app.composite.cache import CompositeCache
        from app.composite.routes import _verdict_for_cached

        cache = CompositeCache()
        key = CompositeCache.make_key_nchannel([["a.fits"]], 1000)

        # Step 1: simulate a force-downscaled run writing the cache. The
        # downscaled arrays are stored at the smaller shape; the original
        # WCS-derived shape is recorded as provenance.
        downscaled_arrays = {"ch0": np.zeros((4000, 4000), dtype=np.float64)}
        cache.put(
            key,
            downscaled_arrays,
            channel_paths=[["a.fits"]],
            original_shape=(10000, 10000),
        )

        # Step 2: subsequent default-flow request (no allow_force_downscale)
        # does the cache lookup and resolves the verdict against provenance.
        result = cache.get(key)
        assert result is not None
        cached_channels, original_shape = result
        verdict = _verdict_for_cached(cached_channels, n=3, original_shape=original_shape)

        assert verdict.status == "forced"
        assert verdict.output_shape == (4000, 4000)
        assert verdict.original_shape == (10000, 10000)
        assert "force-downscaled" in verdict.detail.lower()
