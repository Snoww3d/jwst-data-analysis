"""Tests for the background estimation and subtraction module."""

import numpy as np
import pytest

from app.processing.background import (
    create_background_mask,
    estimate_background,
    estimate_background_simple,
    get_background_statistics,
    subtract_background,
)


def _make_sky_image(size=100, bg_level=100.0, noise_std=5.0, seed=42):
    """Create a synthetic sky image with flat background, noise, and bright sources."""
    rng = np.random.default_rng(seed)
    data = rng.normal(loc=bg_level, scale=noise_std, size=(size, size)).astype(np.float64)

    # Add a few bright Gaussian sources
    yy, xx = np.mgrid[0:size, 0:size]
    sources = [(25, 25, 800.0), (75, 75, 600.0), (50, 20, 400.0)]
    sigma = 2.0
    for sy, sx, peak in sources:
        data += peak * np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * sigma**2))

    return data


@pytest.fixture
def sky_image():
    """100x100 image with flat background (~100), noise (~5), and 3 bright sources."""
    return _make_sky_image()


@pytest.fixture
def flat_image():
    """100x100 uniform image with no sources."""
    rng = np.random.default_rng(99)
    return rng.normal(loc=100.0, scale=5.0, size=(100, 100)).astype(np.float64)


@pytest.fixture
def background_arrays(sky_image):
    """Pre-computed background and RMS for the sky_image fixture."""
    bg, rms = estimate_background(sky_image, box_size=25)
    return bg, rms


class TestEstimateBackground:
    def test_output_shapes_match_input(self, sky_image):
        bg, rms = estimate_background(sky_image, box_size=25)
        assert bg.shape == sky_image.shape
        assert rms.shape == sky_image.shape

    def test_background_near_expected_level(self, flat_image):
        bg, rms = estimate_background(flat_image, box_size=25)
        assert np.nanmedian(bg) == pytest.approx(100.0, abs=3.0)

    def test_rms_near_expected_noise(self, flat_image):
        bg, rms = estimate_background(flat_image, box_size=25)
        assert np.nanmedian(rms) == pytest.approx(5.0, abs=2.0)

    def test_raises_for_1d_input(self):
        data = np.ones(100)
        with pytest.raises(ValueError, match="must be 2D"):
            estimate_background(data, box_size=25)

    def test_raises_for_3d_input(self):
        data = np.ones((10, 10, 3))
        with pytest.raises(ValueError, match="must be 2D"):
            estimate_background(data, box_size=5)

    def test_raises_for_zero_box_size(self, sky_image):
        with pytest.raises(ValueError, match="box_size must be positive"):
            estimate_background(sky_image, box_size=0)

    def test_raises_for_negative_box_size(self, sky_image):
        with pytest.raises(ValueError, match="box_size must be positive"):
            estimate_background(sky_image, box_size=-10)

    def test_raises_for_box_size_larger_than_image(self, sky_image):
        with pytest.raises(ValueError, match="box_size must be positive"):
            estimate_background(sky_image, box_size=200)

    def test_with_coverage_mask(self, sky_image):
        mask = np.zeros(sky_image.shape, dtype=bool)
        mask[:10, :10] = True  # mask corner region
        bg, rms = estimate_background(sky_image, box_size=25, coverage_mask=mask)
        assert bg.shape == sky_image.shape
        assert rms.shape == sky_image.shape

    def test_custom_sigma_clip(self, sky_image):
        bg, rms = estimate_background(sky_image, box_size=25, sigma_clip=5.0, maxiters=5)
        assert bg.shape == sky_image.shape

    def test_custom_filter_size(self, sky_image):
        bg, rms = estimate_background(sky_image, box_size=25, filter_size=5)
        assert bg.shape == sky_image.shape


class TestEstimateBackgroundSimple:
    def test_returns_float_tuple(self, sky_image):
        bg_val, bg_rms = estimate_background_simple(sky_image)
        assert isinstance(bg_val, float)
        assert isinstance(bg_rms, float)

    def test_reasonable_values_for_known_data(self, flat_image):
        bg_val, bg_rms = estimate_background_simple(flat_image)
        assert bg_val == pytest.approx(100.0, abs=2.0)
        assert bg_rms == pytest.approx(5.0, abs=2.0)

    def test_positive_rms(self, sky_image):
        _, bg_rms = estimate_background_simple(sky_image)
        assert bg_rms > 0.0

    def test_custom_sigma(self, sky_image):
        bg_val1, _ = estimate_background_simple(sky_image, sigma=2.0)
        bg_val2, _ = estimate_background_simple(sky_image, sigma=5.0)
        # Both should be close to the true background
        assert bg_val1 == pytest.approx(100.0, abs=5.0)
        assert bg_val2 == pytest.approx(100.0, abs=5.0)

    def test_custom_maxiters(self, sky_image):
        bg_val, bg_rms = estimate_background_simple(sky_image, maxiters=1)
        assert isinstance(bg_val, float)
        assert isinstance(bg_rms, float)


