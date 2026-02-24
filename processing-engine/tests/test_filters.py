"""Tests for the noise reduction filters module."""

import numpy as np
import pytest

from app.processing.filters import (
    astropy_box_filter,
    astropy_gaussian_filter,
    box_filter,
    gaussian_filter,
    median_filter,
    reduce_noise,
    sigma_clip_pixels,
    unsharp_mask,
)


@pytest.fixture
def sample_image():
    """10x10 image with known values."""
    rng = np.random.default_rng(42)
    return rng.normal(loc=100.0, scale=10.0, size=(10, 10)).astype(np.float64)


@pytest.fixture
def image_with_nans(sample_image):
    """Image with NaN pixels to test NaN handling."""
    d = sample_image.copy()
    d[0, 0] = np.nan
    d[5, 5] = np.nan
    return d


@pytest.fixture
def image_with_outliers():
    """Clean image with extreme outlier pixels."""
    rng = np.random.default_rng(42)
    data = rng.normal(loc=50.0, scale=2.0, size=(20, 20)).astype(np.float64)
    data[3, 3] = 5000.0
    data[15, 15] = 5000.0
    return data


class TestGaussianFilter:
    def test_output_shape_matches_input(self, sample_image):
        result = gaussian_filter(sample_image, sigma=1.0)
        assert result.shape == sample_image.shape

    def test_smoothing_reduces_std(self, sample_image):
        result = gaussian_filter(sample_image, sigma=2.0)
        assert np.std(result) < np.std(sample_image)

    def test_preserves_mean_approximately(self, sample_image):
        result = gaussian_filter(sample_image, sigma=1.0)
        assert np.mean(result) == pytest.approx(np.mean(sample_image), abs=1.0)

    def test_sigma_zero_returns_original(self, sample_image):
        result = gaussian_filter(sample_image, sigma=0.0)
        np.testing.assert_array_almost_equal(result, sample_image)


class TestMedianFilter:
    def test_output_shape_matches_input(self, sample_image):
        result = median_filter(sample_image, size=3)
        assert result.shape == sample_image.shape

    def test_removes_salt_and_pepper(self):
        data = np.ones((10, 10)) * 50.0
        data[5, 5] = 9999.0  # spike
        result = median_filter(data, size=3)
        assert result[5, 5] == pytest.approx(50.0)

    def test_uniform_data_unchanged(self):
        data = np.ones((10, 10)) * 42.0
        result = median_filter(data, size=3)
        np.testing.assert_array_almost_equal(result, data)


class TestBoxFilter:
    def test_output_shape_matches_input(self, sample_image):
        result = box_filter(sample_image, size=3)
        assert result.shape == sample_image.shape

    def test_smoothing_reduces_std(self, sample_image):
        result = box_filter(sample_image, size=5)
        assert np.std(result) < np.std(sample_image)

    def test_uniform_data_unchanged(self):
        data = np.ones((10, 10)) * 42.0
        result = box_filter(data, size=3)
        np.testing.assert_array_almost_equal(result, data)


class TestAstropyGaussianFilter:
    def test_output_shape_matches_input(self, sample_image):
        result = astropy_gaussian_filter(sample_image, sigma=1.0)
        assert result.shape == sample_image.shape

    def test_handles_nans_by_default(self, image_with_nans):
        result = astropy_gaussian_filter(image_with_nans, sigma=1.0)
        # With interpolation, NaN locations should be filled
        assert not np.any(np.isnan(result))

    def test_preserve_nan_option(self, image_with_nans):
        result = astropy_gaussian_filter(image_with_nans, sigma=1.0, preserve_nan=True)
        assert np.isnan(result[0, 0])
        assert np.isnan(result[5, 5])

    def test_fill_nan_treatment(self, image_with_nans):
        result = astropy_gaussian_filter(
            image_with_nans, sigma=1.0, nan_treatment="fill", fill_value=0.0
        )
        assert result.shape == image_with_nans.shape
        assert not np.any(np.isnan(result))

    def test_smoothing_reduces_variation(self):
        # Use a larger image to avoid edge normalization effects
        rng = np.random.default_rng(42)
        large_image = rng.normal(loc=100.0, scale=10.0, size=(50, 50)).astype(np.float64)
        result = astropy_gaussian_filter(large_image, sigma=2.0)
        # Compare only the interior to avoid edge effects
        interior = slice(10, 40)
        assert np.std(result[interior, interior]) < np.std(large_image[interior, interior])


