"""Tests for FITS Spectral Data endpoint."""

from unittest.mock import patch

import numpy as np
import pytest
from astropy.io import fits as astropy_fits
from fastapi.testclient import TestClient

from app.storage.local_storage import LocalStorage


_STORAGE_PATCH_TARGET = "app.storage.helpers.get_storage_provider"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def temp_spectral_fits(tmp_path):
    """Create a temporary FITS file with spectral data (WAVELENGTH + FLUX)."""
    filepath = tmp_path / "test_x1d.fits"
    primary = astropy_fits.PrimaryHDU()

    n_points = 100
    col_wave = astropy_fits.Column(
        name="WAVELENGTH",
        format="D",
        unit="um",
        array=np.linspace(0.6, 5.3, n_points),
    )
    col_flux = astropy_fits.Column(
        name="FLUX",
        format="D",
        unit="Jy",
        array=np.random.default_rng(42).normal(1.0, 0.1, n_points),
    )
    col_err = astropy_fits.Column(
        name="FLUX_ERROR",
        format="D",
        unit="Jy",
        array=np.full(n_points, 0.05),
    )
    col_dq = astropy_fits.Column(
        name="DQ",
        format="J",
        array=np.zeros(n_points, dtype=np.int32),
    )

    table_hdu = astropy_fits.BinTableHDU.from_columns(
        [col_wave, col_flux, col_err, col_dq], name="EXTRACT1D"
    )
    hdul = astropy_fits.HDUList([primary, table_hdu])
    hdul.writeto(filepath, overwrite=True)
    return filepath


@pytest.fixture
def temp_spectral_with_units(tmp_path):
    """Create spectral FITS with various unit columns."""
    filepath = tmp_path / "test_units_x1d.fits"
    primary = astropy_fits.PrimaryHDU()

    n_points = 50
    col_wave = astropy_fits.Column(
        name="WAVELENGTH",
        format="D",
        unit="um",
        array=np.linspace(1.0, 5.0, n_points),
    )
    col_flux = astropy_fits.Column(
        name="FLUX",
        format="D",
        unit="Jy",
        array=np.ones(n_points),
    )
    col_sb = astropy_fits.Column(
        name="SURF_BRIGHT",
        format="D",
        unit="MJy/sr",
        array=np.ones(n_points) * 2.0,
    )
    col_net = astropy_fits.Column(
        name="NET",
        format="D",
        array=np.ones(n_points) * 0.5,
    )
    col_bg = astropy_fits.Column(
        name="BACKGROUND",
        format="D",
        array=np.ones(n_points) * 0.1,
    )

    table_hdu = astropy_fits.BinTableHDU.from_columns(
        [col_wave, col_flux, col_sb, col_net, col_bg], name="EXTRACT1D"
    )
    hdul = astropy_fits.HDUList([primary, table_hdu])
    hdul.writeto(filepath, overwrite=True)
    return filepath


@pytest.fixture
def temp_no_wavelength_fits(tmp_path):
    """Create a FITS table without a WAVELENGTH column."""
    filepath = tmp_path / "test_cat.fits"
    primary = astropy_fits.PrimaryHDU()

    col1 = astropy_fits.Column(name="RA", format="D", array=np.array([1.0, 2.0]))
    col2 = astropy_fits.Column(name="DEC", format="D", array=np.array([3.0, 4.0]))

    table_hdu = astropy_fits.BinTableHDU.from_columns([col1, col2], name="CATALOG")
    hdul = astropy_fits.HDUList([primary, table_hdu])
    hdul.writeto(filepath, overwrite=True)
    return filepath


@pytest.fixture
def temp_spectral_with_masked(tmp_path):
    """Create spectral FITS with masked/NaN values."""
    filepath = tmp_path / "test_masked_x1d.fits"
    primary = astropy_fits.PrimaryHDU()

    n_points = 20
    wavelength = np.linspace(1.0, 5.0, n_points)
    flux = np.ones(n_points)
    flux[5] = float("nan")
    flux[10] = float("inf")
    flux[15] = float("-inf")

    col_wave = astropy_fits.Column(
        name="WAVELENGTH",
        format="D",
        unit="um",
        array=wavelength,
    )
    col_flux = astropy_fits.Column(
        name="FLUX",
        format="D",
        unit="Jy",
        array=flux,
    )

    table_hdu = astropy_fits.BinTableHDU.from_columns([col_wave, col_flux], name="EXTRACT1D")
    hdul = astropy_fits.HDUList([primary, table_hdu])
    hdul.writeto(filepath, overwrite=True)
    return filepath


