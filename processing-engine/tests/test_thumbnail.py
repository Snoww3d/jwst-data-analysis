"""Tests for /thumbnail endpoint validation and functionality."""

import base64
import shutil
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
from astropy.io import fits
from fastapi.testclient import TestClient

from main import app


client = TestClient(app)

FIXTURE_DIR = Path(__file__).parent / "fixtures"


class TestThumbnailValidation:
    """Tests for POST /thumbnail input validation."""

    def test_missing_file_path_returns_422(self):
        resp = client.post("/thumbnail", json={})
        assert resp.status_code == 422

    def test_path_traversal_returns_403(self):
        resp = client.post("/thumbnail", json={"file_path": "../../etc/passwd"})
        assert resp.status_code == 403

    def test_absolute_path_returns_403(self):
        resp = client.post("/thumbnail", json={"file_path": "/etc/passwd"})
        assert resp.status_code == 403

    def test_nonexistent_file_returns_404(self):
        resp = client.post("/thumbnail", json={"file_path": "nonexistent.fits"})
        assert resp.status_code == 404


class TestThumbnailSynthetic:
    """Tests for /thumbnail using synthetic FITS data (always runs)."""

    @staticmethod
    def _make_simple_fits(path: Path) -> str:
        """Create a minimal FITS with 2D image data, return filename."""
        data = np.random.default_rng(42).normal(0.5, 0.1, (32, 32)).astype(np.float32)
        hdu = fits.PrimaryHDU(data=data)
        hdu.writeto(str(path), overwrite=True)
        return path.name

    def test_generates_valid_png_from_simple_fits(self, tmp_path):
        filename = self._make_simple_fits(tmp_path / "simple.fits")

        with patch("main.ALLOWED_DATA_DIR", tmp_path):
            resp = client.post("/thumbnail", json={"file_path": filename})

        assert resp.status_code == 200
        data = resp.json()
        assert "thumbnail_base64" in data
        decoded = base64.b64decode(data["thumbnail_base64"])
        assert decoded[:8] == b"\x89PNG\r\n\x1a\n"

    def test_handles_nan_filled_image(self, tmp_path):
        data = np.full((32, 32), np.nan, dtype=np.float32)
        data[10:20, 10:20] = 1.0
        hdu = fits.PrimaryHDU(data=data)
        path = tmp_path / "nan_heavy.fits"
        hdu.writeto(str(path), overwrite=True)

        with patch("main.ALLOWED_DATA_DIR", tmp_path):
            resp = client.post("/thumbnail", json={"file_path": path.name})

        assert resp.status_code == 200

    def test_handles_3d_data_cube(self, tmp_path):
        data = np.random.default_rng(99).normal(0.5, 0.1, (5, 32, 32)).astype(np.float32)
        hdu = fits.PrimaryHDU(data=data)
        path = tmp_path / "cube.fits"
        hdu.writeto(str(path), overwrite=True)

        with patch("main.ALLOWED_DATA_DIR", tmp_path):
            resp = client.post("/thumbnail", json={"file_path": path.name})

        assert resp.status_code == 200

    def test_no_image_data_returns_400(self, tmp_path):
        hdu = fits.PrimaryHDU()  # Empty primary, no image data
        path = tmp_path / "empty.fits"
        hdu.writeto(str(path), overwrite=True)

        with patch("main.ALLOWED_DATA_DIR", tmp_path):
            resp = client.post("/thumbnail", json={"file_path": path.name})

        assert resp.status_code == 400
        assert "No image data" in resp.json()["detail"]


class TestThumbnailFixture:
    """Tests for /thumbnail using realistic multi-extension JWST fixture."""

    @pytest.fixture
    def fixture_data_dir(self, tmp_path):
        """Copy the FITS fixture into a tmp dir that can serve as DATA_DIR."""
        fixture_file = FIXTURE_DIR / "jwst_miri_small.fits"
        if not fixture_file.exists():
            pytest.skip("FITS fixture not available")
        shutil.copy(fixture_file, tmp_path / fixture_file.name)
        return tmp_path

    def test_generates_thumbnail_from_multi_extension_fits(self, fixture_data_dir):
        with patch("main.ALLOWED_DATA_DIR", fixture_data_dir):
            resp = client.post("/thumbnail", json={"file_path": "jwst_miri_small.fits"})

        assert resp.status_code == 200
        data = resp.json()
        decoded = base64.b64decode(data["thumbnail_base64"])
        assert decoded[:8] == b"\x89PNG\r\n\x1a\n"

    def test_finds_sci_extension_not_empty_primary(self, fixture_data_dir):
        """Verify the endpoint skips the empty primary and finds SCI data."""
        with patch("main.ALLOWED_DATA_DIR", fixture_data_dir):
            resp = client.post("/thumbnail", json={"file_path": "jwst_miri_small.fits"})

        assert resp.status_code == 200
        # If it tried to use the empty primary, it would return 400
        assert "thumbnail_base64" in resp.json()
