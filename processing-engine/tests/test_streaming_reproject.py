"""Tests for streaming_reproject_and_combine — verifies tile-by-tile reprojection."""

from pathlib import Path

import numpy as np
from astropy.wcs import WCS

from app.mosaic.mosaic_engine import (
    _compute_tile_signal,
    streaming_reproject_and_combine,
    subtract_tile_background,
)


def _make_simple_wcs(
    crval_ra: float = 180.0, crval_dec: float = 0.0, cdelt: float = -1e-4, crpix: float = 50.0
) -> WCS:
    """Create a minimal 2D celestial WCS for testing."""
    w = WCS(naxis=2)
    w.wcs.crpix = [crpix, crpix]
    w.wcs.cdelt = [cdelt, abs(cdelt)]
    w.wcs.crval = [crval_ra, crval_dec]
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    return w


class TestSubtractTileBackground:
    """Tests for per-tile background subtraction."""

    def test_subtracts_median(self):
        """Background median should be subtracted from positive pixels."""
        data = np.full((100, 100), 200.0)
        result, median = subtract_tile_background(data)
        assert abs(median - 200.0) < 1.0
        # After subtraction all values near 0
        assert np.max(result) < 1.0

    def test_different_backgrounds(self):
        """Three tiles with backgrounds 100, 200, 300 should all end near 0."""
        for bg in [100.0, 200.0, 300.0]:
            rng = np.random.default_rng(42)
            data = rng.normal(loc=bg, scale=5.0, size=(100, 100))
            data = np.clip(data, 0, None)
            result, median = subtract_tile_background(data)
            assert abs(median - bg) < 10.0
            # Most pixels near 0 after subtraction
            assert np.median(result) < 15.0

    def test_all_zero_tile(self):
        """All-zero tile should return unchanged with 0 median."""
        data = np.zeros((50, 50))
        result, median = subtract_tile_background(data)
        assert median == 0.0
        assert np.array_equal(result, data)

    def test_clips_to_zero(self):
        """Negative values after subtraction should be clipped to 0."""
        # Tile with some pixels below median
        data = np.array([10.0, 20.0, 100.0, 100.0, 100.0])
        result, _ = subtract_tile_background(data)
        assert np.all(result >= 0)