@pytest.fixture
def temp_large_spectral_fits(tmp_path):
    """Create a large spectral FITS file (>10k points)."""
    filepath = tmp_path / "test_large_x1d.fits"
    primary = astropy_fits.PrimaryHDU()

    n_points = 15000
    col_wave = astropy_fits.Column(
        name="WAVELENGTH",
        format="D",
        unit="um",
        array=np.linspace(0.6, 28.0, n_points),
    )
    col_flux = astropy_fits.Column(
        name="FLUX",
        format="D",
        unit="Jy",
        array=np.random.default_rng(42).normal(1.0, 0.1, n_points),
    )

    table_hdu = astropy_fits.BinTableHDU.from_columns([col_wave, col_flux], name="EXTRACT1D")
    hdul = astropy_fits.HDUList([primary, table_hdu])
    hdul.writeto(filepath, overwrite=True)
    return filepath


@pytest.fixture
def client():
    """Create a test client."""
    from main import app

    return TestClient(app)


@pytest.fixture
def storage_patch(tmp_path):
    """Patch storage provider to use tmp_path."""
    return patch(
        _STORAGE_PATCH_TARGET,
        return_value=LocalStorage(base_path=str(tmp_path)),
    )


# ---------------------------------------------------------------------------
# GET /analysis/spectral-data tests
# ---------------------------------------------------------------------------


class TestSpectralDataEndpoint:
    """Tests for the GET /analysis/spectral-data endpoint."""

    def test_happy_path(self, client, temp_spectral_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "test_x1d.fits", "hdu_index": 1},
            )

        assert response.status_code == 200
        data = response.json()

        assert data["hdu_index"] == 1
        assert data["hdu_name"] == "EXTRACT1D"
        assert data["n_points"] == 100

        # Should have WAVELENGTH, FLUX, FLUX_ERROR, DQ columns
        col_names = [c["name"] for c in data["columns"]]
        assert "WAVELENGTH" in col_names
        assert "FLUX" in col_names
        assert "FLUX_ERROR" in col_names
        assert "DQ" in col_names

        # WAVELENGTH should be first
        assert col_names[0] == "WAVELENGTH"

        # Data arrays should have correct length
        assert len(data["data"]["WAVELENGTH"]) == 100
        assert len(data["data"]["FLUX"]) == 100

        # Check units
        wave_meta = next(c for c in data["columns"] if c["name"] == "WAVELENGTH")
        assert wave_meta["unit"] == "um"
        flux_meta = next(c for c in data["columns"] if c["name"] == "FLUX")
        assert flux_meta["unit"] == "Jy"

    def test_missing_wavelength_column(self, client, temp_no_wavelength_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "test_cat.fits", "hdu_index": 1},
            )

        assert response.status_code == 400
        assert "WAVELENGTH" in response.json()["detail"]

    def test_invalid_hdu_index_out_of_range(self, client, temp_spectral_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "test_x1d.fits", "hdu_index": 99},
            )

        assert response.status_code == 400
        assert "out of range" in response.json()["detail"]

    def test_negative_hdu_index(self, client, temp_spectral_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "test_x1d.fits", "hdu_index": -1},
            )

        assert response.status_code == 400

    def test_hdu_not_a_table(self, client, temp_spectral_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "test_x1d.fits", "hdu_index": 0},
            )

        assert response.status_code == 400
        assert "not a table" in response.json()["detail"]

    def test_file_not_found(self, client, storage_patch):
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "nonexistent.fits"},
            )

        assert response.status_code == 404

    def test_columns_with_units(self, client, temp_spectral_with_units, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "test_units_x1d.fits", "hdu_index": 1},
            )

        assert response.status_code == 200
        data = response.json()

        col_names = [c["name"] for c in data["columns"]]
        assert "WAVELENGTH" in col_names
        assert "FLUX" in col_names
        assert "SURF_BRIGHT" in col_names
        assert "NET" in col_names
        assert "BACKGROUND" in col_names

        sb_meta = next(c for c in data["columns"] if c["name"] == "SURF_BRIGHT")
        assert sb_meta["unit"] == "MJy / sr"

    def test_nan_inf_serialized_as_null(self, client, temp_spectral_with_masked, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "test_masked_x1d.fits", "hdu_index": 1},
            )

        assert response.status_code == 200
        data = response.json()

        flux_data = data["data"]["FLUX"]
        assert flux_data[5] is None  # NaN -> None
        assert flux_data[10] is None  # inf -> None
        assert flux_data[15] is None  # -inf -> None
        # Non-NaN values should be numbers
        assert flux_data[0] is not None
        assert isinstance(flux_data[0], (int, float))

    def test_large_spectrum(self, client, temp_large_spectral_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "test_large_x1d.fits", "hdu_index": 1},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["n_points"] == 15000
        assert len(data["data"]["WAVELENGTH"]) == 15000

    def test_multiple_numeric_columns(self, client, temp_spectral_with_units, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "test_units_x1d.fits", "hdu_index": 1},
            )

        assert response.status_code == 200
        data = response.json()
        # Should have all 5 columns
        assert len(data["columns"]) == 5

    def test_default_hdu_index_is_1(self, client, temp_spectral_fits, storage_patch):  # noqa: ARG002
        with storage_patch:
            response = client.get(
                "/analysis/spectral-data",
                params={"file_path": "test_x1d.fits"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["hdu_index"] == 1
