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

# Windows reserved device names. Runtime is Linux-only today, but rejecting
# these protects contributors on Windows and any downstream sync to a
# Windows share.
_WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)


def sanitize_filename(raw: str) -> str | None:
    """Return a sanitized filename, or ``None`` if the input is unsafe.

    Rejects anything with a ``..`` sequence (decoded), null bytes (raw or
    percent-encoded), path separators that survive basename extraction, or
    characters outside the whitelist. Call sites must still apply a
    containment check (``_is_path_within_directory``) as defense-in-depth.

    Accepts URL-encoded inputs by design so encoded traversal (``%2e%2e``)
    is decoded and rejected; MAST filenames themselves are plain ASCII,
    not URLs, so decoding here hardens against bypass rather than inviting
    callers to pass URLs.
    """
    if not raw:
        return None

    # Bounded unquote loop: catches multi-level encodings like `%252e%252e`
    # that would otherwise survive a single `unquote` pass as `%2e%2e` and
    # slip past the `..` check once the directory portion is stripped off.
    decoded = raw
    for _ in range(4):
        nxt = unquote(decoded)
        if nxt == decoded:
            break
        decoded = nxt

    if "\x00" in raw or "\x00" in decoded:
        logger.warning("Filename contains null byte: rejected")
        return None

    # Reject non-ASCII to block Unicode lookalikes (fullwidth `．．` U+FF0E,
    # one-dot leader U+2024, etc.) and overlong UTF-8 that decodes to U+FFFD.
    # MAST filenames are plain ASCII — non-ASCII input is never legitimate here.
    if not decoded.isascii():
        logger.warning("Filename contains non-ASCII characters: %.50s", raw)
        return None

    if ".." in decoded:
        logger.warning("Filename contains parent-directory reference: %.50s", raw)
        return None

    name = PurePosixPath(decoded.replace("\\", "/")).name.strip()

    if not name:
        return None

    if not SAFE_FILENAME_PATTERN.fullmatch(name):
        logger.warning("Filename contains invalid characters: %.50s", name)
        return None

    # Reject leading '-' so a downstream subprocess call can't mistake the
    # filename for a CLI flag (e.g. `-rf`, `-oProxyCommand=...`).
    if name.startswith("-"):
        logger.warning("Filename starts with dash (flag-injection risk): %.50s", name)
        return None

    # Reject Windows reserved device names (case-insensitive, any extension).
    stem = name.split(".", 1)[0].upper()
    if stem in _WINDOWS_RESERVED_NAMES:
        logger.warning("Filename uses Windows reserved name: %.50s", name)
        return None

    return name
