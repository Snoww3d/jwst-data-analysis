"""JWST sky-coverage snapshot for the browse-first empty state (MAST Search v2 Phase 5).

Where has JWST looked? One paged ``Observations.query_criteria`` over every
public Level-3 science image (measured 2026-08-23: 21,701 rows, 23.5 MB of
JSON / 8.2 MB gzipped because mosaic ``s_region`` strings run to 40 KB) is
too big to ship to the browser whole. The snapshot therefore serves two
shapes:

* ``grid`` — a HEALPix (NESTED, ``nside`` 64, ~0.9° cells) density grid of
  observation centroids: a few thousand ``[pix, count]`` pairs, drawn as a
  MOC at whole-sky FOV.
* ``footprints`` — the real rows (``obs_id``, ``instrument_name``,
  ``t_obs_release``, ``s_region``) whose centroid falls in a requested
  ``bbox``, capped, for FOVs under ~10°.

The snapshot lives in memory for 24 h and is mirrored to a JSON file
(``MAST_COVERAGE_FILE``) so a restart — or a CE image that pre-fetched it at
build time (``scripts/build_coverage_cache.py``) — serves instantly and
works offline. A stale snapshot is served while a refresh runs in the
background; ``stale`` in the response says so.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from app.config import int_env

from .healpix import ang2pix_nest


logger = logging.getLogger(__name__)

COVERAGE_NSIDE = 64
COVERAGE_TTL_SECONDS = 24 * 3600
COVERAGE_PAGE_SIZE = 5000
COVERAGE_CRITERIA: dict[str, Any] = {
    "obs_collection": "JWST",
    "calib_level": 3,
    "dataproduct_type": "image",
    "intentType": "science",
}
DEFAULT_BBOX_CAP = 1500
_NUMBER_RE = re.compile(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")


def default_coverage_file() -> Path:
    configured = os.environ.get("MAST_COVERAGE_FILE")
    if configured:
        return Path(configured)
    base = os.environ.get("MAST_DOWNLOAD_DIR", os.path.join(os.getcwd(), "data", "mast"))
    return Path(base).parent / "mast-coverage.json"


@dataclass
class CoverageRow:
    obs_id: str
    instrument_name: str
    t_obs_release: float | None
    s_region: str
    ra: float
    dec: float

    def to_wire(self) -> dict[str, Any]:
        return {
            "obs_id": self.obs_id,
            "instrument_name": self.instrument_name,
            "t_obs_release": self.t_obs_release,
            "s_region": self.s_region,
        }


@dataclass
class CoverageSnapshot:
    generated_at: str
    nside: int
    rows: list[CoverageRow]
    cells: dict[int, int] = field(default_factory=dict)

    @property
    def age_seconds(self) -> float:
        try:
            generated = datetime.fromisoformat(self.generated_at)
        except ValueError:
            return math.inf
        if generated.tzinfo is None:
            generated = generated.replace(tzinfo=UTC)
        return (datetime.now(UTC) - generated).total_seconds()

    def is_stale(self, ttl: int = COVERAGE_TTL_SECONDS) -> bool:
        return self.age_seconds > ttl

    def grid_payload(self) -> dict[str, Any]:
        return {
            "shape": "grid",
            "nside": self.nside,
            "cells": sorted(([int(pix), int(n)] for pix, n in self.cells.items())),
            "total": len(self.rows),
            "generated_at": self.generated_at,
            "stale": self.is_stale(),
        }

    def footprints_payload(
        self, bbox: tuple[float, float, float, float], cap: int
    ) -> dict[str, Any]:
        ra_min, dec_min, ra_max, dec_max = bbox
        matched = [r for r in self.rows if _in_bbox(r.ra, r.dec, ra_min, dec_min, ra_max, dec_max)]
        # newest first, so a capped dense field still shows the latest releases
        matched.sort(key=lambda r: r.t_obs_release or 0.0, reverse=True)
        return {
            "shape": "footprints",
            "rows": [r.to_wire() for r in matched[:cap]],
            "total": len(matched),
            "truncated": len(matched) > cap,
            "generated_at": self.generated_at,
            "stale": self.is_stale(),
        }

    def to_json(self) -> dict[str, Any]:
        return {
            "generated_at": self.generated_at,
            "nside": self.nside,
            "rows": [
                [r.obs_id, r.instrument_name, r.t_obs_release, r.s_region, r.ra, r.dec]
                for r in self.rows
            ],
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> CoverageSnapshot:
        rows = [
            CoverageRow(
                obs_id=str(r[0]),
                instrument_name=str(r[1]),
                t_obs_release=None if r[2] is None else float(r[2]),
                s_region=str(r[3]),
                ra=float(r[4]),
                dec=float(r[5]),
            )
            for r in data.get("rows", [])
        ]
        nside = int(data.get("nside", COVERAGE_NSIDE))
        snap = cls(generated_at=str(data.get("generated_at", "")), nside=nside, rows=rows)
        snap.cells = bin_cells(rows, nside)
        return snap


def _in_bbox(
    ra: float, dec: float, ra_min: float, dec_min: float, ra_max: float, dec_max: float
) -> bool:
    if dec < dec_min or dec > dec_max:
        return False
    if ra_min <= ra_max:
        return ra_min <= ra <= ra_max
    # wraps RA=0: [ra_min, 360) ∪ [0, ra_max]
    return ra >= ra_min or ra <= ra_max


def parse_bbox(raw: str) -> tuple[float, float, float, float]:
    """``ra_min,dec_min,ra_max,dec_max`` in degrees; RA may wrap (ra_min > ra_max)."""
    parts = raw.split(",")
    if len(parts) != 4:
        raise ValueError("bbox must be ra_min,dec_min,ra_max,dec_max")
    try:
        ra_min, dec_min, ra_max, dec_max = (float(p) for p in parts)
    except ValueError as exc:
        raise ValueError("bbox values must be numbers") from exc
    if not all(math.isfinite(v) for v in (ra_min, dec_min, ra_max, dec_max)):
        raise ValueError("bbox values must be finite")
    if not (-90 <= dec_min <= 90 and -90 <= dec_max <= 90) or dec_min > dec_max:
        raise ValueError("bbox declinations must be in [-90, 90] with dec_min <= dec_max")
    return (ra_min % 360.0, dec_min, ra_max % 360.0, dec_max)


def stcs_centroid(s_region: str) -> tuple[float, float] | None:
    """Mean unit vector of every coordinate pair in an STC-S string (RA-wrap safe)."""
    nums = [float(x) for x in _NUMBER_RE.findall(s_region or "")]
    if len(nums) < 2:
        return None
    if len(nums) % 2:
        nums = nums[:-1]
    ra = np.deg2rad(np.array(nums[0::2]))
    dec = np.deg2rad(np.array(nums[1::2]))
    x = float(np.sum(np.cos(dec) * np.cos(ra)))
    y = float(np.sum(np.cos(dec) * np.sin(ra)))
    z = float(np.sum(np.sin(dec)))
    norm = math.sqrt(x * x + y * y + z * z)
    if norm == 0:
        return None
    ra_c = math.degrees(math.atan2(y, x)) % 360.0
    if ra_c >= 360.0 - 1e-9:  # -1e-15 rad lands at 359.999…: that is RA 0
        ra_c = 0.0
    dec_c = math.degrees(math.asin(max(-1.0, min(1.0, z / norm))))
    return ra_c, dec_c


def bin_cells(rows: Iterable[CoverageRow], nside: int = COVERAGE_NSIDE) -> dict[int, int]:
    rows = list(rows)
    if not rows:
        return {}
    pix = ang2pix_nest(nside, [r.ra for r in rows], [r.dec for r in rows])
    values, counts = np.unique(pix, return_counts=True)
    return {int(p): int(c) for p, c in zip(values, counts, strict=True)}


def rows_from_table(table) -> list[CoverageRow]:
    """CoverageRows from an astropy Table of CAOM observations (rows without a usable s_region are dropped)."""
    out: list[CoverageRow] = []
    for r in table:
        s_region = "" if r["s_region"] is None else str(r["s_region"])
        centroid = stcs_centroid(s_region)
        if centroid is None:
            continue
        rel = r["t_obs_release"]
        try:
            rel_f = None if rel is None else float(rel)
            if rel_f is not None and math.isnan(rel_f):
                rel_f = None
        except (TypeError, ValueError):
            rel_f = None
        out.append(
            CoverageRow(
                obs_id=str(r["obs_id"]),
                instrument_name=str(r["instrument_name"]),
                t_obs_release=rel_f,
                s_region=s_region,
                ra=centroid[0],
                dec=centroid[1],
            )
        )
    return out


def fetch_coverage_rows(page_size: int = COVERAGE_PAGE_SIZE) -> list[CoverageRow]:
    """Page through MAST (one page at a time — a single 200k-row table OOM-kills the proxy)."""
    from astroquery.mast import Observations

    rows: list[CoverageRow] = []
    page = 1
    while True:
        t0 = time.time()
        table = Observations.query_criteria(**COVERAGE_CRITERIA, pagesize=page_size, page=page)
        n = len(table)
        rows.extend(rows_from_table(table))
        del table
        logger.info(
            "coverage page %d: %d rows in %.1fs (total %d)", page, n, time.time() - t0, len(rows)
        )
        if n < page_size:
            break
        page += 1
    return rows


def build_snapshot(
    fetch: Callable[[], list[CoverageRow]] = fetch_coverage_rows, nside: int = COVERAGE_NSIDE
) -> CoverageSnapshot:
    rows = fetch()
    snap = CoverageSnapshot(generated_at=datetime.now(UTC).isoformat(), nside=nside, rows=rows)
    snap.cells = bin_cells(rows, nside)
    return snap


def load_snapshot(path: Path) -> CoverageSnapshot | None:
    try:
        with path.open(encoding="utf-8") as fh:
            return CoverageSnapshot.from_json(json.load(fh))
    except FileNotFoundError:
        return None
    except (OSError, ValueError, TypeError, IndexError, KeyError) as exc:
        logger.warning("coverage snapshot %s unreadable: %s", path, exc)
        return None


def save_snapshot(snapshot: CoverageSnapshot, path: Path) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(snapshot.to_json(), fh, separators=(",", ":"))
        os.replace(tmp, path)
        return True
    except OSError as exc:
        # read-only data mount (CE) — memory-only is fine
        logger.warning("coverage snapshot not written to %s: %s", path, exc)
        return False


class CoverageStore:
    """Lazy, thread-safe holder for the snapshot.

    ``get()`` returns the in-memory snapshot, seeding it from the file on
    first use. When there is none, or it is stale, ``get()`` kicks off ONE
    background refresh and returns what it has (possibly ``None`` — the
    route answers 202 and the client retries). Refresh failures are logged
    and retried on the next call after ``retry_after`` seconds.
    """

    def __init__(
        self,
        path: Path | None = None,
        fetch: Callable[[], list[CoverageRow]] = fetch_coverage_rows,
        ttl: int = COVERAGE_TTL_SECONDS,
        retry_after: int = 60,
    ):
        self._path = path
        self._fetch = fetch
        self._ttl = ttl
        self._retry_after = retry_after
        self._lock = threading.Lock()
        self._snapshot: CoverageSnapshot | None = None
        self._loaded_file = False
        self._refreshing = False
        self._last_failure: float | None = None
        self.last_error: str | None = None

    @property
    def path(self) -> Path:
        return self._path if self._path is not None else default_coverage_file()

    @property
    def refreshing(self) -> bool:
        return self._refreshing

    def _seed_from_file(self) -> None:
        if self._loaded_file:
            return
        self._loaded_file = True
        snap = load_snapshot(self.path)
        if snap is not None:
            logger.info(
                "coverage snapshot loaded from %s: %d rows, %.0f h old",
                self.path,
                len(snap.rows),
                snap.age_seconds / 3600,
            )
            self._snapshot = snap

    def _refresh_blocking(self) -> None:
        try:
            snap = build_snapshot(self._fetch)
            with self._lock:
                self._snapshot = snap
                self._last_failure = None
                self.last_error = None
            save_snapshot(snap, self.path)
            logger.info(
                "coverage snapshot refreshed: %d rows, %d cells", len(snap.rows), len(snap.cells)
            )
        except Exception as exc:  # noqa: BLE001 — background job: log, never raise into the thread
            with self._lock:
                self._last_failure = time.monotonic()
                self.last_error = str(exc)
            logger.error("coverage refresh failed: %s", exc)
        finally:
            with self._lock:
                self._refreshing = False

    def _start_refresh_locked(self) -> None:
        if self._refreshing:
            return
        if (
            self._last_failure is not None
            and time.monotonic() - self._last_failure < self._retry_after
        ):
            return
        self._refreshing = True
        threading.Thread(
            target=self._refresh_blocking, name="mast-coverage-refresh", daemon=True
        ).start()

    def get(self) -> CoverageSnapshot | None:
        with self._lock:
            self._seed_from_file()
            snap = self._snapshot
            if snap is None or snap.is_stale(self._ttl):
                self._start_refresh_locked()
            return snap

    def refresh_now(self) -> CoverageSnapshot:
        """Synchronous refresh (scripts/tests)."""
        snap = build_snapshot(self._fetch)
        with self._lock:
            self._snapshot = snap
            self._loaded_file = True
        save_snapshot(snap, self.path)
        return snap

    def set(self, snapshot: CoverageSnapshot | None) -> None:
        """Tests: install a snapshot without touching the file."""
        with self._lock:
            self._snapshot = snapshot
            self._loaded_file = True


BBOX_CAP = int_env("MAST_COVERAGE_BBOX_CAP", DEFAULT_BBOX_CAP)
