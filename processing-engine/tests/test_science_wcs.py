"""Tests for the astropy-backed WCS helpers in app.science.wcs."""

import numpy as np

from app.science.wcs import celestial_wcs, wcs_params_from_header


# A real JWST _i2d header shape: PC matrix + CDELT, no CD keywords.
# Values lifted from jw01192-o010_t002_miri_f560w_i2d.fits (~107 deg rotation).
JWST_I2D_HEADER = {
    "CTYPE1": "RA---TAN",
    "CTYPE2": "DEC--TAN",
    "CRPIX1": 518.8269680140714,
    "CRPIX2": 590.6839111081091,
    "CRVAL1": 85.21620289475666,
    "CRVAL2": -2.491669730412056,
    "CDELT1": 3.08077556750194e-05,
    "CDELT2": 3.08077556750194e-05,
    "PC1_1": -0.2951182660246448,
    "PC1_2": 0.9554607313011911,
    "PC2_1": 0.9554607313011911,
    "PC2_2": 0.2951182660246448,
}

# The equivalent CD-matrix spelling of the same pointing.
CD_HEADER = {
    "CTYPE1": "RA---TAN",
    "CTYPE2": "DEC--TAN",
    "CRPIX1": 512.0,
    "CRPIX2": 512.0,
    "CRVAL1": 180.5,
    "CRVAL2": -45.2,
    "CD1_1": -1e-5,
    "CD1_2": 0.0,
    "CD2_1": 0.0,
    "CD2_2": 1e-5,
}


class TestCelestialWcs:
    def test_returns_wcs_for_celestial_header(self):
        w = celestial_wcs(JWST_I2D_HEADER)
        assert w is not None
        assert w.naxis == 2
        assert w.has_celestial

    def test_returns_none_without_celestial_keywords(self):
        assert celestial_wcs({"NAXIS": 2, "BUNIT": "MJy/sr"}) is None

    def test_returns_none_for_none_header(self):
        assert celestial_wcs(None) is None

    def test_reduces_a_cube_header_to_its_celestial_axes(self):
        header = dict(JWST_I2D_HEADER)
        header.update(
            {
                "WCSAXES": 3,
                "CTYPE3": "WAVE",
                "CRPIX3": 1.0,
                "CRVAL3": 5.0,
                "CDELT3": 0.01,
            }
        )
        w = celestial_wcs(header)
        assert w is not None
        assert w.naxis == 2


class TestWcsParamsFromHeader:
    def test_pc_matrix_rotation_survives(self):
        """The regression this whole change exists for.

        The hand-rolled parse read CD only, fell back to CDELT, and produced a
        diagonal (unrotated) matrix for every JWST _i2d product.
        """
        params = wcs_params_from_header(JWST_I2D_HEADER)
        assert params is not None

        expected = celestial_wcs(JWST_I2D_HEADER).pixel_scale_matrix
        assert np.isclose(params["cd1_1"], expected[0][0])
        assert np.isclose(params["cd1_2"], expected[0][1])
        assert np.isclose(params["cd2_1"], expected[1][0])
        assert np.isclose(params["cd2_2"], expected[1][1])

        # Off-diagonal terms carry the rotation — the old code zeroed them.
        assert abs(params["cd1_2"]) > 1e-6
        assert abs(params["cd2_1"]) > 1e-6
        # And axis 1 is sky-flipped, which CDELT1 alone did not express.
        assert params["cd1_1"] < 0

    def test_reference_point_is_passed_through(self):
        params = wcs_params_from_header(JWST_I2D_HEADER)
        assert np.isclose(params["crpix1"], JWST_I2D_HEADER["CRPIX1"])
        assert np.isclose(params["crpix2"], JWST_I2D_HEADER["CRPIX2"])
        assert np.isclose(params["crval1"], JWST_I2D_HEADER["CRVAL1"])
        assert np.isclose(params["crval2"], JWST_I2D_HEADER["CRVAL2"])
        assert params["ctype1"] == "RA---TAN"
        assert params["ctype2"] == "DEC--TAN"

    def test_cdelt_is_the_on_sky_pixel_scale(self):
        params = wcs_params_from_header(JWST_I2D_HEADER)
        # Magnitudes, so a rotated frame still reports its true scale.
        assert np.isclose(params["cdelt1"], 3.08077556750194e-05)
        assert np.isclose(params["cdelt2"], 3.08077556750194e-05)

    def test_cd_matrix_header_is_unchanged_by_astropy(self):
        params = wcs_params_from_header(CD_HEADER)
        assert np.isclose(params["cd1_1"], -1e-5)
        assert np.isclose(params["cd2_2"], 1e-5)
        assert np.isclose(params["cd1_2"], 0.0)
        assert np.isclose(params["cd2_1"], 0.0)

    def test_cdelt_only_header_is_supported(self):
        params = wcs_params_from_header(
            {
                "CTYPE1": "RA---TAN",
                "CTYPE2": "DEC--TAN",
                "CRPIX1": 50.0,
                "CRPIX2": 50.0,
                "CRVAL1": 10.0,
                "CRVAL2": 20.0,
                "CDELT1": -1e-4,
                "CDELT2": 1e-4,
            }
        )
        assert np.isclose(params["cd1_1"], -1e-4)
        assert np.isclose(params["cd2_2"], 1e-4)

    def test_ra_zero_at_crpix_zero_still_returns_params(self):
        """Regression for #1235 — a valid pointing near RA=0 is not 'no WCS'."""
        params = wcs_params_from_header(
            {
                "CTYPE1": "RA---TAN",
                "CTYPE2": "DEC--TAN",
                "CRPIX1": 0.0,
                "CRPIX2": 0.0,
                "CRVAL1": 0.0,
                "CRVAL2": 0.0,
                "CDELT1": -1e-4,
                "CDELT2": 1e-4,
            }
        )
        assert params is not None
        assert params["crval1"] == 0.0
        assert params["crpix1"] == 0.0

    def test_header_without_wcs_returns_none(self):
        assert wcs_params_from_header({"NAXIS": 2, "BUNIT": "MJy/sr"}) is None

    def test_none_header_returns_none(self):
        assert wcs_params_from_header(None) is None

    def test_all_values_are_json_safe_primitives(self):
        params = wcs_params_from_header(JWST_I2D_HEADER)
        for key in (
            "crpix1",
            "crpix2",
            "crval1",
            "crval2",
            "cdelt1",
            "cdelt2",
            "cd1_1",
            "cd1_2",
            "cd2_1",
            "cd2_2",
        ):
            assert type(params[key]) is float, key
        assert type(params["ctype1"]) is str
        assert type(params["ctype2"]) is str
