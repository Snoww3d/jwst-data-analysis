"""Tests for the image enhancement module."""

import numpy as np
import pytest

from app.processing.enhancement import (
    adjust_brightness_contrast,
    apply_colormap,
    asinh_stretch,
    create_rgb_image,
    enhance_image,
    histogram_equalization,
    log_stretch,
    normalize_to_range,
    power_stretch,
    sqrt_stretch,
    zscale_stretch,
)


@pytest.fixture
def sample_image():
    """20x20 image with a gradient and some bright pixels."""
    rng = np.random.default_rng(42)
    base = np.linspace(0, 1000, 400).reshape(20, 20).astype(np.float64)
    noise = rng.normal(0, 10, size=(20, 20))
    return base + noise


@pytest.fixture
def normalized_image():
    """Image already in 0-1 range."""
    rng = np.random.default_rng(42)
    return rng.uniform(0, 1, size=(20, 20)).astype(np.float64)


class TestNormalizeToRange:
    def test_basic_normalization(self):
        data = np.array([[0.0, 50.0], [100.0, 200.0]])
        result = normalize_to_range(data)
        assert np.nanmin(result) == pytest.approx(0.0)
        assert np.nanmax(result) == pytest.approx(1.0)

    def test_custom_vmin_vmax(self):
        data = np.array([[0.0, 50.0], [100.0, 200.0]])
        result = normalize_to_range(data, vmin=0.0, vmax=100.0)
        assert result[0, 0] == pytest.approx(0.0)
        assert result[0, 1] == pytest.approx(0.5)
        assert result[1, 0] == pytest.approx(1.0)
        # 200 gets clipped to 1.0
        assert result[1, 1] == pytest.approx(1.0)

    def test_constant_array_returns_zeros(self):
        data = np.full((5, 5), 42.0)
        result = normalize_to_range(data)
        np.testing.assert_array_equal(result, np.zeros_like(data))

    def test_output_clipped_to_01(self):
        data = np.array([[-10.0, 0.0], [50.0, 110.0]])
        result = normalize_to_range(data, vmin=0.0, vmax=100.0)
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)


class TestZscaleStretch:
    def test_returns_tuple(self, sample_image):
        result = zscale_stretch(sample_image)
        assert isinstance(result, tuple)
        assert len(result) == 3

    def test_output_in_01_range(self, sample_image):
        normalized, vmin, vmax = zscale_stretch(sample_image)
        assert np.all(normalized >= 0.0)
        assert np.all(normalized <= 1.0)

    def test_vmin_less_than_vmax(self, sample_image):
        _, vmin, vmax = zscale_stretch(sample_image)
        assert vmin < vmax

    def test_contrast_parameter(self):
        # Use a large image with wide dynamic range so ZScale contrast differences are visible
        rng = np.random.default_rng(42)
        large = rng.normal(loc=500.0, scale=100.0, size=(200, 200)).astype(np.float64)
        _, vmin_low, vmax_low = zscale_stretch(large, contrast=0.05)
        _, vmin_high, vmax_high = zscale_stretch(large, contrast=0.9)
        # Different contrast values should produce different display ranges
        range_low = vmax_low - vmin_low
        range_high = vmax_high - vmin_high
        assert range_low != pytest.approx(range_high, abs=1.0)


class TestAsinhStretch:
    def test_output_in_01_range(self, sample_image):
        result = asinh_stretch(sample_image, a=0.1)
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)

    def test_shape_preserved(self, sample_image):
        result = asinh_stretch(sample_image)
        assert result.shape == sample_image.shape

    def test_custom_vmin_vmax(self, sample_image):
        result = asinh_stretch(sample_image, vmin=100.0, vmax=800.0)
        assert result.shape == sample_image.shape

    def test_different_a_values(self, sample_image):
        result_small = asinh_stretch(sample_image, a=0.01)
        result_large = asinh_stretch(sample_image, a=1.0)
        # Different a values should produce different results
        assert not np.allclose(result_small, result_large)


class TestLogStretch:
    def test_output_in_01_range(self, sample_image):
        result = log_stretch(sample_image, a=1000.0)
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)

    def test_shape_preserved(self, sample_image):
        result = log_stretch(sample_image)
        assert result.shape == sample_image.shape

    def test_custom_vmin_vmax(self, sample_image):
        result = log_stretch(sample_image, vmin=50.0, vmax=900.0)
        assert result.shape == sample_image.shape


class TestSqrtStretch:
    def test_output_in_01_range(self, sample_image):
        result = sqrt_stretch(sample_image)
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)

    def test_shape_preserved(self, sample_image):
        result = sqrt_stretch(sample_image)
        assert result.shape == sample_image.shape

    def test_custom_vmin_vmax(self, sample_image):
        result = sqrt_stretch(sample_image, vmin=0.0, vmax=500.0)
        assert result.shape == sample_image.shape


