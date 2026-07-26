"""Tests for app.config typed environment-variable helpers (#1383, #1260, #1293)."""

from __future__ import annotations

import pytest

from app.config import (
    EnvVarError,
    cors_origins_env,
    float_env,
    int_env,
    positive_float_env,
    positive_int_env,
)


@pytest.fixture
def clean_env(monkeypatch):
    """Ensure no leftover env vars confuse a test case."""
    for var in ("TEST_INT_VAR", "TEST_FLOAT_VAR", "TEST_POS_VAR", "TEST_POS_FLOAT_VAR"):
        monkeypatch.delenv(var, raising=False)
    return monkeypatch


class TestIntEnv:
    @pytest.mark.usefixtures("clean_env")
    def test_returns_default_when_unset(self):
        assert int_env("TEST_INT_VAR", 42) == 42

    def test_returns_default_when_empty(self, clean_env):
        clean_env.setenv("TEST_INT_VAR", "")
        assert int_env("TEST_INT_VAR", 42) == 42

    def test_parses_valid_value(self, clean_env):
        clean_env.setenv("TEST_INT_VAR", "100")
        assert int_env("TEST_INT_VAR", 42) == 100

    def test_raises_on_non_numeric(self, clean_env):
        clean_env.setenv("TEST_INT_VAR", "abc")
        with pytest.raises(EnvVarError, match="TEST_INT_VAR='abc'") as exc:
            int_env("TEST_INT_VAR", 42)
        # Subclass of ValueError so existing `except ValueError` callers still catch it.
        assert isinstance(exc.value, ValueError)

    def test_negative_allowed(self, clean_env):
        """Plain int_env accepts negatives; positive_int_env is the strict variant."""
        clean_env.setenv("TEST_INT_VAR", "-5")
        assert int_env("TEST_INT_VAR", 42) == -5


class TestFloatEnv:
    @pytest.mark.usefixtures("clean_env")
    def test_returns_default_when_unset(self):
        assert float_env("TEST_FLOAT_VAR", 0.85) == 0.85

    def test_parses_valid_value(self, clean_env):
        clean_env.setenv("TEST_FLOAT_VAR", "0.5")
        assert float_env("TEST_FLOAT_VAR", 0.85) == 0.5

    def test_raises_on_non_numeric(self, clean_env):
        clean_env.setenv("TEST_FLOAT_VAR", "not-a-number")
        with pytest.raises(EnvVarError, match="TEST_FLOAT_VAR='not-a-number'"):
            float_env("TEST_FLOAT_VAR", 0.85)


class TestPositiveIntEnv:
    @pytest.mark.usefixtures("clean_env")
    def test_returns_default_when_unset(self):
        assert positive_int_env("TEST_POS_VAR", 100) == 100

    def test_rejects_zero(self, clean_env):
        clean_env.setenv("TEST_POS_VAR", "0")
        with pytest.raises(EnvVarError, match="must be a positive integer"):
            positive_int_env("TEST_POS_VAR", 100)

    def test_rejects_negative(self, clean_env):
        clean_env.setenv("TEST_POS_VAR", "-1")
        with pytest.raises(EnvVarError, match="must be a positive integer"):
            positive_int_env("TEST_POS_VAR", 100)

    def test_accepts_positive(self, clean_env):
        clean_env.setenv("TEST_POS_VAR", "50")
        assert positive_int_env("TEST_POS_VAR", 100) == 50


class TestPositiveFloatEnv:
    @pytest.mark.usefixtures("clean_env")
    def test_returns_default_when_unset(self):
        assert positive_float_env("TEST_POS_FLOAT_VAR", 15.0) == 15.0

    def test_rejects_zero(self, clean_env):
        clean_env.setenv("TEST_POS_FLOAT_VAR", "0")
        with pytest.raises(EnvVarError, match="must be a positive number"):
            positive_float_env("TEST_POS_FLOAT_VAR", 15.0)

    def test_rejects_negative(self, clean_env):
        clean_env.setenv("TEST_POS_FLOAT_VAR", "-0.5")
        with pytest.raises(EnvVarError, match="must be a positive number"):
            positive_float_env("TEST_POS_FLOAT_VAR", 15.0)

    def test_accepts_positive(self, clean_env):
        clean_env.setenv("TEST_POS_FLOAT_VAR", "0.25")
        assert positive_float_env("TEST_POS_FLOAT_VAR", 15.0) == 0.25

    def test_raises_on_non_numeric(self, clean_env):
        clean_env.setenv("TEST_POS_FLOAT_VAR", "soon")
        with pytest.raises(EnvVarError, match="TEST_POS_FLOAT_VAR='soon'"):
            positive_float_env("TEST_POS_FLOAT_VAR", 15.0)


class TestCorsOriginsEnv:
    @pytest.fixture
    def cors_env(self, monkeypatch):
        monkeypatch.delenv("TEST_CORS_VAR", raising=False)
        return monkeypatch

    @pytest.mark.usefixtures("cors_env")
    def test_default_covers_both_loopback_spellings(self):
        origins = cors_origins_env("TEST_CORS_VAR")
        # 127.0.0.1 and localhost are distinct browser origins; the .NET
        # gateway allows both, so the engine must not be stricter.
        assert origins == [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
        ]

    @pytest.mark.usefixtures("cors_env")
    def test_falls_back_to_default_when_unset(self):
        assert cors_origins_env("TEST_CORS_VAR", "http://a.test") == ["http://a.test"]

    def test_falls_back_to_default_when_blank(self, cors_env):
        cors_env.setenv("TEST_CORS_VAR", "   ")
        assert cors_origins_env("TEST_CORS_VAR", "http://a.test") == ["http://a.test"]

    def test_strips_whitespace_and_drops_empty_entries(self, cors_env):
        cors_env.setenv("TEST_CORS_VAR", " http://a.test , ,http://b.test, ")
        assert cors_origins_env("TEST_CORS_VAR") == ["http://a.test", "http://b.test"]

    def test_rejects_wildcard(self, cors_env):
        # allow_credentials=True + "*" would make Starlette echo any origin.
        cors_env.setenv("TEST_CORS_VAR", "*")
        with pytest.raises(EnvVarError, match="must not contain"):
            cors_origins_env("TEST_CORS_VAR")

    def test_rejects_wildcard_hidden_in_a_list(self, cors_env):
        cors_env.setenv("TEST_CORS_VAR", "http://a.test, * ")
        with pytest.raises(EnvVarError, match="must not contain"):
            cors_origins_env("TEST_CORS_VAR")
