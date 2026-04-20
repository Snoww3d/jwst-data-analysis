"""Shared filename sanitizer for MAST downloaders.

Closes #1095: consolidates two duplicate ``_sanitize_filename`` implementations
in ``s3_downloader`` and ``chunked_downloader`` into one hardened helper that
closes URL-encoded (``%2e%2e``) and mid-name (``file..name``) double-dot
bypasses.
"""

from __future__ import annotations

import logging
import re
from pathlib import PurePosixPath
from urllib.parse import unquote


logger = logging.getLogger(__name__)

SAFE_FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9_\-.]+$")


def sanitize_filename(raw: str) -> str | None:
    """Return a sanitized filename, or ``None`` if the input is unsafe.

    Rejects anything with a ``..`` sequence (decoded), null bytes, path
    separators that survive basename extraction, or characters outside the
    whitelist. Call sites must still apply a containment check
    (``_is_path_within_directory``) as defense-in-depth.
    """
    if not raw:
        return None

    if "\x00" in raw:
        logger.warning("Filename contains null byte: rejected")
        return None

    decoded = unquote(raw)

    if ".." in decoded:
        logger.warning("Filename contains parent-directory reference: %.50s", raw)
        return None

    name = PurePosixPath(decoded.replace("\\", "/")).name.strip()

    if not name:
        return None

    if not SAFE_FILENAME_PATTERN.fullmatch(name):
        logger.warning("Filename contains invalid characters: %.50s", name)
        return None

    return name