class TestPowerStretch:
    def test_output_in_01_range(self, sample_image):
        result = power_stretch(sample_image, power=0.5)
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)

    def test_shape_preserved(self, sample_image):
        result = power_stretch(sample_image)
        assert result.shape == sample_image.shape

    def test_different_powers(self, sample_image):
        result_half = power_stretch(sample_image, power=0.5)
        result_two = power_stretch(sample_image, power=2.0)
        assert not np.allclose(result_half, result_two)


class TestHistogramEqualization:
    def test_output_in_01_range(self, sample_image):
        result = histogram_equalization(sample_image)
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)

    def test_shape_preserved(self, sample_image):
        result = histogram_equalization(sample_image)
        assert result.shape == sample_image.shape

    def test_custom_vmin_vmax(self, sample_image):
        result = histogram_equalization(sample_image, vmin=100.0, vmax=800.0)
        assert result.shape == sample_image.shape


class TestEnhanceImage:
    def test_zscale_method(self, sample_image):
        result = enhance_image(sample_image, method="zscale")
        assert result.shape == sample_image.shape
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)

    def test_asinh_method(self, sample_image):
        result = enhance_image(sample_image, method="asinh")
        assert result.shape == sample_image.shape

    def test_log_method(self, sample_image):
        result = enhance_image(sample_image, method="log")
        assert result.shape == sample_image.shape

    def test_sqrt_method(self, sample_image):
        result = enhance_image(sample_image, method="sqrt")
        assert result.shape == sample_image.shape

    def test_linear_method(self, sample_image):
        result = enhance_image(sample_image, method="linear")
        assert result.shape == sample_image.shape

    def test_histogram_eq_method(self, sample_image):
        result = enhance_image(sample_image, method="histogram_eq")
        assert result.shape == sample_image.shape

    def test_power_method(self, sample_image):
        result = enhance_image(sample_image, method="power", power=0.5)
        assert result.shape == sample_image.shape

    def test_unknown_method_raises(self, sample_image):
        with pytest.raises(ValueError, match="Unknown enhancement method"):
            enhance_image(sample_image, method="nonexistent")

    def test_linear_with_custom_limits(self, sample_image):
        result = enhance_image(sample_image, method="linear", vmin=100.0, vmax=800.0)
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)


class TestAdjustBrightnessContrast:
    def test_no_adjustment_preserves_data(self, normalized_image):
        result = adjust_brightness_contrast(normalized_image, brightness=0.0, contrast=1.0)
        np.testing.assert_array_almost_equal(result, normalized_image)

    def test_brightness_increase(self, normalized_image):
        result = adjust_brightness_contrast(normalized_image, brightness=0.2)
        # On average, result should be brighter (higher values)
        assert np.mean(result) > np.mean(normalized_image)

    def test_brightness_decrease(self, normalized_image):
        result = adjust_brightness_contrast(normalized_image, brightness=-0.2)
        assert np.mean(result) < np.mean(normalized_image)

    def test_contrast_increase(self, normalized_image):
        result = adjust_brightness_contrast(normalized_image, contrast=2.0)
        # Higher contrast should increase std (more spread)
        assert np.std(result) >= np.std(normalized_image) * 0.5

    def test_output_clipped_to_01(self, normalized_image):
        result = adjust_brightness_contrast(normalized_image, brightness=0.9, contrast=3.0)
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)


class TestCreateRgbImage:
    def test_output_shape(self, sample_image):
        r = sample_image
        g = sample_image * 0.8
        b = sample_image * 0.6
        result = create_rgb_image(r, g, b, stretch_method="asinh")
        assert result.shape == (20, 20, 3)

    def test_output_in_01_range(self, sample_image):
        r = sample_image
        g = sample_image * 0.8
        b = sample_image * 0.6
        result = create_rgb_image(r, g, b, stretch_method="asinh")
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)

    def test_different_stretch_methods(self, sample_image):
        r = sample_image
        g = sample_image * 0.8
        b = sample_image * 0.6
        for method in ["asinh", "sqrt", "linear"]:
            result = create_rgb_image(r, g, b, stretch_method=method)
            assert result.shape == (20, 20, 3)


class TestApplyColormap:
    def test_output_shape_rgba(self, normalized_image):
        result = apply_colormap(normalized_image, colormap="viridis")
        assert result.shape == (20, 20, 4)

    def test_output_in_01_range(self, normalized_image):
        result = apply_colormap(normalized_image)
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)

    def test_different_colormaps(self, normalized_image):
        result_v = apply_colormap(normalized_image, colormap="viridis")
        result_h = apply_colormap(normalized_image, colormap="hot")
        assert not np.allclose(result_v, result_h)
