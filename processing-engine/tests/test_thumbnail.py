"""Tests for /thumbnail endpoint validation and functionality."""

import base64

import pytest
from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


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


class TestThumbnailGeneration:
    """Tests for /thumbnail endpoint with real FITS files (requires test fixtures)."""

    @pytest.fixture
    def fits_path(self):
        """Return relative path to test FITS file if available."""
        import os

        # Check for e2e test fixture
        test_file = "mast/e2e-test-obs/test_mirimage_i2d.fits"
        data_dir = os.environ.get("DATA_DIR", "/app/data")
        full_path = os.path.join(data_dir, test_file)
        if os.path.exists(full_path):
            return test_file
        pytest.skip("Test FITS file not available")

    def test_generates_valid_png_base64(self, fits_path):
        resp = client.post("/thumbnail", json={"file_path": fits_path})
        assert resp.status_code == 200
        data = resp.json()
        assert "thumbnail_base64" in data

        # Verify it's valid base64 that decodes to a PNG
        decoded = base64.b64decode(data["thumbnail_base64"])
        assert decoded[:8] == b"\x89PNG\r\n\x1a\n"  # PNG magic bytes
