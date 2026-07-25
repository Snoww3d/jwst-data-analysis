# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Deriving an ObservationBaseId from a JWST product filename.

The library groups files by ``ObservationBaseId`` — that grouping is what the
lineage view, the mosaic substitution and the "siblings of this exposure" logic
all key on. A calibration output written without one is invisible to every one
of them, so it appears in the library detached from the data it came from.

JWST stage-3 products are named ``jw<proposal>-o<observation>_t<target>_
<instrument>_<optical elements>_<suffix>.fits``; the base id is everything
before the suffix. Stage-2 products use the exposure form
``jw<proposal><obs><visit>_<...>_<suffix>.fits`` and have no ``-oNNN`` token,
so they get no base id here rather than a wrong one.
"""

import re


#: Stage-3 association products: jw02733-o001_t001_nircam_f200w_i2d.fits
_STAGE3 = re.compile(
    r"^(jw\d{5}-[oc]\d{3}_t\d+_[a-z0-9]+(?:_[a-z0-9\-]+)*?)_"
    r"(?:i2d|s2d|x1d|cat|segm|crf|c1d|s3d)\b",
    re.IGNORECASE,
)


def observation_base_id_from(file_name: str | None) -> str | None:
    """The observation base id encoded in a product filename, or None.

    Returns None rather than guessing: a wrong base id would silently group an
    output with unrelated exposures, which is worse for the lineage view than
    having no grouping at all.
    """
    if not file_name:
        return None
    match = _STAGE3.match(file_name.strip())
    return match.group(1) if match else None
