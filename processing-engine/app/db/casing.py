"""Key-casing converters for the CE /api facade.

The wire contract is pinned by the Phase 1 golden fixtures
(tests/contract/fixtures/): Mongo documents are PascalCase (.NET-written),
the frontend wire is camelCase (System.Text.Json CamelCase policy), and the
recipe engine speaks snake_case. Dict subtrees keyed by DATA (Metadata mast_*
keys, colorMapping filter names) must never be case-mangled — Metadata is
skipped by name, and snake_to_camel only rewrites keys containing an
underscore.
"""

import re
from datetime import datetime, timezone
from typing import Any


_CAMEL_BOUNDARY = re.compile(r"(?<!^)(?=[A-Z])")


def pascal_to_camel(key: str) -> str:
    """PascalCase -> camelCase, matching System.Text.Json: a LEADING RUN of
    capitals is lowercased as a unit (WCS -> wcs, WCSInfo -> wcsInfo)."""
    if not key or key[0].islower():
        return key
    run = 1
    while run < len(key) and key[run].isupper():
        run += 1
    # If the run is followed by a lowercase letter, the last capital starts
    # the next word and stays (WCSInfo -> wcs + Info).
    if run < len(key) and run > 1:
        run -= 1
    return key[:run].lower() + key[run:]


def snake_to_camel(key: str) -> str:
    """snake_case -> camelCase. Keys without underscores pass through
    verbatim so data-keyed dicts (filter names like F444W) are untouched."""
    if "_" not in key:
        return key
    head, *rest = key.split("_")
    return head + "".join(part.title() for part in rest)


def camel_to_snake(key: str) -> str:
    return _CAMEL_BOUNDARY.sub("_", key).lower()


def _iso_z(dt: datetime) -> str:
    """Serialize like System.Text.Json: ISO-8601 UTC with the fractional part
    trailing-zero-trimmed and omitted entirely when zero (verified against the
    live .NET API, which emits .9Z/.99Z/.999Z variants). Mongo datetimes are
    naive UTC."""
    if dt.tzinfo is not None:  # motor default is naive UTC; normalize if not
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    base = dt.isoformat(timespec="microseconds")
    head, frac = base.split(".")
    frac = frac.rstrip("0")
    return head + (f".{frac}" if frac else "") + "Z"


def _walk(obj: Any, key_fn, verbatim_keys: set[str]) -> Any:
    if isinstance(obj, datetime):
        return _iso_z(obj)
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in verbatim_keys:
                out[key_fn(k)] = v  # rename the container key, keep subtree
            else:
                out[key_fn(k)] = _walk(v, key_fn, verbatim_keys)
        return out
    if isinstance(obj, list):
        return [_walk(v, key_fn, verbatim_keys) for v in obj]
    return obj


def pascal_to_camel_keys(obj: Any, verbatim_keys: set[str] | frozenset[str] = frozenset()) -> Any:
    return _walk(obj, pascal_to_camel, set(verbatim_keys))


def snake_to_camel_keys(obj: Any) -> Any:
    return _walk(obj, snake_to_camel, set())


def camel_to_snake_keys(obj: Any) -> Any:
    return _walk(obj, camel_to_snake, set())