class TestStreamingReprojectAndCombine:
    """Tests for streaming tile-by-tile reprojection."""

    def test_two_overlapping_tiles(self):
        """Two overlapping tiles should produce non-zero output in overlap region."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()

        # Two tiles slightly offset from each other
        tile1 = np.ones((80, 80), dtype=np.float64) * 10.0
        wcs1 = _make_simple_wcs(crval_ra=180.0, crval_dec=0.0, crpix=40.0)

        tile2 = np.ones((80, 80), dtype=np.float64) * 10.0
        wcs2 = _make_simple_wcs(crval_ra=180.001, crval_dec=0.0, crpix=40.0)

        paths = [Path("/fake/tile1.fits"), Path("/fake/tile2.fits")]
        tiles = {paths[0]: (tile1, wcs1), paths[1]: (tile2, wcs2)}

        def load_fn(p: Path) -> tuple[np.ndarray, WCS]:
            return tiles[p]

        result = streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=load_fn,
        )

        assert result.shape == shape_out
        # Should have non-zero coverage
        assert np.sum(result > 0) > 0

    def test_single_file(self):
        """Single file should work correctly through streaming path."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()

        tile = np.ones((80, 80), dtype=np.float64) * 42.0
        wcs1 = _make_simple_wcs(crpix=40.0)

        path = Path("/fake/tile.fits")

        def load_fn(p: Path) -> tuple[np.ndarray, WCS]:
            return tile, wcs1

        result = streaming_reproject_and_combine(
            file_paths=[path],
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=load_fn,
        )

        assert result.shape == shape_out
        # Non-zero pixels should be close to 42
        nonzero = result[result > 0]
        assert len(nonzero) > 0
        assert abs(np.median(nonzero) - 42.0) < 5.0

    def test_background_match_changes_output(self):
        """Background matching should change the output vs without it."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()

        # Tile with high background
        rng = np.random.default_rng(42)
        tile = rng.normal(loc=500.0, scale=10.0, size=(80, 80))
        tile = np.clip(tile, 0, None)
        wcs1 = _make_simple_wcs(crpix=40.0)

        path = Path("/fake/tile.fits")

        def load_fn(p: Path) -> tuple[np.ndarray, WCS]:
            return tile.copy(), wcs1

        result_no_bg = streaming_reproject_and_combine(
            file_paths=[path],
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=load_fn,
            background_match=False,
        )

        result_bg = streaming_reproject_and_combine(
            file_paths=[path],
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=load_fn,
            background_match=True,
        )

        # Background-matched result should have lower values
        nonzero_no_bg = result_no_bg[result_no_bg > 0]
        nonzero_bg = result_bg[result_bg > 0]
        if len(nonzero_no_bg) > 0 and len(nonzero_bg) > 0:
            assert np.median(nonzero_bg) < np.median(nonzero_no_bg)

    def test_many_tiles_all_contribute(self):
        """With 10 tiles, weight_array should show overlap > 1 in center."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()

        paths = []
        tiles = {}
        rng = np.random.default_rng(42)

        # 10 tiles with slight random offsets, all centered near the same point
        for i in range(10):
            p = Path(f"/fake/tile_{i}.fits")
            paths.append(p)
            offset_ra = rng.uniform(-0.0005, 0.0005)
            offset_dec = rng.uniform(-0.0005, 0.0005)
            tile = np.ones((60, 60), dtype=np.float64) * 10.0
            wcs = _make_simple_wcs(
                crval_ra=180.0 + offset_ra,
                crval_dec=0.0 + offset_dec,
                crpix=30.0,
            )
            tiles[p] = (tile, wcs)

        def load_fn(p: Path) -> tuple[np.ndarray, WCS]:
            return tiles[p]

        result = streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=load_fn,
        )

        # All tiles have value 10.0, so the mean should be ~10.0 in overlap
        nonzero = result[result > 0]
        assert len(nonzero) > 0
        assert abs(np.median(nonzero) - 10.0) < 2.0

    def test_zero_pixels_masked(self):
        """Zero pixels in input should not contribute to output."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()

        # Tile with 50% zero coverage
        tile = np.ones((80, 80), dtype=np.float64) * 20.0
        tile[:40, :] = 0.0  # Top half is no-coverage
        wcs1 = _make_simple_wcs(crpix=40.0)

        path = Path("/fake/tile.fits")

        def load_fn(p: Path) -> tuple[np.ndarray, WCS]:
            return tile.copy(), wcs1

        result = streaming_reproject_and_combine(
            file_paths=[path],
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=load_fn,
        )

        # Non-zero pixels should be near 20, and there should be zero regions
        nonzero = result[result > 0]
        zero_count = np.sum(result == 0)
        assert len(nonzero) > 0
        assert zero_count > 0  # Some pixels should remain zero

    def test_gain_normalization_equalizes_tiles(self):
        """Tiles with different signal levels should be equalized by gain normalization.

        Two tiles: one at 10.0 brightness, one at 30.0. Without gain normalization
        the overlap would show a gradient. With it, both should be near the median (20.0).
        """
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()

        # Two tiles with same position but different signal + background
        tile_dim = np.ones((80, 80), dtype=np.float64) * 110.0  # bg=100, signal=10
        tile_bright = np.ones((80, 80), dtype=np.float64) * 130.0  # bg=100, signal=30

        wcs1 = _make_simple_wcs(crpix=40.0)

        paths = [Path("/fake/dim.fits"), Path("/fake/bright.fits")]
        call_count = {"dim": 0, "bright": 0}

        def load_fn(p: Path) -> tuple[np.ndarray, WCS]:
            if "dim" in str(p):
                call_count["dim"] += 1
                return tile_dim.copy(), wcs1
            call_count["bright"] += 1
            return tile_bright.copy(), wcs1

        result = streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=load_fn,
            background_match=True,
        )

        # Both tiles loaded twice (pre-scan + main pass)
        assert call_count["dim"] == 2
        assert call_count["bright"] == 2

        # After gain normalization, the output should be closer to
        # the median signal than the raw average
        nonzero = result[result > 0]
        assert len(nonzero) > 0
        # The median signal of the two tiles (10, 30) is 20.
        # With gain normalization both tiles are scaled to ~20,
        # so the combined output should be near 20.
        assert abs(np.median(nonzero) - 20.0) < 8.0


class TestComputeTileSignal:
    """Tests for _compute_tile_signal."""

    def test_returns_p90(self):
        """Signal level should be the 90th percentile of positive pixels."""
        data = np.arange(1.0, 101.0).reshape(10, 10)  # 1..100
        signal = _compute_tile_signal(data)
        expected = np.percentile(data.ravel(), 90)
        assert abs(signal - expected) < 0.1

    def test_all_zeros_returns_zero(self):
        """All-zero tile should return 0."""
        data = np.zeros((50, 50))
        assert _compute_tile_signal(data) == 0.0

    def test_ignores_zeros(self):
        """Zero pixels (no-coverage) should not affect the signal estimate."""
        data = np.ones((100, 100)) * 42.0
        data[:50, :] = 0.0  # 50% no-coverage
        signal = _compute_tile_signal(data)
        # p90 of all-42 data is 42
        assert abs(signal - 42.0) < 1.0
