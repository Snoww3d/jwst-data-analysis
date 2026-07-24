# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for the stage-3 executor: the security allowlist, override merging,
the full job lifecycle against a FAKE Image3Pipeline (no jwst run in CI),
log-line parsing, and the /api/calibration/runs endpoint.
"""

import time
import uuid
from pathlib import Path

import httpx
import jwt as pyjwt
import pytest

from app.calibration import executor
from app.calibration.executor import (
    RecipeValidationError,
    merge_overrides,
    run_stage3_job,
    validate_step_overrides,
)
from app.calibration.models import CalibrationRecipe
from app.calibration.routes import get_recipe_store
from app.calibration.store import RecipeStore
from app.db.client import get_database, reset_client
from app.jobs.models import JobRecord
from app.jobs.routes import get_job_store
from app.jobs.runner import launch
from app.jobs.store import JobStore


SECRET = "unit-test-secret-key-at-least-32-chars!!"
ROLE_URI = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role"
USER = "user-a"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("JWT_SECRET_KEY", SECRET)
    monkeypatch.setenv("CALIBRATION_WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setenv("CALIBRATION_MIN_FREE_DISK_GB", "0")
    # Reset the module-level semaphore so MAX_CONCURRENT_CALIBRATIONS applies.
    executor._semaphore = None
    # Single reset point per test — multiple fixtures resetting would close
    # a client another fixture's collection is still bound to.
    reset_client()
    yield
    reset_client()


def bearer(user_id: str = USER) -> dict[str, str]:
    now = int(time.time())
    token = pyjwt.encode(
        {
            "sub": user_id,
            ROLE_URI: "User",
            "iss": "JwstDataAnalysis",
            "aud": "JwstDataAnalysisClient",
            "iat": now,
            "exp": now + 900,
        },
        SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def make_recipe(**overrides) -> CalibrationRecipe:
    payload = {
        "id": "test-stage3",
        "name": "Stage 3 test",
        "instrument": "miri",
        "input_source": {"type": "library_products", "product_suffixes": ["_cal"]},
        "stages": [
            {
                "name": "image3",
                "enabled": True,
                "step_overrides": {"tweakreg": {"snr_threshold": 10.0}},
            }
        ],
        "association": {"rule": "DMS_Level3_Base", "product_name": "test-product"},
    }
    payload.update(overrides)
    return CalibrationRecipe.model_validate(payload)


class TestValidateStepOverrides:
    def test_allowed_steps_pass(self) -> None:
        validate_step_overrides(
            "image3",
            {"tweakreg": {"snr_threshold": 10.0}, "resample": {"pixel_scale": 0.05}},
        )

    def test_unknown_stage_rejected(self) -> None:
        with pytest.raises(RecipeValidationError, match="not runnable"):
            validate_step_overrides("detector1", {})

    def test_disallowed_step_rejected(self) -> None:
        with pytest.raises(RecipeValidationError, match="not allowed"):
            validate_step_overrides("image3", {"jump": {"maximum_cores": "half"}})

    def test_reference_file_override_rejected(self) -> None:
        with pytest.raises(RecipeValidationError, match="reference-file"):
            validate_step_overrides("image3", {"resample": {"override_drizpars": "anything"}})

    @pytest.mark.parametrize(
        "value",
        ["../secrets", "/etc/passwd", "..\\win", "~/x", ".hidden", "ref.fits", "a/b"],
    )
    def test_path_like_values_rejected(self, value: str) -> None:
        with pytest.raises(RecipeValidationError, match="path-like"):
            validate_step_overrides("image3", {"tweakreg": {"catalog_name": value}})

    def test_path_like_inside_list_rejected(self) -> None:
        with pytest.raises(RecipeValidationError, match="path-like"):
            validate_step_overrides("image3", {"tweakreg": {"cats": ["ok", "/etc/x"]}})

    @pytest.mark.parametrize("param", sorted(executor.DENIED_PARAMS))
    def test_run_control_params_rejected(self, param: str) -> None:
        # output_* would break workdir confinement (bare names resolve against
        # process cwd); pre/post_hooks accept importable code references.
        with pytest.raises(RecipeValidationError, match="run-control"):
            validate_step_overrides("image3", {"resample": {param: "x"}})


class TestJobLogHandler:
    async def test_batching_and_line_cap(self, store: JobStore) -> None:
        # Locks in the log-flood mitigation: lines flush in batches and stop
        # at _MAX_LINES with a truncation marker.
        import asyncio
        import logging as _logging

        from app.calibration.executor import _JobLogHandler
        from app.jobs.runner import JobContext

        job = JobRecord(type="calibration", user_id=USER, request={})
        await store.create(job)
        ctx = JobContext(store, job.job_id)
        handler = _JobLogHandler(asyncio.get_running_loop(), ctx, ["tweakreg"])

        def rec(msg: str) -> _logging.LogRecord:
            return _logging.LogRecord("stpipe", _logging.INFO, "", 0, msg, None, None)

        total = _JobLogHandler._MAX_LINES + 100
        await asyncio.to_thread(lambda: [handler.emit(rec(f"line {i}")) for i in range(total)])
        await asyncio.to_thread(handler.flush_remaining)
        if handler._last_submission is not None:
            await asyncio.wrap_future(handler._last_submission)

        doc = await store.get(job.job_id)
        # Store caps the tail at LOG_TAIL_MAX_LINES; the handler stopped at
        # _MAX_LINES, so the newest stored line is the truncation marker.
        assert doc["log_tail"][-1].startswith("... log tail truncated")
        assert f"line {total - 1}" not in doc["log_tail"]


class TestMergeOverrides:
    def test_run_overrides_win_per_param(self) -> None:
        merged = merge_overrides(
            {"tweakreg": {"snr_threshold": 10.0, "searchrad": 2.0}},
            {"tweakreg": {"snr_threshold": 5.0}, "skymatch": {"skymethod": "match"}},
        )
        assert merged == {
            "tweakreg": {"snr_threshold": 5.0, "searchrad": 2.0},
            "skymatch": {"skymethod": "match"},
        }


class FakeStorage:
    def __init__(self):
        self.written: dict[str, bytes] = {}

    def write_from_path(self, key: str, local_path: Path) -> None:
        self.written[key] = local_path.read_bytes()


@pytest.fixture()
async def store():
    collection = get_database()[f"jobs_test_{uuid.uuid4().hex}"]
    yield JobStore(collection)
    await collection.drop()


@pytest.fixture()
def fake_pipeline(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Replace the blocking jwst invocation with a fake that emits real-shaped
    stpipe log lines and writes a dummy i2d product."""
    import logging as _logging

    calls: dict = {}

    def _fake(input_paths, steps, product_name, workdir):
        calls["input_paths"] = input_paths
        calls["steps"] = steps
        calls["product_name"] = product_name
        log = _logging.getLogger("stpipe")
        log.info("Step tweakreg running with args")
        log.info("Step tweakreg done")
        log.info("Step resample running with args")
        (Path(workdir) / f"{product_name}_i2d.fits").write_bytes(b"FAKE_I2D")
        log.info("Step resample done")

    monkeypatch.setattr(executor, "_run_image3_sync", _fake)
    monkeypatch.setattr(executor, "_jwst_version", lambda: "2.0.1-fake")

    fake_storage = FakeStorage()
    monkeypatch.setattr(executor, "get_storage_provider", lambda: fake_storage)

    fits = tmp_path / "input_cal.fits"
    fits.write_bytes(b"FAKE_CAL")
    monkeypatch.setattr(executor, "resolve_fits_path", lambda _key: fits)
    return calls, fake_storage


