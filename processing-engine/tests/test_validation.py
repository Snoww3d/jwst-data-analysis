"""Tests for input validation on preview and histogram endpoints."""

import pytest
from fastapi.testclient import TestClient

from main import app


client = TestClient(app)

# A fake data_id — validation rejects before file path check, so no real FITS needed.
DATA_ID = "test123"
# A file_path that won't exist but validation fires first.
BASE_PARAMS = {"file_path": "nonexistent.fits"}


# ===== Preview Endpoint Validation =====


class TestPreviewValidation:
    """Tests for /preview/{data_id} parameter validation."""

    def _url(self) -> str:
        return f"/preview/{DATA_ID}"

    def test_invalid_stretch_returns_400(self):
        resp = client.get(self._url(), params={**BASE_PARAMS, "stretch": "bogus"})
        assert resp.status_code == 400
        assert "stretch" in resp.json()["detail"].lower()

    def test_invalid_cmap_returns_400(self):
        resp = client.get(self._url(), params={**BASE_PARAMS, "cmap": "bogus"})
        assert resp.status_code == 400
        assert "colormap" in resp.json()["detail"].lower()

    @pytest.mark.parametrize("value", [-0.1, 1.1])
    def test_black_point_out_of_range_returns_400(self, value):
        resp = client.get(self._url(), params={**BASE_PARAMS, "black_point": value})
        assert resp.status_code == 400
        assert "black point" in resp.json()["detail"].lower()

    @pytest.mark.parametrize("value", [-0.1, 1.1])
    def test_white_point_out_of_range_returns_400(self, value):
        resp = client.get(self._url(), params={**BASE_PARAMS, "white_point": value})
        assert resp.status_code == 400
        assert "white point" in resp.json()["detail"].lower()

    def test_black_point_not_less_than_white_point_returns_400(self):
        resp = client.get(
            self._url(), params={**BASE_PARAMS, "black_point": 0.5, "white_point": 0.5}
        )
        assert resp.status_code == 400
        assert "black point" in resp.json()["detail"].lower()

    @pytest.mark.parametrize("value", [0.0001, 1.1])
    def test_asinh_a_out_of_range_returns_400(self, value):
        resp = client.get(self._url(), params={**BASE_PARAMS, "asinh_a": value})
        assert resp.status_code == 400
        assert "asinh" in resp.json()["detail"].lower()

    def test_valid_stretch_values_pass_validation(self):
        """Valid stretch values should not return 400 for stretch validation."""
        for stretch in ["zscale", "asinh", "log", "sqrt", "power", "histeq", "linear"]:
            resp = client.get(self._url(), params={**BASE_PARAMS, "stretch": stretch})
            # Should fail with 404 (file not found), not 400 (validation)
            assert resp.status_code != 400 or "stretch" not in resp.json().get("detail", "").lower()

    def test_valid_cmap_values_pass_validation(self):
        """Valid cmap values should not return 400 for cmap validation."""
        for cmap in [
            "grayscale",
            "gray",
            "inferno",
            "magma",
            "viridis",
            "plasma",
            "hot",
            "cool",
            "rainbow",
            "jet",
        ]:
            resp = client.get(self._url(), params={**BASE_PARAMS, "cmap": cmap})
            assert (
                resp.status_code != 400 or "colormap" not in resp.json().get("detail", "").lower()
            )


# ===== Histogram Endpoint Validation =====


class TestHistogramValidation:
    """Tests for /histogram/{data_id} parameter validation."""

    def _url(self) -> str:
        return f"/histogram/{DATA_ID}"

    @pytest.mark.parametrize("value", [0, 10001, -1, 999999999])
    def test_bins_out_of_range_returns_400(self, value):
        resp = client.get(self._url(), params={**BASE_PARAMS, "bins": value})
        assert resp.status_code == 400
        assert "bins" in resp.json()["detail"].lower()

    @pytest.mark.parametrize("value", [0.0, 5.1, -1.0])
    def test_gamma_out_of_range_returns_400(self, value):
        resp = client.get(self._url(), params={**BASE_PARAMS, "gamma": value})
        assert resp.status_code == 400
        assert "gamma" in resp.json()["detail"].lower()

    def test_invalid_stretch_returns_400(self):
        resp = client.get(self._url(), params={**BASE_PARAMS, "stretch": "bogus"})
        assert resp.status_code == 400
        assert "stretch" in resp.json()["detail"].lower()

    @pytest.mark.parametrize("value", [-0.1, 1.1])
    def test_black_point_out_of_range_returns_400(self, value):
        resp = client.get(self._url(), params={**BASE_PARAMS, "black_point": value})
        assert resp.status_code == 400
        assert "black point" in resp.json()["detail"].lower()

    @pytest.mark.parametrize("value", [-0.1, 1.1])
    def test_white_point_out_of_range_returns_400(self, value):
        resp = client.get(self._url(), params={**BASE_PARAMS, "white_point": value})
        assert resp.status_code == 400
        assert "white point" in resp.json()["detail"].lower()

    def test_black_point_not_less_than_white_point_returns_400(self):
        resp = client.get(
            self._url(), params={**BASE_PARAMS, "black_point": 0.5, "white_point": 0.5}
        )
        assert resp.status_code == 400
        assert "black point" in resp.json()["detail"].lower()

    @pytest.mark.parametrize("value", [0.0001, 1.1])
    def test_asinh_a_out_of_range_returns_400(self, value):
        resp = client.get(self._url(), params={**BASE_PARAMS, "asinh_a": value})
        assert resp.status_code == 400
        assert "asinh" in resp.json()["detail"].lower()
