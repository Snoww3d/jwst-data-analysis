"""Typed environment variable helpers with clear startup errors.

The default pattern `int(os.environ.get("FOO", "100"))` raises a bare
`ValueError("invalid literal for int() with base 10: 'abc'")` when a
deployer sets `FOO=abc`. The trace points at the cast, not at the
config key, so operators spend time hunting for which env var is
malformed.

These helpers wrap the cast and re-raise with a clear, named message
the moment the process starts. (#1260, #1293, #1383)
"""

from __future__ import annotations

import os


class EnvVarError(ValueError):
    """Raised when an environment variable cannot be parsed to the expected type.

    Subclass of ValueError so existing `except ValueError` callers still
    catch it, but the type is distinct enough for clean startup-level
    handling in `main.py`.
    """


def int_env(name: str, default: int) -> int:
    """Read ``name`` from the environment as an int, falling back to ``default``.

    Raises EnvVarError with a clear, name-tagged message if the value is set
    but doesn't parse — instead of the default ValueError that names neither
    the offending key nor the actual value.
    """
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise EnvVarError(
            f"Environment variable {name}={raw!r} is not a valid integer "
            f"(expected an int, default {default})."
        ) from exc


def float_env(name: str, default: float) -> float:
    """Read ``name`` as a float, falling back to ``default``."""
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise EnvVarError(
            f"Environment variable {name}={raw!r} is not a valid float "
            f"(expected a number, default {default})."
        ) from exc


def positive_int_env(name: str, default: int) -> int:
    """Read ``name`` as a positive int. Raises EnvVarError if ≤ 0."""
    value = int_env(name, default)
    if value <= 0:
        raise EnvVarError(f"Environment variable {name}={value} must be a positive integer.")
    return value
