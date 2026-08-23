"""HEALPix NESTED ``ang2pix`` (app/mast/healpix.py) — the coverage grid's binning.

Pinned values come from ``astropy_healpix`` (HEALPix(nside, order='nested')),
and when that library is importable (the full engine image has it via
reproject) a random sweep cross-checks every pixel. Exact face-corner points
(RA ∈ {0, 90, 180, 270}, Dec = 0) are excluded: their tie-break differs
between implementations and is irrelevant for binning.
"""

import numpy as np
import pytest

from app.mast.healpix import ang2pix_nest, order_for_nside


class TestOrderForNside:
    @pytest.mark.parametrize("nside,order", [(1, 0), (2, 1), (32, 5), (64, 6), (1024, 10)])
    def test_powers_of_two(self, nside, order):
        assert order_for_nside(nside) == order

    @pytest.mark.parametrize("bad", [0, 3, 6, 100, -2])
    def test_rejects_non_powers(self, bad):
        with pytest.raises(ValueError):
            order_for_nside(bad)


class TestAng2PixNest:
    def test_pinned_values_nside64(self):
        # astropy_healpix 2.0.1, HEALPix(nside=64, order='nested')
        ra = [45.0, 123.4, 300.0, 10.0, 200.0]
        dec = [89.9999, -41.8, 10.0, -89.0, 0.5]
        expected = [4095, 39317, 30555, 32770, 26204]
        got = ang2pix_nest(64, ra, dec)
        assert got.tolist() == expected

    def test_pinned_values_nside1_are_the_faces(self):
        # nside 1: one pixel per base face; the north polar cap is faces 0–3
        got = ang2pix_nest(1, [45.0, 135.0, 225.0, 315.0], [80.0] * 4)
        assert got.tolist() == [0, 1, 2, 3]
        # south polar cap is faces 8–11
        got = ang2pix_nest(1, [45.0, 135.0, 225.0, 315.0], [-80.0] * 4)
        assert got.tolist() == [8, 9, 10, 11]

    def test_range_and_dtype(self):
        rng = np.random.default_rng(1)
        ra = rng.uniform(0, 360, 10_000)
        dec = np.rad2deg(np.arcsin(rng.uniform(-1, 1, 10_000)))
        pix = ang2pix_nest(64, ra, dec)
        assert pix.dtype == np.int64
        assert pix.min() >= 0
        assert pix.max() < 12 * 64 * 64

    def test_scalar_input_and_ra_wrap(self):
        assert ang2pix_nest(64, 370.0, 5.0).tolist() == ang2pix_nest(64, 10.0, 5.0).tolist()
        assert ang2pix_nest(64, -10.0, 5.0).tolist() == ang2pix_nest(64, 350.0, 5.0).tolist()

    def test_shape_mismatch_rejected(self):
        with pytest.raises(ValueError):
            ang2pix_nest(64, [1.0, 2.0], [1.0])

    def test_matches_astropy_healpix_when_available(self):
        astropy_healpix = pytest.importorskip("astropy_healpix")
        import astropy.units as u

        rng = np.random.default_rng(42)
        n = 50_000
        ra = rng.uniform(0, 360, n)
        dec = np.rad2deg(np.arcsin(rng.uniform(-1, 1, n)))
        for nside in (2, 64, 256):
            hp = astropy_healpix.HEALPix(nside=nside, order="nested")
            ref = hp.lonlat_to_healpix(ra * u.deg, dec * u.deg)
            got = ang2pix_nest(nside, ra, dec)
            assert np.array_equal(ref, got), (
                f"nside {nside}: {np.count_nonzero(ref != got)} mismatches"
            )
