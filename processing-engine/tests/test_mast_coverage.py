"""MAST Search v2 Phase 5: the sky-coverage snapshot behind `GET /mast/coverage`.

Covers `coverage.py` (centroids, bbox, binning, snapshot file round-trip,
the store's lazy/background behaviour) and the route in both mount modes
(engine `/mast/coverage`, CE facade `/api/mast/coverage`). MAST is never
called — the fetch callable is injected.
"""

import json
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.mast.routes as engine_mast_routes
from app.mast.api_routes import router as mast_api_router
from app.mast.coverage import (
    COVERAGE_NSIDE,
    CoverageRow,
    CoverageSnapshot,
    CoverageStore,
    bin_cells,
    build_snapshot,
    load_snapshot,
    parse_bbox,
    rows_from_table,
    save_snapshot,
    stcs_centroid,
)
from app.mast.routes import router as engine_router


REAL_FIXTURE = "POLYGON 151.7538 -40.4086 151.7925 -40.4290 151.7524 -40.4729 151.7137 -40.4524"


def _row(
    obs_id: str, ra: float, dec: float, inst: str = "NIRCAM/IMAGE", rel: float | None = 60000.0
):
    s_region = f"POLYGON {ra} {dec} {ra + 0.05} {dec} {ra + 0.05} {dec + 0.05} {ra} {dec + 0.05}"
    c = stcs_centroid(s_region)
    assert c is not None
    return CoverageRow(obs_id, inst, rel, s_region, c[0], c[1])


def _snapshot(rows, age_hours: float = 0.0) -> CoverageSnapshot:
    generated = datetime.now(UTC) - timedelta(hours=age_hours)
    snap = CoverageSnapshot(generated_at=generated.isoformat(), nside=COVERAGE_NSIDE, rows=rows)
    snap.cells = bin_cells(rows, COVERAGE_NSIDE)
    return snap


class TestStcsCentroid:
    def test_real_fixture(self):
        ra, dec = stcs_centroid(REAL_FIXTURE)
        assert ra == pytest.approx(151.7531, abs=1e-3)
        assert dec == pytest.approx(-40.4407, abs=1e-3)

    def test_ra_wrap(self):
        ra, dec = stcs_centroid("POLYGON 359 0 1 0 1 2 359 2")
        assert ra == pytest.approx(0.0, abs=1e-6)
        assert dec == pytest.approx(1.0, abs=1e-3)

    def test_union_and_frame(self):
        ra, dec = stcs_centroid("UNION (POLYGON ICRS 10 10 11 10 11 11 POLYGON 12 12 13 12 13 13)")
        assert 10 < ra < 13
        assert 10 < dec < 13

    @pytest.mark.parametrize("bad", ["", "garbage", "POLYGON 1", None])
    def test_unusable(self, bad):
        assert stcs_centroid(bad) is None


class TestParseBbox:
    def test_plain(self):
        assert parse_bbox("10,-5,20,5") == (10.0, -5.0, 20.0, 5.0)

    def test_ra_normalised_and_wrap_allowed(self):
        assert parse_bbox("-10,0,370,1") == (350.0, 0.0, 10.0, 1.0)

    @pytest.mark.parametrize("bad", ["1,2,3", "a,b,c,d", "0,-91,1,0", "0,5,1,-5", "nan,0,1,1"])
    def test_rejects(self, bad):
        with pytest.raises(ValueError):
            parse_bbox(bad)


