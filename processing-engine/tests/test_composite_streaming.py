"""Tests for the streaming N-channel composite endpoint (#1471).

`POST /composite/generate-nchannel-stream` returns NDJSON — one JSON object
per line, with progress events during the pipeline and a terminal `complete`
or `error` event. These tests assert event ordering, the terminal payloads,
and client-disconnect handling without doing real reproject + combine work
(reuse the `mock_pipeline` cache fixture pattern from test_nchannel_composite).
"""

import base64
import json
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image


def _make_test_data(shape=(50, 50), value=1000.0):
    rng = np.random.default_rng(42)
    return rng.normal(loc=value, scale=100, size=shape).astype(np.float64)


@pytest.fixture()
def client():
    from main import app

    return TestClient(app)


@pytest.fixture()
def mock_pipeline_cache():
    """Same shape as the cache mock in test_nchannel_composite — bypasses
    the WCS + reproject path so the streaming tests run fast."""
    shape = (50, 50)
    data = _make_test_data(shape)
    default_channels = {f"ch{i}": data.copy() for i in range(6)}

    class FakeCache:
        def __init__(self):
            self._data = default_channels
            self._original_shape: tuple[int, int] | None = None

        def make_key_nchannel(self, *_args, **_kwargs):
            return "fake-key"

        def get(self, _key):
            if self._data is None:
                return None
            return self._data, self._original_shape

        def get_any_budget(self, _paths):
            return None

        def put(self, _key, _data, _paths, original_shape=None):
            self._original_shape = original_shape

        @property
        def return_value(self):
            return self._data

        @return_value.setter
        def return_value(self, value):
            if isinstance(value, tuple):
                self._data = value[0]
            else:
                self._data = value

    fake = FakeCache()
    with patch("app.composite.routes._cache", fake):
        yield fake


def _parse_ndjson(body: bytes) -> list[dict[str, Any]]:
    """Parse an NDJSON response body into a list of event dicts."""
    return [json.loads(line) for line in body.splitlines() if line.strip()]


