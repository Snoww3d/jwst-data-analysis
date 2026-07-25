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

#: The exposure a per-exposure product came from: jw02733001001_02101_00001
_EXPOSURE_ROOT = re.compile(r"^(jw\d{11}_\d{5}_\d{5})", re.IGNORECASE)


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
    """
    ids = {str(p.get("ObservationBaseId")).lower() for p in parents if p.get("ObservationBaseId")}
    if len(ids) == 1:
        return ids.pop()
    if ids:
        return None  # genuinely spans observations — no single grouping
    return observation_base_id_from(file_name)


def _exposure_root(file_name: str | None) -> str | None:
    if not file_name:
        return None
    match = _EXPOSURE_ROOT.match(file_name.strip())
    return match.group(1).lower() if match else None


def derived_from_for_output(parents: list[dict], file_name: str) -> list[str]:
    """The parent ids to record for one output file.

    A per-exposure product (a stage-1/2 output) comes from exactly one input,
    so a chained run over six exposures must record six 1→1 links, not a 6×6
    mesh. A combined product (image3) genuinely consumes every input.
    """
    root = _exposure_root(file_name)
    if root:
        matched = [str(p["_id"]) for p in parents if _exposure_root(p.get("FileName")) == root]
        if matched:
            return matched
    return [str(p["_id"]) for p in parents]