async def _run_to_terminal(store: JobStore, recipe, inputs, overrides) -> dict:
    job = JobRecord(type="calibration", user_id=USER, request={})

    async def work(ctx):
        return await run_stage3_job(ctx, recipe, inputs, overrides)

    job_id = await launch(store, job, work)
    import asyncio

    async with asyncio.timeout(10):
        while True:
            doc = await store.get(job_id)
            if doc and doc["status"] in ("succeeded", "failed", "cancelled"):
                return doc
            await asyncio.sleep(0.02)


class TestRunStage3Job:
    async def test_happy_path(self, store: JobStore, fake_pipeline) -> None:
        calls, fake_storage = fake_pipeline
        doc = await _run_to_terminal(
            store, make_recipe(), ["mast/obs/a_cal.fits"], {"tweakreg": {"snr_threshold": 5.0}}
        )
        assert doc["status"] == "succeeded"
        # Merged overrides reached the pipeline (run override wins).
        assert calls["steps"]["tweakreg"]["snr_threshold"] == 5.0
        assert calls["product_name"] == "test-product"
        # Output persisted under calibration/<job_id>/ with correct suffix.
        [output] = doc["result"]["outputs"]
        assert output["suffix"] == "_i2d"
        assert output["storage_key"].startswith(f"calibration/{doc['job_id']}/")
        assert fake_storage.written[output["storage_key"]] == b"FAKE_I2D"
        assert doc["result"]["jwst_version"] == "2.0.1-fake"
        # Real per-step progress came from parsed stpipe lines.
        assert "Step resample done" in doc["log_tail"]
        assert doc["progress"]["current_stage"] == "image3:resample"

    @pytest.mark.usefixtures("fake_pipeline")
    async def test_no_enabled_image3_fails(self, store: JobStore) -> None:
        recipe = make_recipe(stages=[{"name": "image3", "enabled": False, "step_overrides": {}}])
        doc = await _run_to_terminal(store, recipe, ["k"], {})
        assert doc["status"] == "failed"
        assert "no enabled image3" in doc["error"]

    async def test_bad_run_override_fails_before_pipeline(
        self, store: JobStore, fake_pipeline
    ) -> None:
        calls, _ = fake_pipeline
        doc = await _run_to_terminal(
            store, make_recipe(), ["k"], {"tweakreg": {"catfile": "/tmp/evil"}}
        )
        assert doc["status"] == "failed"
        assert "path-like" in doc["error"]
        assert "steps" not in calls  # pipeline never invoked

    @pytest.mark.usefixtures("fake_pipeline")
    async def test_no_outputs_is_failure(
        self, store: JobStore, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _silent(input_paths, steps, product_name, workdir):
            pass  # produces nothing

        monkeypatch.setattr(executor, "_run_image3_sync", _silent)
        doc = await _run_to_terminal(store, make_recipe(), ["k"], {})
        assert doc["status"] == "failed"
        assert "no ['_i2d'] outputs" in doc["error"]

    async def test_cancel_after_run_discards_outputs(self, store: JobStore, fake_pipeline) -> None:
        _, fake_storage = fake_pipeline
        job = JobRecord(type="calibration", user_id=USER, request={})

        async def work(ctx):
            # Simulate a cancel arriving while the pipeline is running.
            await store.request_cancel(ctx.job_id, USER)
            return await run_stage3_job(ctx, make_recipe(), ["k"], {})

        job_id = await launch(store, job, work)
        import asyncio

        async with asyncio.timeout(10):
            while (await store.get(job_id))["status"] not in (
                "succeeded",
                "failed",
                "cancelled",
            ):
                await asyncio.sleep(0.02)
        assert (await store.get(job_id))["status"] == "cancelled"
        assert fake_storage.written == {}

    @pytest.mark.usefixtures("fake_pipeline")
    async def test_cancel_before_slot_does_not_leak_permit(self, store: JobStore) -> None:
        # Regression (PR 5 review MUST FIX): a cancel landing between semaphore
        # acquire and the run must release the permit, or the whole calibration
        # subsystem deadlocks at MAX_CONCURRENT_CALIBRATIONS=1.
        job = JobRecord(type="calibration", user_id=USER, request={})
        await store.create(job)
        await store.request_cancel(job.job_id, USER)  # cancel already pending
        from app.jobs.runner import JobCancelled, JobContext

        with pytest.raises(JobCancelled):
            await run_stage3_job(JobContext(store, job.job_id), make_recipe(), ["k"], {})

        # The permit must still be available: a fresh job runs to success.
        doc = await _run_to_terminal(store, make_recipe(), ["k"], {})
        assert doc["status"] == "succeeded"

    @pytest.mark.usefixtures("fake_pipeline")
    async def test_too_many_inputs_rejected(self, store: JobStore) -> None:
        inputs = [f"k{i}" for i in range(executor.MAX_CALIBRATION_INPUTS + 1)]
        doc = await _run_to_terminal(store, make_recipe(), inputs, {})
        assert doc["status"] == "failed"
        assert "too many inputs" in doc["error"]

    @pytest.mark.usefixtures("fake_pipeline")
    async def test_disk_floor_blocks_run(
        self, store: JobStore, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("CALIBRATION_MIN_FREE_DISK_GB", "1000000")
        doc = await _run_to_terminal(store, make_recipe(), ["k"], {})
        assert doc["status"] == "failed"
        assert "insufficient disk space" in doc["error"]


@pytest.fixture()
async def recipe_store():
    collection = get_database()[f"recipes_test_{uuid.uuid4().hex}"]
    yield RecipeStore(collection)
    await collection.drop()


@pytest.fixture()
async def client(recipe_store: RecipeStore, store: JobStore):
    from main import app

    app.dependency_overrides[get_recipe_store] = lambda: recipe_store
    app.dependency_overrides[get_job_store] = lambda: store
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_recipe_store, None)
        app.dependency_overrides.pop(get_job_store, None)


class TestRunsEndpoint:
    async def _seed_recipe(self, recipe_store: RecipeStore) -> str:
        # Owned by the caller — private recipes are invisible to non-owners.
        recipe = make_recipe(created_by=USER)
        await recipe_store.upsert(recipe)
        return recipe.id

    async def test_disabled_returns_501(
        self, client: httpx.AsyncClient, recipe_store, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("CALIBRATION_ENABLED", "false")
        recipe_id = await self._seed_recipe(recipe_store)
        response = await client.post(
            "/api/calibration/runs",
            json={"recipeId": recipe_id, "inputs": ["k"]},
            headers=bearer(),
        )
        assert response.status_code == 501

    async def test_requires_auth(self, client: httpx.AsyncClient) -> None:
        response = await client.post(
            "/api/calibration/runs", json={"recipeId": "x", "inputs": ["k"]}
        )
        assert response.status_code == 401

    async def test_unknown_recipe_is_404(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._enable(monkeypatch)
        response = await client.post(
            "/api/calibration/runs",
            json={"recipeId": "nope", "inputs": ["k"]},
            headers=bearer(),
        )
        assert response.status_code == 404

    async def test_bad_overrides_rejected_422(
        self, client: httpx.AsyncClient, recipe_store, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._enable(monkeypatch)
        recipe_id = await self._seed_recipe(recipe_store)
        response = await client.post(
            "/api/calibration/runs",
            json={
                "recipeId": recipe_id,
                "inputs": ["k"],
                "runOverrides": {"resample": {"output_file": "/etc/passwd"}},
            },
            headers=bearer(),
        )
        assert response.status_code == 422

    @pytest.mark.usefixtures("store", "fake_pipeline")
    async def test_happy_path_returns_job_id(
        self,
        client: httpx.AsyncClient,
        recipe_store,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        self._enable(monkeypatch)
        recipe_id = await self._seed_recipe(recipe_store)
        response = await client.post(
            "/api/calibration/runs",
            json={"recipeId": recipe_id, "inputs": ["mast/obs/a_cal.fits"]},
            headers=bearer(),
        )
        assert response.status_code == 202
        job_id = response.json()["jobId"]

        import asyncio

        async with asyncio.timeout(10):
            while True:
                job = await client.get(f"/api/jobs/{job_id}", headers=bearer())
                if job.json()["status"] in ("succeeded", "failed", "cancelled"):
                    break
                await asyncio.sleep(0.02)
        body = job.json()
        assert body["status"] == "succeeded"
        assert body["request"]["recipe_snapshot"]["id"] == "test-stage3"

    @staticmethod
    def _enable(monkeypatch: pytest.MonkeyPatch) -> None:
        from app.calibration import flags

        monkeypatch.setenv("CALIBRATION_ENABLED", "true")
        monkeypatch.setattr(flags, "jwst_available", lambda: True)
