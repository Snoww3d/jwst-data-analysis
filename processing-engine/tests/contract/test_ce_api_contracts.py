"""CE /api facade contract tests against the Phase 1 golden .NET fixtures.

The fixtures capture what the frontend receives from the .NET tier today;
these tests pin the FastAPI facade to the same shapes (key names + casing).
Values are environment-specific, so assertions are structural.
"""

import json
from datetime import datetime
from pathlib import Path

import pytest
from bson import ObjectId
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db.deps import get_file_exists, get_repository
from app.db.repository import JwstDataReadRepository
from app.discovery.api_routes import router as discovery_api_router
from app.library.routes import router as library_router
from tests.db.fakes import FakeCollection


FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text())


def full_doc(oid: ObjectId) -> dict:
    """A Mongo doc with every field MapToDataResponse projects, PascalCase."""
    return {
        "_id": oid,
        "FileName": "jw1_i2d.fits",
        "DataType": "image",
        "UploadDate": datetime(2026, 7, 1, 10, 0, 0),
        "Description": None,
        "Metadata": {"mast_obs_id": "jw1-o001", "source": "mast"},
        "FilePath": "mast/jw1/jw1_i2d.fits",
        "FileSize": 123,
        "ProcessingStatus": "completed",
        "Tags": ["mast"],
        "UserId": None,
        "ImageInfo": {"Filter": "F770W", "BitDepth": 16},
        "SensorInfo": None,
        "SpectralInfo": None,
        "CalibrationInfo": None,
        "ProcessingResults": [{"ProcessedDate": datetime(2026, 7, 2, 9, 0, 0)}],
        "FileFormat": "fits",
        "IsValidated": True,
        "LastAccessed": None,
        "IsPublic": True,
        "SharedWith": [],
        "IsArchived": False,
        "ArchivedDate": None,
        "Version": 1,
        "ParentId": None,
        # DerivedFrom deliberately ABSENT — .NET's non-nullable List default
        # means the wire always shows []; the projection must default it
        "ProcessingLevel": "L3",
        "ObservationBaseId": "jw01",
        "ExposureId": None,
        "IsViewable": True,
        "ThumbnailData": b"\x89PNG",
    }


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(library_router)
    app.include_router(discovery_api_router)

    oid = ObjectId()
    docs = [full_doc(oid)]
    repo = JwstDataReadRepository(FakeCollection(docs))
    app.dependency_overrides[get_repository] = lambda: repo
    app.dependency_overrides[get_file_exists] = lambda: lambda _key: True
    c = TestClient(app)
    c.test_oid = str(oid)
    return c


class TestFeaturedContract:
    def test_matches_fixture_exactly_in_shape(self, client):
        resp = client.get("/api/discovery/featured")
        assert resp.status_code == 200
        body = resp.json()
        fix = fixture("get_discovery_featured.json")
        assert isinstance(body, list) and len(body) == len(fix)
        assert set(body[0].keys()) == set(fix[0].keys())
        # .NET adds searchRadius: null to mastSearchParams — facade must too
        assert set(body[0]["mastSearchParams"].keys()) == {"target", "searchRadius"}


class TestJwstDataListContract:
    def test_item_keys_match_fixture(self, client):
        resp = client.get("/api/jwstdata?includeArchived=false")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        fix_keys = set(fixture("get_jwstdata_list.json")[0].keys())
        assert set(items[0].keys()) == fix_keys

    def test_projection_semantics(self, client):
        item = client.get("/api/jwstdata").json()[0]
        assert item["id"] == client.test_oid
        assert item["hasThumbnail"] is True  # ThumbnailData present but NOT inlined
        assert "thumbnailData" not in item
        assert item["processingResultsCount"] == 1
        # whole-second timestamps: System.Text.Json omits the fraction entirely
        assert item["lastProcessed"] == "2026-07-02T09:00:00Z"
        assert item["uploadDate"].endswith("Z")
        assert item["derivedFrom"] == []  # absent in doc -> .NET emits []
        assert item["imageInfo"] == {"filter": "F770W", "bitDepth": 16}
        assert item["metadata"] == {"mast_obs_id": "jw1-o001", "source": "mast"}


class TestCheckAvailabilityContract:
    def test_shape_matches_fixture(self, client):
        resp = client.post("/api/jwstdata/check-availability", json={"observationIds": ["jw01"]})
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {"results"}
        item = body["results"]["jw01"]
        assert set(item.keys()) == {"available", "dataIds", "filter"}
        assert item["available"] is True and item["filter"] == "F770W"

    def test_missing_obs_absent_from_results(self, client):
        body = client.post(
            "/api/jwstdata/check-availability", json={"observationIds": ["nope"]}
        ).json()
        assert body["results"] == {}

    def test_validation_empty_and_cap(self, client):
        assert (
            client.post("/api/jwstdata/check-availability", json={"observationIds": []}).status_code
            == 400
        )
        too_many = {"observationIds": [f"o{i}" for i in range(51)]}
        assert client.post("/api/jwstdata/check-availability", json=too_many).status_code == 400

    def test_file_missing_on_disk_excludes(self, client):
        client.app.dependency_overrides[get_file_exists] = lambda: lambda _key: False
        body = client.post(
            "/api/jwstdata/check-availability", json={"observationIds": ["jw01"]}
        ).json()
        assert body["results"] == {}


class TestThumbnailRoute:
    def test_png_with_cache_header(self, client):
        resp = client.get(f"/api/jwstdata/{client.test_oid}/thumbnail")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.headers["cache-control"] == "public, max-age=86400"

    def test_unknown_id_404(self, client):
        resp = client.get(f"/api/jwstdata/{ObjectId()}/thumbnail")
        assert resp.status_code == 404


class TestSuggestRecipesContract:
    def test_camel_request_and_camel_response(self, client):
        req = {
            "targetName": "NGC 3132",
            "observations": [
                {"filter": "F770W", "instrument": "MIRI", "observationId": "o1"},
                {"filter": "F1130W", "instrument": "MIRI", "observationId": "o2"},
                {"filter": "F1800W", "instrument": "MIRI", "observationId": "o3"},
            ],
        }
        resp = client.post("/api/discovery/suggest-recipes", json=req)
        assert resp.status_code == 200
        body = resp.json()
        fix = fixture("post_discovery_suggest_recipes.json")
        assert set(body.keys()) == set(fix.keys())  # {target, recipes}
        assert body["recipes"], "expected at least one recipe for 3 MIRI filters"
        recipe = body["recipes"][0]
        # exact .NET wire parity, including dropping recommended_feather_strength
        assert set(recipe.keys()) == set(fix["recipes"][0].keys())
        assert "colorMapping" in recipe and "color_mapping" not in recipe
        # colorMapping is keyed by FILTER NAMES — must not be case-mangled
        assert all(k.startswith("F") for k in recipe["colorMapping"])

    def test_empty_observations_400(self, client):
        resp = client.post(
            "/api/discovery/suggest-recipes", json={"targetName": "x", "observations": []}
        )
        assert resp.status_code == 400
