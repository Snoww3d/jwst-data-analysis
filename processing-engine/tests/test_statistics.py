"""Tests for the statistical analysis module."""

import math

import numpy as np
import pytest

from app.processing.statistics import (
    compare_images,
    compute_advanced_stats,
    compute_basic_stats,
    compute_histogram,
    compute_percentiles,
    compute_robust_stats,
    compute_snr,
    compute_statistics,
)


@pytest.fixture
def sample_data():
    """Simple 10x10 image with known values."""
    rng = np.random.default_rng(42)
    return rng.normal(loc=100.0, scale=10.0, size=(10, 10)).astype(np.float64)


@pytest.fixture
def data_with_nans(sample_data):
    """Sample data with some NaN pixels."""
    d = sample_data.copy()
    d[0, 0] = np.nan
    d[5, 5] = np.nan
    d[9, 9] = np.nan
    return d


@pytest.fixture
def mask_array():
    """Boolean mask excluding corner pixels."""
    m = np.zeros((10, 10), dtype=bool)
    m[0, 0] = True
    m[0, 9] = True
    m[9, 0] = True
    m[9, 9] = True
    return m


class TestComputeBasicStats:
    def test_returns_expected_keys(self, sample_data):
        result = compute_basic_stats(sample_data)
        expected_keys = {"min", "max", "mean", "median", "std", "sum", "n_pixels", "n_nan"}
        assert set(result.keys()) == expected_keys

    def test_correct_values_for_known_data(self):
        data = np.array([[1.0, 2.0], [3.0, 4.0]])
        result = compute_basic_stats(data)
        assert result["min"] == pytest.approx(1.0)
        assert result["max"] == pytest.approx(4.0)
        assert result["mean"] == pytest.approx(2.5)
        assert result["median"] == pytest.approx(2.5)
        assert result["sum"] == pytest.approx(10.0)
        assert result["n_pixels"] == 4
        assert result["n_nan"] == 0

    def test_handles_nan_values(self, data_with_nans):
        result = compute_basic_stats(data_with_nans)
        assert result["n_nan"] == 3
        assert result["n_pixels"] == 97

    def test_with_mask(self, sample_data, mask_array):
        result = compute_basic_stats(sample_data, mask=mask_array)
        assert result["n_pixels"] == 96

    def test_all_nan_returns_nan_stats(self):
        data = np.full((3, 3), np.nan)
        result = compute_basic_stats(data)
        assert math.isnan(result["min"])
        assert math.isnan(result["mean"])
        assert result["n_pixels"] == 0
        assert result["n_nan"] == 9

    def test_all_masked_returns_nan_stats(self):
        data = np.ones((3, 3))
        mask = np.ones((3, 3), dtype=bool)
        result = compute_basic_stats(data, mask=mask)
        assert math.isnan(result["min"])
        assert result["n_pixels"] == 0


class TestComputeRobustStats:
    def test_returns_expected_keys(self, sample_data):
        result = compute_robust_stats(sample_data)
        expected_keys = {"clipped_mean", "clipped_median", "clipped_std", "sigma", "maxiters"}
        assert set(result.keys()) == expected_keys

    def test_clipped_stats_resist_outliers(self):
        rng = np.random.default_rng(42)
        data = rng.normal(loc=50.0, scale=5.0, size=(20, 20)).astype(np.float64)
        data[0, 0] = 10000.0  # extreme outlier
        result = compute_robust_stats(data, sigma=3.0)
        assert result["clipped_mean"] == pytest.approx(50.0, abs=3.0)
        assert result["clipped_median"] == pytest.approx(50.0, abs=3.0)

    def test_custom_sigma_and_maxiters(self, sample_data):
        result = compute_robust_stats(sample_data, sigma=2.0, maxiters=10)
        assert result["sigma"] == 2.0
        assert result["maxiters"] == 10

    def test_with_mask(self, sample_data, mask_array):
        result = compute_robust_stats(sample_data, mask=mask_array)
        assert not math.isnan(result["clipped_mean"])

    def test_handles_nans(self, data_with_nans):
        result = compute_robust_stats(data_with_nans)
        assert not math.isnan(result["clipped_mean"])


class TestComputeAdvancedStats:
    def test_returns_expected_keys(self, sample_data):
        result = compute_advanced_stats(sample_data)
        expected_keys = {"biweight_location", "biweight_scale", "mad_std"}
        assert set(result.keys()) == expected_keys

    def test_biweight_values_reasonable(self, sample_data):
        result = compute_advanced_stats(sample_data)
        assert result["biweight_location"] == pytest.approx(100.0, abs=5.0)
        assert result["biweight_scale"] > 0
        assert result["mad_std"] > 0

    def test_insufficient_data_returns_nan(self):
        data = np.array([[1.0, 2.0], [3.0, 4.0]])
        result = compute_advanced_stats(data)
        assert math.isnan(result["biweight_location"])
        assert math.isnan(result["biweight_scale"])
        assert math.isnan(result["mad_std"])

    def test_with_mask(self, sample_data, mask_array):
        result = compute_advanced_stats(sample_data, mask=mask_array)
        assert not math.isnan(result["biweight_location"])

    def test_handles_nans(self, data_with_nans):
        result = compute_advanced_stats(data_with_nans)
        assert not math.isnan(result["biweight_location"])


