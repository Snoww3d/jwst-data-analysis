"""Celestial WCS parsing, delegated to astropy.

FITS spells the pixel-to-sky transform three interchangeable ways: a ``CD``
matrix, a ``PC`` matrix scaled by ``CDELT``, or ``CDELT`` alone. Real JWST
``_i2d`` products use the second, and hand-rolled readers that only know about
``CD`` silently drop the rotation. astropy resolves all three (plus SIP, the
``PC``/``CD`` precedence rules, and the alternate-axis conventions) into a
single matrix, so we parse once here and everything else reads the result.
"""

import logging
import warnings

from astropy.wcs import WCS, FITSFixedWarning
from astropy.wcs.utils import proj_plane_pixel_scales


logger = logging.getLogger(__name__)


def celestial_wcs(header) -> WCS | None:
    """Parse the celestial (RA/Dec) WCS out of a FITS header.

    Args:
        header: FITS header, or any dict-like of FITS keywords. May describe
            more than two axes — the celestial pair is extracted.

    Returns:
        A 2-axis `WCS`, or None when the header carries no celestial solution.
    """
    if header is None:
        return None

    try:
        with warnings.catch_warnings():
            # Headers routinely need datfix/obsfix nudges; astropy applies them
            # and says so. Nothing actionable for a coordinate readout.
            warnings.simplefilter("ignore", FITSFixedWarning)
            wcs = WCS(header)

        if not wcs.has_celestial:
            return None
        return wcs.celestial
    except Exception as e:  # astropy raises a wide range on malformed headers
        logger.warning(f"Could not parse WCS from header: {e}")
        return None


def wcs_params_from_header(header) -> dict | None:
    """Build the viewer's WCS payload from a FITS header.

    The shape matches the frontend `WCSParams` type. `cd1_1`..`cd2_2` are the
    full pixel-to-sky matrix in degrees/pixel with rotation and any sky flip
    included, whichever way the header happened to spell it.

    Args:
        header: FITS header, or any dict-like of FITS keywords.

    Returns:
        Dict of WCS parameters, or None when the header has no celestial WCS.
    """
    wcs = celestial_wcs(header)
    if wcs is None:
        return None

    matrix = wcs.pixel_scale_matrix
    crpix1, crpix2 = wcs.wcs.crpix
    crval1, crval2 = wcs.wcs.crval
    # True on-sky scale per axis — magnitudes, since the matrix above already
    # carries orientation. Kept for consumers that want arcsec/pixel.
    cdelt1, cdelt2 = proj_plane_pixel_scales(wcs)

    return {
        "crpix1": float(crpix1),
        "crpix2": float(crpix2),
        "crval1": float(crval1),
        "crval2": float(crval2),
        "cdelt1": float(cdelt1),
        "cdelt2": float(cdelt2),
        "cd1_1": float(matrix[0][0]),
        "cd1_2": float(matrix[0][1]),
        "cd2_1": float(matrix[1][0]),
        "cd2_2": float(matrix[1][1]),
        "ctype1": str(wcs.wcs.ctype[0]),
        "ctype2": str(wcs.wcs.ctype[1]),
    }
