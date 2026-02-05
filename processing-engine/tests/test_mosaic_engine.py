# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Unit tests for the WCS mosaic engine module.

Tests cover FITS loading with WCS, mosaic generation, footprint computation,
and API route validation.
"""

import io
import tempfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS
from fastapi.testclient import TestClient
from PIL import Image

from app.mosaic.mosaic_engine import (
    generate_mosaic,
    get_footprints,
    load_fits_2d_with_wcs,
)


def _make_fits_with_wcs(
    data: np.ndarray,
    crval1: float = 180.0,
    crval2: float = 45.0,
    cdelt: float = -0.001,
    tmp_dir: str | None = None,
) -> Path:
    """Helper to create a FITS file with a valid celestial WCS."""
    header = fits.Header()
    header["NAXIS"] = 2
    header["NAXIS1"] = data.shape[1]
    header["NAXIS2"] = data.shape[0]
    header["CTYPE1"] = "RA---TAN"
    header["CTYPE2"] = "DEC--TAN"
    header["CRPIX1"] = data.shape[1] / 2.0
    header["CRPIX2"] = data.shape[0] / 2.0
    header["CRVAL1"] = crval1
    header["CRVAL2"] = crval2
    header["CDELT1"] = cdelt
    header["CDELT2"] = abs(cdelt)

    hdu = fits.PrimaryHDU(data=data, header=header)
    with tempfile.NamedTemporaryFile(suffix=".fits", dir=tmp_dir, delete=False) as fd:
        hdu.writeto(fd.name, overwrite=True)
        return Path(fd.name)


def _make_fits_no_wcs(data: np.ndarray, tmp_dir: str | None = None) -> Path:
    """Helper to create a FITS file without WCS."""
    hdu = fits.PrimaryHDU(data=data)
    with tempfile.NamedTemporaryFile(suffix=".fits", dir=tmp_dir, delete=False) as fd:
        hdu.writeto(fd.name, overwrite=True)
        return Path(fd.name)


class TestLoadFits2dWithWcs:
    """Tests for load_fits_2d_with_wcs."""

    def test_load_2d_with_valid_wcs(self, tmp_path):
        data = np.random.default_rng(42).random((100, 100))
        path = _make_fits_with_wcs(data, tmp_dir=str(tmp_path))

        loaded_data, wcs = load_fits_2d_with_wcs(path)

        assert loaded_data.shape == (100, 100)
        assert wcs.has_celestial
        np.testing.assert_allclose(loaded_data, data, atol=1e-10)

    def test_load_3d_cube_extracts_middle_slice(self, tmp_path):
        cube = np.random.default_rng(42).random((10, 50, 50))
        header = fits.Header()
        header["NAXIS"] = 3
        header["NAXIS1"] = 50
        header["NAXIS2"] = 50
        header["NAXIS3"] = 10
        header["CTYPE1"] = "RA---TAN"
        header["CTYPE2"] = "DEC--TAN"
        header["CRPIX1"] = 25.0
        header["CRPIX2"] = 25.0
        header["CRVAL1"] = 180.0
        header["CRVAL2"] = 45.0
        header["CDELT1"] = -0.001
        header["CDELT2"] = 0.001

        hdu = fits.PrimaryHDU(data=cube, header=header)
        path = tmp_path / "cube.fits"
        hdu.writeto(str(path), overwrite=True)

        loaded_data, wcs = load_fits_2d_with_wcs(path)

        assert loaded_data.shape == (50, 50)
        # Middle slice is index 5
        np.testing.assert_allclose(
            loaded_data,
            np.nan_to_num(cube[5], nan=0.0, posinf=0.0, neginf=0.0),
            atol=1e-10,
        )

    def test_load_handles_nan_and_inf(self, tmp_path):
        data = np.array([[1.0, np.nan], [np.inf, -np.inf]])
        path = _make_fits_with_wcs(data, tmp_dir=str(tmp_path))

        loaded_data, _ = load_fits_2d_with_wcs(path)

        assert not np.any(np.isnan(loaded_data))
        assert not np.any(np.isinf(loaded_data))
        assert loaded_data[0, 0] == 1.0
        assert loaded_data[0, 1] == 0.0  # NaN -> 0

    def test_load_no_image_data_raises(self, tmp_path):
        # Create FITS with only a table, no image data
        hdu = fits.PrimaryHDU()  # Empty primary HDU
        path = tmp_path / "empty.fits"
        hdu.writeto(str(path), overwrite=True)

        with pytest.raises(ValueError, match="No image data found"):
            load_fits_2d_with_wcs(path)

    def test_load_no_wcs_raises(self, tmp_path):
        data = np.random.default_rng(42).random((50, 50))
        path = _make_fits_no_wcs(data, tmp_dir=str(tmp_path))

        with pytest.raises(ValueError, match="No celestial WCS found"):
            load_fits_2d_with_wcs(path)


class TestGenerateMosaic:
    """Tests for generate_mosaic."""

    def _make_file_data(self, n=2, offset=0.05):
        """Create test file data with slightly offset WCS."""
        file_data = []
        for i in range(n):
            data = np.random.default_rng(42 + i).random((50, 50)) * 100
            wcs = WCS(naxis=2)
            wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
            wcs.wcs.crpix = [25.0, 25.0]
            wcs.wcs.crval = [180.0 + i * offset, 45.0]
            wcs.wcs.cdelt = [-0.001, 0.001]
            file_data.append((data, wcs))
        return file_data

    def test_mosaic_two_files_mean(self):
        file_data = self._make_file_data(n=2)
        mosaic, footprint, wcs_out = generate_mosaic(file_data, combine_method="mean")

        assert mosaic.ndim == 2
        assert footprint.ndim == 2
        assert mosaic.shape == footprint.shape
        assert wcs_out.has_celestial
        # Mosaic should be wider than individual files due to offset
        assert mosaic.shape[1] >= 50

    def test_mosaic_combine_methods(self):
        file_data = self._make_file_data(n=2)
        for method in ("mean", "sum", "first", "last", "min", "max"):
            mosaic, _, _ = generate_mosaic(file_data, combine_method=method)
            assert mosaic.ndim == 2

    def test_mosaic_output_pixel_limit(self):
        file_data = self._make_file_data(n=2, offset=0.0)
        with pytest.raises(ValueError, match="pixels"):
            generate_mosaic(file_data, max_output_pixels=10)

    def test_mosaic_no_nan_in_output(self):
        file_data = self._make_file_data(n=2)
        mosaic, _, _ = generate_mosaic(file_data)
        assert not np.any(np.isnan(mosaic))


class TestGetFootprints:
    """Tests for get_footprints."""

    def test_footprints_basic(self):
        data = np.zeros((50, 50))
        wcs = WCS(naxis=2)
        wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        wcs.wcs.crpix = [25.0, 25.0]
        wcs.wcs.crval = [180.0, 45.0]
        wcs.wcs.cdelt = [-0.001, 0.001]

        file_data = [(data, wcs, "test.fits")]
        footprints, bbox = get_footprints(file_data)

        assert len(footprints) == 1
        fp = footprints[0]
        assert fp["file_path"] == "test.fits"
        assert len(fp["corners_ra"]) == 4
        assert len(fp["corners_dec"]) == 4
        assert "center_ra" in fp
        assert "center_dec" in fp

        assert "min_ra" in bbox
        assert "max_ra" in bbox
        assert "min_dec" in bbox
        assert "max_dec" in bbox

    def test_footprints_multiple_files(self):
        file_data = []
        for i in range(3):
            data = np.zeros((50, 50))
            wcs = WCS(naxis=2)
            wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
            wcs.wcs.crpix = [25.0, 25.0]
            wcs.wcs.crval = [180.0 + i * 0.1, 45.0]
            wcs.wcs.cdelt = [-0.001, 0.001]
            file_data.append((data, wcs, f"file_{i}.fits"))

        footprints, bbox = get_footprints(file_data)

        assert len(footprints) == 3
        # Bounding box should span all three files
        assert bbox["max_ra"] > bbox["min_ra"]

    def test_footprint_center_near_crval(self):
        data = np.zeros((100, 100))
        wcs = WCS(naxis=2)
        wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
        wcs.wcs.crpix = [50.0, 50.0]
        wcs.wcs.crval = [200.0, 30.0]
        wcs.wcs.cdelt = [-0.001, 0.001]

        footprints, _ = get_footprints([(data, wcs, "test.fits")])
        fp = footprints[0]

        # Center should be close to CRVAL
        assert abs(fp["center_ra"] - 200.0) < 0.01
        assert abs(fp["center_dec"] - 30.0) < 0.01


class TestMosaicRoutes:
    """Tests for mosaic API routes."""

    @pytest.fixture
    def client(self):
        from main import app

        return TestClient(app)

    def test_generate_requires_at_least_2_files(self, client):
        response = client.post(
            "/mosaic/generate",
            json={
                "files": [{"file_path": "test.fits"}],
            },
        )
        assert response.status_code == 422  # Pydantic validation error

    def test_generate_invalid_colormap(self, client):
        response = client.post(
            "/mosaic/generate",
            json={
                "files": [
                    {"file_path": "test1.fits"},
                    {"file_path": "test2.fits"},
                ],
                "cmap": "nonexistent_colormap",
            },
        )
        assert response.status_code == 400
        assert "colormap" in response.json()["detail"].lower()

    def test_footprint_empty_paths(self, client):
        response = client.post(
            "/mosaic/footprint",
            json={"file_paths": []},
        )
        assert response.status_code == 422  # Pydantic validation error

    @patch("app.mosaic.routes.ALLOWED_DATA_DIR", Path("/app/data").resolve())
    def test_path_traversal_blocked(self, client):
        response = client.post(
            "/mosaic/generate",
            json={
                "files": [
                    {"file_path": "../../etc/passwd"},
                    {"file_path": "test2.fits"},
                ],
            },
        )
        assert response.status_code in (403, 404)

    def test_generate_file_not_found(self, client, tmp_path):
        with patch("app.mosaic.routes.ALLOWED_DATA_DIR", tmp_path):
            response = client.post(
                "/mosaic/generate",
                json={
                    "files": [
                        {"file_path": "nonexistent1.fits"},
                        {"file_path": "nonexistent2.fits"},
                    ],
                },
            )
            assert response.status_code == 404

    def test_generate_success(self, client, tmp_path):
        """End-to-end test: generate mosaic from two FITS files with WCS."""
        data1 = np.random.default_rng(42).random((50, 50)).astype(np.float64) * 100
        data2 = np.random.default_rng(43).random((50, 50)).astype(np.float64) * 100

        path1 = _make_fits_with_wcs(data1, crval1=180.0, tmp_dir=str(tmp_path))
        path2 = _make_fits_with_wcs(data2, crval1=180.05, tmp_dir=str(tmp_path))

        with patch("app.mosaic.routes.ALLOWED_DATA_DIR", tmp_path):
            response = client.post(
                "/mosaic/generate",
                json={
                    "files": [
                        {"file_path": path1.name},
                        {"file_path": path2.name},
                    ],
                    "output_format": "png",
                    "cmap": "inferno",
                    "combine_method": "mean",
                },
            )

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        # Verify it's a valid PNG
        img = Image.open(io.BytesIO(response.content))
        assert img.width > 0
        assert img.height > 0

    def test_generate_jpeg(self, client, tmp_path):
        """Test JPEG output format."""
        data1 = np.random.default_rng(42).random((50, 50)).astype(np.float64) * 100
        data2 = np.random.default_rng(43).random((50, 50)).astype(np.float64) * 100

        path1 = _make_fits_with_wcs(data1, crval1=180.0, tmp_dir=str(tmp_path))
        path2 = _make_fits_with_wcs(data2, crval1=180.05, tmp_dir=str(tmp_path))

        with patch("app.mosaic.routes.ALLOWED_DATA_DIR", tmp_path):
            response = client.post(
                "/mosaic/generate",
                json={
                    "files": [
                        {"file_path": path1.name},
                        {"file_path": path2.name},
                    ],
                    "output_format": "jpeg",
                    "quality": 80,
                },
            )

        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"

    def test_footprint_success(self, client, tmp_path):
        """End-to-end test: compute footprints for FITS files with WCS."""
        data = np.random.default_rng(42).random((50, 50)).astype(np.float64)
        path1 = _make_fits_with_wcs(data, crval1=180.0, tmp_dir=str(tmp_path))
        path2 = _make_fits_with_wcs(data, crval1=180.05, tmp_dir=str(tmp_path))

        with patch("app.mosaic.routes.ALLOWED_DATA_DIR", tmp_path):
            response = client.post(
                "/mosaic/footprint",
                json={"file_paths": [path1.name, path2.name]},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["n_files"] == 2
        assert len(body["footprints"]) == 2
        assert "bounding_box" in body
        assert "min_ra" in body["bounding_box"]

    def test_generate_no_wcs_returns_400(self, client, tmp_path):
        """Files without celestial WCS should return 400."""
        data = np.random.default_rng(42).random((50, 50)).astype(np.float64)
        path1 = _make_fits_no_wcs(data, tmp_dir=str(tmp_path))
        path2 = _make_fits_no_wcs(data, tmp_dir=str(tmp_path))

        with patch("app.mosaic.routes.ALLOWED_DATA_DIR", tmp_path):
            response = client.post(
                "/mosaic/generate",
                json={
                    "files": [
                        {"file_path": path1.name},
                        {"file_path": path2.name},
                    ],
                },
            )

        assert response.status_code == 400
        assert "WCS" in response.json()["detail"]

    def test_generate_with_resize(self, client, tmp_path):
        """Test mosaic with explicit width/height resize."""
        data1 = np.random.default_rng(42).random((50, 50)).astype(np.float64) * 100
        data2 = np.random.default_rng(43).random((50, 50)).astype(np.float64) * 100

        path1 = _make_fits_with_wcs(data1, crval1=180.0, tmp_dir=str(tmp_path))
        path2 = _make_fits_with_wcs(data2, crval1=180.05, tmp_dir=str(tmp_path))

        with patch("app.mosaic.routes.ALLOWED_DATA_DIR", tmp_path):
            response = client.post(
                "/mosaic/generate",
                json={
                    "files": [
                        {"file_path": path1.name},
                        {"file_path": path2.name},
                    ],
                    "width": 200,
                    "height": 200,
                },
            )

        assert response.status_code == 200
        img = Image.open(io.BytesIO(response.content))
        assert img.width == 200
        assert img.height == 200
