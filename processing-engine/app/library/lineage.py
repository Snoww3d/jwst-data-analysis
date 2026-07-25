# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Lineage for a calibration output: which library items produced it, and which
observation it belongs to.

``ObservationBaseId`` is what the lineage view, the mosaic substitution and the
"siblings of this exposure" logic all key on. An output written without one is
invisible to every one of them.

It is taken from the run's INPUTS, not from the output's filename. Calibration
outputs are not named like MAST products: an image3 run writes
``{association.product_name}_i2d.fits`` (e.g. ``nircam-imaging_i2d.fits``), so
there is no observation encoded in the name at all. The parents already carry a
correctly-shaped id, so inheriting it is both accurate and immune to the three
different id shapes that exist in the .NET tier.

The filename parsers below are a fallback for the case where an output has no
library parents (a MAST-sourced run). They mirror the two .NET conventions
exactly:

- exposure form (``DataScanService.cs``): ``jw{program}{obs}{visit}``
- stage-3 form (``JwstDataController.cs``): ``jw\\d{5}-o\\d+_t\\d+_{instrument}``
  — instrument only, deliberately without the optical elements.
"""

import re


#: jw02733001001_02101_00001_nrca1_cal.fits -> jw02733001001
_EXPOSURE = re.compile(r"^(jw\d{5}\d{3}\d{3})_\d{5}_\d{5}_[a-z0-9]+", re.IGNORECASE)

#: jw02733-o001_t001_nircam_f200w_i2d.fits -> jw02733-o001_t001_nircam
_STAGE3 = re.compile(r"^(jw\d{5}-o\d+_t\d+_[a-z]+)", re.IGNORECASE)

#: The exposure AND detector a per-exposure product came from. The detector is
#: part of the identity: one JWST exposure emits one file per detector (NIRCam
#: short-wave has eight), and they all share the exposure root — so matching on
#: the root alone would make every detector a parent of every other detector's
#: output, which is the mesh this function exists to prevent. Segment is
#: included for the same reason.
_EXPOSURE_ROOT = re.compile(r"^(jw\d{11}_\d{5}_\d{5}(?:-seg\d+)?)(?:_([a-z0-9]+))?", re.IGNORECASE)


def observation_base_id_from(file_name: str | None) -> str | None:
    """Base id encoded in a product filename, or None.

    Lowercased to match the .NET write path, which stores it lowercased —
    Mongo string equality would otherwise never match a mixed-case name.
    """
    if not file_name:
        return None
    name = file_name.strip()
    for pattern in (_EXPOSURE, _STAGE3):
        match = pattern.match(name)
        if match:
            return match.group(1).lower()
    return None


def observation_base_id_for_output(parents: list[dict], file_name: str | None = None) -> str | None:
    """The observation an output belongs to.

    Inherited from the parents when they agree. Disagreement means the run
    combined several observations, which has no single base id — returning one
    of them would file the output with the wrong half of its own inputs.

    A parent with no id at all is not disagreement: one known id among several
    unknowns still groups the output correctly, and grouping beats invisibility.

    Inheriting also carries through the .NET fallback where ObservationBaseId
    holds a raw MAST ``obs_id`` rather than a ``jw...`` value
    (DataScanService.cs) — a shape no filename parser here would produce.
    """
    ids = {str(p.get("ObservationBaseId")).lower() for p in parents if p.get("ObservationBaseId")}
    if len(ids) == 1:
        return ids.pop()
    if ids:
        return None  # genuinely spans observations — no single grouping
    return observation_base_id_from(file_name)


def _exposure_key(file_name: str | None) -> tuple[str, str | None] | None:
    """(exposure+segment, detector) for a per-exposure product, else None."""
    if not file_name:
        return None
    match = _EXPOSURE_ROOT.match(file_name.strip())
    if not match:
        return None
    detector = match.group(2)
    return match.group(1).lower(), detector.lower() if detector else None


def exposure_id_from(file_name: str | None) -> str | None:
    """``jw{program}{obs}{visit}_{exposure}`` for a per-exposure product.

    Mirrors DataScanService.cs, which groups sibling detectors of one exposure
    by this value. Writing it here means a saved output joins that grouping
    immediately instead of waiting on the backfill endpoint to re-parse names.
    """
    key = _exposure_key(file_name)
    if not key:
        return None
    root = key[0]
    # The .NET form stops at the exposure number: jw02733001001_02101.
    parts = root.split("_")
    return "_".join(parts[:2]) if len(parts) >= 2 else None


def derived_from_for_output(parents: list[dict], file_name: str) -> list[str]:
    """The parent ids to record for one output file.

    A per-exposure product (a stage-1/2 output) comes from exactly one input,
    so a chained run over six exposures must record six 1→1 links, not a 6×6
    mesh. A combined product (image3) genuinely consumes every input.
    """
    key = _exposure_key(file_name)
    if key:
        keyed = [(p, _exposure_key(p.get("FileName"))) for p in parents]
        # Exposure AND detector: the precise parent.
        exact = [str(p["_id"]) for p, k in keyed if k == key]
        if exact:
            return exact
        # Same exposure, detector unknown on one side — still far better than
        # falling back to every input.
        same_exposure = [str(p["_id"]) for p, k in keyed if k and k[0] == key[0]]
        if same_exposure:
            return same_exposure
    return [str(p["_id"]) for p in parents]
