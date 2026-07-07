"""CE /api/composite/generate-nchannel facade contract tests.

The frontend sends camelCase channel configs keyed by Mongo dataIds; the .NET
tier resolves ids -> file paths (with access checks), snake-cases the body,
proxies to the engine, and forwards ONLY X-Composite-*/X-Quality-* headers
back. The facade replicates that — plus the CE hardening decision from the
Phase 1 spike: allow_force_downscale is stripped (a forced full-res render
measured 110.8s; a public no-auth box cannot offer that synchronously).
"""

import pytest
from bson import ObjectId
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

import app.composite.api_routes as facade
from app.composite.api_routes import router as composite_api_router
from app.db.deps import get_repository
from app.db.repository import JwstDataReadRepository
from app.exceptions import register_api_error_shim
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
        "FileName": "priv_i2d.fits",
        "IsPublic": False,
        "FilePath": "/app/data/uploads/u1/priv.fits",
    },
]


@pytest.fixture
def client(monkeypatch):
    captured = {}

    def fake_engine(request):
        captured["request"] = request
        return Response(
            content=b"IMGBYTES",
            media_type="image/png",
            headers={
                "X-Composite-Budget-Status": "ok",
                "X-Composite-Was-Downscaled": "false",
                "X-Quality-Score": "5",
                "X-Internal-Debug": "do-not-forward",
            },
        )

    monkeypatch.setattr(facade, "engine_generate", fake_engine)

    app = FastAPI()
    register_api_error_shim(app)
    app.include_router(composite_api_router)
    repo = JwstDataReadRepository(FakeCollection(DOCS))
    app.dependency_overrides[get_repository] = lambda: repo
    c = TestClient(app)
    c.captured = captured
    return c


def channel(data_ids, **extra):
    return {"dataIds": [str(i) for i in data_ids], "color": {"hue": 120.0}, **extra}


class TestHappyPath:
    def test_resolution_headers_and_disposition(self, client):
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={
                "channels": [channel([PUB_ID], label="F770W", autoStretch=True)],
                "outputFormat": "jpeg",
                "quality": 85,
                "width": 800,
                "height": 800,
            },
        )
        assert resp.status_code == 200
        assert resp.content == b"IMGBYTES"
        assert resp.headers["content-type"] == "image/jpeg"
        assert "composite-nchannel.jpeg" in resp.headers.get("content-disposition", "")
        # only X-Composite-* / X-Quality-* forward (.NET ForwardableHeaderPrefixes)
        assert resp.headers["x-composite-budget-status"] == "ok"
        assert resp.headers["x-quality-score"] == "5"
        assert "x-internal-debug" not in resp.headers

        req = client.captured["request"]
        # dataIds resolved to relative file paths (prefix stripped)
        assert req.channels[0].file_paths == ["mast/jw1/pub_i2d.fits"]
        assert req.channels[0].auto_stretch is True
        assert req.output_format == "jpeg"

    def test_force_downscale_stripped(self, client):
        client.post(
            "/api/composite/generate-nchannel",
            json={"channels": [channel([PUB_ID])], "allowForceDownscale": True},
        )
        assert client.captured["request"].allow_force_downscale is False


class TestAccessControl:
    def test_private_data_id_404_with_error_body(self, client):
        resp = client.post(
            "/api/composite/generate-nchannel", json={"channels": [channel([PRIV_ID])]}
        )
        assert resp.status_code == 404
        body = resp.json()
        # anti-enumeration message parity + frontend ApiError parses `error`
        assert body["error"] == "The requested data was not found."
        assert "detail" in body

    def test_unknown_data_id_404(self, client):
        resp = client.post(
            "/api/composite/generate-nchannel", json={"channels": [channel([ObjectId()])]}
        )
        assert resp.status_code == 404

    def test_mixed_public_private_404(self, client):
        # one bad id poisons the request — no partial rendering
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={"channels": [channel([PUB_ID, PRIV_ID])]},
        )
        assert resp.status_code == 404

    def test_uppercase_hex_id_resolves(self, client):
        # ObjectId hex is case-insensitive on the query side; the batch-map
        # lookup must normalize the same way (round-2 review finding)
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={"channels": [{"dataIds": [str(PUB_ID).upper()], "color": {"hue": 1.0}}]},
        )
        assert resp.status_code == 200

    def test_duplicate_ids_resolve_via_batch(self, client):
        # batch $in query returns unique docs; duplicates must still map 1:1
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={"channels": [channel([PUB_ID, PUB_ID])]},
        )
        assert resp.status_code == 200
        req = client.captured["request"]
        assert req.channels[0].file_paths == ["mast/jw1/pub_i2d.fits"] * 2


class TestValidationParity:
    """ValidateChannelConfigs (.NET CompositeController.cs:415) message parity."""

    def test_no_channels(self, client):
        resp = client.post("/api/composite/generate-nchannel", json={"channels": []})
        assert resp.status_code == 400
        assert resp.json()["error"] == "At least one channel configuration is required"

    def test_channel_without_data_ids(self, client):
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={"channels": [{"dataIds": [], "color": {"hue": 1.0}}]},
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "At least one DataId is required for each channel"

    def test_missing_color(self, client):
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={"channels": [{"dataIds": [str(PUB_ID)]}]},
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "Color specification is required for each channel"

    def test_non_dict_color_400_not_500(self, client):
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={"channels": [{"dataIds": [str(PUB_ID)], "color": "red"}]},
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "Color specification is required for each channel"

    def test_non_list_data_ids_400_not_500(self, client):
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={"channels": [{"dataIds": 5, "color": {"hue": 1.0}}]},
        )
        assert resp.status_code == 400

    def test_total_file_cap_400(self, client, monkeypatch):
        monkeypatch.setenv("MAX_COMPOSITE_REQUEST_FILES", "3")
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={"channels": [channel([PUB_ID] * 4)]},
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "Too many input files: 4 exceeds maximum 3"

    def test_hue_and_rgb_both(self, client):
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={
                "channels": [{"dataIds": [str(PUB_ID)], "color": {"hue": 1.0, "rgb": [1, 0, 0]}}]
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error"] == "Provide either Hue or Rgb, not both"


class TestEngineErrorPassthrough:
    def test_413_budget_error_shaped_for_frontend(self, client, monkeypatch):
        from fastapi import HTTPException

        def boom(request):
            raise HTTPException(status_code=413, detail="Composite output would shrink to 40%")

        monkeypatch.setattr(facade, "engine_generate", boom)
        resp = client.post(
            "/api/composite/generate-nchannel", json={"channels": [channel([PUB_ID])]}
        )
        assert resp.status_code == 413
        body = resp.json()
        # ApiError.ts reads errorData.error (not FastAPI's `detail`) — the
        # /api shim must emit both
        assert body["error"].startswith("Composite output would shrink")
        assert body["detail"].startswith("Composite output would shrink")


class TestErrorShimScope:
    def test_shim_applies_only_to_api_paths(self, client):
        # a non-/api HTTPException keeps FastAPI's default {"detail": ...}
        from fastapi import HTTPException

        @client.app.get("/legacy")
        def legacy():
            raise HTTPException(status_code=418, detail="teapot")

        resp = client.get("/legacy")
        assert resp.status_code == 418
        assert resp.json() == {"detail": "teapot"}
