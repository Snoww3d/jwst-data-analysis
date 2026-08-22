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

import math
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


_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})
_FALSE_VALUES = frozenset({"0", "false", "no", "off"})


def bool_env(name: str, default: bool) -> bool:
    """Read ``name`` as a boolean, falling back to ``default``.

    Accepts 1/true/yes/on and 0/false/no/off, case-insensitive. Anything else
    raises rather than silently reading as False — a typo'd ``MAST_CACHE_ENABLED=ture``
    should not quietly leave a feature switched off.
    """
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    normalized = raw.strip().lower()
    if normalized in _TRUE_VALUES:
        return True
    if normalized in _FALSE_VALUES:
        return False
    raise EnvVarError(
        f"Environment variable {name}={raw!r} is not a valid boolean "
        f"(expected one of true/false/1/0/yes/no/on/off, default {default})."
    )


def positive_int_env(name: str, default: int) -> int:
    """Read ``name`` as a positive int. Raises EnvVarError if ≤ 0."""
    value = int_env(name, default)
    if value <= 0:
        raise EnvVarError(f"Environment variable {name}={value} must be a positive integer.")
    return value


def nonnegative_int_env(name: str, default: int) -> int:
    """Read ``name`` as an int >= 0. Raises EnvVarError if negative.

    For a queue DEPTH, 0 is legitimate ("no queue — shed immediately when every
    slot is busy") but negative is not: it silently shrinks the semaphore that
    is sized from it, which can mean every request 429s forever with no startup
    error at all.
    """
    value = int_env(name, default)
    if value < 0:
        raise EnvVarError(
            f"Environment variable {name}={value} must be zero or a positive integer."
        )
    return value


def positive_float_env(name: str, default: float) -> float:
    """Read ``name`` as a positive float. Raises EnvVarError if ≤ 0.

    Same reasoning as positive_int_env: for a timeout/window, a 0 or negative
    value is never a meaningful configuration — it silently turns "wait, then
    give up" into "give up immediately", which is far worse than refusing to
    start. ``nan``/``inf`` are rejected for the mirror-image reason: float()
    parses them happily, ``nan <= 0`` is False, and either one turns a bounded
    wait into an unbounded one.
    """
    value = float_env(name, default)
    if not math.isfinite(value) or value <= 0:
        raise EnvVarError(f"Environment variable {name}={value} must be a positive, finite number.")
    return value


def nonnegative_float_env(name: str, default: float) -> float:
    """Read ``name`` as a float >= 0. Raises EnvVarError if negative or non-finite.

    The float mirror of nonnegative_int_env, for knobs where 0 is a deliberate
    "off" (a disk-space FLOOR of 0 means "don't gate on free space") but a
    negative or ``nan`` value is always a misconfiguration — ``nan`` in
    particular makes every comparison against it false, which reads as "off"
    while looking like a real threshold.
    """
    value = float_env(name, default)
    if not math.isfinite(value) or value < 0:
        raise EnvVarError(
            f"Environment variable {name}={value} must be zero or a positive, finite number."
        )
    return value


# Browser origins allowed to call the engine directly. Kept in sync with the
# .NET gateway's default (docker/.env.example): 127.0.0.1 and localhost are
# distinct origins to a browser, so both spellings must be listed.
DEFAULT_CORS_ORIGINS = (
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173"
)


def cors_origins_env(
    name: str = "CORS_ALLOWED_ORIGINS", default: str = DEFAULT_CORS_ORIGINS
) -> list[str]:
    """Read ``name`` as a comma-separated CORS allow-list.

    Whitespace is stripped and empty entries dropped. ``*`` is rejected
    outright: the engine sends ``allow_credentials=True``, and Starlette
    responds to a wildcard by echoing back whatever ``Origin`` the request
    carried — credentialed CORS open to every site on the internet. A comment
    saying "never set this to *" is not a control, so this raises instead.

    Prefer the Vite dev-server proxy (same-origin, no CORS) for LAN/phone
    testing over widening this list.
    """
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        raw = default
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    if "*" in origins:
        raise EnvVarError(
            f"Environment variable {name} must not contain '*'. The engine allows "
            "credentialed requests, so a wildcard would echo back any origin and "
            "expose authenticated endpoints to every site. List explicit origins."
        )
    return origins
