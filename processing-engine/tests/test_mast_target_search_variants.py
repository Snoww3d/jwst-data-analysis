# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for target-name normalization and variant-aware MAST target search.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.mast.mast_service import MastService


def _mock_coord(ra_deg: float, dec_deg: float) -> SimpleNamespace:
    return SimpleNamespace(
        ra=SimpleNamespace(deg=ra_deg),
        dec=SimpleNamespace(deg=dec_deg),
    )


class TestTargetVariantNormalization:
    @pytest.mark.parametrize(
        ("target_name", "expected"),
        [
            ("NGC-3132", ["NGC-3132", "NGC 3132", "NGC3132"]),
            ("NGC 3132", ["NGC 3132", "NGC-3132", "NGC3132"]),
            ("NGC3132", ["NGC3132", "NGC 3132"]),
            ("Crab Nebula", ["Crab Nebula", "Crab-Nebula", "CrabNebula"]),
        ],
    )
    def test_generate_target_candidates(self, target_name: str, expected: list[str]):
        candidates = MastService._generate_target_candidates(target_name)
        assert candidates == expected


class TestTargetVariantSearch:
    @pytest.mark.parametrize(
        "target_query",
        ["NGC 3132", "NGC-3132", "NGC3132", "ngc_3132"],
    )
    def test_search_by_target_resolves_common_variants(self, target_query: str, tmp_path):
        service = MastService(download_dir=str(tmp_path))
        resolved_coord = _mock_coord(151.1, -40.5)
        attempted_variants: list[str] = []

        def from_name_with_variant_support(candidate: str):
            attempted_variants.append(candidate)
            if candidate.casefold() == "ngc 3132":
                return resolved_coord
            raise ValueError("not found")

        with (
            patch(
                "app.mast.mast_service.SkyCoord.from_name",
                side_effect=from_name_with_variant_support,
            ),
            patch(
                "app.mast.mast_service.Observations.query_criteria",
                return_value=[{"obs_id": "raw"}],
            ) as query_mock,
            patch.object(service, "_table_to_dict_list", return_value=[{"obs_id": "jw-test"}]),
        ):
            results = service.search_by_target(
                target_name=target_query, radius=0.2, calib_level=[1, 2, 3]
            )

        assert results == [{"obs_id": "jw-test"}]
        assert any(variant.casefold() == "ngc 3132" for variant in attempted_variants)

        kwargs = query_mock.call_args.kwargs
        assert kwargs["obs_collection"] == "JWST"
        assert kwargs["calib_level"] == [1, 2, 3]
        assert kwargs["s_ra"] == pytest.approx([150.9, 151.3])
        assert kwargs["s_dec"] == pytest.approx([-40.7, -40.3])

    def test_search_by_target_raises_when_all_variants_fail(self, tmp_path):
        service = MastService(download_dir=str(tmp_path))
        attempted_variants: list[str] = []

        def always_fail(candidate: str):
            attempted_variants.append(candidate)
            raise ValueError("not found")

        with (
            patch("app.mast.mast_service.SkyCoord.from_name", side_effect=always_fail),
            pytest.raises(ValueError, match="Could not resolve target name 'NGC-3132'"),
        ):
            service.search_by_target(target_name="NGC-3132")

        assert attempted_variants == ["NGC-3132", "NGC 3132", "NGC3132"]
