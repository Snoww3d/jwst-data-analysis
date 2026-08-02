# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Tests for Level-3 product naming (#1803, option 4)."""

import numpy as np
import pytest
from astropy.io import fits

from app.calibration.product_naming import ACID_DISCOVERED, derive_product_name


FALLBACK = "miri-imaging"


def _exposure(tmp_path, name, **cards):
    """A minimal exposure carrying the header keywords naming reads."""
    path = tmp_path / name
    hdu = fits.PrimaryHDU(np.zeros((2, 2), dtype=np.float32))
    for key, value in cards.items():
        hdu.header[key] = value
    hdu.writeto(path, overwrite=True)
    return path


class TestDeriveProductName:
    def test_names_after_the_data(self, tmp_path):
        paths = [
            _exposure(
                tmp_path,
                f"exp{i}.fits",
                PROGRAM="1040",
                OBSERVTN="001",
                INSTRUME="MIRI",
                FILTER="F770W",
            )
            for i in range(3)
        ]
        assert derive_product_name(paths, FALLBACK) == "jw01040-a3001_miri_f770w"

    def test_program_is_zero_padded_to_five(self, tmp_path):
        path = _exposure(
            tmp_path, "e.fits", PROGRAM="1040", OBSERVTN="1", INSTRUME="MIRI", FILTER="F770W"
        )
        name = derive_product_name([path], FALLBACK)
        assert name.startswith("jw01040-")
        # ...and the observation to three, so candidates sort lexically.
        assert f"-{ACID_DISCOVERED}001_" in name

    def test_optical_elements_are_alphabetical(self, tmp_path):
        """Matches the archive: nircam_clear-f200w, nircam_f444w-f470n."""
        clear = _exposure(
            tmp_path,
            "a.fits",
            PROGRAM="1226",
            OBSERVTN="002",
            INSTRUME="NIRCAM",
            FILTER="F200W",
            PUPIL="CLEAR",
        )
        assert derive_product_name([clear], FALLBACK) == "jw01226-a3002_nircam_clear-f200w"

        narrow = _exposure(
            tmp_path,
            "b.fits",
            PROGRAM="1226",
            OBSERVTN="002",
            INSTRUME="NIRCAM",
            FILTER="F444W",
            PUPIL="F470N",
        )
        assert derive_product_name([narrow], FALLBACK) == "jw01226-a3002_nircam_f444w-f470n"

    def test_na_wheel_is_not_an_element(self, tmp_path):
        path = _exposure(
            tmp_path,
            "e.fits",
            PROGRAM="1040",
            OBSERVTN="001",
            INSTRUME="MIRI",
            FILTER="F770W",
            PUPIL="N/A",
        )
        assert derive_product_name([path], FALLBACK) == "jw01040-a3001_miri_f770w"

    def test_multiple_observations_collapse_to_a3000(self, tmp_path):
        """A mosaic spanning visits has no single observation to be named after."""
        paths = [
            _exposure(
                tmp_path,
                f"o{obs}.fits",
                PROGRAM="1040",
                OBSERVTN=obs,
                INSTRUME="MIRI",
                FILTER="F770W",
            )
            for obs in ("001", "002")
        ]
        assert derive_product_name(paths, FALLBACK) == "jw01040-a3000_miri_f770w"

    def test_mixed_filters_drop_the_optics(self, tmp_path):
        """Naming a multi-filter association after one filter would be wrong."""
        paths = [
            _exposure(
                tmp_path,
                f"{filt}.fits",
                PROGRAM="1040",
                OBSERVTN="001",
                INSTRUME="MIRI",
                FILTER=filt,
            )
            for filt in ("F770W", "F1000W")
        ]
        assert derive_product_name(paths, FALLBACK) == "jw01040-a3001_miri"

    def test_marks_app_generated_products(self, tmp_path):
        """a3 is the DISCOVERED candidate type — how MAST products differ from ours.

        A MAST download of the same programme reads jw01040-o001_...; anything
        this app builds reads jw01040-a3001_..., so provenance is legible in the
        filename without an arbitrary suffix.
        """
        path = _exposure(
            tmp_path, "e.fits", PROGRAM="1040", OBSERVTN="001", INSTRUME="MIRI", FILTER="F770W"
        )
        name = derive_product_name([path], FALLBACK)
        assert f"-{ACID_DISCOVERED}" in name
        assert "-o001" not in name

    def test_no_fabricated_target_id(self, tmp_path):
        """t### is assigned by PPS and cannot be known here; inventing one would lie."""
        path = _exposure(
            tmp_path, "e.fits", PROGRAM="1040", OBSERVTN="001", INSTRUME="MIRI", FILTER="F770W"
        )
        assert "_t0" not in derive_product_name([path], FALLBACK)


class TestFallback:
    def test_unreadable_input_falls_back(self, tmp_path):
        (tmp_path / "broken.fits").write_text("not a FITS file", encoding="utf-8")
        assert derive_product_name([tmp_path / "broken.fits"], FALLBACK) == FALLBACK

    def test_missing_keywords_fall_back(self, tmp_path):
        path = _exposure(tmp_path, "bare.fits")
        assert derive_product_name([path], FALLBACK) == FALLBACK

    def test_mixed_instruments_fall_back(self, tmp_path):
        """Not a coherent Level-3 product; the recipe's own name is more honest."""
        paths = [
            _exposure(tmp_path, f"{inst}.fits", PROGRAM="1040", OBSERVTN="001", INSTRUME=inst)
            for inst in ("MIRI", "NIRCAM")
        ]
        assert derive_product_name(paths, FALLBACK) == FALLBACK

    def test_empty_input_falls_back(self):
        assert derive_product_name([], FALLBACK) == FALLBACK

    def test_never_raises(self, tmp_path):
        """A naming failure must not cost the user a multi-hour run."""
        missing = tmp_path / "does-not-exist.fits"
        assert derive_product_name([missing], FALLBACK) == FALLBACK


class TestValidatorCompatibility:
    """The result feeds Association.product_name, whose validator is strict."""

    @pytest.mark.parametrize(
        "cards",
        [
            {"PROGRAM": "1040", "OBSERVTN": "001", "INSTRUME": "MIRI", "FILTER": "F770W"},
            {"PROGRAM": "01040", "OBSERVTN": "1", "INSTRUME": "mIrI", "FILTER": "f770w"},
        ],
    )
    def test_output_is_a_legal_product_name(self, tmp_path, cards):
        from app.calibration.models import Association

        path = _exposure(tmp_path, "e.fits", **cards)
        name = derive_product_name([path], FALLBACK)
        # Raises ValidationError if the charset or length is wrong.
        assert Association(product_name=name).product_name == name

    def test_odd_header_values_are_scrubbed(self, tmp_path):
        """Header text reaches a filename, so anything illegal must be stripped."""
        from app.calibration.models import Association

        path = _exposure(
            tmp_path,
            "e.fits",
            PROGRAM="1040",
            OBSERVTN="001",
            INSTRUME="MIRI",
            FILTER="F770W/OPEN",
        )
        name = derive_product_name([path], FALLBACK)
        assert "/" not in name
        assert Association(product_name=name).product_name == name