class TestAstropyBoxFilter:
    def test_output_shape_matches_input(self, sample_image):
        result = astropy_box_filter(sample_image, size=3)
        assert result.shape == sample_image.shape

    def test_handles_nans(self, image_with_nans):
        result = astropy_box_filter(image_with_nans, size=3)
        assert not np.any(np.isnan(result))

    def test_preserve_nan_option(self, image_with_nans):
        result = astropy_box_filter(image_with_nans, size=3, preserve_nan=True)
        assert np.isnan(result[0, 0])
        assert np.isnan(result[5, 5])


class TestReduceNoise:
    def test_dispatches_gaussian(self, sample_image):
        result = reduce_noise(sample_image, method="gaussian", sigma=1.0)
        expected = gaussian_filter(sample_image, sigma=1.0)
        np.testing.assert_array_equal(result, expected)

    def test_dispatches_median(self, sample_image):
        result = reduce_noise(sample_image, method="median", size=3)
        expected = median_filter(sample_image, size=3)
        np.testing.assert_array_equal(result, expected)

    def test_dispatches_box(self, sample_image):
        result = reduce_noise(sample_image, method="box", size=3)
        expected = box_filter(sample_image, size=3)
        np.testing.assert_array_equal(result, expected)

    def test_dispatches_astropy_gaussian(self, sample_image):
        result = reduce_noise(sample_image, method="astropy_gaussian", sigma=1.0)
        assert result.shape == sample_image.shape

    def test_dispatches_astropy_box(self, sample_image):
        result = reduce_noise(sample_image, method="astropy_box", size=3)
        assert result.shape == sample_image.shape

    def test_unknown_method_raises(self, sample_image):
        with pytest.raises(ValueError, match="Unknown filter method"):
            reduce_noise(sample_image, method="nonexistent")

    def test_kernel_size_alias(self, sample_image):
        result = reduce_noise(sample_image, method="median", kernel_size=5)
        expected = median_filter(sample_image, size=5)
        np.testing.assert_array_equal(result, expected)


class TestUnsharpMask:
    def test_output_shape_matches_input(self, sample_image):
        result = unsharp_mask(sample_image, sigma=2.0, amount=1.0)
        assert result.shape == sample_image.shape

    def test_enhances_edges(self):
        # Create image with a sharp edge
        data = np.zeros((20, 20), dtype=np.float64)
        data[:, 10:] = 100.0
        result = unsharp_mask(data, sigma=2.0, amount=1.0)
        # Near the edge, sharpened values should overshoot
        assert np.max(result) > 100.0

    def test_zero_amount_returns_original(self, sample_image):
        result = unsharp_mask(sample_image, sigma=2.0, amount=0.0)
        np.testing.assert_array_almost_equal(result, sample_image)


class TestSigmaClipPixels:
    def test_output_shape_matches_input(self, sample_image):
        result = sigma_clip_pixels(sample_image, sigma=5.0)
        assert result.shape == sample_image.shape

    def test_replaces_outliers(self, image_with_outliers):
        result = sigma_clip_pixels(image_with_outliers, sigma=3.0)
        # Extreme outliers should be replaced with values near the median
        assert result[3, 3] < 100.0
        assert result[15, 15] < 100.0

    def test_preserves_normal_data(self, sample_image):
        result = sigma_clip_pixels(sample_image, sigma=5.0)
        # With high sigma threshold, no changes for normal data
        np.testing.assert_array_almost_equal(result, sample_image, decimal=1)

    def test_does_not_modify_input(self, image_with_outliers):
        original = image_with_outliers.copy()
        sigma_clip_pixels(image_with_outliers, sigma=3.0)
        np.testing.assert_array_equal(image_with_outliers, original)

    def test_handles_nan_values(self):
        """NaN values should not crash sigma clipping."""
        rng = np.random.default_rng(42)
        data = rng.normal(loc=50.0, scale=2.0, size=(20, 20)).astype(np.float64)
        data[0, 0] = np.nan
        data[10, 10] = np.nan
        data[3, 3] = 5000.0  # outlier
        result = sigma_clip_pixels(data, sigma=3.0)
        assert result.shape == data.shape
        # Outlier should be clipped to near median
        assert result[3, 3] < 100.0

    def test_single_iteration(self, image_with_outliers):
        """maxiters=1 should still replace extreme outliers."""
        result = sigma_clip_pixels(image_with_outliers, sigma=3.0, maxiters=1)
        assert result[3, 3] < 100.0
        assert result[15, 15] < 100.0

    def test_no_outliers_early_exit(self):
        """Uniform data should trigger early exit (no outliers found)."""
        data = np.ones((10, 10)) * 50.0
        result = sigma_clip_pixels(data, sigma=3.0)
        np.testing.assert_array_almost_equal(result, data)


