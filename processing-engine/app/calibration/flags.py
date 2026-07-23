# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""Runtime feature gate for calibration runs.

Two independent gates (#1709 PR 4):
- build-time: the Docker ``INSTALL_CALIBRATION`` arg controls whether the
  ``jwst`` package layer exists in the image at all;
- runtime: the ``CALIBRATION_ENABLED`` env var lets an operator turn runs
  off without rebuilding.

Recipe browsing/CRUD works regardless — only *executing* runs is gated.
"""

import importlib.util
import os
from functools import lru_cache


def calibration_env_enabled() -> bool:
    return os.environ.get("CALIBRATION_ENABLED", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


@lru_cache(maxsize=1)
def jwst_available() -> bool:
    """Whether the jwst package is installed (build-time gate). Cached — the
    image contents cannot change at runtime."""
    return importlib.util.find_spec("jwst") is not None


@lru_cache(maxsize=1)
def jwst_version() -> str | None:
    if not jwst_available():
        return None
    from importlib.metadata import version

    return version("jwst")


def calibration_enabled() -> bool:
    return calibration_env_enabled() and jwst_available()
