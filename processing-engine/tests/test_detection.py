"""Tests for the source detection module."""

import numpy as np
import pytest
from astropy.table import Table

from app.processing.detection import (
    detect_extended_sources,
    detect_point_sources,
    detect_sources,
    estimate_fwhm,
    sources_to_dict,
)


def _make_starfield(n_stars=15, size=100, fwhm=3.0, peak_flux=500.0, seed=42):
    """Create a synthetic image with Gaussian point sources on a flat background."""
    rng = np.random.default_rng(seed)
    data = rng.normal(loc=100.0, scale=5.0, size=(size, size)).astype(np.float64)

    sigma = fwhm / 2.355
    y_coords = rng.integers(10, size - 10, n_stars)
    x_coords = rng.integers(10, size - 10, n_stars)

    yy, xx = np.mgrid[0:size, 0:size]
    for y, x in zip(y_coords, x_coords, strict=True):
        star = peak_flux * np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * sigma**2))
        data += star

    return data


@pytest.fixture
def starfield():
    """100x100 image with 15 stars on a noisy background."""
    return _make_starfield()


@pytest.fixture
def starfield_background():
    """Flat background and RMS arrays matching the starfield."""
    bg = np.full((100, 100), 100.0)
    rms = np.full((100, 100), 5.0)
    return bg, rms


@pytest.fixture
def faint_image():
    """Image with no detectable sources (pure noise)."""
    rng = np.random.default_rng(99)
    return rng.normal(loc=100.0, scale=5.0, size=(50, 50)).astype(np.float64)


class TestDetectPointSources:
    def test_finds_sources_daofind(self, starfield):
        bg_subtracted = starfield - 100.0
        sources = detect_point_sources(bg_subtracted, threshold=25.0, fwhm=3.0, method="daofind")
        assert sources is not None
        assert len(sources) > 0
        assert isinstance(sources, Table)

    def test_finds_sources_iraf(self, starfield):
        bg_subtracted = starfield - 100.0
        sources = detect_point_sources(bg_subtracted, threshold=25.0, fwhm=3.0, method="iraf")
        assert sources is not None
        assert len(sources) > 0

    def test_returns_none_for_no_sources(self, faint_image):
        bg_subtracted = faint_image - 100.0
        sources = detect_point_sources(bg_subtracted, threshold=1000.0, fwhm=3.0)
        assert sources is None

    def test_table_has_expected_columns(self, starfield):
        bg_subtracted = starfield - 100.0
        sources = detect_point_sources(bg_subtracted, threshold=25.0, fwhm=3.0)
        assert "xcentroid" in sources.colnames
        assert "ycentroid" in sources.colnames
        assert "flux" in sources.colnames

    def test_invalid_method_raises(self, starfield):
        with pytest.raises(ValueError, match="Unknown method"):
            detect_point_sources(starfield - 100.0, threshold=25.0, method="invalid")

    def test_custom_sharpness_bounds(self, starfield):
        bg_subtracted = starfield - 100.0
        sources = detect_point_sources(
            bg_subtracted, threshold=25.0, fwhm=3.0, sharplo=0.1, sharphi=2.0
        )
        assert sources is not None

    def test_high_threshold_finds_fewer(self, starfield):
        bg_subtracted = starfield - 100.0
        sources_low = detect_point_sources(bg_subtracted, threshold=15.0, fwhm=3.0)
        sources_high = detect_point_sources(bg_subtracted, threshold=100.0, fwhm=3.0)
        n_low = len(sources_low) if sources_low is not None else 0
        n_high = len(sources_high) if sources_high is not None else 0
        assert n_low >= n_high


class TestDetectExtendedSources:
    def test_finds_extended_sources(self, starfield):
        bg_subtracted = starfield - 100.0
        threshold = 15.0
        segm = detect_extended_sources(bg_subtracted, threshold=threshold, npixels=5)
        assert segm is not None
        assert segm.nlabels > 0

    def test_returns_none_for_no_sources(self, faint_image):
        bg_subtracted = faint_image - 100.0
        segm = detect_extended_sources(bg_subtracted, threshold=1000.0, npixels=5)
        assert segm is None

    def test_no_deblend(self, starfield):
        bg_subtracted = starfield - 100.0
        segm = detect_extended_sources(bg_subtracted, threshold=15.0, npixels=5, deblend=False)
        assert segm is not None

    def test_with_mask(self, starfield):
        bg_subtracted = starfield - 100.0
        mask = np.zeros((100, 100), dtype=bool)
        mask[:50, :] = True  # mask top half
        segm = detect_extended_sources(bg_subtracted, threshold=15.0, npixels=5, mask=mask)
        # Should find fewer or equal sources with mask
        segm_full = detect_extended_sources(bg_subtracted, threshold=15.0, npixels=5)
        if segm is not None and segm_full is not None:
            assert segm.nlabels <= segm_full.nlabels

    def test_connectivity_parameter(self, starfield):
        bg_subtracted = starfield - 100.0
        segm4 = detect_extended_sources(bg_subtracted, threshold=15.0, npixels=5, connectivity=4)
        segm8 = detect_extended_sources(bg_subtracted, threshold=15.0, npixels=5, connectivity=8)
        assert segm4 is not None
        assert segm8 is not None


