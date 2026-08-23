"""MAST search v2 Phase 4: query-less (facet-only) search.

Covers `resolve_facet_window` / `MastFacetSearchRequest` in models.py,
`search_by_facets` + the re-based `search_recent_releases` in
mast_service.py, and the `/mast/search/facets` route with its
`default_window_applied` flag. MAST is never called —
`Observations.query_criteria` is patched.
"""

from unittest.mock import MagicMock, patch

import pytest
from astropy.table import Table
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

import app.mast.routes as engine_mast_routes
from app.mast.api_routes import router as mast_api_router
from app.mast.mast_service import MastSearchResult, MastService, _today_mjd
from app.mast.models import (
    DEFAULT_FACET_DAYS_BACK,
    MastFacetSearchRequest,
    MastSearchResponse,
    resolve_facet_window,
)
from app.mast.routes import router as engine_router


class TestResolveFacetWindow:
    def test_no_dates_no_days_back_applies_default(self):
        assert resolve_facet_window({"instrument_name": ["MIRI"]}, None) == (
            DEFAULT_FACET_DAYS_BACK,
            True,
        )

    def test_explicit_days_back_wins(self):
        assert resolve_facet_window({}, 365) == (365, False)

    @pytest.mark.parametrize("key", ["t_min", "t_max"])
    def test_date_facet_suppresses_default(self, key):
        assert resolve_facet_window({key: [60000.0, 60100.0]}, None) == (None, False)

    def test_explicit_days_back_with_dates_is_kept(self):
        # the client said so; both bounds apply
        assert resolve_facet_window({"t_min": [1.0, 2.0]}, 30) == (30, False)


class TestFacetRequestModel:
    def test_defaults(self):
        req = MastFacetSearchRequest()
        assert req.calib_level == [3]
        assert req.days_back is None
        assert req.limit is None
        assert req.offset == 0
        assert req.filters.to_query_criteria() == {}

    def test_filters_whitelist_rejects_pagesize(self):
        with pytest.raises(ValidationError):
            MastFacetSearchRequest(filters={"pagesize": 5})

    @pytest.mark.parametrize("bad_key", ["obs_collection", "t_obs_release", "calib_level", "s_ra"])
    def test_filters_whitelist_rejects_server_bounds(self, bad_key):
        with pytest.raises(ValidationError):
            MastFacetSearchRequest(filters={bad_key: "x"})

    def test_days_back_bounds(self):
        with pytest.raises(ValidationError):
            MastFacetSearchRequest(days_back=0)
        with pytest.raises(ValidationError):
            MastFacetSearchRequest(days_back=100_000)

    def test_response_default_window_flag_defaults_false(self):
        resp = MastSearchResponse(
            search_type="facets", query_params={}, results=[], result_count=0, timestamp="t"
        )
        assert resp.default_window_applied is False


def _table(n: int) -> Table:
    return Table(
        {
            "obs_id": [f"obs-{i}" for i in range(n)],
            "t_obs_release": [60000.0 + i for i in range(n)],
        }
    )


