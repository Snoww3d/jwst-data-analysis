# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for MAST service pagination logic in search_recent_releases.

Verifies that offset and limit are correctly applied to query results,
including the fix for #1152 where limit was not applied after offset.
"""

from unittest.mock import MagicMock, patch

import pytest
from astropy.table import Table

from app.mast.mast_service import MastService


def _make_obs_table(n: int) -> Table:
    """Create a fake observations table with n rows and a sortable release date column."""
    return Table(
        {
            "obs_id": [f"obs-{i}" for i in range(n)],
            "t_obs_release": [60000.0 + i for i in range(n)],
            "obs_collection": ["JWST"] * n,
        }
    )


class TestSearchRecentReleasesPagination:
    """Pagination tests for MastService.search_recent_releases (#1152)."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        """Create a MastService instance with mocked internals."""
        self.service = MastService.__new__(MastService)
        # Mock _table_to_dict_list to return a simple list of dicts
        self.service._table_to_dict_list = MagicMock(
            side_effect=lambda t: [{"obs_id": row["obs_id"]} for row in t]
        )

    @patch("app.mast.mast_service.Observations")
    @patch("app.mast.mast_service._today_mjd", return_value=60100.0)
    def test_limit_applied_after_offset(self, _mock_mjd, mock_obs):
        """Limit must be applied after offset — the core #1152 fix."""
        mock_obs.query_criteria.return_value = _make_obs_table(20)

        results = self.service.search_recent_releases(days_back=30, limit=5, offset=3)

        assert len(results) == 5, (
            f"Expected 5 results (limit=5), got {len(results)}. Limit was not applied after offset."
        )

    @patch("app.mast.mast_service.Observations")
    @patch("app.mast.mast_service._today_mjd", return_value=60100.0)
    def test_offset_zero_returns_limit(self, _mock_mjd, mock_obs):
        """With offset=0, limit should still cap the results."""
        mock_obs.query_criteria.return_value = _make_obs_table(20)

        results = self.service.search_recent_releases(days_back=30, limit=5, offset=0)

        assert len(results) == 5

    @patch("app.mast.mast_service.Observations")
    @patch("app.mast.mast_service._today_mjd", return_value=60100.0)
    def test_offset_beyond_results_returns_empty(self, _mock_mjd, mock_obs):
        """Offset past the end of results should return an empty list."""
        mock_obs.query_criteria.return_value = _make_obs_table(5)

        results = self.service.search_recent_releases(days_back=30, limit=10, offset=100)

        assert len(results) == 0

    @patch("app.mast.mast_service.Observations")
    @patch("app.mast.mast_service._today_mjd", return_value=60100.0)
    def test_offset_equals_length_returns_empty(self, _mock_mjd, mock_obs):
        """Offset exactly equal to table length should return empty."""
        mock_obs.query_criteria.return_value = _make_obs_table(10)

        results = self.service.search_recent_releases(days_back=30, limit=5, offset=10)

        assert len(results) == 0

    @patch("app.mast.mast_service.Observations")
    @patch("app.mast.mast_service._today_mjd", return_value=60100.0)
    def test_offset_plus_limit_exceeds_length(self, _mock_mjd, mock_obs):
        """When offset+limit exceeds table length, return remaining rows."""
        mock_obs.query_criteria.return_value = _make_obs_table(10)

        results = self.service.search_recent_releases(days_back=30, limit=5, offset=8)

        # Only 2 rows remain after offset=8 on 10-row table
        assert len(results) == 2

    @patch("app.mast.mast_service.Observations")
    @patch("app.mast.mast_service._today_mjd", return_value=60100.0)
    def test_empty_table_returns_empty(self, _mock_mjd, mock_obs):
        """An empty MAST result should return an empty list."""
        mock_obs.query_criteria.return_value = _make_obs_table(0)

        results = self.service.search_recent_releases(days_back=30, limit=10, offset=0)

        assert len(results) == 0

    @patch("app.mast.mast_service.Observations")
    @patch("app.mast.mast_service._today_mjd", return_value=60100.0)
    def test_no_offset_no_excess_returns_all(self, _mock_mjd, mock_obs):
        """When results <= limit and offset=0, all results are returned."""
        mock_obs.query_criteria.return_value = _make_obs_table(3)

        results = self.service.search_recent_releases(days_back=30, limit=10, offset=0)

        assert len(results) == 3
