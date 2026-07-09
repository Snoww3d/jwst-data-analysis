"""Global render semaphore (CE plan Phase 4).

The per-request memory budgets are per-request; nothing bounded render
CONCURRENCY before this. On a public no-auth box, N parallel renders each
within budget can still sum past physical memory — the semaphore caps
concurrent renders (queue briefly, then 429 + Retry-After).

The slot pool is GLOBAL and shared across composite AND mosaic renders (they
contend for the same physical RAM), so it lives in ``app.render.render_gate``
and is patched there.
"""

import importlib
import json
import threading
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.render.render_gate as gate


@pytest.fixture
def exhausted_semaphore(monkeypatch):
    """Render slots exhausted (admission open) and a near-zero queue wait."""
    sem = threading.BoundedSemaphore(1)
    assert sem.acquire(blocking=False)
    monkeypatch.setattr(gate, "_render_slots", sem)
    monkeypatch.setattr(gate, "_admission", threading.BoundedSemaphore(8))
    monkeypatch.setattr(gate, "RENDER_QUEUE_WAIT_SECONDS", 0.05)
    return sem


VALID_BODY = {
    "channels": [{"file_paths": ["mast/x/y.fits"], "color": {"hue": 120.0}}],
    "width": 200,
    "height": 200,
}

# Schema-valid mosaic bodies — enough for FastAPI/Pydantic to build the request
# and enter the handler, where the render slot is acquired before any file work.
VALID_MOSAIC_BODY = {
    "files": [
        {"file_path": "mast/a.fits"},
        {"file_path": "mast/b.fits"},
    ],
    "output_format": "png",
}
VALID_OBS_MOSAIC_BODY = {"file_paths": ["mast/a.fits", "mast/b.fits"]}


class TestRenderSlot:
    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_exhausted_raises_429_with_retry_after(self):
        with pytest.raises(HTTPException) as exc, gate.render_slot():
            pass
        assert exc.value.status_code == 429
        # clamped to >= 1 even when the queue wait is sub-second
        assert int(exc.value.headers["Retry-After"]) >= 1
        assert "renderer is at capacity" in str(exc.value.detail)

    def test_admission_full_fails_immediately_without_waiting(self, monkeypatch):
        """Beyond slots+queue_depth, callers must NOT block a thread at all."""
        monkeypatch.setattr(gate, "_render_slots", threading.BoundedSemaphore(1))
        adm = threading.BoundedSemaphore(1)
        assert adm.acquire(blocking=False)
        monkeypatch.setattr(gate, "_admission", adm)
        monkeypatch.setattr(gate, "RENDER_QUEUE_WAIT_SECONDS", 30.0)
        start = time.monotonic()
        with pytest.raises(HTTPException) as exc, gate.render_slot():
            pass
        assert exc.value.status_code == 429
        assert time.monotonic() - start < 1.0  # no 30s wait

    def test_cancelled_while_waiting_raises_pipeline_cancelled(self, monkeypatch):
        from app.composite.progress import PipelineCancelled

        sem = threading.BoundedSemaphore(1)
        assert sem.acquire(blocking=False)
        monkeypatch.setattr(gate, "_render_slots", sem)
        monkeypatch.setattr(gate, "_admission", threading.BoundedSemaphore(8))
        monkeypatch.setattr(gate, "RENDER_QUEUE_WAIT_SECONDS", 30.0)
        cancelled = threading.Event()
        cancelled.set()
        start = time.monotonic()
        with pytest.raises(PipelineCancelled), gate.render_slot(cancelled=cancelled):
            pass
        assert time.monotonic() - start < 1.0  # bails on the first slice

    def test_exactly_slot_count_succeeds_under_contention(self, monkeypatch):
        monkeypatch.setattr(gate, "_render_slots", threading.BoundedSemaphore(2))
        monkeypatch.setattr(gate, "_admission", threading.BoundedSemaphore(10))
        monkeypatch.setattr(gate, "RENDER_QUEUE_WAIT_SECONDS", 0.3)
        inside = threading.Semaphore(0)
        release_renders = threading.Event()
        outcomes = []

        def render():
            try:
                with gate.render_slot():
                    inside.release()
                    release_renders.wait(timeout=5)
                    outcomes.append("ok")
            except HTTPException as e:
                outcomes.append(e.status_code)

        threads = [threading.Thread(target=render) for _ in range(5)]
        for t in threads:
            t.start()
        inside.acquire()
        inside.acquire()  # two renders hold slots
        # give the other three time to exhaust their 0.3s window
        time.sleep(0.6)
        release_renders.set()
        for t in threads:
            t.join(timeout=5)
        assert outcomes.count("ok") == 2
        assert outcomes.count(429) == 3

    def test_slot_released_after_use(self, monkeypatch):
        sem = threading.BoundedSemaphore(1)
        monkeypatch.setattr(gate, "_render_slots", sem)
        monkeypatch.setattr(gate, "RENDER_QUEUE_WAIT_SECONDS", 0.05)
        with gate.render_slot():
            assert not sem.acquire(blocking=False)  # held
        assert sem.acquire(blocking=False)  # released
        sem.release()

    def test_slot_released_when_body_raises(self, monkeypatch):
        sem = threading.BoundedSemaphore(1)
        monkeypatch.setattr(gate, "_render_slots", sem)
        with pytest.raises(RuntimeError), gate.render_slot():
            raise RuntimeError("pipeline exploded")
        assert sem.acquire(blocking=False)
        sem.release()

    def test_queued_caller_proceeds_when_slot_frees(self, monkeypatch):
        """A waiter inside the queue window gets the slot instead of 429ing."""
        sem = threading.BoundedSemaphore(1)
        monkeypatch.setattr(gate, "_render_slots", sem)
        monkeypatch.setattr(gate, "RENDER_QUEUE_WAIT_SECONDS", 2.0)
        assert sem.acquire(blocking=False)
        result = {}

        def waiter():
            with gate.render_slot():
                result["entered"] = True

        t = threading.Thread(target=waiter)
        t.start()
        time.sleep(0.1)
        sem.release()  # first render finishes
        t.join(timeout=3)
        assert result.get("entered") is True

    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_composite_alias_shares_the_same_pool(self):
        """composite.routes imports the gate slot as ``_render_slot``; it must
        draw from the SAME global pool. Asserted behaviorally (not by object
        identity) so it survives an importlib.reload(gate) elsewhere in the
        suite — the composite alias reads the live gate module globals at call
        time, so exhausting gate._render_slots must make the alias 429 too."""
        import app.composite.routes as composite_routes

        with pytest.raises(HTTPException) as exc, composite_routes._render_slot():
            pass
        assert exc.value.status_code == 429


