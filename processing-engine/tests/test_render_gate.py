"""Tests for the global render concurrency gate (#1645).

The gate bounds concurrent heavy renders (composite/mosaic generation) so N
parallel requests cannot OOM the box — the per-request memory budget (#882)
caps one render, the gate caps how many run at once.
"""

import asyncio
import threading
import time

import pytest
from fastapi import HTTPException

from app.config import EnvVarError
from app.render_gate import (
    RenderGate,
    get_render_gate,
    render_gated,
    reset_render_gate,
    resolve_slot_count,
)


@pytest.fixture(autouse=True)
def _clean_gate_env(monkeypatch):
    """Isolate each test from ambient env and the module singleton."""
    for var in (
        "MAX_CONCURRENT_RENDERS",
        "RENDER_QUEUE_WAIT_SECONDS",
        "RENDER_RETRY_AFTER_SECONDS",
        "MAX_COMPOSITE_MEMORY_BYTES",
    ):
        monkeypatch.delenv(var, raising=False)
    reset_render_gate()
    yield
    reset_render_gate()


# ---------------------------------------------------------------------------
# Slot resolution
# ---------------------------------------------------------------------------


class TestResolveSlotCount:
    def test_explicit_env_wins(self, monkeypatch):
        monkeypatch.setenv("MAX_CONCURRENT_RENDERS", "3")
        assert resolve_slot_count(detected_limit_bytes=32_000_000_000) == 3

    def test_auto_derives_from_memory_limit_over_budget(self, monkeypatch):
        # 8 GB container / 3 GB budget -> 2 slots
        monkeypatch.setenv("MAX_COMPOSITE_MEMORY_BYTES", "3000000000")
        assert resolve_slot_count(detected_limit_bytes=8_000_000_000) == 2

    def test_auto_clamps_to_max_four(self, monkeypatch):
        monkeypatch.setenv("MAX_COMPOSITE_MEMORY_BYTES", "1500000000")
        assert resolve_slot_count(detected_limit_bytes=64_000_000_000) == 4

    def test_auto_clamps_to_min_one(self, monkeypatch):
        # Budget larger than the container limit still yields one slot.
        monkeypatch.setenv("MAX_COMPOSITE_MEMORY_BYTES", "3000000000")
        assert resolve_slot_count(detected_limit_bytes=2_000_000_000) == 1

    def test_auto_without_detectable_limit_falls_back_to_two(self):
        assert resolve_slot_count(detected_limit_bytes=None) == 2

    def test_zero_env_means_auto(self, monkeypatch):
        monkeypatch.setenv("MAX_CONCURRENT_RENDERS", "0")
        monkeypatch.setenv("MAX_COMPOSITE_MEMORY_BYTES", "3000000000")
        assert resolve_slot_count(detected_limit_bytes=8_000_000_000) == 2

    def test_negative_env_is_a_startup_error(self, monkeypatch):
        monkeypatch.setenv("MAX_CONCURRENT_RENDERS", "-1")
        with pytest.raises(EnvVarError):
            resolve_slot_count(detected_limit_bytes=None)

    def test_non_integer_env_is_a_startup_error(self, monkeypatch):
        monkeypatch.setenv("MAX_CONCURRENT_RENDERS", "many")
        with pytest.raises(EnvVarError):
            resolve_slot_count(detected_limit_bytes=None)


# ---------------------------------------------------------------------------
# Gate behavior
# ---------------------------------------------------------------------------


class TestRenderGate:
    def test_render_runs_inside_slot(self):
        gate = RenderGate(slots=1, wait_seconds=0.05, retry_after_seconds=7)
        with gate.slot():
            pass  # acquired and released without error

    def test_second_render_gets_429_when_full(self):
        gate = RenderGate(slots=1, wait_seconds=0.05, retry_after_seconds=7)
        holding = threading.Event()
        release = threading.Event()

        def hold_slot():
            with gate.slot():
                holding.set()
                release.wait(timeout=5)

        worker = threading.Thread(target=hold_slot)
        worker.start()
        try:
            assert holding.wait(timeout=5)
            with pytest.raises(HTTPException) as excinfo, gate.slot():
                pass
            assert excinfo.value.status_code == 429
            assert excinfo.value.headers["Retry-After"] == "7"
        finally:
            release.set()
            worker.join(timeout=5)

    def test_slot_freed_after_release(self):
        gate = RenderGate(slots=1, wait_seconds=0.05, retry_after_seconds=7)
        with gate.slot():
            pass
        with gate.slot():
            pass  # no 429 — the slot was released

    def test_slot_freed_when_render_raises(self):
        gate = RenderGate(slots=1, wait_seconds=0.05, retry_after_seconds=7)
        with pytest.raises(RuntimeError), gate.slot():
            raise RuntimeError("render blew up")
        with gate.slot():
            pass  # slot not leaked by the failure

    def test_acquire_async_succeeds_when_slot_free(self):
        gate = RenderGate(slots=1, wait_seconds=0.05, retry_after_seconds=7)
        asyncio.run(gate.acquire_async())
        gate.release()
        # Released slot is reusable.
        asyncio.run(gate.acquire_async())
        gate.release()

    def test_acquire_async_raises_429_when_full(self):
        gate = RenderGate(slots=1, wait_seconds=0.05, retry_after_seconds=7)
        gate._semaphore.acquire()  # consume the only slot
        with pytest.raises(HTTPException) as excinfo:
            asyncio.run(gate.acquire_async())
        assert excinfo.value.status_code == 429
        assert excinfo.value.headers["Retry-After"] == "7"

    def test_acquire_async_gets_slot_freed_within_window(self):
        gate = RenderGate(slots=1, wait_seconds=5, retry_after_seconds=7)
        gate._semaphore.acquire()

        async def free_then_acquire():
            loop = asyncio.get_running_loop()
            loop.call_later(0.15, gate.release)
            await gate.acquire_async()  # must pick up the freed slot, not 429

        asyncio.run(free_then_acquire())
        gate.release()

    def test_waiter_acquires_when_slot_frees_within_window(self):
        gate = RenderGate(slots=1, wait_seconds=5, retry_after_seconds=7)
        holding = threading.Event()

        def hold_briefly():
            with gate.slot():
                holding.set()
                time.sleep(0.1)

        worker = threading.Thread(target=hold_briefly)
        worker.start()
        try:
            assert holding.wait(timeout=5)
            with gate.slot():
                pass  # waited out the holder instead of 429ing
        finally:
            worker.join(timeout=5)


