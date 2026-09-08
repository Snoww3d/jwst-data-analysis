"""Memory-budget and header-before-payload regressions for render routes."""

from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
from astropy.io import fits
from fastapi import FastAPI
from fastapi.testclient import TestClient
from scipy import ndimage

from app import diagnostics
from app.render import routes
from app.storage.helpers import MAX_FITS_ARRAY_ELEMENTS


@pytest.mark.parametrize(
    ("limit", "used", "host", "expected"),
    [
        ("1000", "250", 2000, 750),
        ("1000", "250", 500, 500),
        ("1000", "1000", 2000, 0),
        ("1000", "1100", 2000, 0),
        ("max", "250", 2000, 2000),
        ("invalid", "250", 2000, 2000),
        ("1000", "invalid", 2000, 2000),
        ("-1", "250", 2000, 2000),
        ("1000", "-1", 2000, 2000),
    ],
)
def test_available_memory(monkeypatch, limit, used, host, expected):
    counters = {"memory.max": limit, "memory.current": used}
    monkeypatch.setattr(diagnostics.Path, "read_text", lambda path: counters[path.name])
    monkeypatch.setattr(
        diagnostics.psutil, "virtual_memory", lambda: SimpleNamespace(available=host)
    )
    assert diagnostics.available_memory_bytes() == expected


@pytest.mark.parametrize("error", [FileNotFoundError, PermissionError])
@pytest.mark.parametrize("missing", ["memory.max", "memory.current"])
def test_unavailable_cgroup_falls_back_to_host(monkeypatch, error, missing):
    def read_counter(path):
        if path.name == missing:
            raise error
        return "1000"

    monkeypatch.setattr(diagnostics.Path, "read_text", read_counter)
    monkeypatch.setattr(
        diagnostics.psutil, "virtual_memory", lambda: SimpleNamespace(available=1234)
    )
    assert diagnostics.available_memory_bytes() == 1234


@pytest.mark.parametrize("dtype", [np.float32, np.float64])
def test_zoom_budget_boundary(monkeypatch, dtype):
    data = np.zeros((10, 10), dtype=dtype)
    boundary = data.size * data.itemsize * 3 * 5 // 4
    monkeypatch.setattr(diagnostics, "available_memory_bytes", lambda: boundary)
    diagnostics.check_zoom_memory(data)
    monkeypatch.setattr(diagnostics, "available_memory_bytes", lambda: boundary - 1)
    with pytest.raises(MemoryError, match="Downsampling needs"):
        diagnostics.check_zoom_memory(data)


def test_zoom_rejects_nonempty_array_when_memory_exhausted(monkeypatch):
    monkeypatch.setattr(diagnostics, "available_memory_bytes", lambda: 0)
    diagnostics.check_zoom_memory(np.empty((0, 0)))
    with pytest.raises(MemoryError):
        diagnostics.check_zoom_memory(np.zeros((1, 1)))


@pytest.fixture
def client(monkeypatch):
    api = FastAPI()
    api.include_router(routes.router)
    monkeypatch.setattr(routes, "resolve_fits_path", lambda path: path)
    with TestClient(api) as test_client:
        yield test_client


def request_image(client, endpoint, file_path="unused.fits", size=100):
    if endpoint == "thumbnail":
        return client.post("/thumbnail", json={"file_path": str(file_path)})
    return client.get(
        f"/{endpoint}/test",
        params={"file_path": str(file_path), "width": size, "height": size, "max_size": size},
    )


@pytest.fixture
def image_path(tmp_path):
    path = tmp_path / "image.fits.gz"
    fits.HDUList(
        [
            fits.PrimaryHDU(),
            fits.BinTableHDU.from_columns([]),
            fits.ImageHDU(np.arange(200 * 200, dtype=np.float32).reshape(200, 200)),
        ]
    ).writeto(path)
    return path


@pytest.mark.parametrize("endpoint", ["preview", "pixeldata"])
@pytest.mark.parametrize("failure", ["budget", "allocation"])
def test_zoom_memory_failure_returns_413(client, monkeypatch, image_path, endpoint, failure):
    monkeypatch.setattr(
        diagnostics, "available_memory_bytes", lambda: 0 if failure == "budget" else 10**9
    )
    zoom = Mock(side_effect=MemoryError("private allocator detail"))
    monkeypatch.setattr(ndimage, "zoom", zoom)
    response = request_image(client, endpoint, image_path)
    assert response.status_code == 413
    assert response.json()["detail"].startswith("Insufficient memory to downsample image.")
    assert "private allocator detail" not in response.text
    assert zoom.call_count == (0 if failure == "budget" else 1)


@pytest.mark.parametrize("endpoint", ["preview", "pixeldata"])
def test_no_zoom_does_not_require_memory_budget(client, monkeypatch, image_path, endpoint):
    monkeypatch.setattr(diagnostics, "available_memory_bytes", lambda: 0)
    zoom = Mock(side_effect=AssertionError("No downsampling needed"))
    monkeypatch.setattr(ndimage, "zoom", zoom)
    assert request_image(client, endpoint, image_path, size=200).status_code == 200
    zoom.assert_not_called()


@pytest.mark.parametrize("endpoint", ["preview", "pixeldata", "histogram", "thumbnail"])
def test_compressed_image_after_table_renders(client, monkeypatch, image_path, endpoint):
    monkeypatch.setattr(diagnostics, "available_memory_bytes", lambda: 10**9)
    response = request_image(client, endpoint, image_path)
    assert response.status_code == 200
    if endpoint == "preview":
        assert response.content.startswith(b"\x89PNG")
    elif endpoint == "pixeldata":
        assert response.json()["preview_shape"] == [100, 100]


@pytest.mark.parametrize("endpoint", ["preview", "pixeldata", "histogram", "thumbnail"])
def test_oversized_header_rejected_without_payload_access(client, monkeypatch, endpoint):
    class LazyImage:
        shape = (MAX_FITS_ARRAY_ELEMENTS + 1, 2)

        @property
        def data(self):
            pytest.fail("Oversized FITS payload accessed before header validation")

    # Non-image HDUs have no shape property; they must also be skipped without data access.
    monkeypatch.setattr(
        routes.fits, "open", lambda *_a, **_kw: nullcontext([object(), LazyImage()])
    )
    response = request_image(client, endpoint)
    assert response.status_code == 413
    assert "Image too large" in response.json()["detail"]