class TestRoutesGuarded:
    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_sync_route_429_before_any_pipeline_work(self):
        from main import app

        client = TestClient(app)
        resp = client.post("/composite/generate-nchannel", json=VALID_BODY)
        assert resp.status_code == 429
        assert resp.headers.get("retry-after")

    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_stream_route_emits_429_error_event_with_retry_hint(self):
        from main import app

        client = TestClient(app)
        with client.stream("POST", "/composite/generate-nchannel-stream", json=VALID_BODY) as resp:
            events = [json.loads(line) for line in resp.iter_lines() if line]
        terminal = events[-1]
        assert terminal["event"] == "error"
        assert terminal["status_code"] == 429
        # NDJSON responses are HTTP 200, so the backoff hint must ride in-band
        assert int(terminal["retry_after"]) >= 1

    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_ce_facade_429_with_retry_after(self):
        """The public CE edge: 429 must propagate out of asyncio.to_thread
        with the Retry-After header and the /api error-shim body shape."""
        from bson import ObjectId
        from fastapi import FastAPI

        import app.composite.api_routes as facade
        from app.db.deps import get_repository
        from app.db.repository import JwstDataReadRepository
        from app.exceptions import register_api_error_shim
        from tests.db.fakes import FakeCollection

        oid = ObjectId()
        api = FastAPI()
        register_api_error_shim(api)
        api.include_router(facade.router)
        repo = JwstDataReadRepository(
            FakeCollection(
                [{"_id": oid, "FileName": "x.fits", "IsPublic": True, "FilePath": "mast/x.fits"}]
            )
        )
        api.dependency_overrides[get_repository] = lambda: repo
        client = TestClient(api)
        resp = client.post(
            "/api/composite/generate-nchannel",
            json={"channels": [{"dataIds": [str(oid)], "color": {"hue": 1.0}}]},
        )
        assert resp.status_code == 429
        assert resp.headers.get("retry-after")
        assert "renderer is at capacity" in resp.json()["error"]

    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_estimate_and_analyze_bypass_the_gate(self):
        """Pre-flight endpoints deliberately do NOT take a render slot —
        they must keep answering while renderers are saturated."""
        from main import app

        client = TestClient(app)
        resp = client.post("/composite/estimate", json=VALID_BODY)
        assert resp.status_code != 429
        resp = client.post("/composite/analyze-channels", json=VALID_BODY)
        assert resp.status_code != 429