class TestSubtractBackground:
    def test_correct_subtraction(self, sky_image):
        bg = np.full_like(sky_image, 100.0)
        result = subtract_background(sky_image, bg)
        expected = sky_image - 100.0
        np.testing.assert_array_almost_equal(result, expected)

    def test_shape_mismatch_raises(self):
        data = np.ones((10, 10))
        bg = np.ones((5, 5))
        with pytest.raises(ValueError, match="Shape mismatch"):
            subtract_background(data, bg)

    def test_scalar_background(self, sky_image):
        result = subtract_background(sky_image, np.float64(100.0))
        expected = sky_image - 100.0
        np.testing.assert_array_almost_equal(result, expected)

    def test_result_shape_matches_input(self, sky_image):
        bg = np.full_like(sky_image, 100.0)
        result = subtract_background(sky_image, bg)
        assert result.shape == sky_image.shape

    def test_zero_background_returns_original(self, sky_image):
        bg = np.zeros_like(sky_image)
        result = subtract_background(sky_image, bg)
        np.testing.assert_array_equal(result, sky_image)

    def test_does_not_modify_input(self, sky_image):
        original = sky_image.copy()
        bg = np.full_like(sky_image, 50.0)
        subtract_background(sky_image, bg)
        np.testing.assert_array_equal(sky_image, original)


class TestCreateBackgroundMask:
    def test_returns_bool_array(self, sky_image):
        mask = create_background_mask(sky_image)
        assert mask.dtype == bool
        assert mask.shape == sky_image.shape

    def test_masks_bright_sources(self, sky_image):
        mask = create_background_mask(sky_image, threshold_sigma=3.0)
        # Our synthetic sources at (25,25), (75,75), (50,20) should be masked
        assert mask[25, 25], "Brightest source center should be masked"
        assert mask[75, 75], "Second source center should be masked"

    def test_flat_image_minimal_masking(self, flat_image):
        mask = create_background_mask(flat_image, threshold_sigma=5.0, npixels=10)
        # A flat noisy image should have very few masked pixels
        masked_fraction = np.sum(mask) / mask.size
        assert masked_fraction < 0.05, "Flat image should have <5% pixels masked"

    def test_npixels_filtering(self, sky_image):
        mask_small_npix = create_background_mask(sky_image, threshold_sigma=3.0, npixels=1)
        mask_large_npix = create_background_mask(sky_image, threshold_sigma=3.0, npixels=50)
        # Larger npixels should mask fewer or equal pixels (more regions filtered out)
        assert np.sum(mask_large_npix) <= np.sum(mask_small_npix)

    def test_high_threshold_masks_less(self, sky_image):
        mask_low = create_background_mask(sky_image, threshold_sigma=2.0)
        mask_high = create_background_mask(sky_image, threshold_sigma=10.0)
        assert np.sum(mask_high) <= np.sum(mask_low)


class TestGetBackgroundStatistics:
    def test_returns_expected_keys(self, sky_image, background_arrays):
        bg, rms = background_arrays
        stats = get_background_statistics(sky_image, bg, rms)
        expected_keys = {
            "background_median",
            "background_mean",
            "background_std",
            "background_rms_median",
            "background_rms_mean",
            "data_fraction_above_3sigma",
            "original_median",
            "subtracted_median",
        }
        assert set(stats.keys()) == expected_keys

    def test_values_are_floats(self, sky_image, background_arrays):
        bg, rms = background_arrays
        stats = get_background_statistics(sky_image, bg, rms)
        for key, value in stats.items():
            assert isinstance(value, float), f"{key} should be float, got {type(value)}"

    def test_background_median_reasonable(self, sky_image, background_arrays):
        bg, rms = background_arrays
        stats = get_background_statistics(sky_image, bg, rms)
        assert stats["background_median"] == pytest.approx(100.0, abs=5.0)

    def test_subtracted_median_near_zero(self, sky_image, background_arrays):
        bg, rms = background_arrays
        stats = get_background_statistics(sky_image, bg, rms)
        assert stats["subtracted_median"] == pytest.approx(0.0, abs=5.0)

    def test_fraction_above_3sigma_is_small(self, flat_image):
        bg, rms = estimate_background(flat_image, box_size=25)
        stats = get_background_statistics(flat_image, bg, rms)
        # For Gaussian noise, ~0.3% should be above 3-sigma
        assert stats["data_fraction_above_3sigma"] < 0.05

    def test_with_uniform_arrays(self):
        data = np.full((50, 50), 100.0)
        bg = np.full((50, 50), 100.0)
        rms = np.full((50, 50), 5.0)
        stats = get_background_statistics(data, bg, rms)
        assert stats["background_median"] == pytest.approx(100.0)
        assert stats["background_std"] == pytest.approx(0.0)
        assert stats["subtracted_median"] == pytest.approx(0.0)
        assert stats["data_fraction_above_3sigma"] == pytest.approx(0.0)
