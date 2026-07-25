# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""JWST processing levels, mirrored from the .NET ``ProcessingLevels`` class.

The library labels every file L1/L2a/L2b/L3, and that label is what makes the
calibration pipeline legible: a run does not "enable image2", it raises a file
from one level to the next. A calibration output that carries no level cannot
be told apart from its siblings, cannot be fed to the next stage, and cannot be
compared against a variant produced with different settings.

Kept in lockstep with ``JwstDataModel.cs`` ``ProcessingLevels.SuffixToLevel``.
Duplicating the table is deliberate: the alternative is the engine reaching into
the .NET tier at write time, and the mapping is a stable property of the JWST
data products, not of either service.
"""

LEVEL_1 = "L1"
LEVEL_2A = "L2a"
LEVEL_2B = "L2b"
LEVEL_3 = "L3"
UNKNOWN = "unknown"

#: Longest suffixes first so ``_rateints`` is not matched as ``_rate``.
SUFFIX_TO_LEVEL: dict[str, str] = {
    "_rateints": LEVEL_2A,
    "_uncal": LEVEL_1,
    "_rate": LEVEL_2A,
    "_calints": LEVEL_2B,
    "_cal": LEVEL_2B,
    "_crf": LEVEL_2B,
    "_i2d": LEVEL_3,
    "_s2d": LEVEL_3,
    "_x1d": LEVEL_3,
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

    Matches the longest suffix present, so ``jw01_rateints.fits`` is L2a rather
    than being mistaken for a plain ``_rate`` product (same level here, but the
    same trap applies to ``_cal``/``_calints``).
    """
    if not file_name:
        return UNKNOWN
    lowered = file_name.lower()
    best: tuple[int, str] | None = None
    for suffix, level in SUFFIX_TO_LEVEL.items():
        if suffix in lowered and (best is None or len(suffix) > best[0]):
            best = (len(suffix), level)
    return best[1] if best else UNKNOWN