class TestComputeStatistics:
    def test_combines_all_stat_types(self, sample_data):
        result = compute_statistics(sample_data)
        assert "min" in result
        assert "clipped_mean" in result
        assert "biweight_location" in result
        assert "shape" in result
        assert "dtype" in result

    def test_shape_metadata(self, sample_data):
        result = compute_statistics(sample_data)
        assert result["shape"] == [10, 10]
        assert result["dtype"] == "float64"

    def test_custom_sigma(self, sample_data):
        result = compute_statistics(sample_data, sigma=2.0)
        assert not math.isnan(result["clipped_mean"])

    def test_with_mask(self, sample_data, mask_array):
        result = compute_statistics(sample_data, mask=mask_array)
        assert result["n_pixels"] == 96


class TestComputeHistogram:
    def test_returns_expected_keys(self, sample_data):
        result = compute_histogram(sample_data)
        expected_keys = {"counts", "bin_edges", "bin_centers", "n_bins", "range"}
        assert set(result.keys()) == expected_keys

    def test_default_256_bins(self, sample_data):
        result = compute_histogram(sample_data)
        assert result["n_bins"] == 256
        assert len(result["counts"]) == 256
        assert len(result["bin_edges"]) == 257
        assert len(result["bin_centers"]) == 256

    def test_custom_bins(self, sample_data):
        result = compute_histogram(sample_data, bins=10)
        assert result["n_bins"] == 10
        assert len(result["counts"]) == 10

    def test_custom_range(self, sample_data):
        result = compute_histogram(sample_data, range=(80.0, 120.0))
        assert result["range"] == (80.0, 120.0)

    def test_total_counts_match_pixels(self, sample_data):
        result = compute_histogram(sample_data)
        assert sum(result["counts"]) == sample_data.size

    def test_with_mask(self, sample_data, mask_array):
        result = compute_histogram(sample_data, mask=mask_array)
        assert sum(result["counts"]) == sample_data.size - mask_array.sum()

    def test_handles_nans(self, data_with_nans):
        result = compute_histogram(data_with_nans)
        assert sum(result["counts"]) == data_with_nans.size - 3


class TestComputePercentiles:
    def test_default_percentiles(self, sample_data):
        result = compute_percentiles(sample_data)
        expected_keys = {"p1", "p5", "p10", "p25", "p50", "p75", "p90", "p95", "p99"}
        assert set(result.keys()) == expected_keys

    def test_percentiles_are_ordered(self, sample_data):
        result = compute_percentiles(sample_data)
        assert result["p1"] <= result["p25"] <= result["p50"] <= result["p75"] <= result["p99"]

    def test_custom_percentiles(self, sample_data):
        result = compute_percentiles(sample_data, percentiles=[10, 50, 90])
        assert set(result.keys()) == {"p10", "p50", "p90"}

    def test_with_mask(self, sample_data, mask_array):
        result = compute_percentiles(sample_data, mask=mask_array)
        assert "p50" in result

    def test_handles_nans(self, data_with_nans):
        result = compute_percentiles(data_with_nans)
        assert not math.isnan(result["p50"])


class TestComputeSnr:
    def test_returns_expected_keys(self, sample_data):
        result = compute_snr(sample_data)
        expected_keys = {"peak_snr", "mean_snr", "background", "noise"}
        assert set(result.keys()) == expected_keys

    def test_positive_snr_for_signal(self):
        rng = np.random.default_rng(42)
        data = rng.normal(loc=100.0, scale=5.0, size=(20, 20)).astype(np.float64)
        data[10, 10] = 200.0  # bright source
        result = compute_snr(data)
        assert result["peak_snr"] > 0
        assert result["mean_snr"] > 0

    def test_custom_background_and_noise(self, sample_data):
        result = compute_snr(sample_data, background=100.0, noise=10.0)
        assert result["background"] == pytest.approx(100.0)
        assert result["noise"] == pytest.approx(10.0)

    def test_zero_noise_returns_nan(self, sample_data):
        result = compute_snr(sample_data, background=100.0, noise=0.0)
        assert math.isnan(result["peak_snr"])
        assert math.isnan(result["mean_snr"])

    def test_negative_noise_returns_nan(self, sample_data):
        result = compute_snr(sample_data, background=100.0, noise=-1.0)
        assert math.isnan(result["peak_snr"])

    def test_with_mask(self, sample_data, mask_array):
        result = compute_snr(sample_data, mask=mask_array)
        assert result["peak_snr"] > 0

    def test_auto_estimates_background(self, sample_data):
        result = compute_snr(sample_data)
        assert result["background"] == pytest.approx(100.0, abs=5.0)
        assert result["noise"] > 0


class TestCompareImages:
    def test_identical_images_zero_diff(self, sample_data):
        result = compare_images(sample_data, sample_data)
        assert result["mean_diff"] == pytest.approx(0.0)
        assert result["median_diff"] == pytest.approx(0.0)
        assert result["max_diff"] == pytest.approx(0.0)
        assert result["rms_diff"] == pytest.approx(0.0)

    def test_known_offset(self):
        data1 = np.ones((5, 5)) * 10.0
        data2 = np.ones((5, 5)) * 7.0
        result = compare_images(data1, data2)
        assert result["mean_diff"] == pytest.approx(3.0)
        assert result["n_pixels"] == 25

    def test_shape_mismatch_raises(self):
        data1 = np.ones((5, 5))
        data2 = np.ones((3, 3))
        with pytest.raises(ValueError, match="Shape mismatch"):
            compare_images(data1, data2)

    def test_with_mask(self, sample_data, mask_array):
        data2 = sample_data + 1.0
        result = compare_images(sample_data, data2, mask=mask_array)
        assert result["mean_diff"] == pytest.approx(-1.0)
        assert result["n_pixels"] == 96

    def test_handles_nans(self, data_with_nans):
        data2 = data_with_nans.copy()
        result = compare_images(data_with_nans, data2)
        assert result["mean_diff"] == pytest.approx(0.0)
