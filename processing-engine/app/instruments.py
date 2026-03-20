"""
JWST instrument constants shared across the application.

FOV radii are used for spatial overlap detection in both the recipe engine
(discovery) and the footprint endpoint (mosaic).

Pixel scales are used for resolution-aware compositing — when mixing
instruments with different native resolutions (e.g. NIRCAM + MIRI),
the pipeline applies Gaussian blur to coarser-resolution channels to
prevent upsampling artifacts.
"""

# Known JWST instrument FOV radii (arcminutes) — conservative estimates
INSTRUMENT_FOV_RADIUS_ARCMIN: dict[str, float] = {
    "NIRCAM": 1.1,  # ~2.2' square field
    "MIRI": 0.75,  # ~1.23'×1.88' (conservative)
    "NIRISS": 1.1,
    "NIRSPEC": 1.6,  # MSA
}

# Default FOV radius when instrument not in lookup
DEFAULT_FOV_RADIUS_ARCMIN = 1.1

# Native pixel scales in arcseconds per pixel.
# NIRCAM has two channels with different scales; SW/LW is selected by wavelength.
INSTRUMENT_PIXEL_SCALE_ARCSEC: dict[str, float] = {
    "NIRCAM_SW": 0.031,  # Short-wave channel (0.6–2.3 µm)
    "NIRCAM_LW": 0.063,  # Long-wave channel (2.4–5.0 µm)
    "MIRI": 0.111,  # Imager (5–28 µm)
    "NIRISS": 0.065,
    "NIRSPEC": 0.100,  # MSA imaging mode
}

# Fallback when instrument not recognized
DEFAULT_PIXEL_SCALE_ARCSEC = 0.065

# NIRCAM SW/LW wavelength boundary in micrometers
_NIRCAM_SW_LW_CUTOFF_UM = 2.4


def get_pixel_scale(instrument: str | None, wavelength_um: float | None = None) -> float:
    """Return the native pixel scale for an instrument in arcseconds/pixel.

    For NIRCAM, uses wavelength to select short-wave vs long-wave channel.
    Returns DEFAULT_PIXEL_SCALE_ARCSEC for unknown instruments.
    """
    if instrument is None:
        return DEFAULT_PIXEL_SCALE_ARCSEC

    name = instrument.upper()
    if name == "NIRCAM":
        if wavelength_um is not None and wavelength_um >= _NIRCAM_SW_LW_CUTOFF_UM:
            return INSTRUMENT_PIXEL_SCALE_ARCSEC["NIRCAM_LW"]
        return INSTRUMENT_PIXEL_SCALE_ARCSEC["NIRCAM_SW"]

    scale = INSTRUMENT_PIXEL_SCALE_ARCSEC.get(name)
    if scale is not None:
        return scale

    return DEFAULT_PIXEL_SCALE_ARCSEC