# ---------------------------------------------------------------------------
# render_gated decorator — slot accounting around the wrapped handler
# ---------------------------------------------------------------------------


class TestRenderGatedDecorator:
    def _install_gate(self, monkeypatch) -> RenderGate:
        import app.render_gate as render_gate_module

        gate = RenderGate(slots=1, wait_seconds=0.05, retry_after_seconds=7)
        monkeypatch.setattr(render_gate_module, "_gate", gate)
        return gate

    def test_success_runs_handler_and_releases_slot(self, monkeypatch):
        gate = self._install_gate(monkeypatch)

        @render_gated
        def handler(value: int) -> int:
            return value + 1

        assert asyncio.run(handler(1)) == 2
        # Slot was released: it can be acquired again without waiting.
        asyncio.run(gate.acquire_async())
        gate.release()

    def test_handler_exception_still_releases_slot(self, monkeypatch):
        gate = self._install_gate(monkeypatch)

        @render_gated
        def handler() -> None:
            raise RuntimeError("render blew up")

        with pytest.raises(RuntimeError):
            asyncio.run(handler())
        asyncio.run(gate.acquire_async())
        gate.release()

    def test_raises_429_without_running_handler_when_busy(self, monkeypatch):
        gate = self._install_gate(monkeypatch)
        gate._semaphore.acquire()  # exhaust the only slot
        ran = False

        @render_gated
        def handler() -> None:
            nonlocal ran
            ran = True

        with pytest.raises(HTTPException) as excinfo:
            asyncio.run(handler())
        assert excinfo.value.status_code == 429
        assert ran is False


# ---------------------------------------------------------------------------
# Singleton + env wiring
# ---------------------------------------------------------------------------


class TestGateSingleton:
    def test_get_render_gate_reads_env(self, monkeypatch):
        monkeypatch.setenv("MAX_CONCURRENT_RENDERS", "1")
        monkeypatch.setenv("RENDER_QUEUE_WAIT_SECONDS", "0.05")
        monkeypatch.setenv("RENDER_RETRY_AFTER_SECONDS", "11")
        reset_render_gate()
        gate = get_render_gate()
        assert gate.slots == 1
        assert gate.retry_after_seconds == 11
        assert get_render_gate() is gate  # cached singleton


# ---------------------------------------------------------------------------
# Endpoint integration — gated routes return 429 when the gate is exhausted
# ---------------------------------------------------------------------------


@pytest.fixture()
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from main import app

    return TestClient(app, raise_server_exceptions=False)


def _exhausted_gate():
    gate = RenderGate(slots=1, wait_seconds=0.05, retry_after_seconds=7)
    gate._semaphore.acquire()  # deterministically consume the only slot
    return gate


class TestEndpointIntegration:
    def test_generate_nchannel_returns_429_when_busy(self, monkeypatch, client):
        import app.render_gate as render_gate_module

        monkeypatch.setattr(render_gate_module, "_gate", _exhausted_gate())
        response = client.post(
            "/composite/generate-nchannel",
            json={"channels": [{"file_paths": ["nonexistent.fits"], "color": {"hue": 0}}]},
        )
        assert response.status_code == 429
        assert response.headers.get("Retry-After") == "7"

    def test_mosaic_generate_returns_429_when_busy(self, monkeypatch, client):
        import app.render_gate as render_gate_module

        monkeypatch.setattr(render_gate_module, "_gate", _exhausted_gate())
        response = client.post(
            "/mosaic/generate",
            json={"files": [{"file_path": "a.fits"}, {"file_path": "b.fits"}]},
        )
        assert response.status_code == 429

    def test_estimate_stays_unthrottled(self, monkeypatch, client):
        import app.render_gate as render_gate_module

        monkeypatch.setattr(render_gate_module, "_gate", _exhausted_gate())
        response = client.post(
            "/composite/estimate",
            json={"channels": [{"file_paths": ["nonexistent.fits"], "color": {"hue": 0}}]},
        )
        # Not 429: the pre-flight estimate must stay cheap and available even
        # while renders are saturated (it may 4xx for other reasons here).
        assert response.status_code != 429