class TestDetectSources:
    def test_auto_method(self, starfield, starfield_background):
        bg, rms = starfield_background
        result = detect_sources(starfield, bg, rms, method="auto", threshold_sigma=5.0)
        assert isinstance(result, dict)
        assert result["n_sources"] > 0
        assert result["method"] in ("daofind", "segmentation")

    def test_daofind_method(self, starfield, starfield_background):
        bg, rms = starfield_background
        result = detect_sources(starfield, bg, rms, method="daofind", threshold_sigma=5.0)
        assert result["method"] == "daofind"
        assert result["n_sources"] > 0
        assert result["sources"] is not None

    def test_iraf_method(self, starfield, starfield_background):
        bg, rms = starfield_background
        result = detect_sources(starfield, bg, rms, method="iraf", threshold_sigma=5.0)
        assert result["method"] == "iraf"
        assert result["n_sources"] > 0

    def test_segmentation_method(self, starfield, starfield_background):
        bg, rms = starfield_background
        result = detect_sources(
            starfield, bg, rms, method="segmentation", threshold_sigma=3.0, npixels=5
        )
        assert result["method"] == "segmentation"
        assert result["n_sources"] > 0
        assert result["segmentation"] is not None
        assert result["catalog"] is not None

    def test_unknown_method_raises(self, starfield, starfield_background):
        bg, rms = starfield_background
        with pytest.raises(ValueError, match="Unknown method"):
            detect_sources(starfield, bg, rms, method="invalid")

    def test_high_threshold_finds_fewer(self, starfield, starfield_background):
        bg, rms = starfield_background
        result_low = detect_sources(starfield, bg, rms, method="daofind", threshold_sigma=3.0)
        result_high = detect_sources(starfield, bg, rms, method="daofind", threshold_sigma=10.0)
        assert result_low["n_sources"] >= result_high["n_sources"]

    def test_result_keys(self, starfield, starfield_background):
        bg, rms = starfield_background
        result = detect_sources(starfield, bg, rms)
        expected_keys = {
            "method",
            "threshold_sigma",
            "threshold_value",
            "n_sources",
            "sources",
            "segmentation",
            "catalog",
        }
        assert set(result.keys()) == expected_keys

    def test_no_sources_returns_zero(self, faint_image):
        bg = np.full_like(faint_image, 100.0)
        rms = np.full_like(faint_image, 5.0)
        result = detect_sources(faint_image, bg, rms, method="daofind", threshold_sigma=100.0)
        assert result["n_sources"] == 0
        assert result["sources"] is None

    def test_auto_selects_segmentation_for_variable_rms(self, starfield):
        bg = np.full((100, 100), 100.0)
        # High RMS variation should trigger segmentation
        rms = np.linspace(1, 20, 100).reshape(1, 100).repeat(100, axis=0)
        result = detect_sources(starfield, bg, rms, method="auto", threshold_sigma=3.0, npixels=5)
        assert result["method"] == "segmentation"


class TestSourcesToDict:
    def test_converts_table(self, starfield):
        bg_subtracted = starfield - 100.0
        sources = detect_point_sources(bg_subtracted, threshold=25.0, fwhm=3.0)
        result = sources_to_dict(sources)
        assert isinstance(result, list)
        assert len(result) > 0
        assert isinstance(result[0], dict)
        assert "xcentroid" in result[0]
        assert "flux" in result[0]

    def test_none_returns_empty_list(self):
        assert sources_to_dict(None) == []

    def test_values_are_python_types(self, starfield):
        bg_subtracted = starfield - 100.0
        sources = detect_point_sources(bg_subtracted, threshold=25.0, fwhm=3.0)
        result = sources_to_dict(sources)
        for source in result:
            for val in source.values():
                assert not hasattr(val, "dtype"), f"Value {val} is still a numpy type"


class TestEstimateFwhm:
    def test_estimates_fwhm(self, starfield):
        bg_subtracted = starfield - 100.0
        fwhm = estimate_fwhm(bg_subtracted, threshold=25.0)
        assert fwhm is not None
        assert 1.0 <= fwhm <= 20.0

    def test_returns_none_for_no_sources(self, faint_image):
        bg_subtracted = faint_image - 100.0
        fwhm = estimate_fwhm(bg_subtracted, threshold=1000.0)
        assert fwhm is None

    def test_result_clipped_to_range(self, starfield):
        bg_subtracted = starfield - 100.0
        fwhm = estimate_fwhm(bg_subtracted, threshold=25.0)
        if fwhm is not None:
            assert 1.0 <= fwhm <= 20.0
