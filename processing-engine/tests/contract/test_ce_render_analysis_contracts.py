"""CE render/analysis dataId-shim contract tests.

The .NET tier resolves dataId -> file path (with the anonymous IsPublic
check) before calling the engine's file_path-keyed render/analysis routes,
converting camelCase query params to snake_case. These tests pin that
mapping; the engine functions themselves are monkeypatched (their behavior
is covered by the existing viewer/analysis suites).
"""

import pytest
from bson import ObjectId
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

import app.analysis.api_routes as analysis_facade
import app.library.routes as library_routes
from app.analysis.api_routes import router as analysis_api_router
from app.db.deps import get_repository
from app.db.repository import JwstDataReadRepository
from app.library.routes import router as library_router
from tests.db.fakes import FakeCollection


PUB_ID = ObjectId()
PRIV_ID = ObjectId()

DOCS = [
    {
        "_id": PUB_ID,
        "FileName": "pub_i2d.fits",
        "IsPublic": True,
        "FilePath": "/app/data/mast/jw1/pub_i2d.fits",
    },
    {
        "_id": PRIV_ID,
        "FileName": "priv.fits",
        "IsPublic": False,
        "FilePath": "/app/data/uploads/u1/priv.fits",
    },
]


@pytest.fixture
def client(monkeypatch):
    calls = {}

    def fake_preview(**kwargs):
        calls["preview"] = kwargs
        return Response(
            content=b"PNG",
            media_type="image/png",
            headers={"X-Cube-Slices": "12", "X-Cube-Current": "6"},
        )

    def fake_pixel_data(**kwargs):
        calls["pixeldata"] = kwargs
        return {"width": 10, "height": 10, "pixels": []}

    def fake_cube_info(**kwargs):
        calls["cubeinfo"] = kwargs
        return {"is_cube": False}

    def fake_histogram(**kwargs):
        calls["histogram"] = kwargs
        return {"bins": [], "counts": []}

    def fake_table_info(**kwargs):
        calls["table_info"] = kwargs
        return {"tables": []}

    def fake_table_data(**kwargs):
        calls["table_data"] = kwargs
        return {"rows": []}

    def fake_spectral(**kwargs):
        calls["spectral"] = kwargs
        return {"points": []}

    monkeypatch.setattr(library_routes, "engine_preview", fake_preview)
    monkeypatch.setattr(library_routes, "engine_pixel_data", fake_pixel_data)
    monkeypatch.setattr(library_routes, "engine_cube_info", fake_cube_info)
    monkeypatch.setattr(library_routes, "engine_histogram", fake_histogram)
    monkeypatch.setattr(analysis_facade, "engine_table_info", fake_table_info)
    monkeypatch.setattr(analysis_facade, "engine_table_data", fake_table_data)
    monkeypatch.setattr(analysis_facade, "engine_spectral_data", fake_spectral)

    app = FastAPI()
    app.include_router(library_router)
    app.include_router(analysis_api_router)
    repo = JwstDataReadRepository(FakeCollection(DOCS))
    app.dependency_overrides[get_repository] = lambda: repo
    c = TestClient(app)
    c.calls = calls
    return c


class TestPreviewShim:
    def test_camel_params_map_to_snake_and_headers_forward(self, client):
        resp = client.get(
            f"/api/jwstdata/{PUB_ID}/preview"
            "?cmap=viridis&width=500&blackPoint=0.1&whitePoint=0.9&asinhA=0.2"
            "&sliceIndex=3&format=jpeg&embedAvm=true&smoothMethod=gaussian"
        )
        assert resp.status_code == 200
        # X-Cube-* headers pass through (.NET forwards them to the viewer)
        assert resp.headers["x-cube-slices"] == "12"
        assert resp.headers["x-cube-current"] == "6"
        kw = client.calls["preview"]
        assert kw["file_path"] == "mast/jw1/pub_i2d.fits"
        assert kw["black_point"] == 0.1
        assert kw["white_point"] == 0.9
        assert kw["asinh_a"] == 0.2
        assert kw["slice_index"] == 3
        assert kw["embed_avm"] is True
        assert kw["smooth_method"] == "gaussian"

    def test_private_404(self, client):
        assert client.get(f"/api/jwstdata/{PRIV_ID}/preview").status_code == 404

    def test_unknown_404(self, client):
        assert client.get(f"/api/jwstdata/{ObjectId()}/preview").status_code == 404


class TestPixelDataShim:
    def test_params(self, client):
        resp = client.get(f"/api/jwstdata/{PUB_ID}/pixeldata?maxSize=600&sliceIndex=2")
        assert resp.status_code == 200
        kw = client.calls["pixeldata"]
        assert kw["max_size"] == 600
        assert kw["slice_index"] == 2
        assert kw["file_path"] == "mast/jw1/pub_i2d.fits"

    def test_private_404(self, client):
        assert client.get(f"/api/jwstdata/{PRIV_ID}/pixeldata").status_code == 404


class TestCubeInfoShim:
    def test_resolves(self, client):
        resp = client.get(f"/api/jwstdata/{PUB_ID}/cubeinfo")
        assert resp.status_code == 200
        assert client.calls["cubeinfo"]["file_path"] == "mast/jw1/pub_i2d.fits"


class TestHistogramShim:
    def test_camel_params_map_to_snake(self, client):
        # ImageViewer fetches /histogram unconditionally — missing from the
        # Phase 1 inventory, caught in PR4 review
        resp = client.get(
            f"/api/jwstdata/{PUB_ID}/histogram?bins=128&sliceIndex=2&blackPoint=0.05&asinhA=0.3"
        )
        assert resp.status_code == 200
        kw = client.calls["histogram"]
        assert kw["bins"] == 128
        assert kw["slice_index"] == 2
        assert kw["black_point"] == 0.05
        assert kw["asinh_a"] == 0.3
        assert kw["file_path"] == "mast/jw1/pub_i2d.fits"

    def test_private_404(self, client):
        assert client.get(f"/api/jwstdata/{PRIV_ID}/histogram").status_code == 404


class TestAnalysisShims:
    def test_table_info(self, client):
        resp = client.get(f"/api/analysis/table-info?dataId={PUB_ID}")
        assert resp.status_code == 200
        assert client.calls["table_info"]["file_path"] == "mast/jw1/pub_i2d.fits"

    def test_table_data_param_mapping(self, client):
        resp = client.get(
            f"/api/analysis/table-data?dataId={PUB_ID}"
            "&hduIndex=2&page=1&pageSize=50&sortColumn=flux&sortDirection=desc&search=x"
        )
        assert resp.status_code == 200
        kw = client.calls["table_data"]
        assert kw["hdu_index"] == 2
        assert kw["page_size"] == 50
        assert kw["sort_column"] == "flux"
        assert kw["sort_direction"] == "desc"
        assert kw["search"] == "x"

    def test_spectral_data(self, client):
        resp = client.get(f"/api/analysis/spectral-data?dataId={PUB_ID}&hduIndex=2")
        assert resp.status_code == 200
        assert client.calls["spectral"]["hdu_index"] == 2

    def test_private_data_id_404(self, client):
        assert client.get(f"/api/analysis/table-info?dataId={PRIV_ID}").status_code == 404

    def test_missing_data_id_422(self, client):
        # required query param absent -> FastAPI request validation
        assert client.get("/api/analysis/table-info").status_code == 422
