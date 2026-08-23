"""Minimal HEALPix (NESTED scheme) pixel indexing in pure numpy.

The coverage density grid (MAST Search v2 Phase 5) bins observation
centroids into HEALPix cells so the frontend can draw them as a MOC
(``A.MOCFromJSON`` takes NESTED indices per order). The full engine image
has ``astropy_healpix`` via reproject, but the lightweight MAST proxy image
(``requirements-mast.txt``) does not — and a dependency for one function is
not worth it. This is the standard ``ang2pix_nest`` algorithm (Górski et
al. 2005; healpy's C implementation), vectorised. ``tests/test_healpix.py``
cross-checks it against ``astropy_healpix`` when that is importable.
"""

from __future__ import annotations

import numpy as np


def _spread_bits(v: np.ndarray) -> np.ndarray:
    """Interleave zeros between the bits of ``v`` (uint64): b3 b2 b1 b0 → 0b3 0b2 0b1 0b0."""
    v = v.astype(np.uint64)
    v = (v | (v << np.uint64(16))) & np.uint64(0x0000FFFF0000FFFF)
    v = (v | (v << np.uint64(8))) & np.uint64(0x00FF00FF00FF00FF)
    v = (v | (v << np.uint64(4))) & np.uint64(0x0F0F0F0F0F0F0F0F)
    v = (v | (v << np.uint64(2))) & np.uint64(0x3333333333333333)
    v = (v | (v << np.uint64(1))) & np.uint64(0x5555555555555555)
    return v


def order_for_nside(nside: int) -> int:
    if nside <= 0 or (nside & (nside - 1)) != 0:
        raise ValueError(f"nside must be a power of two, got {nside}")
    return nside.bit_length() - 1


def ang2pix_nest(nside: int, ra_deg, dec_deg) -> np.ndarray:
    """NESTED pixel index for each (RA, Dec) in degrees. Vectorised; returns int64."""
    order_for_nside(nside)
    ra = np.atleast_1d(np.asarray(ra_deg, dtype=np.float64))
    dec = np.atleast_1d(np.asarray(dec_deg, dtype=np.float64))
    if ra.shape != dec.shape:
        raise ValueError("ra and dec must have the same shape")

    phi = np.deg2rad(np.mod(ra, 360.0))
    z = np.sin(np.deg2rad(np.clip(dec, -90.0, 90.0)))
    za = np.abs(z)
    tt = np.mod(phi, 2 * np.pi) * (2.0 / np.pi)  # in [0, 4)

    ns = float(nside)
    ix = np.empty(ra.shape, dtype=np.int64)
    iy = np.empty(ra.shape, dtype=np.int64)
    face = np.empty(ra.shape, dtype=np.int64)

    # Equatorial region: |z| <= 2/3
    eq = za <= 2.0 / 3.0
    if np.any(eq):
        temp1 = ns * (0.5 + tt[eq])
        temp2 = ns * z[eq] * 0.75
        jp = (temp1 - temp2).astype(np.int64)  # ascending edge line index
        jm = (temp1 + temp2).astype(np.int64)  # descending edge line index
        ifp = jp // nside
        ifm = jm // nside
        f = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
        face[eq] = f
        ix[eq] = jm & (nside - 1)
        iy[eq] = nside - (jp & (nside - 1)) - 1

    # Polar caps: |z| > 2/3
    po = ~eq
    if np.any(po):
        ntt = np.minimum(tt[po].astype(np.int64), 3)
        tp = tt[po] - ntt
        tmp = ns * np.sqrt(3.0 * (1.0 - za[po]))
        jp = np.minimum((tp * tmp).astype(np.int64), nside - 1)
        jm = np.minimum(((1.0 - tp) * tmp).astype(np.int64), nside - 1)
        north = z[po] >= 0
        face[po] = np.where(north, ntt, ntt + 8)
        ix[po] = np.where(north, nside - jm - 1, jp)
        iy[po] = np.where(north, nside - jp - 1, jm)

    order = order_for_nside(nside)
    pix = (
        (face.astype(np.uint64) << np.uint64(2 * order))
        + _spread_bits(ix)
        + (_spread_bits(iy) << np.uint64(1))
    )
    return pix.astype(np.int64)
