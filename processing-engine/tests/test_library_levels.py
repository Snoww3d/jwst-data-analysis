# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Processing levels and lineage derivation for calibration outputs (#1754).

These two facts are what turn a saved output from a stored file into something
usable: the level says what it now IS (and so what may be run on it next), and
the base id puts it back with the data it came from.
"""

import pytest

from app.library.levels import (
    LEVEL_1,
    LEVEL_2A,
    LEVEL_2B,
    LEVEL_3,
    LEVEL_ORDER,
    SUFFIX_TO_LEVEL,
    UNKNOWN,
    level_for_filename,
    level_for_suffix,
)
from app.library.lineage import (
    derived_from_for_output,
    exposure_id_from,
    observation_base_id_for_output,
    observation_base_id_from,
)


class TestLevelForSuffix:
    @pytest.mark.parametrize(
        ("suffix", "expected"),
        [
            ("_uncal", LEVEL_1),
            ("_rate", LEVEL_2A),
            ("_rateints", LEVEL_2A),
            ("_cal", LEVEL_2B),
            ("_crf", LEVEL_2B),
            ("_i2d", LEVEL_3),
            ("_s2d", LEVEL_3),
            ("_x1d", LEVEL_3),
        ],
    )
    def test_matches_the_dotnet_table(self, suffix: str, expected: str) -> None:
        assert level_for_suffix(suffix) == expected

    def test_accepts_a_bare_suffix(self) -> None:
        # The engine records outputs as "_i2d"; be tolerant of "i2d" too.
        assert level_for_suffix("i2d") == LEVEL_3

    @pytest.mark.parametrize("value", [None, "", "_nonsense"])
    def test_unknown_rather_than_a_guess(self, value) -> None:
        assert level_for_suffix(value) == UNKNOWN


class TestLevelForFilename:
    def test_reads_the_level_off_a_real_product_name(self) -> None:
        assert level_for_filename("jw02733-o001_t001_nircam_f200w_i2d.fits") == LEVEL_3
        assert level_for_filename("jw02733001001_02101_00001_nrca1_uncal.fits") == LEVEL_1

    def test_matches_the_end_of_the_stem_not_anywhere_in_it(self) -> None:
        # An image3 output is named {product_name}_i2d.fits and a product name
        # may contain "_". Searching anywhere would find "_cal" here and file a
        # finished mosaic as a half-processed exposure. This is the case a
        # containment match gets wrong.
        assert level_for_filename("ngc_calibration_i2d.fits") == LEVEL_3
        assert level_for_filename("my_rate_limited_uncal.fits") == LEVEL_1

    def test_ints_variants_keep_their_own_level(self) -> None:
        # Note: endswith makes these order-independent — "..._rateints" does
        # not end with "_rate" — so this documents the mapping rather than
        # guarding the matching strategy (that is the test above).
        assert level_for_filename("jw01_rateints.fits") == LEVEL_2A
        assert level_for_filename("jw01_calints.fits") == LEVEL_2B

    def test_association_files_are_not_a_data_level(self) -> None:
        # DataScanService maps _asn explicitly to Unknown.
        assert level_for_filename("jw02733-o001_asn.json") == UNKNOWN

    def test_no_recognisable_suffix_is_unknown(self) -> None:
        assert level_for_filename("my-export.fits") == UNKNOWN


class TestLevelTable:
    def test_order_is_ascending_and_excludes_unknown(self) -> None:
        assert LEVEL_ORDER == [LEVEL_1, LEVEL_2A, LEVEL_2B, LEVEL_3]
        assert UNKNOWN not in LEVEL_ORDER

    def test_every_mapped_level_is_orderable(self) -> None:
        # A level that isn't in LEVEL_ORDER can't be compared, so "what can run
        # on this next?" would have no answer for it.
        assert set(SUFFIX_TO_LEVEL.values()) <= set(LEVEL_ORDER)


class TestLevelTableMatchesTheScanner:
    @pytest.mark.parametrize(
        ("suffix", "expected"),
        [("_x1dints", LEVEL_3), ("_cat", LEVEL_3), ("_calints", LEVEL_2B)],
    )
    def test_covers_what_datascanservice_classifies(self, suffix, expected) -> None:
        # Present in ParseFileInfo but not in the C# SuffixToLevel dict. Without
        # them a saved catalog is levelless while the same file imported from
        # MAST is L3 — two labels for identical data in one library.
        assert level_for_suffix(suffix) == expected


class TestObservationBaseId:
    def test_stage3_form_matches_the_dotnet_regex(self) -> None:
        # JwstDataController.cs: (jw\d{5}-o\d+_t\d+_[a-z]+) — instrument
        # only. Including the optical elements would produce an id that never
        # equals a stored one.
        assert (
            observation_base_id_from("jw02733-o001_t001_nircam_f200w_i2d.fits")
            == "jw02733-o001_t001_nircam"
        )

    def test_exposure_form_matches_datascanservice(self) -> None:
        # DataScanService.cs: jw{program}{obs}{visit}. This is the shape on
        # every MAST-imported file, so stage-2 outputs must use it too.
        assert (
            observation_base_id_from("jw02733001001_02101_00001_nrca1_cal.fits") == "jw02733001001"
        )

    def test_lowercased_to_match_the_stored_values(self) -> None:
        # The .NET write path lowercases; Mongo string equality would never
        # match otherwise.
        assert (
            observation_base_id_from("JW02733-O001_T001_NIRCAM_f200w_i2d.fits")
            == "jw02733-o001_t001_nircam"
        )

    @pytest.mark.parametrize("value", [None, "", "not-a-jwst-name.fits"])
    def test_none_for_anything_unrecognised(self, value) -> None:
        assert observation_base_id_from(value) is None


def _parent(oid: str, file_name: str, base_id: str | None):
    return {"_id": oid, "FileName": file_name, "ObservationBaseId": base_id}


class TestObservationBaseIdForOutput:
    def test_inherits_from_the_parents(self) -> None:
        # The real case: an image3 output is named after the RECIPE
        # ("nircam-imaging_i2d.fits") and encodes no observation at all, so
        # the parents are the only source of truth.
        parents = [
            _parent("a", "jw02733001001_02101_00001_nrca1_cal.fits", "jw02733001001"),
            _parent("b", "jw02733001001_02101_00002_nrca1_cal.fits", "jw02733001001"),
        ]
        assert observation_base_id_for_output(parents, "nircam-imaging_i2d.fits") == "jw02733001001"

    def test_no_grouping_when_a_run_spans_observations(self) -> None:
        parents = [
            _parent("a", "x_cal.fits", "jw02733001001"),
            _parent("b", "y_cal.fits", "jw02739001001"),
        ]
        assert observation_base_id_for_output(parents, "nircam-imaging_i2d.fits") is None

    def test_a_parent_without_an_id_is_not_disagreement(self) -> None:
        # One known id among unknowns still groups the output correctly;
        # grouping beats invisibility.
        parents = [
            _parent("a", "x_cal.fits", "jw02733001001"),
            _parent("b", "y_cal.fits", None),
        ]
        assert observation_base_id_for_output(parents, "nircam-imaging_i2d.fits") == "jw02733001001"

    def test_falls_back_to_the_filename_with_no_parents(self) -> None:
        # A MAST-sourced run has no library inputs.
        assert (
            observation_base_id_for_output([], "jw02733-o001_t001_nircam_f200w_i2d.fits")
            == "jw02733-o001_t001_nircam"
        )


class TestExposureId:
    def test_matches_the_dotnet_grouping_key(self) -> None:
        # DataScanService.cs: jw{program}{obs}{visit}_{exposure}
        assert exposure_id_from("jw02733001001_02101_00001_nrca1_cal.fits") == "jw02733001001_02101"

    def test_none_for_a_combined_product(self) -> None:
        assert exposure_id_from("nircam-imaging_i2d.fits") is None


class TestDerivedFromForOutput:
    def test_per_exposure_output_records_only_its_own_parent(self) -> None:
        # A chained run over 6 exposures emits 6 _cal files. Recording all 6
        # parents on each would draw a 6x6 mesh instead of six 1-to-1 links.
        parents = [
            _parent("a", "jw02733001001_02101_00001_nrca1_uncal.fits", None),
            _parent("b", "jw02733001001_02101_00002_nrca1_uncal.fits", None),
        ]
        got = derived_from_for_output(parents, "jw02733001001_02101_00002_nrca1_cal.fits")
        assert got == ["b"]

    def test_combined_output_records_every_input(self) -> None:
        # image3 genuinely consumes all of them.
        parents = [
            _parent("a", "jw02733001001_02101_00001_nrca1_cal.fits", None),
            _parent("b", "jw02733001001_02101_00002_nrca1_cal.fits", None),
        ]
        assert derived_from_for_output(parents, "nircam-imaging_i2d.fits") == ["a", "b"]

    def test_sibling_detectors_of_one_exposure_are_not_all_parents(self) -> None:
        # One exposure emits a file PER DETECTOR (NIRCam SW has eight), all
        # sharing the exposure root. Matching on the root alone would make
        # every detector a parent of every other detector's output — the mesh
        # this function exists to prevent.
        parents = [
            _parent("a", "jw02733001001_02101_00001_nrca1_rate.fits", None),
            _parent("b", "jw02733001001_02101_00001_nrca2_rate.fits", None),
        ]
        got = derived_from_for_output(parents, "jw02733001001_02101_00001_nrca2_cal.fits")
        assert got == ["b"]

    def test_segments_of_one_exposure_are_kept_apart(self) -> None:
        parents = [
            _parent("a", "jw02733001001_02101_00001-seg001_nrca1_uncal.fits", None),
            _parent("b", "jw02733001001_02101_00001-seg002_nrca1_uncal.fits", None),
        ]
        got = derived_from_for_output(parents, "jw02733001001_02101_00001-seg002_nrca1_rate.fits")
        assert got == ["b"]

    def test_unmatched_exposure_falls_back_to_all_parents(self) -> None:
        # Two parents, so the fallback is distinguishable from a match.
        parents = [
            _parent("a", "jw02733001001_02101_00001_nrca1_cal.fits", None),
            _parent("b", "jw02733001001_02101_00002_nrca1_cal.fits", None),
        ]
        got = derived_from_for_output(parents, "jw09999009009_02101_00007_nrca1_cal.fits")
        assert got == ["a", "b"]

    def test_no_parents_is_empty_not_an_error(self) -> None:
        assert derived_from_for_output([], "nircam-imaging_i2d.fits") == []
