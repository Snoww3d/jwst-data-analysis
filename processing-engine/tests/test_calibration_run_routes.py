# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""POST /api/calibration/runs — the request contract (#1751).

Covers what unit-testing `resolve_input_data_ids` alone cannot: that the route
refuses raw storage keys, enforces the input cap before any job exists, maps
resolution failures to 422, derives admin from the token role, and records the
source ids on the job so a re-run can re-select them.
"""

import time
import uuid

import httpx
import jwt as pyjwt
import pytest
from bson import ObjectId

from app.calibration.executor import MAX_CALIBRATION_INPUTS
from app.calibration.routes import get_recipe_store
from app.calibration.store import RecipeStore
from app.db.client import get_database, reset_client


SECRET = "unit-test-secret-key-at-least-32-chars!!"
ROLE_URI = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"
USER = "user-a"
OTHER = "user-b"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)
    monkeypatch.setenv("CALIBRATION_ENABLED", "true")


def bearer(user_id: str, role: str = "User") -> dict[str, str]:
    now = int(time.time())
    token = pyjwt.encode(
        {
            "sub": user_id,
            ROLE_URI: role,
            "iss": "JwstDataAnalysis",
            "aud": "JwstDataAnalysisClient",
            "iat": now,
            "exp": now + 900,
        },
        SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
async def store():
    reset_client()
    collection = get_database()[f"recipes_test_{uuid.uuid4().hex}"]
    recipe_store = RecipeStore(collection)
    await recipe_store.seed()
    yield recipe_store
    await collection.drop()
    reset_client()


@pytest.fixture()
async def library():
    """The route reads `jwst_data` directly, so seed that collection and take
    the inserted ids away again rather than dropping a shared collection."""
    collection = get_database()["jwst_data"]
    inserted: list[ObjectId] = []

    async def add(**over) -> str:
        doc = {
            "FileName": "a_cal.fits",
            "FilePath": "mast/jw1/a_cal.fits",
            "UserId": USER,
            "IsPublic": False,
            **over,
        }
        result = await collection.insert_one(doc)
        inserted.append(result.inserted_id)
        return str(result.inserted_id)

    yield add
    if inserted:
        await collection.delete_many({"_id": {"$in": inserted}})


@pytest.fixture()
async def launched(monkeypatch: pytest.MonkeyPatch) -> list:
    """Capture jobs instead of running them — this is a request-contract test."""
    calls: list = []

    async def _fake_launch(job_store, job, work):
        calls.append(job)
        return "job-1"

    monkeypatch.setattr("app.jobs.runner.launch", _fake_launch)
    return calls


@pytest.fixture()
async def client(store: RecipeStore):
    from main import app

    app.dependency_overrides[get_recipe_store] = lambda: store
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_recipe_store, None)


def body(**over) -> dict:
    return {
        "recipeId": "seed-nircam-imaging",
        "inputDataIds": [],
        "runOverrides": {},
        "enabledStages": {"detector1": False, "image2": False, "image3": True},
        **over,
    }


class TestStartRunInputContract:
    @pytest.mark.usefixtures("launched")
    async def test_raw_storage_keys_are_refused(self, client: httpx.AsyncClient) -> None:
        # The whole point of #1751/#1719: a raw key is authorized nowhere, so
        # honouring one would let any user calibrate another user's file.
        response = await client.post(
            "/api/calibration/runs",
            json=body(inputs=["mast/someone-elses/x_cal.fits"]),
            headers=bearer(USER),
        )
        assert response.status_code == 422
        assert "inputDataIds" in response.json()["detail"]

    async def test_someone_elses_private_item_is_refused(
        self, client: httpx.AsyncClient, library
    ) -> None:
        data_id = await library(UserId=OTHER, IsPublic=False)
        response = await client.post(
            "/api/calibration/runs",
            json=body(inputDataIds=[data_id]),
            headers=bearer(USER),
        )
        assert response.status_code == 422
        assert "not found" in response.json()["detail"]

    @pytest.mark.usefixtures("launched")
    async def test_admin_role_from_the_token_may_use_any_item(
        self, client: httpx.AsyncClient, library
    ) -> None:
        data_id = await library(UserId=OTHER, IsPublic=False)
        response = await client.post(
            "/api/calibration/runs",
            json=body(inputDataIds=[data_id]),
            headers=bearer(USER, role="Admin"),
        )
        assert response.status_code == 202, response.text

    async def test_over_the_cap_is_refused_before_a_job_exists(
        self, client: httpx.AsyncClient, launched: list
    ) -> None:
        ids = [str(ObjectId()) for _ in range(MAX_CALIBRATION_INPUTS + 1)]
        response = await client.post(
            "/api/calibration/runs",
            json=body(inputDataIds=ids),
            headers=bearer(USER),
        )
        assert response.status_code == 422
        assert "too many inputs" in response.json()["detail"]
        assert launched == []

    async def test_unknown_recipe_answers_about_the_recipe_not_the_inputs(
        self, client: httpx.AsyncClient
    ) -> None:
        response = await client.post(
            "/api/calibration/runs",
            json=body(recipeId="nope", inputDataIds=[str(ObjectId())]),
            headers=bearer(USER),
        )
        assert response.status_code == 404

    async def test_run_records_the_source_ids_for_a_re_run(
        self, client: httpx.AsyncClient, library, launched: list
    ) -> None:
        data_id = await library()
        response = await client.post(
            "/api/calibration/runs",
            json=body(inputDataIds=[data_id]),
            headers=bearer(USER),
        )
        assert response.status_code == 202, response.text
        job = launched[0]
        # Both: keys for the executor, ids so the form can re-select the items.
        assert job.request["inputs"] == [{"path": "mast/jw1/a_cal.fits", "role": "science"}]
        assert job.request["input_data_ids"] == [data_id]

    @pytest.mark.usefixtures("launched")
    async def test_an_empty_inputs_key_is_ignored_not_rejected(
        self, client: httpx.AsyncClient
    ) -> None:
        # A client that always sends the key must not be broken by the
        # rejection above — only a non-empty one is an attempt to supply keys.
        response = await client.post(
            "/api/calibration/runs",
            json=body(inputs=[]),
            headers=bearer(USER),
        )
        assert response.status_code == 202, response.text

    async def test_malformed_enabled_stages_is_422(self, client: httpx.AsyncClient) -> None:
        response = await client.post(
            "/api/calibration/runs",
            json=body(enabledStages={"image3": "yes"}),
            headers=bearer(USER),
        )
        assert response.status_code == 422
        assert "enabledStages" in response.json()["detail"]

    async def test_request_shape_is_checked_before_any_database_round_trip(
        self, client: httpx.AsyncClient
    ) -> None:
        # Both are wrong. Shape checks cost nothing, so a malformed body must
        # be answered before any database round-trip — recipe or library.
        response = await client.post(
            "/api/calibration/runs",
            json=body(
                recipeId="nope",
                enabledStages={"image3": "yes"},
                inputDataIds=[str(ObjectId())],
            ),
            headers=bearer(USER),
        )
        assert response.status_code == 422
        assert "enabledStages" in response.json()["detail"]

    async def test_requires_auth(self, client: httpx.AsyncClient) -> None:
        response = await client.post("/api/calibration/runs", json=body())
        assert response.status_code in (401, 403)
