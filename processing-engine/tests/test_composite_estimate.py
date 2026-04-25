"""Tests for the POST /composite/estimate endpoint (#882).

The estimate endpoint accepts a full NChannelCompositeRequest, runs the
file-resolution + WCS-reading + memory-budget math, and returns whether
generation would succeed, warn (mild downscale), or fail (HTTP 413).
No actual reproject + combine work is done.
"""

from unittest.mock import patch

import pytest
from astropy.wcs import WCS
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from main import app

    return TestClient(app)


_CHANNEL_PAYLOAD = {
    "file_paths": ["/fake/test_i2d.fits"],
    "color": {"hue": 0},
    "label": "F444W",
    "stretch": "asinh",
    "black_point": 0.0,
    "white_point": 1.0,
    "gamma": 1.0,
    "asinh_a": 0.05,
    "curve": "linear",
    "weight": 1.0,
}


def _make_wcs(naxis1: int, naxis2: int, cdelt: float = -0.001) -> WCS:
    header = {
        "NAXIS": 2,
        "NAXIS1": naxis1,
        "NAXIS2": naxis2,
        "CTYPE1": "RA---TAN",
        "CTYPE2": "DEC--TAN",
        "CRPIX1": naxis1 / 2.0,
        "CRPIX2": naxis2 / 2.0,
        "CRVAL1": 180.0,
        "CRVAL2": 45.0,
        "CDELT1": cdelt,
        "CDELT2": abs(cdelt),
    }
    return WCS(header, naxis=2)


def _mock_common_wcs_small(*_args, **_kwargs):
    """Mock for _compute_common_wcs that returns a small-grid WCS."""
    wcs = _make_wcs(1000, 1000)
    return (wcs, (1000, 1000), [("ch0", [])])


def _mock_common_wcs_borderline(*_args, **_kwargs):
    """Mock returning a shape that triggers mild downscale."""
    wcs = _make_wcs(4150, 4150)
    return (wcs, (4150, 4150), [("ch0", []), ("ch1", []), ("ch2", [])])


def _mock_common_wcs_oversize(*_args, **_kwargs):
    """Mock returning a shape that triggers heavy downscale → fail."""
    wcs = _make_wcs(30000, 30000)
    return (
        wcs,
        (30000, 30000),
        [("ch0", []), ("ch1", []), ("ch2", []), ("ch3", []), ("ch4", [])],
    )


_ROUTES_PREFIX = "app.composite.routes"


def _five_channel_payload():
    """Build a 5-channel payload that matches NGC-3324 nasa_press structure."""
    base = dict(_CHANNEL_PAYLOAD)
    return [{**base, "label": f"ch{i}", "color": {"hue": i * 60}} for i in range(5)]


class TestEstimateEndpoint:
    """End-to-end tests for /composite/estimate."""

    @patch(f"{_ROUTES_PREFIX}._compute_common_wcs", side_effect=_mock_common_wcs_small)
    def test_returns_ok_for_small_composite(self, _mock_wcs, client):
        response = client.post(
            "/composite/estimate",
            json={"channels": [_CHANNEL_PAYLOAD], "background_neutralization": False},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["original_shape"] == [1000, 1000]
        assert body["output_shape"] == [1000, 1000]
        assert body["side_factor"] == 1.0

    @patch(f"{_ROUTES_PREFIX}._compute_common_wcs", side_effect=_mock_common_wcs_borderline)
    def test_returns_warn_for_borderline(self, _mock_wcs, client):
        payload = {
            "channels": [{**_CHANNEL_PAYLOAD, "label": f"ch{i}"} for i in range(3)],
            "background_neutralization": False,
        }
        response = client.post("/composite/estimate", json=payload)
        assert response.status_code == 200
        body = response.json()
        # 4150x4150 with n=3, default 0.85 threshold: side_factor ~0.95 → warn
        assert body["status"] == "warn"
        assert body["original_shape"] == [4150, 4150]
        assert body["output_shape"][0] < 4150
        assert 0.85 <= body["side_factor"] < 1.0
        assert body["memory_limit_mb"] > 0

    @patch(f"{_ROUTES_PREFIX}._compute_common_wcs", side_effect=_mock_common_wcs_oversize)
    def test_returns_fail_for_oversize(self, _mock_wcs, client):
        payload = {
            "channels": _five_channel_payload(),
            "background_neutralization": False,
        }
        response = client.post("/composite/estimate", json=payload)
        # Estimate returns 200 with status="fail" — it's a verdict, not an error
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "fail"
        assert "MAX_COMPOSITE_MEMORY_BYTES" in body["detail"]
        assert "COMPOSITE_DOWNSCALE_FAIL_THRESHOLD" in body["detail"]
        assert body["fail_threshold"] == 0.85
        assert body["side_factor"] < 0.85

    @patch(f"{_ROUTES_PREFIX}._compute_common_wcs", side_effect=_mock_common_wcs_oversize)
    def test_response_includes_diagnostic_fields(self, _mock_wcs, client):
        payload = {
            "channels": _five_channel_payload(),
            "background_neutralization": False,
        }
        response = client.post("/composite/estimate", json=payload)
        body = response.json()
        # All EstimateResponse fields must be present
        for field in (
            "status",
            "original_shape",
            "output_shape",
            "side_factor",
            "detail",
            "memory_limit_mb",
            "fail_threshold",
        ):
            assert field in body, f"missing {field} in estimate response"

    @patch(f"{_ROUTES_PREFIX}._compute_common_wcs", side_effect=_mock_common_wcs_small)
    def test_estimate_does_not_run_reproject(self, _mock_wcs, client):
        """Verify estimate is cheap: never calls _reproject_all_channels."""
        with patch(f"{_ROUTES_PREFIX}._reproject_all_channels") as mock_reproject:
            response = client.post(
                "/composite/estimate",
                json={"channels": [_CHANNEL_PAYLOAD], "background_neutralization": False},
            )
            assert response.status_code == 200
            assert mock_reproject.call_count == 0

    def test_estimate_validates_payload(self, client):
        """Empty channels payload returns 422 (Pydantic validation)."""
        response = client.post(
            "/composite/estimate",
            json={"channels": [], "background_neutralization": False},
        )
        assert response.status_code in (400, 422)

    def test_estimate_rejects_excessive_input_count(self, client):
        """Total input file count above the soft cap returns 413 with detail."""
        # 5 channels × 200 files = 1000 > 500 cap
        bulk_channel = {
            **_CHANNEL_PAYLOAD,
            "file_paths": [f"/fake/file_{i:04d}.fits" for i in range(200)],
        }
        response = client.post(
            "/composite/estimate",
            json={
                "channels": [{**bulk_channel, "label": f"ch{i}"} for i in range(5)],
                "background_neutralization": False,
            },
        )
        assert response.status_code == 413
        assert "soft cap" in response.json()["detail"]
