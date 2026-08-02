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
from bson import ObjectId
from fastapi import Response

from app.db.client import get_database, reset_client
from app.jobs.models import JobOutput, JobRecord, JobResult
from app.jobs.routes import get_job_store, get_library_writer
from app.jobs.store import JobStore
from app.library.writer import JwstDataWriteRepository


SECRET = "unit-test-secret-key-at-least-32-chars!!"
ISSUER = "JwstDataAnalysis"
AUDIENCE = "JwstDataAnalysisClient"
ROLE_URI = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"

USER = "user-a"
OTHER = "user-b"
ADMIN_USER = "admin-a"


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
async def library():
    """Throwaway stand-in for the .NET-era ``jwst_data`` collection.

    Save tests must never write to the real library, so the writer dependency is
    always overridden — including for tests that don't save, which keeps a
    mistake from silently landing in the shared collection.
    """
    collection = get_database()[f"jwst_data_test_{uuid.uuid4().hex}"]
    yield collection
    await collection.drop()


@pytest.fixture()
async def client(store: JobStore, library):
    from main import app

    app.dependency_overrides[get_job_store] = lambda: store
    app.dependency_overrides[get_library_writer] = lambda: JwstDataWriteRepository(library)
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_job_store, None)
        app.dependency_overrides.pop(get_library_writer, None)


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

    async def test_progress_signals_on_the_wire(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        # Contract the run page consumes: per-file position and a last-activity
        # stamp, camelCased by the facade.
        job_id = await seed_job(store)
        await store.set_progress(job_id, current_stage="detector1", current_file=2, total_files=4)

        body = (await client.get(f"/api/jobs/{job_id}", headers=bearer(USER))).json()
        assert body["progress"]["currentFile"] == 2
        assert body["progress"]["totalFiles"] == 4
        assert body["updatedAt"] is not None
        assert "current_file" not in body["progress"]

    async def test_pre_change_documents_still_serve(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        # Jobs written before this change have no updated_at / current_file /
        # total_files. There is no migration, so the facade must still serve
        # them and consumers must see nulls rather than missing keys blowing up.
        job_id = str(uuid.uuid4())
        await store._col.insert_one(
            {
                "job_id": job_id,
                "type": "calibration",
                "user_id": USER,
                "status": "running",
                "cancel_requested": False,
                "created_at": "2026-07-01T00:00:00Z",
                "started_at": "2026-07-01T00:00:01Z",
                "finished_at": None,
                "request": {"recipe_id": "old"},
                "progress": {
                    "stages": [{"name": "image3", "status": "running"}],
                    "current_stage": "image3",
                    "message": "running image3",
                    "download_pct": None,
                },
                "log_tail": ["old line"],
                "result": None,
                "error": None,
            }
        )

        response = await client.get(f"/api/jobs/{job_id}", headers=bearer(USER))
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "running"
        assert body["logTail"] == ["old line"]
        # Absent, not null — consumers must treat missing as null.
        assert body.get("updatedAt") is None
        assert body["progress"].get("currentFile") is None
        assert body["progress"].get("totalFiles") is None

    async def test_interrupted_run_explains_itself_on_the_wire(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        # A run killed by an engine restart must never surface as a bare
        # "cancelled" with no error — the UI has nothing to say in that case.
        job_id = await seed_job(store)
        await store.mark_interrupted(job_id)

        body = (await client.get(f"/api/jobs/{job_id}", headers=bearer(USER))).json()
        assert body["status"] == "failed"
        assert "interrupted" in body["error"]
        assert "restart" in body["error"]

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


class TestAdminRunVisibility:
    """#1807: admin visibility was inconsistent — get_job and the output routes
    have an Admin bypass, the LIST route did not. An admin could open any run
    but never find one, because job ids are UUIDs. It failed safe, which is why
    it went unnoticed, and it made admin observability unusable in practice.
    """

    async def test_default_listing_is_still_only_your_own_runs(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        await seed_job(store, user_id=USER)
        await seed_job(store, user_id=OTHER)

        response = await client.get("/api/jobs", headers=bearer(USER))

        assert response.status_code == 200
        jobs = response.json()["jobs"]
        assert len(jobs) == 1
        assert all(j["userId"] == USER for j in jobs)

    async def test_admin_default_listing_is_also_only_their_own(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        # Opt-in, not implicit: silently merging every user's runs into an
        # admin's own history would make their personal list unusable.
        await seed_job(store, user_id=ADMIN_USER)
        await seed_job(store, user_id=OTHER)

        response = await client.get("/api/jobs", headers=bearer(ADMIN_USER, role="Admin"))

        jobs = response.json()["jobs"]
        assert len(jobs) == 1
        assert jobs[0]["userId"] == ADMIN_USER

    async def test_admin_can_ask_for_every_users_runs(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        await seed_job(store, user_id=ADMIN_USER)
        await seed_job(store, user_id=OTHER)

        response = await client.get("/api/jobs?all=true", headers=bearer(ADMIN_USER, role="Admin"))

        assert response.status_code == 200
        jobs = response.json()["jobs"]
        assert len(jobs) == 2
        # The owner travels on the wire so the UI can label rows that are not
        # the caller's.
        assert {j["userId"] for j in jobs} == {ADMIN_USER, OTHER}

    async def test_non_admin_asking_for_all_is_refused_not_quietly_ignored(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        # A filter that silently does nothing is how this class of bug starts.
        await seed_job(store, user_id=USER)
        await seed_job(store, user_id=OTHER)

        response = await client.get("/api/jobs?all=true", headers=bearer(USER))

        assert response.status_code == 403
        assert "Admin" in response.json()["detail"]


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


async def seed_succeeded_job(
    store: JobStore,
    *,
    user_id: str = USER,
    outputs: list[JobOutput] | None = None,
    request: dict | None = None,
) -> str:
    job = JobRecord(type="calibration", user_id=user_id, request=request or {"recipe_id": "r1"})
    await store.create(job)
    await store.mark_succeeded(job.job_id, JobResult(outputs=outputs or []))
    return job.job_id


def _fits_output(name: str = "jw001_cal.fits") -> JobOutput:
    return JobOutput(storage_key=f"calibration/job-1/{name}", suffix="_cal", size_bytes=1024)


class TestOutputPreview:
    async def test_requires_token(self, client: httpx.AsyncClient) -> None:
        assert (await client.get("/api/jobs/some-id/outputs/0/preview")).status_code == 401

    async def test_foreign_job_is_404(self, client: httpx.AsyncClient, store: JobStore) -> None:
        job_id = await seed_succeeded_job(store, user_id=OTHER, outputs=[_fits_output()])
        response = await client.get(f"/api/jobs/{job_id}/outputs/0/preview", headers=bearer(USER))
        assert response.status_code == 404

    async def test_unknown_job_is_404(self, client: httpx.AsyncClient) -> None:
        response = await client.get("/api/jobs/nope/outputs/0/preview", headers=bearer(USER))
        assert response.status_code == 404

    async def test_no_result_is_404(self, client: httpx.AsyncClient, store: JobStore) -> None:
        # Job exists and is owned, but never succeeded / has no outputs.
        job_id = await seed_job(store)
        response = await client.get(f"/api/jobs/{job_id}/outputs/0/preview", headers=bearer(USER))
        assert response.status_code == 404

    async def test_index_out_of_range_is_404(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        job_id = await seed_succeeded_job(store, outputs=[_fits_output()])
        response = await client.get(f"/api/jobs/{job_id}/outputs/5/preview", headers=bearer(USER))
        assert response.status_code == 404

    async def test_non_fits_output_is_415(self, client: httpx.AsyncClient, store: JobStore) -> None:
        catalog = JobOutput(
            storage_key="calibration/job-1/jw001_cat.ecsv", suffix="_cat", size_bytes=64
        )
        job_id = await seed_succeeded_job(store, outputs=[catalog])
        response = await client.get(f"/api/jobs/{job_id}/outputs/0/preview", headers=bearer(USER))
        assert response.status_code == 415

    async def test_fits_output_renders_png(
        self, client: httpx.AsyncClient, store: JobStore, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        captured: dict[str, object] = {}

        def fake_preview(**kwargs: object) -> Response:
            captured.update(kwargs)
            return Response(content=b"\x89PNG", media_type="image/png")

        # Patch the shim as imported into the jobs router — no real FITS render.
        monkeypatch.setattr("app.jobs.routes.engine_preview", fake_preview)
        job_id = await seed_succeeded_job(store, outputs=[_fits_output()])
        response = await client.get(f"/api/jobs/{job_id}/outputs/0/preview", headers=bearer(USER))
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert response.content == b"\x89PNG"
        # Storage key comes from the job record, not the client.
        assert captured["file_path"] == "calibration/job-1/jw001_cal.fits"
        assert captured["data_id"] == job_id

    async def test_admin_can_view_any_output(
        self, client: httpx.AsyncClient, store: JobStore, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.jobs.routes.engine_preview",
            lambda **_: Response(content=b"\x89PNG", media_type="image/png"),
        )
        job_id = await seed_succeeded_job(store, user_id=OTHER, outputs=[_fits_output()])
        response = await client.get(
            f"/api/jobs/{job_id}/outputs/0/preview", headers=bearer(USER, role="Admin")
        )
        assert response.status_code == 200


class TestDownloadOutput:
    async def test_requires_token(self, client: httpx.AsyncClient) -> None:
        assert (await client.get("/api/jobs/some-id/outputs/0/download")).status_code == 401

    async def test_foreign_job_is_404(self, client: httpx.AsyncClient, store: JobStore) -> None:
        job_id = await seed_succeeded_job(store, user_id=OTHER, outputs=[_fits_output()])
        response = await client.get(f"/api/jobs/{job_id}/outputs/0/download", headers=bearer(USER))
        assert response.status_code == 404

    async def test_serves_a_catalog(
        self, client: httpx.AsyncClient, store: JobStore, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        # Catalogs are 415 for preview; download is their only useful action.
        local = tmp_path / "jw001_cat.ecsv"
        local.write_text("# catalog\n")
        monkeypatch.setattr("app.jobs.routes.resolve_fits_path", lambda _key: local)

        catalog = JobOutput(
            storage_key="calibration/job-1/jw001_cat.ecsv", suffix="_cat", size_bytes=10
        )
        job_id = await seed_succeeded_job(store, outputs=[catalog])
        response = await client.get(f"/api/jobs/{job_id}/outputs/0/download", headers=bearer(USER))
        assert response.status_code == 200
        assert "jw001_cat.ecsv" in response.headers["content-disposition"]


class TestSaveOutputToLibrary:
    @staticmethod
    def _stub_render(monkeypatch: pytest.MonkeyPatch, body: bytes = b"\x89PNG") -> None:
        monkeypatch.setattr(
            "app.jobs.routes.engine_preview",
            lambda **_: Response(content=body, media_type="image/png"),
        )

    async def test_requires_token(self, client: httpx.AsyncClient) -> None:
        assert (await client.post("/api/jobs/some-id/outputs/0/save")).status_code == 401

    async def test_foreign_job_is_404(self, client: httpx.AsyncClient, store: JobStore) -> None:
        job_id = await seed_succeeded_job(store, user_id=OTHER, outputs=[_fits_output()])
        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        assert response.status_code == 404

    async def test_index_out_of_range_is_404(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        job_id = await seed_succeeded_job(store, outputs=[_fits_output()])
        response = await client.post(f"/api/jobs/{job_id}/outputs/9/save", headers=bearer(USER))
        assert response.status_code == 404

    async def test_unsavable_format_is_415(
        self, client: httpx.AsyncClient, store: JobStore
    ) -> None:
        # Downloadable, but there is nothing to look at and nothing to read:
        # neither an image nor a table, so it gets no library record.
        asdf = JobOutput(
            storage_key="calibration/job-1/jw001_cal.asdf", suffix="_cal", size_bytes=64
        )
        job_id = await seed_succeeded_job(store, outputs=[asdf])
        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        assert response.status_code == 415

    async def test_duplicate_key_is_409_not_500(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A name clash is a client-visible conflict, not a server fault (#1803).

        Before this, DuplicateKeyError escaped the route and the UI could only
        report "InternalServerError", which told the user nothing about what
        had gone wrong or what to do next.
        """
        from pymongo.errors import DuplicateKeyError

        async def _boom(_self, **_kwargs):
            raise DuplicateKeyError("E11000 duplicate key error")

        monkeypatch.setattr(
            "app.library.writer.JwstDataWriteRepository.create_from_calibration_output",
            _boom,
        )
        monkeypatch.setattr(
            "app.jobs.routes.engine_preview",
            lambda **_: Response(content=b"\x89PNG", media_type="image/png"),
        )
        job_id = await seed_succeeded_job(store, outputs=[_fits_output()])

        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        assert response.status_code == 409
        assert "already exists" in response.json()["detail"]

    async def test_saves_a_source_catalog(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
    ) -> None:
        """A ``_cat.ecsv`` is savable even though it is not previewable (S1).

        The catalog holds the run's citable numbers — positions, fluxes, AB
        magnitudes and uncertainties — and needs a library record because the
        table viewer is keyed by dataId.
        """
        # Deliberately NOT stubbing the renderer: a catalog must not attempt a
        # thumbnail at all, so a real call here would be a bug.
        catalog = JobOutput(
            storage_key="calibration/job-1/nircam-imaging_cat.ecsv", suffix="_cat", size_bytes=64
        )
        job_id = await seed_succeeded_job(store, outputs=[catalog])

        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        assert response.status_code == 201

        doc = await library.find_one({"FilePath": "calibration/job-1/nircam-imaging_cat.ecsv"})
        assert doc is not None
        assert doc["FileName"] == "nircam-imaging_cat.ecsv"
        # _cat is L3 in the level table, so the catalog files alongside the
        # image it describes rather than landing levelless.
        assert doc["ProcessingLevel"] == "L3"
        # No image, so no thumbnail — the writer omits the field rather than
        # storing a null — and the save still succeeded.
        assert doc.get("ThumbnailData") is None

    async def test_creates_a_private_viewable_library_record(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._stub_render(monkeypatch)
        job_id = await seed_succeeded_job(store, outputs=[_fits_output()])

        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        assert response.status_code == 201
        assert response.json()["created"] is True

        doc = await library.find_one({"FilePath": "calibration/job-1/jw001_cal.fits"})
        assert doc is not None
        assert str(doc["_id"]) == response.json()["dataId"]
        assert doc["UserId"] == USER
        # Private to its owner: the .NET read path filters owner-or-public, so
        # the owner still sees it in /library and the full viewer.
        assert doc["IsPublic"] is False
        assert doc["IsViewable"] is True
        assert doc["FileName"] == "jw001_cal.fits"
        assert doc["DataType"] == "image"
        assert "calibration" in doc["Tags"]
        # Provenance travels with the record, not just the run page.
        assert doc["Metadata"]["job_id"] == job_id
        assert doc["Metadata"]["source"] == "calibration"
        assert doc["ThumbnailData"] is not None

    async def test_records_the_level_and_lineage_that_make_it_reusable(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Without these a saved output is an anonymous file: no level, so
        # nothing knows what can run on it next; no parents, so it is detached
        # from the data it came from; no settings, so two runs of the same
        # input are indistinguishable (#1754).
        self._stub_render(monkeypatch)
        # The name the engine ACTUALLY writes for an image3 run: the recipe's
        # association product_name, which encodes no observation at all. A
        # MAST-shaped filename here would have made this test pass while
        # production recorded nothing.
        parent = await library.insert_one(
            {
                "FileName": "jw02733001001_02101_00001_nrca1_cal.fits",
                "ObservationBaseId": "jw02733001001",
                "UserId": USER,
            }
        )
        job_id = await seed_succeeded_job(
            store,
            outputs=[
                JobOutput(
                    storage_key="calibration/job-1/nircam-imaging_i2d.fits",
                    suffix="_i2d",
                    size_bytes=2048,
                )
            ],
            request={
                "recipe_id": "seed-nircam-imaging",
                "input_data_ids": [str(parent.inserted_id)],
                "run_overrides": {"tweakreg": {"snr_threshold": 5.0}},
                "recipe_snapshot": {
                    "stages": [
                        {"name": "detector1", "enabled": False},
                        {"name": "image3", "enabled": True},
                    ]
                },
            },
        )

        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        assert response.status_code == 201

        doc = await library.find_one({"_id": ObjectId(response.json()["dataId"])})
        # An _i2d output IS a level-3 product — that is what makes it show as
        # finished rather than as something still to be processed.
        assert doc["ProcessingLevel"] == "L3"
        # The library items this run consumed.
        assert doc["DerivedFrom"] == [str(parent.inserted_id)]
        # Inherited from the parent, since the output's own name carries no
        # observation. This is what puts it back with the data it came from.
        assert doc["ObservationBaseId"] == "jw02733001001"
        # Tells two runs of the same recipe apart in the library listing.
        assert doc["Description"] == "L3 from seed-nircam-imaging (tweakreg.snr_threshold=5.0)"
        # The lineage view draws edges from ParentId, so a single-parent output
        # must set it or it renders as a disconnected root.
        assert doc["ParentId"] == str(parent.inserted_id)
        # The settings that produced THIS variant.
        assert doc["Metadata"]["run_overrides"] == {"tweakreg": {"snr_threshold": 5.0}}
        assert doc["Metadata"]["stages_run"] == ["image3"]

    async def test_a_per_exposure_output_records_only_its_own_parent(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Two inputs, one output: recording both would claim the run's other
        # exposure produced this file too.
        self._stub_render(monkeypatch)
        first = await library.insert_one(
            {"FileName": "jw02733001001_02101_00001_nrca1_uncal.fits", "UserId": USER}
        )
        second = await library.insert_one(
            {"FileName": "jw02733001001_02101_00002_nrca1_uncal.fits", "UserId": USER}
        )
        job_id = await seed_succeeded_job(
            store,
            outputs=[
                JobOutput(
                    storage_key="calibration/job-1/jw02733001001_02101_00002_nrca1_rate.fits",
                    suffix="_rate",
                    size_bytes=64,
                )
            ],
            request={
                "recipe_id": "r1",
                "input_data_ids": [str(first.inserted_id), str(second.inserted_id)],
            },
        )
        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        doc = await library.find_one({"_id": ObjectId(response.json()["dataId"])})
        assert doc["DerivedFrom"] == [str(second.inserted_id)]
        assert doc["ProcessingLevel"] == "L2a"
        assert doc["ExposureId"] == "jw02733001001_02101"

    async def test_description_stays_within_the_dotnet_length_limit(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Override names and values are unbounded (the validators check shape,
        # not size), and Description is [StringLength(1000)] on the C# model —
        # so an oversized one would 400 any client that round-trips the record.
        self._stub_render(monkeypatch)
        job_id = await seed_succeeded_job(
            store,
            outputs=[_fits_output()],
            request={
                "recipe_id": "r1",
                "run_overrides": {"tweakreg": {f"p{i}": "x" * 200 for i in range(40)}},
            },
        )
        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        doc = await library.find_one({"_id": ObjectId(response.json()["dataId"])})
        # Never truncated mid-value into something that reads like a real
        # setting: it summarises instead.
        assert len(doc["Description"]) <= 200
        assert doc["Description"] == "L2b from r1 (40 custom settings)"

    async def test_description_drops_whole_settings_when_it_must(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._stub_render(monkeypatch)
        job_id = await seed_succeeded_job(
            store,
            outputs=[_fits_output()],
            request={
                "recipe_id": "r1",
                "run_overrides": {"tweakreg": {f"param_number_{i}": i for i in range(20)}},
            },
        )
        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        description = (await library.find_one({"_id": ObjectId(response.json()["dataId"])}))[
            "Description"
        ]
        assert len(description) <= 200
        assert description.endswith("more)")
        # Whole settings only — no dangling half-written parameter.
        assert "tweakreg.param_number_0=0" in description

    async def test_level_falls_back_to_the_filename(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # An output the engine didn't label must still land with a level
        # rather than none, or it drops out of the pipeline flow entirely.
        self._stub_render(monkeypatch)
        job_id = await seed_succeeded_job(
            store,
            outputs=[
                JobOutput(storage_key="calibration/job-1/jw001_rate.fits", suffix="", size_bytes=64)
            ],
        )
        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        assert response.status_code == 201
        doc = await library.find_one({"_id": ObjectId(response.json()["dataId"])})
        assert doc["ProcessingLevel"] == "L2a"

    async def test_unrecognised_product_gets_no_level_rather_than_a_wrong_one(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._stub_render(monkeypatch)
        job_id = await seed_succeeded_job(
            store,
            outputs=[
                JobOutput(storage_key="calibration/job-1/mystery.fits", suffix="", size_bytes=64)
            ],
        )
        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        doc = await library.find_one({"_id": ObjectId(response.json()["dataId"])})
        assert "ProcessingLevel" not in doc
        # Exposure-level names carry no observation token; no grouping beats a
        # wrong one that files this with unrelated exposures.
        assert "ObservationBaseId" not in doc

    async def test_saving_twice_is_idempotent(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._stub_render(monkeypatch)
        job_id = await seed_succeeded_job(store, outputs=[_fits_output()])

        first = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        second = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))

        assert first.json()["dataId"] == second.json()["dataId"]
        assert second.json()["created"] is False
        # A double-click must not litter the library with duplicates.
        assert await library.count_documents({}) == 1

    async def test_admin_save_files_under_the_job_owner(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._stub_render(monkeypatch)
        job_id = await seed_succeeded_job(store, user_id=OTHER, outputs=[_fits_output()])

        response = await client.post(
            f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER, role="Admin")
        )
        assert response.status_code == 201
        doc = await library.find_one({})
        # An Admin acting on someone else's run must not claim the output.
        assert doc["UserId"] == OTHER

    async def test_thumbnail_failure_still_saves(
        self,
        client: httpx.AsyncClient,
        store: JobStore,
        library,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        def boom(**_: object) -> Response:
            raise RuntimeError("render exploded")

        monkeypatch.setattr("app.jobs.routes.engine_preview", boom)
        job_id = await seed_succeeded_job(store, outputs=[_fits_output()])

        response = await client.post(f"/api/jobs/{job_id}/outputs/0/save", headers=bearer(USER))
        # The thumbnail is cosmetic — losing it must not cost the user the save.
        assert response.status_code == 201
        doc = await library.find_one({})
        assert doc is not None
        assert "ThumbnailData" not in doc


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
