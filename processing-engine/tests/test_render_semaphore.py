"""Global render semaphore (CE plan Phase 4).

The #882 memory budget is per-request; nothing bounded render CONCURRENCY
before this. On a public no-auth box, N parallel composites each within
budget can still sum past physical memory — the semaphore caps concurrent
renders (queue briefly, then 429 + Retry-After).
"""

import json
import threading
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.composite.routes as routes


@pytest.fixture
def exhausted_semaphore(monkeypatch):
    """Render slots exhausted (admission open) and a near-zero queue wait."""
    sem = threading.BoundedSemaphore(1)
    assert sem.acquire(blocking=False)
    monkeypatch.setattr(routes, "_render_slots", sem)
    monkeypatch.setattr(routes, "_admission", threading.BoundedSemaphore(8))
    monkeypatch.setattr(routes, "COMPOSITE_QUEUE_WAIT_SECONDS", 0.05)
    return sem


VALID_BODY = {
    "channels": [{"file_paths": ["mast/x/y.fits"], "color": {"hue": 120.0}}],
    "width": 200,
    "height": 200,
}


class TestRenderSlot:
    @pytest.mark.usefixtures("exhausted_semaphore")
    def test_exhausted_raises_429_with_retry_after(self):
        with pytest.raises(HTTPException) as exc, routes._render_slot():
            pass
        assert exc.value.status_code == 429
        # clamped to >= 1 even when the queue wait is sub-second
        assert int(exc.value.headers["Retry-After"]) >= 1
        assert "renderer is at capacity" in str(exc.value.detail)

    def test_admission_full_fails_immediately_without_waiting(self, monkeypatch):
        """Beyond slots+queue_depth, callers must NOT block a thread at all."""
        monkeypatch.setattr(routes, "_render_slots", threading.BoundedSemaphore(1))
        adm = threading.BoundedSemaphore(1)
        assert adm.acquire(blocking=False)
        monkeypatch.setattr(routes, "_admission", adm)
        monkeypatch.setattr(routes, "COMPOSITE_QUEUE_WAIT_SECONDS", 30.0)
        start = time.monotonic()
        with pytest.raises(HTTPException) as exc, routes._render_slot():
            pass
        assert exc.value.status_code == 429
        assert time.monotonic() - start < 1.0  # no 30s wait

    def test_cancelled_while_waiting_raises_pipeline_cancelled(self, monkeypatch):
        from app.composite.progress import PipelineCancelled

        sem = threading.BoundedSemaphore(1)
        assert sem.acquire(blocking=False)
        monkeypatch.setattr(routes, "_render_slots", sem)
        monkeypatch.setattr(routes, "_admission", threading.BoundedSemaphore(8))
        monkeypatch.setattr(routes, "COMPOSITE_QUEUE_WAIT_SECONDS", 30.0)
        cancelled = threading.Event()
        cancelled.set()
        start = time.monotonic()
        with pytest.raises(PipelineCancelled), routes._render_slot(cancelled=cancelled):
            pass
        assert time.monotonic() - start < 1.0  # bails on the first slice

    def test_exactly_slot_count_succeeds_under_contention(self, monkeypatch):
        monkeypatch.setattr(routes, "_render_slots", threading.BoundedSemaphore(2))
        monkeypatch.setattr(routes, "_admission", threading.BoundedSemaphore(10))
        monkeypatch.setattr(routes, "COMPOSITE_QUEUE_WAIT_SECONDS", 0.3)
        inside = threading.Semaphore(0)
        release_renders = threading.Event()
        outcomes = []

        def render():
            try:
                with routes._render_slot():
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
        monkeypatch.setattr(routes, "_render_slots", sem)
        monkeypatch.setattr(routes, "COMPOSITE_QUEUE_WAIT_SECONDS", 0.05)
        with routes._render_slot():
            assert not sem.acquire(blocking=False)  # held
        assert sem.acquire(blocking=False)  # released
        sem.release()

    def test_slot_released_when_body_raises(self, monkeypatch):
        sem = threading.BoundedSemaphore(1)
        monkeypatch.setattr(routes, "_render_slots", sem)
        with pytest.raises(RuntimeError), routes._render_slot():
            raise RuntimeError("pipeline exploded")
        assert sem.acquire(blocking=False)
        sem.release()

    def test_queued_caller_proceeds_when_slot_frees(self, monkeypatch):
        """A waiter inside the queue window gets the slot instead of 429ing."""
        sem = threading.BoundedSemaphore(1)
        monkeypatch.setattr(routes, "_render_slots", sem)
        monkeypatch.setattr(routes, "COMPOSITE_QUEUE_WAIT_SECONDS", 2.0)
        assert sem.acquire(blocking=False)
        result = {}

        def waiter():
            with routes._render_slot():
                result["entered"] = True

        t = threading.Thread(target=waiter)
        t.start()
        time.sleep(0.1)
        sem.release()  # first render finishes
        t.join(timeout=3)
        assert result.get("entered") is True


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