class TestSearchByFacetsService:
    @pytest.fixture(autouse=True)
    def _service(self):
        self.service = MastService.__new__(MastService)
        self.service._table_to_dict_list = MagicMock(
            side_effect=lambda t: [
                {"obs_id": r["obs_id"], "t_obs_release": float(r["t_obs_release"])} for r in t
            ]
        )

    @patch("app.mast.mast_service.Observations")
    def test_days_back_bounds_release_window(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(2)
        result = self.service.search_by_facets(
            {"instrument_name": ["MIRI*"]}, calib_level=[3], days_back=90
        )
        kwargs = mock_obs.query_criteria.call_args.kwargs
        today = _today_mjd()
        assert kwargs["t_obs_release"] == [today - 90, today]
        assert kwargs["instrument_name"] == ["MIRI*"]
        assert kwargs["calib_level"] == [3]
        assert kwargs["obs_collection"] == "JWST"
        assert kwargs["pagesize"] == MastService.DEFAULT_PAGE_SIZE
        assert isinstance(result, MastSearchResult)
        assert result.truncated is False

    @patch("app.mast.mast_service.Observations")
    def test_no_days_back_keeps_proprietary_exclusion_only(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(0)
        self.service.search_by_facets({"t_min": [60000.0, 60100.0]}, days_back=None)
        kwargs = mock_obs.query_criteria.call_args.kwargs
        assert kwargs["t_obs_release"] == [0, _today_mjd()]
        assert kwargs["t_min"] == [60000.0, 60100.0]

    @patch("app.mast.mast_service.Observations")
    def test_truncated_when_page_is_full(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(MastService.DEFAULT_PAGE_SIZE)
        result = self.service.search_by_facets({}, days_back=30)
        assert result.truncated is True
        assert result.page_size == MastService.DEFAULT_PAGE_SIZE
        assert len(result.rows) == MastService.DEFAULT_PAGE_SIZE

    @patch("app.mast.mast_service.Observations")
    def test_limit_is_capped_at_page_size_and_offset_fetches_extra(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(5)
        self.service.search_by_facets({}, days_back=30, limit=10_000, offset=7)
        assert mock_obs.query_criteria.call_args.kwargs["pagesize"] == (
            MastService.DEFAULT_PAGE_SIZE + 7
        )

    @patch("app.mast.mast_service.Observations")
    def test_sorted_newest_first_then_sliced(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(5)
        result = self.service.search_by_facets({}, days_back=30, limit=2, offset=1)
        assert [r["obs_id"] for r in result.rows] == ["obs-3", "obs-2"]

    @patch("app.mast.mast_service.Observations")
    def test_criteria_cannot_override_server_bounds(self, mock_obs):
        # criteria are applied last, so the whitelist at the API edge is
        # what keeps obs_collection/t_obs_release/pagesize server-owned;
        # pin that the server bounds are always present alongside them
        mock_obs.query_criteria.return_value = _table(0)
        self.service.search_by_facets({"dataproduct_type": ["cube"]}, days_back=10)
        kwargs = mock_obs.query_criteria.call_args.kwargs
        assert kwargs["obs_collection"] == "JWST"
        assert "t_obs_release" in kwargs
        assert kwargs["dataproduct_type"] == ["cube"]

    @patch("app.mast.mast_service.Observations")
    def test_recent_releases_still_returns_rows_list(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(3)
        rows = self.service.search_recent_releases(days_back=14, instrument="miri", limit=2)
        assert isinstance(rows, list)
        assert len(rows) == 2
        kwargs = mock_obs.query_criteria.call_args.kwargs
        assert kwargs["instrument_name"] == "MIRI"
        assert kwargs["pagesize"] == 2
        assert "calib_level" not in kwargs


@pytest.fixture
def client(monkeypatch):
    calls = {}

    def fake_facets(filters, calib_level, days_back, limit, offset):
        calls["facets"] = {
            "filters": filters,
            "calib_level": calib_level,
            "days_back": days_back,
            "limit": limit,
            "offset": offset,
        }
        return MastSearchResult(
            rows=[{"obs_id": "x"}], truncated=calls.get("truncate", False), page_size=500
        )

    monkeypatch.setattr(engine_mast_routes.mast_service, "search_by_facets", fake_facets)
    engine_mast_routes._facet_search_cache.clear()

    app = FastAPI()
    app.include_router(engine_router)
    app.include_router(mast_api_router)
    c = TestClient(app)
    c.calls = calls
    return c


class TestFacetRoute:
    def test_default_window_applied_when_unbounded(self, client):
        resp = client.post("/mast/search/facets", json={"filters": {"instrument_name": ["MIRI*"]}})
        assert resp.status_code == 200
        body = resp.json()
        assert body["search_type"] == "facets"
        assert body["default_window_applied"] is True
        assert body["query_params"]["days_back"] == DEFAULT_FACET_DAYS_BACK
        assert client.calls["facets"]["days_back"] == DEFAULT_FACET_DAYS_BACK
        assert client.calls["facets"]["calib_level"] == [3]
        assert client.calls["facets"]["filters"] == {"instrument_name": ["MIRI*"]}

    def test_explicit_dates_override_default_window(self, client):
        resp = client.post(
            "/mast/search/facets",
            json={"filters": {"t_min": [60000, 60100], "dataproduct_type": ["cube"]}},
        )
        assert resp.status_code == 200
        assert resp.json()["default_window_applied"] is False
        assert client.calls["facets"]["days_back"] is None
        assert client.calls["facets"]["filters"]["t_min"] == [60000.0, 60100.0]

    def test_explicit_days_back_is_not_flagged(self, client):
        resp = client.post("/mast/search/facets", json={"filters": {}, "days_back": 365})
        assert resp.status_code == 200
        assert resp.json()["default_window_applied"] is False
        assert client.calls["facets"]["days_back"] == 365

    def test_truncated_flag_in_envelope(self, client):
        client.calls["truncate"] = True
        resp = client.post("/mast/search/facets", json={"filters": {}})
        assert resp.json()["truncated"] is True
        assert resp.json()["page_size"] == 500

    def test_whitelist_rejects_pagesize(self, client):
        resp = client.post("/mast/search/facets", json={"filters": {"pagesize": 5}})
        assert resp.status_code == 422
        assert "facets" not in client.calls

    def test_ce_facade_camel_case_and_verbatim_filters(self, client):
        resp = client.post(
            "/api/mast/search/facets",
            json={
                "filters": {"intentType": ["science"], "instrument_name": ["NIRCAM*"]},
                "calibLevel": [2, 3],
                "daysBack": 30,
            },
        )
        assert resp.status_code == 200
        seen = client.calls["facets"]
        assert seen["filters"] == {"intentType": ["science"], "instrument_name": ["NIRCAM*"]}
        assert seen["calib_level"] == [2, 3]
        assert seen["days_back"] == 30

    def test_ce_facade_whitelist_rejects_pagesize_400(self, client):
        resp = client.post("/api/mast/search/facets", json={"filters": {"pagesize": 5}})
        assert resp.status_code == 400

    def test_cached_second_call_does_not_hit_service(self, client):
        client.post("/mast/search/facets", json={"filters": {"instrument_name": ["FGS*"]}})
        client.calls.clear()
        resp = client.post("/mast/search/facets", json={"filters": {"instrument_name": ["FGS*"]}})
        assert resp.status_code == 200
        assert "facets" not in client.calls
