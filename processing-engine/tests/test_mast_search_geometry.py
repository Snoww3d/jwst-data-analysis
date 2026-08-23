"""MAST search v2 Phase 0: cone geometry, criteria whitelist, truncation flag.

Covers `_bbox_criteria` / `_filter_by_separation` in mast_service.py, the
`MastCriteria` whitelist in models.py, and the `truncated` flag threaded
from `_warn_if_truncated` through to `MastSearchResponse`. MAST is never
called — `Observations.query_criteria` is patched.
"""

import math
from unittest.mock import MagicMock, patch

import pytest
from astropy.table import Table
from pydantic import ValidationError

from app.mast.mast_service import (
    MastSearchResult,
    MastService,
    _bbox_criteria,
    _filter_by_separation,
)
from app.mast.models import (
    MastCoordinateSearchRequest,
    MastCriteria,
    MastSearchResponse,
    MastTargetSearchRequest,
)


class TestBboxCriteria:
    def test_equator_is_symmetric_square(self):
        c = _bbox_criteria(ra=100.0, dec=0.0, radius=0.5)
        assert c["s_ra"] == pytest.approx([99.5, 100.5])
        assert c["s_dec"] == pytest.approx([-0.5, 0.5])

    def test_high_dec_widens_ra_half_width(self):
        c = _bbox_criteria(ra=100.0, dec=80.0, radius=0.5)
        ra_half = 0.5 / math.cos(math.radians(80.0))
        assert ra_half > 2.5  # ~2.88 deg: a plain +-0.5 box would miss most of the cone
        assert c["s_ra"] == pytest.approx([100.0 - ra_half, 100.0 + ra_half])
        assert c["s_dec"] == pytest.approx([79.5, 80.5])

    def test_ra_wrap_drops_s_ra(self):
        c = _bbox_criteria(ra=359.9, dec=10.0, radius=0.5)
        assert "s_ra" not in c
        assert c["s_dec"] == pytest.approx([9.5, 10.5])

    def test_ra_wrap_below_zero_drops_s_ra(self):
        c = _bbox_criteria(ra=0.05, dec=-20.0, radius=0.2)
        assert "s_ra" not in c

    def test_pole_drops_s_ra_and_clamps_dec(self):
        c = _bbox_criteria(ra=45.0, dec=89.8, radius=0.5)
        assert "s_ra" not in c
        assert c["s_dec"] == pytest.approx([89.3, 90.0])

    def test_south_pole_clamps_dec(self):
        c = _bbox_criteria(ra=45.0, dec=-89.9, radius=1.0)
        assert "s_ra" not in c
        assert c["s_dec"][0] == pytest.approx(-90.0)


class TestFilterBySeparation:
    def test_keeps_inside_drops_outside(self):
        rows = [
            {"obs_id": "in", "s_ra": 10.0, "s_dec": 20.1},
            {"obs_id": "out", "s_ra": 10.0, "s_dec": 21.0},
        ]
        kept = _filter_by_separation(rows, ra=10.0, dec=20.0, radius=0.2)
        assert [r["obs_id"] for r in kept] == ["in"]

    def test_box_corner_is_outside_cone(self):
        # the bbox admits this row; the cone must not
        rows = [{"obs_id": "corner", "s_ra": 10.19, "s_dec": 20.19}]
        assert _filter_by_separation(rows, ra=10.0, dec=20.0, radius=0.2) == []

    def test_wrap_across_ra_zero(self):
        rows = [{"obs_id": "wrapped", "s_ra": 359.95, "s_dec": 0.0}]
        kept = _filter_by_separation(rows, ra=0.05, dec=0.0, radius=0.2)
        assert len(kept) == 1

    def test_missing_coordinates_are_kept(self):
        rows = [
            {"obs_id": "no-ra", "s_dec": 0.0},
            {"obs_id": "none-dec", "s_ra": 0.0, "s_dec": None},
            {"obs_id": "no-coords"},
        ]
        kept = _filter_by_separation(rows, ra=100.0, dec=50.0, radius=0.1)
        assert len(kept) == 3


