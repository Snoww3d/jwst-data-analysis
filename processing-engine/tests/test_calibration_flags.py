# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for the calibration feature gates and the capabilities endpoint.
"""

import importlib.util

import httpx
import pytest

from app.calibration import flags


@pytest.fixture(autouse=True)
def _clear_caches():
    flags.jwst_available.cache_clear()
    flags.jwst_version.cache_clear()
    yield
    flags.jwst_available.cache_clear()
    flags.jwst_version.cache_clear()


@pytest.fixture()
async def client():
    from main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as async_client:
        yield async_client


class TestFlags:
    def test_env_gate_off_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("CALIBRATION_ENABLED", raising=False)
        assert flags.calibration_env_enabled() is False

    @pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes"])
    def test_env_gate_truthy_values(self, monkeypatch: pytest.MonkeyPatch, value: str) -> None:
        monkeypatch.setenv("CALIBRATION_ENABLED", value)
        assert flags.calibration_env_enabled() is True

    def test_enabled_requires_both_gates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("CALIBRATION_ENABLED", "true")
        monkeypatch.setattr(flags, "jwst_available", lambda: False)
        assert flags.calibration_enabled() is False

        monkeypatch.setattr(flags, "jwst_available", lambda: True)
        assert flags.calibration_enabled() is True

        monkeypatch.setenv("CALIBRATION_ENABLED", "false")
        assert flags.calibration_enabled() is False

    @pytest.mark.skipif(
        importlib.util.find_spec("jwst") is None,
        reason="jwst layer not installed (CI pip env); Docker dev image runs this",
    )
    def test_jwst_available_matches_reality(self) -> None:
        # The dev image builds with INSTALL_CALIBRATION=true, so jwst must be
        # importable there — this also guards the pin resolving on py3.12.
        assert flags.jwst_available() is True
        assert flags.jwst_version() is not None


class TestCapabilitiesEndpoint:
    async def test_capabilities_enabled(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Endpoint logic is tested independent of whether the jwst layer is
        # installed in this environment (CI pip env lacks it; Docker has it).
        monkeypatch.setenv("CALIBRATION_ENABLED", "true")
        monkeypatch.setattr(flags, "jwst_available", lambda: True)
        monkeypatch.setattr(flags, "jwst_version", lambda: "2.0.1")
        response = await client.get("/api/calibration/capabilities")
        assert response.status_code == 200
        body = response.json()
        assert body["calibrationEnabled"] is True
        assert body["jwstVersion"] == "2.0.1"

    async def test_capabilities_disabled_when_jwst_missing(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("CALIBRATION_ENABLED", "true")
        monkeypatch.setattr(flags, "jwst_available", lambda: False)
        monkeypatch.setattr(flags, "jwst_version", lambda: None)
        response = await client.get("/api/calibration/capabilities")
        assert response.status_code == 200
        assert response.json() == {"calibrationEnabled": False, "jwstVersion": None}

    async def test_capabilities_disabled_via_env(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("CALIBRATION_ENABLED", "false")
        response = await client.get("/api/calibration/capabilities")
        assert response.status_code == 200
        assert response.json()["calibrationEnabled"] is False
