"""Tests for MAST request/response model validation (#1389, #1010)."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.mast.models import (
    MastCoordinateSearchRequest,
    MastDownloadResponse,
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


def _download_response(**overrides) -> MastDownloadResponse:
    fields = {
        "status": "completed",
        "obs_id": "jw02733-o001_t001_nircam_clear-f090w",
        "timestamp": "2026-11-07T00:00:00Z",
    }
    fields.update(overrides)
    return MastDownloadResponse(**fields)


class TestMastDownloadResponseFileCount:
    """`file_count` is derived from `files` and can never disagree with it (#1010)."""

    def test_supplied_mismatched_count_is_ignored(self):
        response = _download_response(files=["a_cal.fits", "b_cal.fits"], file_count=99)
        assert response.file_count == 2

    def test_omitted_count_matches_files(self):
        response = _download_response(files=["a_cal.fits", "b_cal.fits"])
        assert response.file_count == 2

    def test_no_files_gives_zero(self):
        assert _download_response().file_count == 0
        assert _download_response(files=[]).file_count == 0

    def test_count_follows_files_after_construction(self):
        response = _download_response(files=["a_cal.fits", "b_cal.fits"])
        response.files.append("c_cal.fits")
        assert response.file_count == 3
        response.files = ["x_cal.fits"]
        assert response.file_count == 1

    def test_serialized_json_keeps_derived_count(self):
        response = _download_response(files=["a_cal.fits", "b_cal.fits"], file_count=99)
        assert json.loads(response.model_dump_json())["file_count"] == 2
        assert response.model_dump()["file_count"] == 2

    def test_json_round_trip_keeps_derived_count(self):
        original = _download_response(files=["a_cal.fits", "b_cal.fits"], file_count=99)
        restored = MastDownloadResponse.model_validate_json(original.model_dump_json())
        assert restored.file_count == 2
        assert restored.model_dump() == original.model_dump()

    def test_count_is_read_only(self):
        response = _download_response(files=["a_cal.fits"])
        with pytest.raises(AttributeError):
            response.file_count = 5
