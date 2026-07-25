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
from app.library.lineage import observation_base_id_from


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

    def test_longest_suffix_wins(self) -> None:
        # "_rateints" contains "_rate"; matching the shorter one first would
        # still be L2a here, but the same trap misclassifies _calints.
        assert level_for_filename("jw01_rateints.fits") == LEVEL_2A
        assert level_for_filename("jw01_calints.fits") == LEVEL_2B

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


class TestObservationBaseId:
    @pytest.mark.parametrize(
        ("file_name", "expected"),
        [
            (
                "jw02733-o001_t001_nircam_f200w_i2d.fits",
                "jw02733-o001_t001_nircam_f200w",
            ),
            (
                "jw06675-o007_t008_nircam_clear-f444w_i2d.fits",
                "jw06675-o007_t008_nircam_clear-f444w",
            ),
            (
                "jw02736-o003_t001_niriss_f200w-gr150c_x1d.fits",
                "jw02736-o003_t001_niriss_f200w-gr150c",
            ),
        ],
    )
    def test_strips_the_product_suffix(self, file_name: str, expected: str) -> None:
        assert observation_base_id_from(file_name) == expected

    def test_matches_the_ids_already_in_the_library(self) -> None:
        # Exactly the shape of ObservationBaseId values on existing records, so
        # a calibration output groups with the data it was made from.
        assert (
            observation_base_id_from("jw02733-o002_t001_miri_f1130w_i2d.fits")
            == "jw02733-o002_t001_miri_f1130w"
        )

    def test_exposure_level_products_get_none_not_a_guess(self) -> None:
        # Stage-2 names carry no -oNNN token; inventing a grouping would file
        # the output with unrelated exposures.
        assert observation_base_id_from("jw02733001001_02101_00001_nrca1_cal.fits") is None

    @pytest.mark.parametrize("value", [None, "", "not-a-jwst-name.fits"])
    def test_none_for_anything_unrecognised(self, value) -> None:
        assert observation_base_id_from(value) is None
