"""Tests for the POST /composite/analyze-channels endpoint."""

from collections import OrderedDict
from unittest.mock import patch

import numpy as np
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create a test client."""
    from main import app

    return TestClient(app)


# Deterministic test data: a synthetic 64x64 image with known statistics
_RNG = np.random.default_rng(42)
_SYNTHETIC_DATA = np.abs(_RNG.normal(loc=1000.0, scale=50.0, size=(64, 64))).astype(np.float32)

# Minimal valid channel payload
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


def _mock_reprojected(*_args, **_kwargs):
    """Return a dict simulating reprojected channel data."""
    return OrderedDict({"ch0_F444W": _SYNTHETIC_DATA.copy()})


def _mock_instruments(*_args, **_kwargs):
    """Return instrument list for one channel."""
    return [None]


def _mock_reprojected_two(*_args, **_kwargs):
    """Return two channels of reprojected data."""
    return OrderedDict(
        {
            "ch0_F444W": _SYNTHETIC_DATA.copy(),
            "ch1_F200W": (_SYNTHETIC_DATA * 0.5).copy(),
        }
    )


def _mock_instruments_two(*_args, **_kwargs):
    return [None, None]


_ROUTES_PREFIX = "app.composite.routes"


class TestAnalyzeChannels:
    """Tests for the analyze-channels endpoint."""

    @patch(f"{_ROUTES_PREFIX}._load_reprojected_channels", side_effect=_mock_reprojected)
    @patch(f"{_ROUTES_PREFIX}._detect_channel_instruments", side_effect=_mock_instruments)
    def test_single_channel_returns_analysis(self, _mock_instr, _mock_load, client):
        response = client.post(
            "/composite/analyze-channels",
            json={"channels": [_CHANNEL_PAYLOAD], "background_neutralization": False},
        )
        assert response.status_code == 200
        body = response.json()
        assert len(body["channels"]) == 1

        ch = body["channels"][0]
        assert ch["channel_name"] == "ch0_F444W"
        assert ch["label"] == "F444W"

    @patch(f"{_ROUTES_PREFIX}._load_reprojected_channels", side_effect=_mock_reprojected)
    @patch(f"{_ROUTES_PREFIX}._detect_channel_instruments", side_effect=_mock_instruments)
    def test_response_contains_params(self, _mock_instr, _mock_load, client):
        response = client.post(
            "/composite/analyze-channels",
            json={"channels": [_CHANNEL_PAYLOAD], "background_neutralization": False},
        )
        ch = response.json()["channels"][0]
        params = ch["params"]
        assert "stretch" in params
        assert "asinh_a" in params
        assert "black_point" in params
        assert "white_point" in params
        assert "gamma" in params

    @patch(f"{_ROUTES_PREFIX}._load_reprojected_channels", side_effect=_mock_reprojected)
    @patch(f"{_ROUTES_PREFIX}._detect_channel_instruments", side_effect=_mock_instruments)
    def test_response_contains_histogram(self, _mock_instr, _mock_load, client):
        response = client.post(
            "/composite/analyze-channels",
            json={"channels": [_CHANNEL_PAYLOAD], "background_neutralization": False},
        )
        ch = response.json()["channels"][0]
        hist = ch["histogram"]
        assert len(hist["counts"]) == 100
        assert len(hist["bin_centers"]) == 100
        assert len(hist["bin_edges"]) == 101
        assert hist["n_bins"] == 100

    @patch(f"{_ROUTES_PREFIX}._load_reprojected_channels", side_effect=_mock_reprojected)
    @patch(f"{_ROUTES_PREFIX}._detect_channel_instruments", side_effect=_mock_instruments)
    def test_response_contains_meta(self, _mock_instr, _mock_load, client):
        response = client.post(
            "/composite/analyze-channels",
            json={"channels": [_CHANNEL_PAYLOAD], "background_neutralization": False},
        )
        ch = response.json()["channels"][0]
        meta = ch["meta"]
        assert "dynamic_range" in meta
        assert "snr" in meta
        assert "hdr_detected" in meta
        assert "curve_reason" in meta
        assert "instrument_adjusted" in meta
        assert "valid_pixels" in meta
        assert "zero_coverage_frac" in meta

    @patch(f"{_ROUTES_PREFIX}._load_reprojected_channels", side_effect=_mock_reprojected)
    @patch(f"{_ROUTES_PREFIX}._detect_channel_instruments", side_effect=_mock_instruments)
    def test_response_contains_stats(self, _mock_instr, _mock_load, client):
        response = client.post(
            "/composite/analyze-channels",
            json={"channels": [_CHANNEL_PAYLOAD], "background_neutralization": False},
        )
        ch = response.json()["channels"][0]
        stats = ch["stats"]
        assert stats["min"] > 0
        assert stats["max"] > stats["min"]
        assert stats["mean"] > 0
        assert stats["std"] > 0

    @patch(f"{_ROUTES_PREFIX}._load_reprojected_channels", side_effect=_mock_reprojected_two)
    @patch(f"{_ROUTES_PREFIX}._detect_channel_instruments", side_effect=_mock_instruments_two)
    def test_two_channels(self, _mock_instr, _mock_load, client):
        ch2 = dict(_CHANNEL_PAYLOAD)
        ch2["label"] = "F200W"
        ch2["color"] = {"hue": 200}
        response = client.post(
            "/composite/analyze-channels",
            json={"channels": [_CHANNEL_PAYLOAD, ch2], "background_neutralization": False},
        )
        assert response.status_code == 200
        body = response.json()
        assert len(body["channels"]) == 2
        assert body["channels"][0]["channel_name"] == "ch0_F444W"
        assert body["channels"][1]["channel_name"] == "ch1_F200W"

    def test_empty_channels_rejected(self, client):
        response = client.post(
            "/composite/analyze-channels",
            json={"channels": [], "background_neutralization": False},
        )
        assert response.status_code == 422  # Pydantic validation error

    @patch(f"{_ROUTES_PREFIX}._load_reprojected_channels", side_effect=_mock_reprojected)
    @patch(f"{_ROUTES_PREFIX}._detect_channel_instruments", side_effect=_mock_instruments)
    def test_histogram_counts_are_nonnegative(self, _mock_instr, _mock_load, client):
        response = client.post(
            "/composite/analyze-channels",
            json={"channels": [_CHANNEL_PAYLOAD], "background_neutralization": False},
        )
        counts = response.json()["channels"][0]["histogram"]["counts"]
        assert all(c >= 0 for c in counts)
        assert sum(counts) > 0  # at least some data was binned
