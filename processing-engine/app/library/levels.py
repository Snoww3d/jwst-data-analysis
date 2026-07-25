# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""JWST processing levels, mirrored from the .NET ``ProcessingLevels`` class.

The library labels every file L1/L2a/L2b/L3, and that label is what makes the
calibration pipeline legible: a run does not "enable image2", it raises a file
from one level to the next. A calibration output that carries no level cannot
be told apart from its siblings, cannot be fed to the next stage, and cannot be
compared against a variant produced with different settings.

Mirrors the .NET classification. That classification lives in two places on the
C# side — the ``ProcessingLevels.SuffixToLevel`` dictionary (8 entries) and the
longer if/else chain in ``DataScanService.ParseFileInfo`` — and this table is
the union of both, so a calibration output gets the same level the scanner
would give the identical file. The four entries beyond ``SuffixToLevel``
(``_calints``, ``_x1dints``, ``_cat``, and ``_asn`` deliberately omitted) come
from ``ParseFileInfo``; without them a saved catalog would be levelless while
the same file imported from MAST is L3 — two labels for identical data.

Duplicating the table is deliberate: the alternative is the engine reaching into
the .NET tier at write time, and the mapping is a stable property of the JWST
data products, not of either service.
"""

from pathlib import Path


LEVEL_1 = "L1"
LEVEL_2A = "L2a"
LEVEL_2B = "L2b"
LEVEL_3 = "L3"
UNKNOWN = "unknown"

SUFFIX_TO_LEVEL: dict[str, str] = {
    "_uncal": LEVEL_1,
    "_rate": LEVEL_2A,
    "_rateints": LEVEL_2A,
    "_cal": LEVEL_2B,
    "_calints": LEVEL_2B,
    "_crf": LEVEL_2B,
    "_i2d": LEVEL_3,
    "_s2d": LEVEL_3,
    "_x1d": LEVEL_3,
    "_x1dints": LEVEL_3,
    "_cat": LEVEL_3,
}

#: Ascending, for "can this be advanced?" questions. Excludes UNKNOWN.
LEVEL_ORDER: list[str] = [LEVEL_1, LEVEL_2A, LEVEL_2B, LEVEL_3]


def level_for_suffix(suffix: str | None) -> str:
    """Level for a product suffix (``_cal`` → ``L2b``), or ``unknown``."""
    if not suffix:
        return UNKNOWN
    key = suffix if suffix.startswith("_") else f"_{suffix}"
    return SUFFIX_TO_LEVEL.get(key.lower(), UNKNOWN)


def level_for_filename(file_name: str | None) -> str:
    """Level implied by a product filename, or ``unknown``.

    Matches the END of the stem, the way the executor identifies its own
    outputs (``path.stem.endswith(s)``). Searching anywhere in the name would
    misread a recipe-named product: an image3 output is
    ``{product_name}_i2d.fits``, and a product name may itself contain ``_``,
    so ``ngc_calibration_i2d.fits`` would match ``_cal`` and be labelled L2b —
    a finished mosaic filed as a half-processed exposure.
    """
    if not file_name:
        return UNKNOWN
    stem = Path(file_name.lower()).stem
    for suffix, level in SUFFIX_TO_LEVEL.items():
        if stem.endswith(suffix):
            return level
    return UNKNOWN