class TestSnapshotPayloads:
    def test_grid_payload_bins_by_cell(self):
        rows = [_row("a", 10.0, 10.0), _row("b", 10.01, 10.01), _row("c", 200.0, -30.0)]
        snap = _snapshot(rows)
        grid = snap.grid_payload()
        assert grid["shape"] == "grid"
        assert grid["nside"] == COVERAGE_NSIDE
        assert grid["total"] == 3
        assert grid["stale"] is False
        counts = sorted(n for _, n in grid["cells"])
        assert counts == [1, 2]
        assert all(isinstance(p, int) and p >= 0 for p, _ in grid["cells"])

    def test_footprints_payload_filters_caps_and_sorts_newest_first(self):
        rows = [
            _row("old", 10.0, 10.0, rel=59000.0),
            _row("new", 10.1, 10.1, rel=61000.0),
            _row("mid", 10.2, 10.2, rel=60000.0),
            _row("far", 200.0, -30.0),
        ]
        snap = _snapshot(rows)
        fp = snap.footprints_payload((9.0, 9.0, 11.0, 11.0), cap=2)
        assert fp["shape"] == "footprints"
        assert fp["total"] == 3
        assert fp["truncated"] is True
        assert [r["obs_id"] for r in fp["rows"]] == ["new", "mid"]
        assert set(fp["rows"][0]) == {"obs_id", "instrument_name", "t_obs_release", "s_region"}

    def test_footprints_payload_bbox_wraps_ra(self):
        rows = [_row("w", 359.5, 0.0), _row("e", 0.5, 0.0), _row("no", 180.0, 0.0)]
        fp = _snapshot(rows).footprints_payload((359.0, -1.0, 1.0, 1.0), cap=10)
        assert sorted(r["obs_id"] for r in fp["rows"]) == ["e", "w"]

    def test_stale_after_ttl(self):
        assert _snapshot([], age_hours=25).is_stale() is True
        assert _snapshot([], age_hours=1).is_stale() is False
        assert _snapshot([], age_hours=25).grid_payload()["stale"] is True


class TestSnapshotFile:
    def test_round_trip(self, tmp_path: Path):
        snap = _snapshot(
            [_row("a", 10.0, 10.0), _row("b", 200.0, -30.0, inst="MIRI/IMAGE", rel=None)]
        )
        path = tmp_path / "cov" / "mast-coverage.json"
        assert save_snapshot(snap, path) is True
        loaded = load_snapshot(path)
        assert loaded is not None
        assert loaded.generated_at == snap.generated_at
        assert [r.obs_id for r in loaded.rows] == ["a", "b"]
        assert loaded.rows[1].t_obs_release is None
        assert loaded.cells == snap.cells

    def test_missing_and_corrupt(self, tmp_path: Path):
        assert load_snapshot(tmp_path / "nope.json") is None
        bad = tmp_path / "bad.json"
        bad.write_text("{not json")
        assert load_snapshot(bad) is None


class TestRowsFromTable:
    def test_drops_rows_without_usable_region(self):
        from astropy.table import Table

        table = Table(
            rows=[
                ("a", "NIRCAM/IMAGE", 60000.0, REAL_FIXTURE),
                ("b", "MIRI/IMAGE", 60001.0, ""),
                ("c", "MIRI/IMAGE", float("nan"), "POLYGON 1 1 2 1 2 2"),
            ],
            names=("obs_id", "instrument_name", "t_obs_release", "s_region"),
        )
        rows = rows_from_table(table)
        assert [r.obs_id for r in rows] == ["a", "c"]
        assert rows[1].t_obs_release is None


