"""Tests for MAST search request validation (#1389)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.mast.models import (
    MastCoordinateSearchRequest,
    MastObservationSearchRequest,
    MastProgramSearchRequest,
    MastTargetSearchRequest,
)


class TestTargetSearchValidation:
    def test_empty_target_rejected(self):
        with pytest.raises(ValidationError):
            MastTargetSearchRequest(target_name="")

    def test_negative_radius_rejected(self):
        with pytest.raises(ValidationError):
            MastTargetSearchRequest(target_name="NGC 1234", radius=-1.0)

    def test_zero_radius_rejected(self):
        with pytest.raises(ValidationError):
            MastTargetSearchRequest(target_name="NGC 1234", radius=0.0)

    def test_oversized_radius_rejected(self):
        with pytest.raises(ValidationError):
            MastTargetSearchRequest(target_name="NGC 1234", radius=100.0)

    def test_valid_request_accepted(self):
        req = MastTargetSearchRequest(target_name="NGC 1234", radius=0.5)
        assert req.target_name == "NGC 1234"
        assert req.radius == 0.5


class TestCoordinateSearchValidation:
    def test_out_of_range_ra_rejected(self):
        with pytest.raises(ValidationError):
            MastCoordinateSearchRequest(ra=400.0, dec=0.0)

    def test_negative_ra_rejected(self):
        with pytest.raises(ValidationError):
            MastCoordinateSearchRequest(ra=-1.0, dec=0.0)

    def test_out_of_range_dec_rejected(self):
        with pytest.raises(ValidationError):
            MastCoordinateSearchRequest(ra=0.0, dec=100.0)

    def test_zero_radius_rejected(self):
        with pytest.raises(ValidationError):
            MastCoordinateSearchRequest(ra=0.0, dec=0.0, radius=0.0)

    def test_celestial_origin_accepted(self):
        """RA=0, Dec=0 is a valid coordinate (vernal equinox)."""
        req = MastCoordinateSearchRequest(ra=0.0, dec=0.0)
        assert req.ra == 0.0
        assert req.dec == 0.0


class TestObservationSearchValidation:
    def test_empty_obs_id_rejected(self):
        with pytest.raises(ValidationError):
            MastObservationSearchRequest(obs_id="")


class TestProgramSearchValidation:
    def test_empty_program_id_rejected(self):
        with pytest.raises(ValidationError):
            MastProgramSearchRequest(program_id="")
