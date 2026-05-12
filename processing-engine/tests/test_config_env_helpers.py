"""Tests for app.config typed environment-variable helpers (#1383, #1260, #1293)."""

from __future__ import annotations

import pytest

from app.config import EnvVarError, float_env, int_env, positive_int_env


@pytest.fixture
def clean_env(monkeypatch):
    """Ensure no leftover env vars confuse a test case."""
    for var in ("TEST_INT_VAR", "TEST_FLOAT_VAR", "TEST_POS_VAR"):
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
