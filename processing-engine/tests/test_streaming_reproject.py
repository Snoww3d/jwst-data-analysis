"""Tests for streaming_reproject_and_combine — verifies tile-by-tile reprojection."""

import gc
import weakref
from pathlib import Path

import numpy as np
from astropy.wcs import WCS
from reproject import reproject_interp

from app.mosaic import mosaic_engine
from app.mosaic.mosaic_engine import (
    _apply_tile_background,
    _compute_tile_background,
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

        Two tiles with a Gaussian source: one dim (peak 10 above bg), one bright
        (peak 30 above bg). After background subtraction + gain normalization,
        both should converge toward the median signal level (~20).
        """
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()
        wcs1 = _make_simple_wcs(crpix=40.0)

        # Build tiles with background + Gaussian source (not uniform — uniform
        # gets fully subtracted to 0 by background matching and masked as NaN)
        y, x = np.mgrid[-40:40, -40:40]
        source = np.exp(-(x**2 + y**2) / (2 * 15**2))

        tile_dim = np.full((80, 80), 100.0) + source * 10.0  # bg=100, peak signal=10
        tile_bright = np.full((80, 80), 100.0) + source * 30.0  # bg=100, peak signal=30

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

        # After gain normalization, the output should have non-zero pixels
        nonzero = result[result > 0]
        assert len(nonzero) > 0


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


def _legacy_subtract_tile_background(data: np.ndarray) -> tuple[np.ndarray, float]:
    """Frozen copy of the pre-refactor `subtract_tile_background` body.

    The golden reference below must not call the production function it is
    supposed to be checking — if the split into `_compute_tile_background` +
    `_apply_tile_background` ever changed the arithmetic, a reference built on
    the new code would change with it and agree anyway. This is the original,
    verbatim.
    """
    valid = data[data > 0]
    if valid.size == 0:
        return data.copy(), 0.0

    _, median, _ = mosaic_engine.sigma_clipped_stats(valid, sigma=3.0, maxiters=5)
    result = data - median
    np.clip(result, 0, None, out=result)
    return result, float(median)


def _legacy_streaming_reproject_and_combine(
    file_paths: list[Path],
    wcs_out: WCS,
    shape_out: tuple[int, int],
    load_fn,
    background_match: bool = False,
) -> np.ndarray:
    """Frozen copy of the pre-refactor implementation.

    Kept verbatim as a golden reference: reusing the pre-scan's background
    median only pays for itself if it is bitwise identical to recomputing the
    median in the main pass. Do not "modernise" this — it exists to disagree
    with the production function if the refactor ever changes behaviour.
    """
    if not file_paths:
        raise ValueError("No files provided for streaming reproject")
    n = len(file_paths)

    tile_gains: list[float] = []
    if background_match and n > 1:
        signal_levels = []
        for path in file_paths:
            data, _wcs = load_fn(path)
            data, _bg = _legacy_subtract_tile_background(data)
            signal_levels.append(_compute_tile_signal(data))
            del data
        nonzero_signals = [s for s in signal_levels if s > 0]
        if len(nonzero_signals) >= 2:
            ref_signal = float(np.median(nonzero_signals))
            tile_gains = [ref_signal / s if s > 0 else 1.0 for s in signal_levels]
        else:
            tile_gains = [1.0] * n

    sum_array = np.zeros(shape_out, dtype=np.float64)
    weight_array = np.zeros(shape_out, dtype=np.float64)

    for i, path in enumerate(file_paths):
        data, wcs = load_fn(path)
        if background_match:
            data, _bg_median = _legacy_subtract_tile_background(data)
            if tile_gains:
                gain = tile_gains[i]
                if abs(gain - 1.0) > 0.01:
                    data = data * gain
        data[data == 0.0] = np.nan
        reprojected, footprint = reproject_interp((data, wcs), wcs_out, shape_out=shape_out)
        valid = np.isfinite(reprojected) & (footprint > 0)
        sum_array[valid] += reprojected[valid] * footprint[valid]
        weight_array[valid] += footprint[valid]
        del data, reprojected, footprint

    return np.where(weight_array > 0, sum_array / weight_array, 0.0)


def _make_gain_fixture(n_tiles: int = 5):
    """Build n tiles differing in both background level and signal strength.

    Returns (paths, make_load_fn). Each load_fn hands out a freshly allocated
    array, so nothing outside the engine holds a reference to a tile.
    """
    y, x = np.mgrid[-40:40, -40:40]
    source = np.exp(-(x**2 + y**2) / (2 * 15**2))
    rng = np.random.default_rng(7)

    specs = [
        {
            "bg": 100.0 + 40.0 * i,
            "amp": 10.0 + 7.0 * i,
            "noise": rng.normal(0.0, 0.5, size=(80, 80)),
            "wcs": _make_simple_wcs(crval_ra=180.0 + 0.0003 * i, crpix=40.0),
        }
        for i in range(n_tiles)
    ]
    paths = [Path(f"/fake/gain_tile_{i}.fits") for i in range(n_tiles)]
    by_path = dict(zip(paths, specs, strict=True))

    def make_load_fn(on_load=None):
        def load_fn(p: Path) -> tuple[np.ndarray, WCS]:
            spec = by_path[p]
            tile = np.full((80, 80), spec["bg"]) + source * spec["amp"] + spec["noise"]
            tile = np.clip(tile, 0.0, None)
            if on_load is not None:
                on_load(p, tile)
            return tile, spec["wcs"]

        return load_fn

    return paths, make_load_fn


class TestPrescanBackgroundReuse:
    """The pre-scan keeps each tile's background median; the main pass reuses it."""

    def test_output_bitwise_identical_to_recomputing(self):
        """Reusing the pre-scan median must not move a single output pixel."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()
        paths, make_load_fn = _make_gain_fixture()

        new = streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=make_load_fn(),
            background_match=True,
        )
        legacy = _legacy_streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=make_load_fn(),
            background_match=True,
        )

        assert np.array_equal(new, legacy)

    def test_background_match_false_output_unchanged(self):
        """background_match=False never enters the pre-scan and is byte-identical."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()
        paths, make_load_fn = _make_gain_fixture()

        new = streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=make_load_fn(),
        )
        legacy = _legacy_streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=make_load_fn(),
        )

        assert np.array_equal(new, legacy)

    def test_sigma_clip_runs_once_per_tile(self, monkeypatch):
        """The whole point: N tiles cost N sigma-clips, not 2N."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()
        paths, make_load_fn = _make_gain_fixture()

        calls = {"n": 0}
        real = mosaic_engine.sigma_clipped_stats

        def counting(*args, **kwargs):
            calls["n"] += 1
            return real(*args, **kwargs)

        monkeypatch.setattr(mosaic_engine, "sigma_clipped_stats", counting)

        streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=make_load_fn(),
            background_match=True,
        )

        assert calls["n"] == len(paths)

    def test_no_background_computed_when_matching_disabled(self, monkeypatch):
        """background_match=False must not sigma-clip at all, and loads once per tile."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()
        paths, make_load_fn = _make_gain_fixture()

        def fail(*args, **kwargs):
            raise AssertionError("sigma_clipped_stats called with background_match=False")

        monkeypatch.setattr(mosaic_engine, "sigma_clipped_stats", fail)

        loads: list[Path] = []
        streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=make_load_fn(on_load=lambda p, _t: loads.append(p)),
        )

        assert loads == paths

    def test_tiles_loaded_exactly_twice_with_background_match(self):
        """Two passes are inherent — but exactly two, not three."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()
        paths, make_load_fn = _make_gain_fixture()

        loads: list[Path] = []
        streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=make_load_fn(on_load=lambda p, _t: loads.append(p)),
            background_match=True,
        )

        assert loads == paths + paths

    def test_no_tile_array_retained_between_passes(self):
        """O(1) memory: every tile array is collectable once its iteration ends."""
        shape_out = (100, 100)
        wcs_out = _make_simple_wcs()
        paths, make_load_fn = _make_gain_fixture()

        refs: list[weakref.ref] = []

        def track(_p: Path, tile: np.ndarray) -> None:
            refs.append(weakref.ref(tile))

        streaming_reproject_and_combine(
            file_paths=paths,
            wcs_out=wcs_out,
            shape_out=shape_out,
            load_fn=make_load_fn(on_load=track),
            background_match=True,
        )

        gc.collect()
        assert len(refs) == 2 * len(paths)
        assert all(r() is None for r in refs)


class TestApplyTileBackground:
    """Tests for the shared subtract-and-clip helper."""

    def test_matches_subtract_tile_background(self):
        """Applying a precomputed median equals the one-shot function."""
        rng = np.random.default_rng(3)
        data = np.clip(rng.normal(200.0, 20.0, size=(64, 64)), 0.0, None)

        expected, median = subtract_tile_background(data)
        actual = _apply_tile_background(data, _compute_tile_background(data))

        assert np.array_equal(actual, expected)
        assert _compute_tile_background(data) == median

    def test_public_function_matches_frozen_original(self):
        """The split must not have moved `subtract_tile_background` at all."""
        rng = np.random.default_rng(11)
        cases = [
            np.clip(rng.normal(300.0, 30.0, size=(48, 48)), 0.0, None),
            np.zeros((16, 16)),  # no coverage
            np.full((16, 16), -2.0),  # no positive pixels, negatives preserved
            np.array([10.0, 20.0, 100.0, 100.0, 100.0]),  # 1D, clips to zero
        ]
        for data in cases:
            expected, expected_median = _legacy_subtract_tile_background(data)
            actual, actual_median = subtract_tile_background(data)
            assert np.array_equal(actual, expected)
            assert actual_median == expected_median

    def test_none_median_leaves_data_untouched(self):
        """A tile with no positive pixels is returned as-is, negatives included."""
        data = np.array([[-3.0, 0.0], [0.0, -1.0]])
        result = _apply_tile_background(data, None)

        assert np.array_equal(result, data)
        assert result is not data

    def test_compute_returns_none_for_no_positive_pixels(self):
        """No pixels > 0 means there is no background to estimate."""
        assert _compute_tile_background(np.zeros((10, 10))) is None
        assert _compute_tile_background(np.full((10, 10), -5.0)) is None

    def test_clips_negatives_after_subtraction(self):
        """Subtracting a median must not create negative pixels."""
        data = np.array([[10.0, 500.0], [500.0, 500.0]])
        result = _apply_tile_background(data, 400.0)

        assert np.all(result >= 0.0)
        assert result[0, 0] == 0.0
