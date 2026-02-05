"""Tests for region selection and statistics computation."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.analysis.routes import create_ellipse_mask, create_rectangle_mask


class TestRectangleMask:
    def test_basic_rectangle(self):
        mask = create_rectangle_mask((100, 100), 10, 20, 30, 40)
        assert mask.shape == (100, 100)
        assert np.sum(mask) == 30 * 40

    def test_rectangle_clamped_to_bounds(self):
        mask = create_rectangle_mask((50, 50), 40, 40, 30, 30)
        # Should be clamped: x 40-50, y 40-50 = 10x10
        assert np.sum(mask) == 10 * 10

    def test_rectangle_fully_outside(self):
        mask = create_rectangle_mask((50, 50), 60, 60, 10, 10)
        assert np.sum(mask) == 0

    def test_rectangle_at_origin(self):
        mask = create_rectangle_mask((100, 100), 0, 0, 5, 5)
        assert np.sum(mask) == 25
        assert mask[0, 0]
        assert mask[4, 4]
        assert not mask[5, 5]


class TestEllipseMask:
    def test_circle(self):
        # A circle with radius 10 at center of 100x100
        mask = create_ellipse_mask((100, 100), 50.0, 50.0, 10.0, 10.0)
        # Area of circle = pi * r^2 ~ 314
        pixel_count = np.sum(mask)
        assert 300 < pixel_count < 330

    def test_ellipse(self):
        mask = create_ellipse_mask((100, 100), 50.0, 50.0, 20.0, 10.0)
        # Area of ellipse = pi * rx * ry ~ 628
        pixel_count = np.sum(mask)
        assert 600 < pixel_count < 660

    def test_ellipse_at_edge(self):
        # Ellipse partially outside image
        mask = create_ellipse_mask((50, 50), 0.0, 0.0, 10.0, 10.0)
        # Should be roughly quarter of full circle
        full_mask = create_ellipse_mask((100, 100), 50.0, 50.0, 10.0, 10.0)
        assert np.sum(mask) < np.sum(full_mask)


class TestRegionStatisticsEndpoint:
    """Integration tests for the region statistics endpoint."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client with a temporary data directory."""
        import os

        os.environ["DATA_DIR"] = str(tmp_path)

        # Re-import to pick up new DATA_DIR
        import importlib

        import app.analysis.routes as routes_module

        importlib.reload(routes_module)
        routes_module.ALLOWED_DATA_DIR = tmp_path.resolve()

        from main import app

        # Replace the router's ALLOWED_DATA_DIR
        return TestClient(app)

    @pytest.fixture
    def fits_file(self, tmp_path):
        """Create a test FITS file with known data."""
        from astropy.io import fits as astropy_fits

        # Create 100x100 image with known values
        data = np.ones((100, 100), dtype=np.float64) * 10.0
        # Set a 10x10 region at (20,30) to value 50
        data[30:40, 20:30] = 50.0
        hdu = astropy_fits.PrimaryHDU(data)
        file_path = tmp_path / "test.fits"
        hdu.writeto(file_path)
        return file_path

    def test_rectangle_statistics(self, client, fits_file, tmp_path):  # noqa: ARG002
        response = client.post(
            "/analysis/region-statistics",
            json={
                "file_path": "test.fits",
                "region_type": "rectangle",
                "rectangle": {"x": 20, "y": 30, "width": 10, "height": 10},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["mean"] == 50.0
        assert data["median"] == 50.0
        assert data["std"] == 0.0
        assert data["min"] == 50.0
        assert data["max"] == 50.0
        assert data["sum"] == 50.0 * 100
        assert data["pixel_count"] == 100

    def test_ellipse_statistics(self, client, fits_file, tmp_path):  # noqa: ARG002
        # Uniform image of 10s — any ellipse region should give mean=10
        response = client.post(
            "/analysis/region-statistics",
            json={
                "file_path": "test.fits",
                "region_type": "ellipse",
                "ellipse": {"cx": 50.0, "cy": 50.0, "rx": 5.0, "ry": 5.0},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["mean"] == 10.0
        assert data["pixel_count"] > 0

    def test_missing_rectangle(self, client, fits_file, tmp_path):  # noqa: ARG002
        response = client.post(
            "/analysis/region-statistics",
            json={
                "file_path": "test.fits",
                "region_type": "rectangle",
            },
        )
        assert response.status_code == 400

    def test_missing_ellipse(self, client, fits_file, tmp_path):  # noqa: ARG002
        response = client.post(
            "/analysis/region-statistics",
            json={
                "file_path": "test.fits",
                "region_type": "ellipse",
            },
        )
        assert response.status_code == 400

    def test_file_not_found(self, client, tmp_path):  # noqa: ARG002
        response = client.post(
            "/analysis/region-statistics",
            json={
                "file_path": "nonexistent.fits",
                "region_type": "rectangle",
                "rectangle": {"x": 0, "y": 0, "width": 10, "height": 10},
            },
        )
        assert response.status_code == 404

    def test_nan_handling(self, client, tmp_path):
        """Test that NaN pixels are excluded from statistics."""
        from astropy.io import fits as astropy_fits

        data = np.full((50, 50), 5.0)
        data[10:20, 10:20] = np.nan  # NaN region inside selection
        hdu = astropy_fits.PrimaryHDU(data)
        hdu.writeto(tmp_path / "nan_test.fits")

        response = client.post(
            "/analysis/region-statistics",
            json={
                "file_path": "nan_test.fits",
                "region_type": "rectangle",
                "rectangle": {"x": 0, "y": 0, "width": 50, "height": 50},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["mean"] == 5.0
        # 50*50 - 10*10 = 2400 valid pixels
        assert data["pixel_count"] == 2400
