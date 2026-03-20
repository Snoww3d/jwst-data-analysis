"""Tests for JWST instrument constants and pixel scale helper."""

from app.instruments import (
    DEFAULT_PIXEL_SCALE_ARCSEC,
    INSTRUMENT_PIXEL_SCALE_ARCSEC,
    get_pixel_scale,
)


class TestGetPixelScale:
    """Tests for get_pixel_scale instrument resolution lookup."""

    def test_nircam_short_wave(self):
        """NIRCAM below 2.4 µm should return SW scale (0.031)."""
        assert get_pixel_scale("NIRCAM", 1.5) == INSTRUMENT_PIXEL_SCALE_ARCSEC["NIRCAM_SW"]

    def test_nircam_long_wave(self):
        """NIRCAM at or above 2.4 µm should return LW scale (0.063)."""
        assert get_pixel_scale("NIRCAM", 2.4) == INSTRUMENT_PIXEL_SCALE_ARCSEC["NIRCAM_LW"]
        assert get_pixel_scale("NIRCAM", 4.4) == INSTRUMENT_PIXEL_SCALE_ARCSEC["NIRCAM_LW"]

    def test_nircam_no_wavelength_defaults_to_sw(self):
        """NIRCAM without wavelength info should default to SW (finer scale)."""
        assert get_pixel_scale("NIRCAM") == INSTRUMENT_PIXEL_SCALE_ARCSEC["NIRCAM_SW"]

    def test_miri(self):
        assert get_pixel_scale("MIRI") == INSTRUMENT_PIXEL_SCALE_ARCSEC["MIRI"]

    def test_niriss(self):
        assert get_pixel_scale("NIRISS") == INSTRUMENT_PIXEL_SCALE_ARCSEC["NIRISS"]

    def test_nirspec(self):
        assert get_pixel_scale("NIRSPEC") == INSTRUMENT_PIXEL_SCALE_ARCSEC["NIRSPEC"]

    def test_case_insensitive(self):
        """Instrument names should be case-insensitive."""
        assert get_pixel_scale("miri") == get_pixel_scale("MIRI")
        assert get_pixel_scale("Nircam", 1.0) == get_pixel_scale("NIRCAM", 1.0)

    def test_unknown_instrument_returns_default(self):
        assert get_pixel_scale("FGS") == DEFAULT_PIXEL_SCALE_ARCSEC

    def test_none_instrument_returns_default(self):
        assert get_pixel_scale(None) == DEFAULT_PIXEL_SCALE_ARCSEC

    def test_miri_scale_coarser_than_nircam(self):
        """MIRI should always be coarser than any NIRCAM mode."""
        miri = get_pixel_scale("MIRI")
        nircam_sw = get_pixel_scale("NIRCAM", 1.0)
        nircam_lw = get_pixel_scale("NIRCAM", 4.0)
        assert miri > nircam_sw
        assert miri > nircam_lw