class TestFiltersWhitelist:
    def test_accepts_instrument_name_list(self):
        req = MastTargetSearchRequest(
            target_name="M16", filters={"instrument_name": ["NIRCAM", "MIRI/IMAGE"]}
        )
        assert req.filters.to_query_criteria() == {"instrument_name": ["NIRCAM", "MIRI/IMAGE"]}

    def test_accepts_wildcard_and_ranges(self):
        crit = MastCriteria(filters=["F*W"], t_exptime=(100, 2000.5), proposal_id=["2733"])
        assert crit.to_query_criteria() == {
            "filters": ["F*W"],
            "proposal_id": ["2733"],
            "t_exptime": [100.0, 2000.5],
        }

    @pytest.mark.parametrize(
        "bad_key",
        ["pagesize", "obs_collection", "s_ra", "s_dec", "t_obs_release", "calib_level", "extra"],
    )
    def test_rejects_non_whitelisted_keys(self, bad_key):
        with pytest.raises(ValidationError):
            MastCriteria.model_validate({bad_key: 5})

    def test_rejects_regex_violating_value(self):
        with pytest.raises(ValidationError, match="invalid characters"):
            MastCriteria(instrument_name=["NIRCAM; DROP TABLE"])

    def test_rejects_too_many_items(self):
        with pytest.raises(ValidationError, match="at most 20"):
            MastCriteria(filters=[f"F{i}W" for i in range(21)])

    def test_rejects_inverted_range(self):
        with pytest.raises(ValidationError, match="lower bound"):
            MastCriteria(t_min=(60000.0, 59000.0))

    def test_rejects_range_wrong_arity(self):
        with pytest.raises(ValidationError):
            MastCriteria(t_min=(1.0, 2.0, 3.0))

    def test_coordinate_request_mode_default_and_values(self):
        assert MastCoordinateSearchRequest(ra=1, dec=2).mode == "cone"
        assert MastCoordinateSearchRequest(ra=1, dec=2, mode="box").mode == "box"
        assert MastCoordinateSearchRequest(ra=1, dec=2, mode=None).mode == "cone"
        with pytest.raises(ValidationError):
            MastCoordinateSearchRequest(ra=1, dec=2, mode="sphere")

    def test_calib_level_defaults_to_three(self):
        assert MastTargetSearchRequest(target_name="M16").calib_level == [3]
        assert MastCoordinateSearchRequest(ra=1, dec=2).calib_level == [3]


def _table(n: int, ra: float = 10.0, dec: float = 20.0) -> Table:
    return Table(
        {
            "obs_id": [f"obs-{i}" for i in range(n)],
            "s_ra": [ra] * n,
            "s_dec": [dec] * n,
        }
    )


class TestTruncatedFlag:
    @pytest.fixture(autouse=True)
    def _service(self):
        self.service = MastService.__new__(MastService)
        self.service._table_to_dict_list = MagicMock(
            side_effect=lambda t: [
                {"obs_id": r["obs_id"], "s_ra": float(r["s_ra"]), "s_dec": float(r["s_dec"])}
                for r in t
            ]
        )

    @patch("app.mast.mast_service.Observations")
    def test_coordinates_sets_truncated_when_page_is_full(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(MastService.DEFAULT_PAGE_SIZE)
        result = self.service.search_by_coordinates(ra=10.0, dec=20.0, radius=0.2)
        assert isinstance(result, MastSearchResult)
        assert result.truncated is True
        assert result.page_size == MastService.DEFAULT_PAGE_SIZE
        assert mock_obs.query_criteria.call_args.kwargs["pagesize"] == MastService.DEFAULT_PAGE_SIZE

    @patch("app.mast.mast_service.Observations")
    def test_truncated_reflects_raw_page_not_cone_filtered_rows(self, mock_obs):
        # every row sits outside the cone: rows shrink to 0 but the flag
        # still says MAST's page was full
        mock_obs.query_criteria.return_value = _table(MastService.DEFAULT_PAGE_SIZE, dec=25.0)
        result = self.service.search_by_coordinates(ra=10.0, dec=20.0, radius=0.2)
        assert result.rows == []
        assert result.truncated is True

    @patch("app.mast.mast_service.Observations")
    def test_not_truncated_below_page_size(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(3)
        result = self.service.search_by_coordinates(ra=10.0, dec=20.0, radius=0.2)
        assert result.truncated is False
        assert len(result.rows) == 3

    @patch("app.mast.mast_service.Observations")
    def test_box_mode_skips_cone_filter(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(3, dec=25.0)
        result = self.service.search_by_coordinates(ra=10.0, dec=20.0, radius=0.2, mode="box")
        assert len(result.rows) == 3

    @patch("app.mast.mast_service.Observations")
    def test_filters_merge_into_query_without_overriding_bounds(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(0)
        self.service.search_by_coordinates(
            ra=10.0, dec=20.0, radius=0.2, filters={"instrument_name": ["NIRCAM"]}
        )
        kwargs = mock_obs.query_criteria.call_args.kwargs
        assert kwargs["instrument_name"] == ["NIRCAM"]
        assert kwargs["obs_collection"] == "JWST"
        assert kwargs["pagesize"] == MastService.DEFAULT_PAGE_SIZE

    @patch("app.mast.mast_service.Observations")
    def test_observation_search_threads_flag(self, mock_obs):
        mock_obs.query_criteria.return_value = _table(MastService.DEFAULT_PAGE_SIZE)
        result = self.service.search_by_observation_id("jw02733")
        assert result.truncated is True

    def test_response_model_defaults(self):
        resp = MastSearchResponse(
            search_type="target", query_params={}, results=[], result_count=0, timestamp="t"
        )
        assert resp.truncated is False
        assert resp.page_size == 0