class TestUnsharpMaskNaN:
    """Tests for unsharp_mask NaN handling."""

    def test_nan_pixels_handled(self):
        """NaN pixels should not propagate to entire image via astropy convolution."""
        data = np.ones((20, 20), dtype=np.float64) * 100.0
        data[10, 10] = np.nan
        result = unsharp_mask(data, sigma=2.0, amount=1.0)
        assert result.shape == data.shape
        # Most pixels (away from NaN) should still be finite
        finite_count = np.sum(np.isfinite(result))
        assert finite_count > data.size * 0.9

    def test_large_amount_with_nan(self):
        """Large amount with NaN should still produce a result."""
        rng = np.random.default_rng(42)
        data = rng.normal(loc=100.0, scale=10.0, size=(20, 20)).astype(np.float64)
        data[5, 5] = np.nan
        result = unsharp_mask(data, sigma=3.0, amount=5.0)
        assert result.shape == data.shape


class TestReduceNoiseEdgeCases:
    """Additional edge case tests for reduce_noise dispatch."""

    def test_kernel_size_alias_box(self, sample_image):
        """kernel_size kwarg should be mapped to size for box filter."""
        result = reduce_noise(sample_image, method="box", kernel_size=5)
        expected = box_filter(sample_image, size=5)
        np.testing.assert_array_equal(result, expected)

    def test_kernel_size_alias_astropy_box(self, sample_image):
        """kernel_size kwarg should be mapped to size for astropy_box."""
        result = reduce_noise(sample_image, method="astropy_box", kernel_size=3)
        expected = astropy_box_filter(sample_image, size=3)
        np.testing.assert_array_equal(result, expected)

    def test_astropy_gaussian_with_nan(self, image_with_nans):
        """reduce_noise(astropy_gaussian) should handle NaN data."""
        result = reduce_noise(image_with_nans, method="astropy_gaussian", sigma=1.0)
        assert result.shape == image_with_nans.shape
        assert not np.any(np.isnan(result))


class TestSmallImageEdgeCases:
    """Tests for filter functions with very small images."""

    def test_gaussian_1x1(self):
        """1x1 image should pass through gaussian filter."""
        data = np.array([[42.0]])
        result = gaussian_filter(data, sigma=1.0)
        assert result.shape == (1, 1)
        assert np.isfinite(result[0, 0])

    def test_median_2x2(self):
        """2x2 image with median filter size=3."""
        data = np.array([[1.0, 2.0], [3.0, 4.0]])
        result = median_filter(data, size=3)
        assert result.shape == (2, 2)

    def test_box_3x3(self):
        """3x3 image with box filter size=3."""
        data = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [7.0, 8.0, 9.0]])
        result = box_filter(data, size=3)
        assert result.shape == (3, 3)
        # Center pixel should be mean of all 9 values
        assert result[1, 1] == pytest.approx(5.0)

    def test_unsharp_mask_3x3(self):
        """3x3 image with unsharp mask."""
        data = np.array([[0.0, 0.0, 0.0], [0.0, 100.0, 0.0], [0.0, 0.0, 0.0]], dtype=np.float64)
        result = unsharp_mask(data, sigma=1.0, amount=1.0)
        assert result.shape == (3, 3)
        # Center bright pixel should be enhanced
        assert result[1, 1] > 100.0

    def test_sigma_clip_small_image(self):
        """Small image with one outlier."""
        data = np.array([[10.0, 10.0, 10.0], [10.0, 9999.0, 10.0], [10.0, 10.0, 10.0]])
        result = sigma_clip_pixels(data, sigma=3.0)
        assert result.shape == (3, 3)
        # Outlier should be replaced
        assert result[1, 1] < 100.0

    def test_astropy_gaussian_2x2(self):
        """2x2 image with astropy gaussian filter."""
        data = np.array([[10.0, 20.0], [30.0, 40.0]])
        result = astropy_gaussian_filter(data, sigma=0.5)
        assert result.shape == (2, 2)
        assert np.all(np.isfinite(result))
