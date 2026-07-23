# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for /api/jobs routes: auth, ownership, camelCase wire shape, cancel
semantics, and the full-mode CORS middleware.

Uses httpx.AsyncClient over ASGITransport (not the sync TestClient) so the
app, the motor client, and the test all share one event loop — and so app
startup hooks (job reconciliation) don't fire against the real collection.
Backing store is the real MongoDB with a throwaway collection per test.
"""

import time
import uuid

import httpx
import jwt as pyjwt
import pytest

from app.db.client import get_database, reset_client
from app.jobs.models import JobRecord, JobResult
from app.jobs.routes import get_job_store
from app.jobs.store import JobStore


SECRET = "unit-test-secret-key-at-least-32-chars!!"
ISSUER = "JwstDataAnalysis"
AUDIENCE = "JwstDataAnalysisClient"
ROLE_URI = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"

USER = "user-a"
OTHER = "user-b"


@pytest.fixture(autouse=True)
def _jwt_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)


def token_for(user_id: str, role: str = "User") -> str:
    now = int(time.time())
    return pyjwt.encode(
        {
            "sub": user_id,
            ROLE_URI: role,
            "iss": ISSUER,
            "aud": AUDIENCE,
            "iat": now,
            "exp": now + 900,
        },
        SECRET,
        algorithm="HS256",
    )


def bearer(user_id: str, role: str = "User") -> dict[str, str]:
    return {"Authorization": f"Bearer {token_for(user_id, role)}"}


@pytest.fixture()
async def store():
    # Fresh motor client per test: the cached global binds to the first
    # event loop it touches, and pytest-asyncio makes a new loop per test.
    reset_client()
    collection = get_database()[f"jobs_test_{uuid.uuid4().hex}"]
    yield JobStore(collection)
    await collection.drop()
    reset_client()


@pytest.fixture()
async def client(store: JobStore):
    from main import app

    app.dependency_overrides[get_job_store] = lambda: store
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_job_store, None)


async def seed_job(store: JobStore, user_id: str = USER) -> str:
    job = JobRecord(type="calibration", user_id=user_id, request={"recipe_id": "r1"})
    await store.create(job)
    return job.job_id


class TestAuth:
    async def test_list_requires_token(self, client: httpx.AsyncClient) -> None:
        assert (await client.get("/api/jobs")).status_code == 401

    async def test_get_requires_token(self, client: httpx.AsyncClient) -> None:
        assert (await client.get("/api/jobs/some-id")).status_code == 401

    async def test_cancel_requires_token(self, client: httpx.AsyncClient) -> None:
        assert (await client.post("/api/jobs/some-id/cancel")).status_code == 401


class TestOwnership:
    async def test_get_own_job_camel_case(self, client: httpx.AsyncClient, store: JobStore) -> None:
        job_id = await seed_job(store)
        response = await client.get(f"/api/jobs/{job_id}", headers=bearer(USER))
        assert response.status_code == 200
        body = response.json()
        assert body["jobId"] == job_id
        assert body["userId"] == USER
        assert body["cancelRequested"] is False
        assert "logTail" in body
        # No snake_case leakage on the wire.
        assert "job_id" not in body and "user_id" not in body

    async def test_request_blob_stays_verbatim_on_wire(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        # `request` is opaque job-type data: snake_case keys inside it (step
        # names, parameter names) must NOT be camelCased by the facade.
        job = JobRecord(
            type="calibration",
            user_id=USER,
            request={
                "recipe_id": "r1",
                "run_overrides": {"tweakreg": {"abs_refcat": "GAIADR3"}},
            },
        )
        await store.create(job)
        response = await client.get(f"/api/jobs/{job.job_id}", headers=bearer(USER))
        assert response.status_code == 200
        assert response.json()["request"] == {
            "recipe_id": "r1",
            "run_overrides": {"tweakreg": {"abs_refcat": "GAIADR3"}},
        }

    async def test_get_foreign_job_is_404(self, client: httpx.AsyncClient, store: JobStore) -> None:
        job_id = await seed_job(store, user_id=OTHER)
        response = await client.get(f"/api/jobs/{job_id}", headers=bearer(USER))
        assert response.status_code == 404

    async def test_admin_can_read_any_job(self, client: httpx.AsyncClient, store: JobStore) -> None:
        job_id = await seed_job(store, user_id=OTHER)
        response = await client.get(f"/api/jobs/{job_id}", headers=bearer(USER, role="Admin"))
        assert response.status_code == 200

    async def test_get_unknown_job_is_404(self, client: httpx.AsyncClient) -> None:
        response = await client.get("/api/jobs/does-not-exist", headers=bearer(USER))
        assert response.status_code == 404

    async def test_list_returns_only_own_jobs(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        mine = await seed_job(store)
        await seed_job(store, user_id=OTHER)
        response = await client.get("/api/jobs", headers=bearer(USER))
        assert response.status_code == 200
        jobs = response.json()["jobs"]
        assert [j["jobId"] for j in jobs] == [mine]


class TestCancel:
    async def test_cancel_own_active_job(self, client: httpx.AsyncClient, store: JobStore) -> None:
        job_id = await seed_job(store)
        response = await client.post(f"/api/jobs/{job_id}/cancel", headers=bearer(USER))
        assert response.status_code == 200
        assert response.json() == {"cancelRequested": True}
        assert await store.is_cancel_requested(job_id) is True

    async def test_cancel_foreign_job_is_404(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        job_id = await seed_job(store, user_id=OTHER)
        response = await client.post(f"/api/jobs/{job_id}/cancel", headers=bearer(USER))
        assert response.status_code == 404
        assert await store.is_cancel_requested(job_id) is False

    async def test_cancel_unknown_job_is_404(self, client: httpx.AsyncClient) -> None:
        response = await client.post("/api/jobs/does-not-exist/cancel", headers=bearer(USER))
        assert response.status_code == 404

    async def test_cancel_terminal_job_is_noop(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        job_id = await seed_job(store)
        await store.mark_succeeded(job_id, JobResult())
        response = await client.post(f"/api/jobs/{job_id}/cancel", headers=bearer(USER))
        assert response.status_code == 200
        assert response.json() == {"cancelRequested": False, "status": "succeeded"}


class TestCors:
    async def test_preflight_from_allowed_origin(self, client: httpx.AsyncClient) -> None:
        response = await client.options(
            "/api/jobs",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"

    async def test_preflight_from_unknown_origin_not_allowed(
        self, client: httpx.AsyncClient
    ) -> None:
        response = await client.options(
            "/api/jobs",
            headers={
                "Origin": "http://evil.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert "access-control-allow-origin" not in response.headers
