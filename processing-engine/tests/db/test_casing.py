"""Casing converters — the CE /api facade must match the .NET wire contract.

Rules pinned by the Phase 1 golden fixtures (tests/contract/fixtures/):
- Mongo docs are PascalCase; the wire is camelCase (System.Text.Json policy,
  which lowercases a LEADING RUN of capitals: WCS -> wcs, WCSInfo -> wcsInfo).
- The Metadata subtree passes through verbatim (mast_* keys untouched).
- The recipe-engine facade converts camelCase requests to snake_case and
  snake_case responses to camelCase.
"""

from datetime import datetime

from app.db.casing import (
    camel_to_snake_keys,
    pascal_to_camel,
    pascal_to_camel_keys,
    snake_to_camel,
    snake_to_camel_keys,
)


class TestPascalToCamel:
    def test_simple(self):
        assert pascal_to_camel("FileName") == "fileName"
        assert pascal_to_camel("IsPublic") == "isPublic"

    def test_leading_acronym_run(self):
        # System.Text.Json CamelCase policy behavior
        assert pascal_to_camel("WCS") == "wcs"
        assert pascal_to_camel("WCSInfo") == "wcsInfo"

    def test_already_camel_or_single(self):
        assert pascal_to_camel("id") == "id"
        assert pascal_to_camel("A") == "a"

    def test_bit_depth(self):
        assert pascal_to_camel("BitDepth") == "bitDepth"
        assert pascal_to_camel("ProposalPi") == "proposalPi"


class TestPascalToCamelKeys:
    def test_recursive_with_verbatim_subtrees(self):
        # WCS is a Dictionary<string,object> in .NET — DictionaryKeyPolicy is
        # null, so its keys (FITS keywords like CRPIX1) pass through verbatim;
        # only the container property name camelizes.
        doc = {
            "FileName": "a.fits",
            "ImageInfo": {"BitDepth": 16, "WCS": {"CRPIX1": 1.0}},
            "Metadata": {"mast_obs_id": "jw1", "source": "mast"},
            "Tags": ["X"],
        }
        out = pascal_to_camel_keys(doc, verbatim_keys={"Metadata", "WCS"})
        assert out["fileName"] == "a.fits"
        assert out["imageInfo"]["bitDepth"] == 16
        assert out["imageInfo"]["wcs"] == {"CRPIX1": 1.0}
        # Metadata keys untouched, but renamed to camel itself
        assert out["metadata"] == {"mast_obs_id": "jw1", "source": "mast"}
        assert out["tags"] == ["X"]

    def test_datetimes_become_utc_iso_z(self):
        doc = {"UploadDate": datetime(2026, 7, 6, 12, 0, 0, 123000)}
        out = pascal_to_camel_keys(doc, verbatim_keys=set())
        assert out["uploadDate"] == "2026-07-06T12:00:00.123Z"

    def test_datetime_trailing_zeros_trimmed_like_dotnet(self):
        # System.Text.Json trims trailing zeros (verified against live API:
        # .9Z / .99Z / .999Z variants on the wire)
        doc = {"A": datetime(2026, 7, 6, 12, 0, 0, 360000)}
        assert pascal_to_camel_keys(doc, verbatim_keys=set())["a"] == "2026-07-06T12:00:00.36Z"

    def test_datetime_whole_second_omits_fraction(self):
        doc = {"A": datetime(2026, 7, 6, 12, 0, 0)}
        assert pascal_to_camel_keys(doc, verbatim_keys=set())["a"] == "2026-07-06T12:00:00Z"

    def test_lists_of_dicts(self):
        doc = {"Items": [{"SubKey": 1}, {"SubKey": 2}]}
        out = pascal_to_camel_keys(doc, verbatim_keys=set())
        assert out["items"] == [{"subKey": 1}, {"subKey": 2}]


class TestSnakeCamelRoundtrip:
    def test_snake_to_camel(self):
        assert snake_to_camel("color_mapping") == "colorMapping"
        assert snake_to_camel("t_obs_release") == "tObsRelease"
        assert snake_to_camel("name") == "name"

    def test_snake_to_camel_keys_recursive(self):
        out = snake_to_camel_keys(
            {"color_mapping": {"F444W": "#ff0000"}, "recipes": [{"observation_ids": ["a"]}]}
        )
        # dict VALUES keyed by data (filter names) must be untouched
        assert out["colorMapping"] == {"F444W": "#ff0000"}
        assert out["recipes"] == [{"observationIds": ["a"]}]

    def test_camel_to_snake_keys(self):
        out = camel_to_snake_keys(
            {"targetName": "M16", "observations": [{"tObsRelease": 1.0, "sRa": 2.0}]}
        )
        assert out == {"target_name": "M16", "observations": [{"t_obs_release": 1.0, "s_ra": 2.0}]}
