# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Derive a Level-3 product name from the exposures a run consumed.

Recipes used to carry a constant ``association.product_name`` (``"miri-imaging"``),
so every run of a recipe wrote ``miri-imaging_i2d.fits`` no matter what was
observed. Two consequences, both real:

* the filename encoded nothing about the data — ``save_output_to_library``
  already had to note that "an image3 output is named after the recipe, so it
  encodes no observation at all";
* a second run collided with the first on the ``(UserId, FileName)`` unique
  index and failed to save.

This module builds the name from the exposures instead, following the DMS
Level-3 convention::

    jw{program}-{acid}_{instrument}_{optical elements}
    jw01040-a3001_miri_f770w

``acid`` is the association candidate ID, and it is where provenance lives.
``jwst.associations.lib.acid`` defines ``oXXX`` for PPS-planned OBSERVATION
candidates, ``c1XXX`` for MOSAIC, and ``a3XXX`` for DISCOVERED — associations
built programmatically rather than planned. That is exactly what
``asn_from_list`` does here, so ``a3`` marks a product this app produced while
MAST downloads keep their ``o``/``c`` candidates. A reader can tell the two
apart at a glance, and no arbitrary suffix is involved.

Deliberately omitted: the ``t###`` target field of the full DMS convention.
That number is assigned by PPS and cannot be known from the exposures. Emitting
a plausible-looking ``t001`` would be inventing an identifier, which is not
something a science tool should do to a filename.
"""

import logging
import re
from pathlib import Path


logger = logging.getLogger(__name__)

#: DISCOVERED-association candidate type: built by software, not planned by PPS.
ACID_DISCOVERED = "a3"

#: Used when the exposures span more than one observation, so no single
#: observation number describes the product (a mosaic across visits).
MULTI_OBSERVATION = "000"

#: Mirrors the Association.product_name validator: letters, digits, '-', '_'.
_ILLEGAL = re.compile(r"[^A-Za-z0-9_-]+")
_MAX_LEN = 80


def _clean(value: object) -> str:
    """Lowercase a header value and drop anything the validator would reject."""
    if value is None:
        return ""
    return _ILLEGAL.sub("", str(value).strip().lower())


def _optical_elements(header) -> str:
    """The filter/pupil combination, alphabetically ordered.

    Alphabetical is what the archive does — MAST products in the library read
    ``nircam_clear-f200w`` (FILTER=F200W, PUPIL=CLEAR) and
    ``nircam_f444w-f470n`` (FILTER=F444W, PUPIL=F470N). Both are sorted, not
    filter-then-pupil. Instruments without a pupil wheel yield the filter alone.
    """
    elements = {
        _clean(header.get(key))
        for key in ("FILTER", "PUPIL", "GRATING", "BAND")
        if _clean(header.get(key))
    }
    # N/A is how the pipeline spells "this wheel does not apply".
    elements.discard("na")
    return "-".join(sorted(elements))


def _read_header(path: Path):
    from astropy.io import fits

    with fits.open(path, memmap=True) as hdul:
        return dict(hdul[0].header)


def derive_product_name(input_paths: list[Path], fallback: str) -> str:
    """Build a Level-3 product name from the exposures, or return ``fallback``.

    Never raises: a naming failure must not cost the user a multi-hour run, so
    an unreadable or header-less input falls back to the recipe's own name —
    which is the pre-existing behaviour, collisions and all.
    """
    programs: set[str] = set()
    observations: set[str] = set()
    instruments: set[str] = set()
    elements: set[str] = set()

    for path in input_paths:
        try:
            header = _read_header(path)
        except Exception:  # noqa: BLE001 -- naming is best-effort, see docstring
            logger.warning("Could not read header for naming: %s", path.name)
            continue
        programs.add(_clean(header.get("PROGRAM")))
        observations.add(_clean(header.get("OBSERVTN")))
        instruments.add(_clean(header.get("INSTRUME")))
        if optics := _optical_elements(header):
            elements.add(optics)

    programs.discard("")
    observations.discard("")
    instruments.discard("")

    # Program and instrument are what make the name meaningful. Without them
    # the result would be a decorated constant, so prefer the recipe's name.
    if len(programs) != 1 or len(instruments) != 1:
        logger.info(
            "Falling back to recipe product name %r (programs=%s instruments=%s)",
            fallback,
            sorted(programs),
            sorted(instruments),
        )
        return fallback

    program = programs.pop().zfill(5)
    instrument = instruments.pop()

    if len(observations) == 1:
        acid = f"{ACID_DISCOVERED}{observations.pop().zfill(3)}"
    else:
        # A mosaic spanning visits has no single observation to name it after.
        acid = f"{ACID_DISCOVERED}{MULTI_OBSERVATION}"

    parts = [f"jw{program}-{acid}", instrument]
    # Several filters in one association is legitimate for a colour mosaic;
    # naming it after one of them would be misleading, so leave optics out.
    if len(elements) == 1:
        parts.append(elements.pop())

    return "_".join(parts)[:_MAX_LEN]
