# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Input validation tests for preview, histogram, and pixeldata endpoints.

These tests verify that invalid numeric parameters and disallowed string
values are rejected with HTTP 400 before any file processing occurs.
"""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app


@pytest_asyncio.fixture()
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


class TestPreviewValidation:
    """Validation tests for the /preview/{data_id} endpoint."""

    @pytest.mark.parametrize("black_point", [-0.1, 1.1, 2.0])
    async def test_invalid_black_point(self, client, black_point):
        resp = await client.get(
            "/preview/test-id",
            params={"file_path": "test.fits", "black_point": black_point},
        )
        assert resp.status_code == 400
        assert "Black point" in resp.json()["detail"]

    @pytest.mark.parametrize("white_point", [-0.1, 1.1, 2.0])
    async def test_invalid_white_point(self, client, white_point):
        resp = await client.get(
            "/preview/test-id",
            params={"file_path": "test.fits", "white_point": white_point},
        )
        assert resp.status_code == 400
        assert "White point" in resp.json()["detail"]

    async def test_black_point_greater_than_white_point(self, client):
        resp = await client.get(
            "/preview/test-id",
            params={
                "file_path": "test.fits",
                "black_point": 0.8,
                "white_point": 0.2,
            },
        )
        assert resp.status_code == 400
        assert "less than white point" in resp.json()["detail"]

    async def test_black_point_equals_white_point(self, client):
        resp = await client.get(
            "/preview/test-id",
            params={
                "file_path": "test.fits",
                "black_point": 0.5,
                "white_point": 0.5,
            },
        )
        assert resp.status_code == 400

    @pytest.mark.parametrize("asinh_a", [0.0001, 1.1, 0.0])
    async def test_invalid_asinh_a(self, client, asinh_a):
        resp = await client.get(
            "/preview/test-id",
            params={"file_path": "test.fits", "asinh_a": asinh_a},
        )
        assert resp.status_code == 400
        assert "Asinh" in resp.json()["detail"]

    async def test_invalid_slice_index(self, client):
        resp = await client.get(
            "/preview/test-id",
            params={"file_path": "test.fits", "slice_index": -2},
        )
        assert resp.status_code == 400
        assert "Slice index" in resp.json()["detail"]

    @pytest.mark.parametrize("cmap", ["invalid", "turbo", "autumn", ""])
    async def test_invalid_cmap(self, client, cmap):
        resp = await client.get(
            "/preview/test-id",
            params={"file_path": "test.fits", "cmap": cmap},
        )
        assert resp.status_code == 400
        assert "colormap" in resp.json()["detail"].lower()

    @pytest.mark.parametrize("stretch", ["invalid", "nearest", ""])
    async def test_invalid_stretch(self, client, stretch):
        resp = await client.get(
            "/preview/test-id",
            params={"file_path": "test.fits", "stretch": stretch},
        )
        assert resp.status_code == 400
        assert "stretch" in resp.json()["detail"].lower()


class TestHistogramValidation:
    """Validation tests for the /histogram/{data_id} endpoint."""

    @pytest.mark.parametrize("bins", [0, 9, 10001, -1])
    async def test_invalid_bins(self, client, bins):
        resp = await client.get(
            "/histogram/test-id",
            params={"file_path": "test.fits", "bins": bins},
        )
        assert resp.status_code == 400
        assert "Bins" in resp.json()["detail"]

    @pytest.mark.parametrize("gamma", [0.0, 0.09, 5.1])
    async def test_invalid_gamma(self, client, gamma):
        resp = await client.get(
            "/histogram/test-id",
            params={"file_path": "test.fits", "gamma": gamma},
        )
        assert resp.status_code == 400
        assert "Gamma" in resp.json()["detail"]

    async def test_black_point_gte_white_point(self, client):
        resp = await client.get(
            "/histogram/test-id",
            params={
                "file_path": "test.fits",
                "black_point": 0.5,
                "white_point": 0.5,
            },
        )
        assert resp.status_code == 400

    @pytest.mark.parametrize("stretch", ["invalid", ""])
    async def test_invalid_stretch(self, client, stretch):
        resp = await client.get(
            "/histogram/test-id",
            params={"file_path": "test.fits", "stretch": stretch},
        )
        assert resp.status_code == 400
        assert "stretch" in resp.json()["detail"].lower()

    @pytest.mark.parametrize("asinh_a", [0.0001, 1.1])
    async def test_invalid_asinh_a(self, client, asinh_a):
        resp = await client.get(
            "/histogram/test-id",
            params={"file_path": "test.fits", "asinh_a": asinh_a},
        )
        assert resp.status_code == 400
        assert "Asinh" in resp.json()["detail"]

    async def test_invalid_slice_index(self, client):
        resp = await client.get(
            "/histogram/test-id",
            params={"file_path": "test.fits", "slice_index": -2},
        )
        assert resp.status_code == 400
        assert "Slice index" in resp.json()["detail"]


class TestPixeldataValidation:
    """Validation tests for the /pixeldata/{data_id} endpoint."""

    @pytest.mark.parametrize("max_size", [0, 99, 8001, -1])
    async def test_invalid_max_size(self, client, max_size):
        resp = await client.get(
            "/pixeldata/test-id",
            params={"file_path": "test.fits", "max_size": max_size},
        )
        assert resp.status_code == 400
        assert "Max size" in resp.json()["detail"]

    async def test_invalid_slice_index(self, client):
        resp = await client.get(
            "/pixeldata/test-id",
            params={"file_path": "test.fits", "slice_index": -2},
        )
        assert resp.status_code == 400
        assert "Slice index" in resp.json()["detail"]