class TestCoverageStore:
    def test_get_builds_in_background_then_serves(self, tmp_path: Path):
        started = threading.Event()
        release = threading.Event()

        def fetch():
            started.set()
            release.wait(5)
            return [_row("a", 10.0, 10.0)]

        store = CoverageStore(path=tmp_path / "c.json", fetch=fetch)
        assert store.get() is None  # nothing yet — refresh kicked off
        assert started.wait(2)
        assert store.refreshing is True
        release.set()
        for _ in range(200):
            snap = store.get()
            if snap is not None:
                break
            threading.Event().wait(0.01)
        assert snap is not None
        assert [r.obs_id for r in snap.rows] == ["a"]
        assert (tmp_path / "c.json").exists()

    def test_seeds_from_file_and_serves_stale_while_refreshing(self, tmp_path: Path):
        path = tmp_path / "c.json"
        save_snapshot(_snapshot([_row("old", 1.0, 1.0)], age_hours=30), path)
        release = threading.Event()

        def fetch():
            release.wait(5)
            return [_row("new", 2.0, 2.0)]

        store = CoverageStore(path=path, fetch=fetch)
        snap = store.get()
        assert snap is not None and [r.obs_id for r in snap.rows] == ["old"]
        assert snap.is_stale()
        assert store.refreshing is True
        release.set()
        for _ in range(200):
            snap = store.get()
            if [r.obs_id for r in snap.rows] == ["new"]:
                break
            threading.Event().wait(0.01)
        assert [r.obs_id for r in snap.rows] == ["new"]

    def test_failure_is_recorded_and_retry_is_throttled(self, tmp_path: Path):
        calls = []

        def fetch():
            calls.append(1)
            raise RuntimeError("MAST down")

        store = CoverageStore(path=tmp_path / "c.json", fetch=fetch, retry_after=3600)
        assert store.get() is None
        for _ in range(200):
            if not store.refreshing:
                break
            threading.Event().wait(0.01)
        assert store.last_error == "MAST down"
        assert store.get() is None
        assert len(calls) == 1  # throttled: no second attempt within retry_after

    def test_build_snapshot_uses_injected_fetch(self):
        snap = build_snapshot(fetch=lambda: [_row("a", 10.0, 10.0)])
        assert len(snap.rows) == 1 and len(snap.cells) == 1


@pytest.fixture
def clients(tmp_path: Path):
    """Engine + CE-facade clients sharing one store with a known snapshot."""
    original = engine_mast_routes.coverage_store
    store = CoverageStore(path=tmp_path / "c.json", fetch=lambda: [])
    engine_mast_routes.coverage_store = store
    app = FastAPI()
    app.include_router(engine_router)
    app.include_router(mast_api_router)
    try:
        yield TestClient(app), store
    finally:
        engine_mast_routes.coverage_store = original


class TestCoverageRoute:
    @pytest.mark.parametrize("prefix", ["/mast", "/api/mast"])
    def test_grid(self, clients, prefix):
        client, store = clients
        store.set(_snapshot([_row("a", 10.0, 10.0), _row("b", 10.0, 10.0)]))
        resp = client.get(f"{prefix}/coverage")
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == "public, max-age=86400"
        body = resp.json()
        assert body["shape"] == "grid"
        assert body["total"] == 2
        assert body["cells"] and body["cells"][0][1] == 2

    @pytest.mark.parametrize("prefix", ["/mast", "/api/mast"])
    def test_footprints_bbox(self, clients, prefix):
        client, store = clients
        store.set(_snapshot([_row("a", 10.0, 10.0), _row("b", 200.0, -30.0)]))
        resp = client.get(f"{prefix}/coverage", params={"bbox": "9,9,11,11"})
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == "public, max-age=3600"
        body = resp.json()
        assert body["shape"] == "footprints"
        assert [r["obs_id"] for r in body["rows"]] == ["a"]
        assert body["truncated"] is False

    def test_bad_bbox_is_400(self, clients):
        client, store = clients
        store.set(_snapshot([]))
        assert client.get("/mast/coverage", params={"bbox": "1,2,3"}).status_code == 400
        assert client.get("/api/mast/coverage", params={"bbox": "a,b,c,d"}).status_code == 400

    def test_building_is_202_with_retry_after(self, clients):
        client, store = clients
        # store has no snapshot and its fetch returns [] quickly; the first
        # call still races the thread, so pin the "no snapshot" state.
        store.set(None)
        store._loaded_file = True
        resp = client.get("/api/mast/coverage")
        assert resp.status_code == 202
        assert resp.headers["retry-after"] == str(engine_mast_routes.COVERAGE_RETRY_AFTER_SECONDS)
        assert resp.json()["status"] == "building"

    def test_snapshot_json_is_compact(self, tmp_path: Path):
        snap = _snapshot([_row("a", 10.0, 10.0)])
        path = tmp_path / "c.json"
        save_snapshot(snap, path)
        data = json.loads(path.read_text())
        assert set(data) == {"generated_at", "nside", "rows"}
        assert len(data["rows"][0]) == 6