class TestMosaicRoutesGuarded:
    """Mosaic renders share the same global pool as composites (#1645)."""

    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_mosaic_generate_429_before_any_file_work(self):
        from main import app

        client = TestClient(app)
        resp = client.post("/mosaic/generate", json=VALID_MOSAIC_BODY)
        assert resp.status_code == 429
        assert resp.headers.get("retry-after")

    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_observation_mosaic_429_before_any_file_work(self):
        from main import app

        client = TestClient(app)
        resp = client.post("/mosaic/generate-observation", json=VALID_OBS_MOSAIC_BODY)
        assert resp.status_code == 429
        assert resp.headers.get("retry-after")

    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_mosaic_footprint_bypasses_the_gate(self):
        """The cheap footprint pre-flight must keep answering under saturation."""
        from main import app

        client = TestClient(app)
        resp = client.post("/mosaic/footprint", json={"file_paths": ["mast/a.fits"]})
        assert resp.status_code != 429

    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_mosaic_route_signature_preserved_by_decorator(self):
        """@render_slot() must not clobber the handler's request model — a
        malformed body must still 422 (FastAPI validated the signature),
        proving the decorator preserved it via functools.wraps/__wrapped__."""
        from main import app

        client = TestClient(app)
        resp = client.post("/mosaic/generate", json={"files": []})  # min_length=2
        assert resp.status_code == 422


class TestEnvFallback:
    """The generic RENDER_* env names are primary; the legacy COMPOSITE_* names
    are honoured as fallbacks so pre-#1645 configs keep working. Values are read
    at import, so these tests set env then reload the module."""

    @pytest.fixture(autouse=True)
    def _reload_clean_after(self):
        # Restore the module to its unpatched, env-free state after each test so
        # a reloaded copy never leaks into other test modules holding `gate`.
        # NOTE: this autouse fixture must NOT request `monkeypatch` in its
        # signature — autouse fixtures tear down AFTER same-scope requested ones,
        # so monkeypatch's env restore runs first and this reload re-reads clean
        # env. Requesting monkeypatch here would flip that order and make the
        # teardown reload re-read dirty env (re-raising for the zero-count case).
        yield
        importlib.reload(gate)

    def test_legacy_names_used_when_primary_unset(self, monkeypatch):
        monkeypatch.delenv("MAX_CONCURRENT_RENDERS", raising=False)
        monkeypatch.delenv("RENDER_QUEUE_WAIT_SECONDS", raising=False)
        monkeypatch.delenv("RENDER_QUEUE_DEPTH", raising=False)
        monkeypatch.setenv("MAX_CONCURRENT_COMPOSITES", "5")
        monkeypatch.setenv("COMPOSITE_QUEUE_WAIT_SECONDS", "7")
        monkeypatch.setenv("COMPOSITE_QUEUE_DEPTH", "9")
        importlib.reload(gate)
        assert gate.MAX_CONCURRENT_RENDERS == 5
        assert gate.RENDER_QUEUE_WAIT_SECONDS == 7.0
        assert gate.RENDER_QUEUE_DEPTH == 9

    def test_primary_names_win_over_legacy(self, monkeypatch):
        monkeypatch.setenv("MAX_CONCURRENT_RENDERS", "3")
        monkeypatch.setenv("MAX_CONCURRENT_COMPOSITES", "5")
        monkeypatch.setenv("RENDER_QUEUE_WAIT_SECONDS", "1")
        monkeypatch.setenv("COMPOSITE_QUEUE_WAIT_SECONDS", "7")
        monkeypatch.setenv("RENDER_QUEUE_DEPTH", "1")
        monkeypatch.setenv("COMPOSITE_QUEUE_DEPTH", "9")
        importlib.reload(gate)
        assert gate.MAX_CONCURRENT_RENDERS == 3
        assert gate.RENDER_QUEUE_WAIT_SECONDS == 1.0
        assert gate.RENDER_QUEUE_DEPTH == 1

    def test_all_unset_uses_defaults(self, monkeypatch):
        for name in (
            "MAX_CONCURRENT_RENDERS",
            "MAX_CONCURRENT_COMPOSITES",
            "RENDER_QUEUE_WAIT_SECONDS",
            "COMPOSITE_QUEUE_WAIT_SECONDS",
            "RENDER_QUEUE_DEPTH",
            "COMPOSITE_QUEUE_DEPTH",
        ):
            monkeypatch.delenv(name, raising=False)
        importlib.reload(gate)
        assert gate.MAX_CONCURRENT_RENDERS == 2
        assert gate.RENDER_QUEUE_WAIT_SECONDS == 15.0
        assert gate.RENDER_QUEUE_DEPTH == 4

    def test_primary_set_ignores_malformed_legacy(self, monkeypatch):
        """A stale/malformed legacy var must NOT crash startup when the new name
        is the one actually configured (presence short-circuit, not nested
        eager parse)."""
        monkeypatch.setenv("MAX_CONCURRENT_RENDERS", "4")
        monkeypatch.setenv("MAX_CONCURRENT_COMPOSITES", "not-an-int")
        importlib.reload(gate)  # must not raise
        assert gate.MAX_CONCURRENT_RENDERS == 4

    def test_zero_slot_count_fails_loudly(self, monkeypatch):
        from app.config import EnvVarError

        monkeypatch.setenv("MAX_CONCURRENT_RENDERS", "0")
        with pytest.raises(EnvVarError):
            importlib.reload(gate)
