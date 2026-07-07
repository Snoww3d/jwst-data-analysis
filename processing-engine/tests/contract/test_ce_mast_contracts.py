"""CE /api/mast facade contract tests.

The .NET tier proxies MAST search verbatim (the golden fixture
post_mast_search_target.json shows the engine's snake_case envelope with raw
MAST rows reaching the frontend), so the facade's job is: camelCase request
in, engine handler, response untouched. Target search additionally resolves
featured-target display-name aliases (DiscoveryService.ResolveTargetAlias
parity). MAST is never called in these tests — the service layer is
monkeypatched.
"""

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.mast.routes as engine_mast_routes
from app.mast.api_routes import router as mast_api_router


FIXTURES = Path(__file__).parent / "fixtures"

FAKE_ROWS = [
    {
        "obs_id": "jw02733-o002_t001_miri_f0770w",
        "filters": "F770W",
        "instrument_name": "MIRI",
        # raw MAST columns are mixed-case and MUST pass through verbatim
        "intentType": "science",
        "jpegURL": "mast:JWST/product/x.jpg",
        "objID": 12345,
        "t_obs_release": 59000.0,
    }
]


@pytest.fixture
def client(monkeypatch):
    calls = {}

    def fake_target(target_name, radius, filters, calib_level):
        calls["target"] = {
            "target_name": target_name,
            "radius": radius,
            "calib_level": calib_level,
            "filters_seen": filters,
        }
        return FAKE_ROWS

    def fake_coords(ra, dec, radius, calib_level):
        calls["coords"] = {"ra": ra, "dec": dec}
        return FAKE_ROWS

    def fake_obs(obs_id, calib_level):
        calls["obs"] = {"obs_id": obs_id}
        return FAKE_ROWS

    def fake_program(program_id, calib_level):
        calls["program"] = {"program_id": program_id}
        return FAKE_ROWS

    def fake_recent(days_back, instrument, limit, offset):
        calls["recent"] = {
            "days_back": days_back,
            "instrument": instrument,
            "limit": limit,
            "offset": offset,
        }
        return FAKE_ROWS

    monkeypatch.setattr(engine_mast_routes.mast_service, "search_by_target", fake_target)
    monkeypatch.setattr(engine_mast_routes.mast_service, "search_by_coordinates", fake_coords)
    monkeypatch.setattr(engine_mast_routes.mast_service, "search_by_observation_id", fake_obs)
    monkeypatch.setattr(engine_mast_routes.mast_service, "search_by_program_id", fake_program)
    monkeypatch.setattr(engine_mast_routes.mast_service, "search_recent_releases", fake_recent)
    # engine handlers cache responses module-globally — isolate tests
    engine_mast_routes._target_search_cache.clear()
    engine_mast_routes._recent_releases_cache.clear()

    app = FastAPI()
    app.include_router(mast_api_router)
    c = TestClient(app)
    c.calls = calls
    return c


class TestTargetSearchContract:
    def test_camel_request_snake_envelope_verbatim_rows(self, client):
        resp = client.post(
            "/api/mast/search/target",
            json={"targetName": "NGC 3132", "radius": 0.2, "calibLevel": [3]},
        )
        assert resp.status_code == 200
        body = resp.json()
        fix = json.loads((FIXTURES / "post_mast_search_target.json").read_text())
        assert set(body.keys()) == set(fix.keys())  # snake envelope
        assert body["search_type"] == "target"
        assert body["result_count"] == 1
        row = body["results"][0]
        # raw MAST columns verbatim — no case mangling
        assert row["intentType"] == "science"
        assert row["jpegURL"] == "mast:JWST/product/x.jpg"
        assert row["objID"] == 12345
        assert client.calls["target"]["calib_level"] == [3]

    def test_display_name_alias_resolved(self, client):
        # DiscoveryService.ResolveTargetAlias parity: featured display name
        # maps to its catalog id before hitting MAST
        client.post(
            "/api/mast/search/target",
            json={"targetName": "Pillars of Creation", "radius": 0.2},
        )
        assert client.calls["target"]["target_name"] == "M16"

    def test_invalid_radius_400(self, client):
        resp = client.post("/api/mast/search/target", json={"targetName": "M16", "radius": 99})
        assert resp.status_code == 400

    def test_filters_injection_stripped(self, client):
        # `filters` splats into astroquery query_criteria server-side — the
        # public edge must drop it (pagesize/obs_collection override vector)
        resp = client.post(
            "/api/mast/search/target",
            json={"targetName": "M16", "filters": {"pagesize": 5000000}},
        )
        assert resp.status_code == 200
        assert client.calls["target"].get("filters_seen") is None


class TestValidationPaths:
    def test_validate_helper_field_error_400(self, client):
        # coordinates route goes through the shared _validate helper
        resp = client.post("/api/mast/search/coordinates", json={"ra": 999, "dec": 0})
        assert resp.status_code == 400

    def test_malformed_body_is_422(self, client):
        # NOT .NET parity: a non-object body fails FastAPI request validation
        # (422) before the facade's 400 conversion can run. The CE frontend
        # always sends JSON objects; this test pins the known divergence.
        resp = client.post("/api/mast/search/coordinates", json=[1, 2, 3])
        assert resp.status_code == 422


class TestOtherSearchModes:
    def test_coordinates(self, client):
        resp = client.post(
            "/api/mast/search/coordinates", json={"ra": 10.5, "dec": -60.2, "radius": 0.1}
        )
        assert resp.status_code == 200
        assert resp.json()["search_type"] == "coordinates"
        assert client.calls["coords"] == {"ra": 10.5, "dec": -60.2}

    def test_observation(self, client):
        resp = client.post(
            "/api/mast/search/observation", json={"obsId": "jw02733-o002", "calibLevel": [3]}
        )
        assert resp.status_code == 200
        assert client.calls["obs"] == {"obs_id": "jw02733-o002"}

    def test_program(self, client):
        resp = client.post(
            "/api/mast/search/program", json={"programId": "2733", "calibLevel": [3]}
        )
        assert resp.status_code == 200
        assert client.calls["program"] == {"program_id": "2733"}


class TestWhatsNew:
    def test_maps_to_search_recent(self, client):
        resp = client.post(
            "/api/mast/whats-new",
            json={"daysBack": 14, "instrument": "MIRI", "limit": 25, "offset": 0},
        )
        assert resp.status_code == 200
        assert resp.json()["search_type"] == "recent_releases"
        assert client.calls["recent"] == {
            "days_back": 14,
            "instrument": "MIRI",
            "limit": 25,
            "offset": 0,
        }

    def test_empty_body_uses_defaults(self, client):
        resp = client.post("/api/mast/whats-new", json={})
        assert resp.status_code == 200
        assert client.calls["recent"]["days_back"] == 30
        assert client.calls["recent"]["limit"] == 50
