"""Shared path containment and MAST URI validation."""

import os
import posixpath
import re
from pathlib import Path


_MAST_URI_PATTERN = re.compile(r"mast:[A-Za-z0-9_\-./]+")


def ensure_within(candidate: str | os.PathLike, root: str | os.PathLike) -> Path:
    """Return the resolved candidate if contained in the resolved root; otherwise raise."""
    full = Path(candidate).resolve()
    if not full.is_relative_to(Path(root).resolve()):
        raise ValueError("Path is outside storage root")
    return full


def validate_mast_uri(raw: str) -> str | None:
    """Return a normalized MAST URI, rejecting traversal and encoding before URL use."""
    if not raw or not raw.startswith("mast:"):
        return None
    path = posixpath.normpath(raw.removeprefix("mast:"))
    # Check the raw input too: normalization must not hide parent segments or
    # forbidden characters. Never URL-decode here; percent encoding is rejected.
    if not _MAST_URI_PATTERN.fullmatch(raw) or ".." in raw:
        return None
    if path == "." or path.startswith("/") or ".." in path:
        return None
    return f"mast:{path}"
