"""
JWST instrument constants shared across the application.

FOV radii are used for spatial overlap detection in both the recipe engine
(discovery) and the footprint endpoint (mosaic).
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