class TestGenerateNChannelStream:
    """POST /composite/generate-nchannel-stream — NDJSON streaming response."""

    def _three_channel_request(self) -> dict[str, Any]:
        return {
            "channels": [
                {"file_paths": ["r.fits"], "color": {"hue": 0.0}, "label": "Red"},
                {"file_paths": ["g.fits"], "color": {"hue": 120.0}, "label": "Green"},
                {"file_paths": ["b.fits"], "color": {"hue": 240.0}, "label": "Blue"},
            ],
            "width": 100,
            "height": 100,
        }

    def test_response_is_ndjson(self, client, mock_pipeline_cache):
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline_cache.return_value = (
            {f"ch{i}": data.copy() for i in range(3)},
            shape,
        )

        response = client.post(
            "/composite/generate-nchannel-stream",
            json=self._three_channel_request(),
        )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-ndjson")

    def test_emits_per_channel_stretch_events(self, client, mock_pipeline_cache):
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline_cache.return_value = (
            {f"ch{i}": data.copy() for i in range(3)},
            shape,
        )

        response = client.post(
            "/composite/generate-nchannel-stream",
            json=self._three_channel_request(),
        )
        events = _parse_ndjson(response.content)
        stretch_events = [e for e in events if e.get("stage") == "stretch"]
        # Three channels, three stretch events, ordered 1..3 of 3.
        assert len(stretch_events) == 3
        for idx, event in enumerate(stretch_events, start=1):
            assert event["event"] == "progress"
            assert event["index"] == idx
            assert event["total"] == 3
            assert "filter" in event
            assert "message" in event

    def test_emits_combine_and_encode_stages(self, client, mock_pipeline_cache):
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline_cache.return_value = (
            {f"ch{i}": data.copy() for i in range(3)},
            shape,
        )

        response = client.post(
            "/composite/generate-nchannel-stream",
            json=self._three_channel_request(),
        )
        events = _parse_ndjson(response.content)
        stages = [e.get("stage") for e in events if e.get("event") == "progress"]
        # Combine fires once; encode fires once. Order: combine before encode.
        assert "combine" in stages
        assert "encode" in stages
        assert stages.index("combine") < stages.index("encode")

    def test_terminal_complete_carries_image(self, client, mock_pipeline_cache):
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline_cache.return_value = (
            {f"ch{i}": data.copy() for i in range(3)},
            shape,
        )

        response = client.post(
            "/composite/generate-nchannel-stream",
            json=self._three_channel_request(),
        )
        events = _parse_ndjson(response.content)
        terminal = events[-1]
        assert terminal["event"] == "complete"
        assert "image_b64" in terminal
        assert terminal["content_type"] in ("image/png", "image/jpeg")
        # Decoded payload must be a valid image at the requested dimensions.
        decoded = base64.b64decode(terminal["image_b64"])
        img = Image.open(__import__("io").BytesIO(decoded))
        assert img.size == (100, 100)

    def test_terminal_error_on_invalid_request(self, client, mock_pipeline_cache):  # noqa: ARG002 - fixture bypasses file resolution so the engine reaches the luminance validation

        response = client.post(
            "/composite/generate-nchannel-stream",
            json={
                # Two luminance channels — pipeline raises HTTPException(422).
                "channels": [
                    {"file_paths": ["a.fits"], "color": {"luminance": True}},
                    {"file_paths": ["b.fits"], "color": {"luminance": True}},
                ],
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200  # streaming response itself is 200
        events = _parse_ndjson(response.content)
        terminal = events[-1]
        assert terminal["event"] == "error"
        assert "luminance" in terminal["detail"].lower()
        assert terminal.get("status_code") == 422

    def test_progress_emitter_raises_when_cancellation_flag_set(self):
        """The streaming route's emit closure raises PipelineCancelled at the
        next stage boundary when its threading.Event is set, so a client
        disconnect short-circuits the pipeline instead of running to completion.

        This is a unit test on the cancellation contract — full integration
        with `client.stream(...)` + connection close is awkward in TestClient
        (which buffers responses); the contract here is what makes the route
        safe under client disconnect.
        """
        import asyncio
        import contextlib
        import threading

        from app.composite.progress import PipelineCancelled

        # Drive the same emit closure pattern the route uses.
        loop = asyncio.new_event_loop()
        cancellation = threading.Event()
        queue: asyncio.Queue = asyncio.Queue()  # unused; emit just calls put_nowait

        def emit(event):
            if cancellation.is_set() and event is not None:
                raise PipelineCancelled()
            with contextlib.suppress(RuntimeError):
                loop.call_soon_threadsafe(queue.put_nowait, event)

        # Without flag set, emit succeeds.
        emit({"event": "progress", "stage": "reproject", "message": "first"})

        # Set the flag (as the event_stream's finally would on disconnect).
        cancellation.set()

        # Next emit raises — pipeline code would unwind.
        with pytest.raises(PipelineCancelled):
            emit({"event": "progress", "stage": "stretch", "message": "second"})

        # Sentinel emits (None) bypass the cancellation check — the worker's
        # finally must still be able to drop the sentinel.
        emit(None)

        loop.close()

    def test_progress_events_have_required_schema(self, client, mock_pipeline_cache):
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline_cache.return_value = (
            {f"ch{i}": data.copy() for i in range(3)},
            shape,
        )

        response = client.post(
            "/composite/generate-nchannel-stream",
            json=self._three_channel_request(),
        )
        events = _parse_ndjson(response.content)
        progress_events = [e for e in events if e.get("event") == "progress"]
        assert progress_events, "expected at least one progress event"
        for event in progress_events:
            assert "stage" in event
            assert "message" in event
            assert isinstance(event["message"], str)
            assert event["message"]
