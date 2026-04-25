"""RSS-instrumented integration test for the composite memory budget (#882).

Verifies that the formula `effective_arrays = n + 17` is calibrated tightly
enough that real reproject_interp peak RSS does not exceed the budget. Marked
@pytest.mark.memory so it is opt-in: run via `pytest -m memory` locally or via
the dedicated GitHub Actions workflow.

This test exists because the formula was hand-calibrated. Without an integration
verification, future changes to numpy/reproject/astropy could silently drift
the real peak above the modeled limit, restoring OOM kills on modest VPSes.
"""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from unittest.mock import patch

import numpy as np
import psutil
import pytest
from astropy.io import fits
from fastapi.testclient import TestClient


pytestmark = [
    pytest.mark.memory,
    # RSS attribution gets muddied if multiple tests share the process under
    # pytest-xdist. The slack factor would mask the noise but cause confusing
    # flakes; skip rather than pretend the result is meaningful.
    pytest.mark.skipif(
        os.environ.get("PYTEST_XDIST_WORKER") is not None,
        reason="RSS measurement requires serial execution; not safe under pytest-xdist",
    ),
]


def _write_synthetic_fits(
    tmp_dir: Path,
    name: str,
    shape: tuple[int, int],
    crval: tuple[float, float] = (180.0, 45.0),
    cdelt: float = -0.0005,
) -> Path:
    """Write a small WCS-bearing FITS file for the memory test.

    Uses NIRCam-like pixel scale and a 256x256 grid. Intensities are random
    Gaussian — the exact values don't matter for memory profiling, only the
    array shapes and WCS metadata that drive reproject_interp.
    """
    rng = np.random.default_rng(seed=hash(name) & 0xFFFFFFFF)
    data = np.abs(rng.normal(loc=1.0, scale=0.1, size=shape)).astype(np.float32)

    hdr = fits.Header()
    hdr["NAXIS"] = 2
    hdr["NAXIS1"] = shape[1]
    hdr["NAXIS2"] = shape[0]
    hdr["CTYPE1"] = "RA---TAN"
    hdr["CTYPE2"] = "DEC--TAN"
    hdr["CRPIX1"] = shape[1] / 2.0
    hdr["CRPIX2"] = shape[0] / 2.0
    hdr["CRVAL1"] = crval[0]
    hdr["CRVAL2"] = crval[1]
    hdr["CDELT1"] = cdelt
    hdr["CDELT2"] = abs(cdelt)
    hdr["INSTRUME"] = "NIRCAM"

    path = tmp_dir / name
    fits.writeto(path, data, hdr, overwrite=True)
    return path


class _RSSSampler(threading.Thread):
    """Background thread that samples process RSS at a fixed interval."""

    def __init__(self, interval_s: float = 0.05) -> None:
        super().__init__(daemon=True)
        self.interval = interval_s
        self.peak_rss = 0
        # Note: threading.Thread reserves `_stop` as a method, so we use _stop_event
        self._stop_event = threading.Event()
        self._proc = psutil.Process()

    def run(self) -> None:
        while not self._stop_event.is_set():
            rss = self._proc.memory_info().rss
            if rss > self.peak_rss:
                self.peak_rss = rss
            time.sleep(self.interval)

    def stop(self) -> int:
        self._stop_event.set()
        self.join(timeout=2.0)
        return self.peak_rss


@pytest.fixture
def synthetic_5channel_fits(tmp_path: Path) -> list[Path]:
    """Produce 5 small WCS-bearing FITS files with overlapping footprints."""
    paths = []
    for i in range(5):
        # Slight RA offsets so the WCS has a non-trivial overlap pattern
        path = _write_synthetic_fits(
            tmp_path, f"ch{i}.fits", shape=(256, 256), crval=(180.0 + i * 0.001, 45.0)
        )
        paths.append(path)
    return paths


def _channel_payload(file_path: str, label: str, hue: int) -> dict:
    return {
        "file_paths": [file_path],
        "color": {"hue": hue},
        "label": label,
        "stretch": "asinh",
        "black_point": 0.0,
        "white_point": 1.0,
        "gamma": 1.0,
        "asinh_a": 0.05,
        "curve": "linear",
        "weight": 1.0,
    }


class TestCompositeMemoryBudgetRSS:
    """Real-RSS integration tests for the composite memory budget."""

    def test_5_channel_composite_stays_within_budget(self, synthetic_5channel_fits):
        """Peak RSS during a 5-channel composite stays within MAX_COMPOSITE_MEMORY_BYTES.

        Tolerance 1.5x: the Python process baseline (interpreter, libraries,
        astropy/scipy data tables) consumes ~250-500 MB even at idle. The
        formula budgets for arrays only, not process baseline. We assert the
        peak RSS during the composite doesn't exceed MAX_COMPOSITE_MEMORY_BYTES
        plus that baseline overhead.
        """
        from app.composite.routes import MAX_COMPOSITE_MEMORY_BYTES
        from main import app

        client = TestClient(app)

        # Bypass storage path resolution to point directly at our tmp FITS files.
        def _passthrough(key: str) -> Path:
            return Path(key)

        payload = {
            "channels": [
                _channel_payload(str(p), f"ch{i}", i * 60)
                for i, p in enumerate(synthetic_5channel_fits)
            ],
            "background_neutralization": False,
            "width": 512,
            "height": 512,
            "output_format": "png",
            "quality": 85,
        }

        sampler = _RSSSampler(interval_s=0.05)
        # Capture baseline before request — process startup has already happened
        baseline_rss = psutil.Process().memory_info().rss
        sampler.start()

        try:
            with patch("app.composite.routes.resolve_fits_path", side_effect=_passthrough):
                response = client.post("/composite/generate-nchannel", json=payload)
        finally:
            peak_rss = sampler.stop()

        assert response.status_code == 200, f"composite failed: {response.status_code}"

        # Memory delta during the request — what the formula is supposed to bound
        delta = peak_rss - baseline_rss
        budget = MAX_COMPOSITE_MEMORY_BYTES

        # Slack: 50% over the modeled budget. If the formula is honest, real peak
        # delta should be well under MAX_COMPOSITE_MEMORY_BYTES. The margin guards
        # against minor RSS sampling jitter and Python-side allocator slack
        # without being so loose that drift goes undetected.
        slack_factor = 1.5
        assert delta < budget * slack_factor, (
            f"Composite peak RSS delta {delta / 1e6:.0f} MB exceeded "
            f"budget × {slack_factor} = {budget * slack_factor / 1e6:.0f} MB. "
            f"baseline={baseline_rss / 1e6:.0f} MB peak={peak_rss / 1e6:.0f} MB. "
            f"This means n+17 may be too low for current reproject_interp behavior; "
            f"investigate whether the multiplier needs to grow."
        )
