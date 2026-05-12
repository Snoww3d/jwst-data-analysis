"""
Tests for the N-channel composite API endpoint (B3.2).

Tests the /composite/generate-nchannel route, cache key generation,
the color resolution helper, and the extracted pipeline functions.
"""

import io
from unittest.mock import patch

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.composite.cache import CompositeCache
from app.composite.color_mapping import blend_luminance, hsl_to_rgb, rgb_to_hsl
from app.composite.models import (
    ChannelColor,
    NChannelCompositeRequest,
    NChannelConfig,
    SharpeningConfig,
)
from app.composite.routes import (
    StretchResult,
    _build_coverage_mask,
    _combine_to_rgb,
    _detect_channel_instruments,
    _encode_and_respond,
    _render_debug_masks_response,
    _resolve_feather_strength,
    _stretch_and_map_channels,
    apply_sharpening,
    resolve_channel_color,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_test_data(shape=(100, 100), value=1000.0):
    """Create synthetic FITS-like 2D data."""
    rng = np.random.default_rng(42)
    return rng.normal(loc=value, scale=100, size=shape).astype(np.float64)


# ---------------------------------------------------------------------------
# Unit tests for resolve_channel_color
# ---------------------------------------------------------------------------


class TestResolveChannelColor:
    """Tests for the color resolution helper."""

    def test_hue_resolves_to_rgb(self):
        color = ChannelColor(hue=0.0)
        r, g, b = resolve_channel_color(color)
        assert r == pytest.approx(1.0)
        assert g == pytest.approx(0.0)
        assert b == pytest.approx(0.0)

    def test_hue_120_resolves_to_green(self):
        color = ChannelColor(hue=120.0)
        r, g, b = resolve_channel_color(color)
        assert r == pytest.approx(0.0)
        assert g == pytest.approx(1.0)
        assert b == pytest.approx(0.0)

    def test_explicit_rgb_returned_directly(self):
        color = ChannelColor(rgb=(0.3, 0.6, 0.9))
        result = resolve_channel_color(color)
        assert result == (0.3, 0.6, 0.9)

    def test_rgb_takes_precedence_format(self):
        """When rgb is provided, it's returned as-is (tuple)."""
        color = ChannelColor(rgb=(0.0, 0.0, 0.0))
        result = resolve_channel_color(color)
        assert result == (0.0, 0.0, 0.0)

    def test_luminance_returns_none(self):
        """Luminance channel resolves to None (no RGB weights)."""
        color = ChannelColor(luminance=True)
        result = resolve_channel_color(color)
        assert result is None


# ---------------------------------------------------------------------------
# Unit tests for HSL blending
# ---------------------------------------------------------------------------


class TestHSLBlending:
    """Tests for rgb_to_hsl, hsl_to_rgb, and blend_luminance."""

    def test_rgb_to_hsl_red(self):
        """Pure red → H=0, S=1, L=0.5."""
        rgb = np.zeros((1, 1, 3))
        rgb[0, 0] = [1.0, 0.0, 0.0]
        h, s, lit = rgb_to_hsl(rgb)
        assert h[0, 0] == pytest.approx(0.0, abs=1e-6)
        assert s[0, 0] == pytest.approx(1.0, abs=1e-6)
        assert lit[0, 0] == pytest.approx(0.5, abs=1e-6)

    def test_rgb_to_hsl_green(self):
        """Pure green → H≈0.333, S=1, L=0.5."""
        rgb = np.zeros((1, 1, 3))
        rgb[0, 0] = [0.0, 1.0, 0.0]
        h, s, lit = rgb_to_hsl(rgb)
        assert h[0, 0] == pytest.approx(1.0 / 3.0, abs=1e-6)
        assert s[0, 0] == pytest.approx(1.0, abs=1e-6)
        assert lit[0, 0] == pytest.approx(0.5, abs=1e-6)

    def test_roundtrip(self):
        """RGB → HSL → RGB preserves values."""
        rng = np.random.default_rng(123)
        rgb_orig = rng.uniform(0, 1, size=(10, 10, 3))
        h, s, lit = rgb_to_hsl(rgb_orig)
        rgb_back = hsl_to_rgb(h, s, lit)
        np.testing.assert_allclose(rgb_back, rgb_orig, atol=1e-5)

    def test_blend_luminance_identity(self):
        """weight=0 returns the original color image."""
        rng = np.random.default_rng(42)
        color = rng.uniform(0, 1, size=(5, 5, 3))
        lum = rng.uniform(0, 1, size=(5, 5))
        result = blend_luminance(color, lum, weight=0.0)
        np.testing.assert_allclose(result, color, atol=1e-5)

    def test_blend_luminance_full(self):
        """weight=1 replaces the L channel entirely."""
        # Create a uniform color (red, L=0.5) and blend with white luminance (L=1.0)
        color = np.full((3, 3, 3), 0.0)
        color[:, :, 0] = 1.0  # pure red
        lum = np.ones((3, 3))  # max luminance

        result = blend_luminance(color, lum, weight=1.0)
        # With L=1 the result should be white (H/S don't matter when L=1)
        np.testing.assert_allclose(result, 1.0, atol=1e-5)

    def test_blend_luminance_preserves_hue(self):
        """Blending luminance preserves hue of the color channels."""
        # Create pure green image
        color = np.zeros((3, 3, 3))
        color[:, :, 1] = 1.0  # green
        lum = np.full((3, 3), 0.5)

        result = blend_luminance(color, lum, weight=1.0)
        # Hue should still be green — check that green channel >= other channels
        assert np.all(result[:, :, 1] >= result[:, :, 0] - 1e-6)
        assert np.all(result[:, :, 1] >= result[:, :, 2] - 1e-6)


# ---------------------------------------------------------------------------
# Unit tests for N-channel cache key
# ---------------------------------------------------------------------------


class TestNCacheKey:
    """Tests for CompositeCache.make_key_nchannel."""

    def test_deterministic(self):
        paths = [["a.fits"], ["b.fits"]]
        k1 = CompositeCache.make_key_nchannel(paths, 1000)
        k2 = CompositeCache.make_key_nchannel(paths, 1000)
        assert k1 == k2

    def test_different_budget_different_key(self):
        paths = [["a.fits"], ["b.fits"]]
        k1 = CompositeCache.make_key_nchannel(paths, 1000)
        k2 = CompositeCache.make_key_nchannel(paths, 2000)
        assert k1 != k2

    def test_different_paths_different_key(self):
        k1 = CompositeCache.make_key_nchannel([["a.fits"]], 1000)
        k2 = CompositeCache.make_key_nchannel([["b.fits"]], 1000)
        assert k1 != k2

    def test_path_order_within_channel_irrelevant(self):
        """Sorted within each channel, so order doesn't matter."""
        k1 = CompositeCache.make_key_nchannel([["b.fits", "a.fits"]], 1000)
        k2 = CompositeCache.make_key_nchannel([["a.fits", "b.fits"]], 1000)
        assert k1 == k2

    def test_channel_order_matters(self):
        """Different channel ordering should produce different keys."""
        k1 = CompositeCache.make_key_nchannel([["a.fits"], ["b.fits"]], 1000)
        k2 = CompositeCache.make_key_nchannel([["b.fits"], ["a.fits"]], 1000)
        assert k1 != k2


class TestCacheProvenance:
    """Tests for cache entries carrying original_shape provenance so cache hits
    of force-downscaled results can surface the warning to users who didn't
    opt in themselves."""

    def test_put_and_get_round_trip_with_original_shape(self):
        """cache.put accepts original_shape; cache.get returns it alongside
        the cached channel arrays."""
        cache = CompositeCache()
        key = CompositeCache.make_key_nchannel([["a.fits"]], 1000)
        channels = {"ch0": np.zeros((100, 100), dtype=np.float64)}
        cache.put(key, channels, channel_paths=[["a.fits"]], original_shape=(500, 500))

        result = cache.get(key)
        assert result is not None
        cached_channels, original_shape = result
        assert "ch0" in cached_channels
        assert original_shape == (500, 500)

    def test_put_without_original_shape_returns_none_provenance(self):
        """Backward compat: omitting original_shape stores None so legacy
        callers and warn/ok paths don't lie about a force-downscale."""
        cache = CompositeCache()
        key = CompositeCache.make_key_nchannel([["a.fits"]], 1000)
        channels = {"ch0": np.zeros((100, 100), dtype=np.float64)}
        cache.put(key, channels, channel_paths=[["a.fits"]])

        result = cache.get(key)
        assert result is not None
        _cached_channels, original_shape = result
        assert original_shape is None

    def test_get_any_budget_returns_provenance(self):
        """Cross-budget fallback hit also surfaces original_shape so /generate
        can emit forced headers from a different-budget cache hit."""
        cache = CompositeCache()
        key = CompositeCache.make_key_nchannel([["a.fits"]], 1000)
        channels = {"ch0": np.zeros((100, 100), dtype=np.float64)}
        cache.put(key, channels, channel_paths=[["a.fits"]], original_shape=(500, 500))

        result = cache.get_any_budget([["a.fits"]])
        assert result is not None
        _cached_channels, original_shape = result
        assert original_shape == (500, 500)

    def test_get_miss_returns_none(self):
        """Miss still returns None (not a tuple of (None, None))."""
        cache = CompositeCache()
        assert cache.get("nonexistent_key") is None
        assert cache.get_any_budget([["nonexistent.fits"]]) is None


# ---------------------------------------------------------------------------
# Model validation tests
# ---------------------------------------------------------------------------


class TestNChannelRequestModel:
    """Tests for NChannelCompositeRequest validation."""

    def test_valid_minimal_request(self):
        req = NChannelCompositeRequest(
            channels=[
                NChannelConfig(
                    file_paths=["test.fits"],
                    color=ChannelColor(hue=0.0),
                )
            ]
        )
        assert len(req.channels) == 1

    def test_valid_multi_channel_request(self):
        req = NChannelCompositeRequest(
            channels=[
                NChannelConfig(
                    file_paths=["f090w.fits"],
                    color=ChannelColor(hue=240.0),
                    label="F090W",
                    wavelength_um=0.9,
                ),
                NChannelConfig(
                    file_paths=["f200w.fits"],
                    color=ChannelColor(hue=120.0),
                    label="F200W",
                    wavelength_um=2.0,
                ),
                NChannelConfig(
                    file_paths=["f444w.fits"],
                    color=ChannelColor(hue=0.0),
                    label="F444W",
                    wavelength_um=4.44,
                ),
            ]
        )
        assert len(req.channels) == 3
        assert req.channels[0].label == "F090W"

    def test_empty_channels_rejected(self):
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="at least 1"):
            NChannelCompositeRequest(channels=[])

    def test_inherits_stretch_defaults(self):
        """NChannelConfig inherits ChannelConfig defaults."""
        config = NChannelConfig(
            file_paths=["test.fits"],
            color=ChannelColor(hue=0.0),
        )
        assert config.stretch == "asinh"
        assert config.weight == 1.0
        assert config.gamma == 1.0

    def test_allow_force_downscale_defaults_false(self):
        """allow_force_downscale opts in to bypassing the 413 guardrail; the
        default is False so existing flows refuse heavy downscale as before."""
        req = NChannelCompositeRequest(
            channels=[NChannelConfig(file_paths=["test.fits"], color=ChannelColor(hue=0.0))]
        )
        assert req.allow_force_downscale is False

    def test_allow_force_downscale_accepts_true(self):
        """allow_force_downscale=true is honored on the request model."""
        req = NChannelCompositeRequest(
            channels=[NChannelConfig(file_paths=["test.fits"], color=ChannelColor(hue=0.0))],
            allow_force_downscale=True,
        )
        assert req.allow_force_downscale is True

    def test_rgb_color_spec(self):
        """Channels can use explicit RGB instead of hue."""
        req = NChannelCompositeRequest(
            channels=[
                NChannelConfig(
                    file_paths=["test.fits"],
                    color=ChannelColor(rgb=(0.5, 0.2, 0.8)),
                )
            ]
        )
        assert req.channels[0].color.rgb == (0.5, 0.2, 0.8)

    def test_luminance_channel_valid(self):
        """A channel with luminance=True is accepted."""
        req = NChannelCompositeRequest(
            channels=[
                NChannelConfig(
                    file_paths=["color.fits"],
                    color=ChannelColor(hue=0.0),
                ),
                NChannelConfig(
                    file_paths=["lum.fits"],
                    color=ChannelColor(luminance=True),
                    label="Luminance",
                ),
            ]
        )
        assert req.channels[1].color.luminance is True
        assert req.channels[1].color.hue is None
        assert req.channels[1].color.rgb is None

    def test_luminance_with_hue_rejected(self):
        """Cannot set both luminance=True and hue."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="only one"):
            ChannelColor(hue=120.0, luminance=True)

    def test_luminance_with_rgb_rejected(self):
        """Cannot set both luminance=True and rgb."""
        from pydantic import ValidationError

        with pytest.raises(ValidationError, match="only one"):
            ChannelColor(rgb=(1.0, 0.0, 0.0), luminance=True)


# ---------------------------------------------------------------------------
# Integration tests for the endpoint
# ---------------------------------------------------------------------------


class TestGenerateNChannelEndpoint:
    """Integration tests for POST /composite/generate-nchannel."""

    @pytest.fixture()
    def client(self):
        from main import app

        return TestClient(app)

    @pytest.fixture()
    def mock_pipeline(self):
        """Mock the composite cache to return pre-computed channel data.

        The new single-reprojection pipeline builds reprojected_channels
        directly. Mocking the cache bypass avoids needing to mock the
        entire WCS collection + streaming pipeline.
        """
        shape = (50, 50)
        data = _make_test_data(shape)
        default_channels = {f"ch{i}": data.copy() for i in range(6)}

        class FakeCache:
            def __init__(self):
                self._data = default_channels
                self._original_shape: tuple[int, int] | None = None

            def make_key_nchannel(self, *_args, **_kwargs):
                return "fake-key"

            def get(self, _key):
                # New contract (post-#1450): (channels, original_shape) | None.
                # Tests can set ``_data`` to None to simulate a miss.
                if self._data is None:
                    return None
                return self._data, self._original_shape

            def get_any_budget(self, _paths):
                return None

            def put(self, _key, _data, _paths, original_shape=None):
                self._original_shape = original_shape

            @property
            def return_value(self):
                return self._data

            @return_value.setter
            def return_value(self, value):
                # Accept (dict, shape) tuples for back-compat with tests
                if isinstance(value, tuple):
                    self._data = value[0]
                else:
                    self._data = value

        fake_cache = FakeCache()

        with patch("app.composite.routes._cache", fake_cache):
            yield fake_cache

    def test_single_channel_returns_image(self, client, mock_pipeline):
        # Override reproject mock for single channel
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = ({"ch0": data}, shape)

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [
                    {
                        "file_paths": ["test.fits"],
                        "color": {"hue": 120.0},
                    }
                ],
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"

        # Verify it's a valid PNG
        img = Image.open(response)
        assert img.size == (100, 100)

    def test_three_channel_rgb_equivalent(self, client, mock_pipeline):
        """3-channel with R/G/B hues should produce a valid composite."""
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = (
            {"ch0": data.copy(), "ch1": data.copy(), "ch2": data.copy()},
            shape,
        )

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [
                    {"file_paths": ["r.fits"], "color": {"hue": 0.0}, "label": "Red"},
                    {
                        "file_paths": ["g.fits"],
                        "color": {"hue": 120.0},
                        "label": "Green",
                    },
                    {
                        "file_paths": ["b.fits"],
                        "color": {"hue": 240.0},
                        "label": "Blue",
                    },
                ],
                "width": 200,
                "height": 200,
            },
        )
        assert response.status_code == 200
        img = Image.open(response)
        assert img.size == (200, 200)

    def test_five_channel_composite(self, client, mock_pipeline):
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = (
            {f"ch{i}": data.copy() for i in range(5)},
            shape,
        )

        channels = [{"file_paths": [f"f{i}.fits"], "color": {"hue": i * 60.0}} for i in range(5)]
        response = client.post(
            "/composite/generate-nchannel",
            json={"channels": channels, "width": 150, "height": 150},
        )
        assert response.status_code == 200
        img = Image.open(response)
        assert img.size == (150, 150)

    def test_jpeg_output(self, client, mock_pipeline):
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = ({"ch0": data}, shape)

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [{"file_paths": ["test.fits"], "color": {"hue": 60.0}}],
                "output_format": "jpeg",
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"

    def test_explicit_rgb_color(self, client, mock_pipeline):
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = ({"ch0": data}, shape)

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [
                    {
                        "file_paths": ["test.fits"],
                        "color": {"rgb": [0.5, 0.3, 0.8]},
                    }
                ],
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200

    def test_with_overall_adjustments(self, client, mock_pipeline):
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = ({"ch0": data}, shape)

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [{"file_paths": ["test.fits"], "color": {"hue": 0.0}}],
                "overall": {
                    "stretch": "asinh",
                    "black_point": 0.05,
                    "white_point": 0.95,
                },
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200

    def test_with_sharpening_enabled(self, client, mock_pipeline):
        """Sharpening config flows through the endpoint and returns a valid image."""
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = ({"ch0": data}, shape)

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [{"file_paths": ["test.fits"], "color": {"hue": 0.0}}],
                "sharpening": {"radius": 1.5, "amount": 0.8, "threshold": 0.01},
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"

    def test_sharpening_end_to_end_multi_channel(self, client, mock_pipeline):
        """Multi-channel + background_neutralization + sharpening runs the full
        orchestrator path: `_build_coverage_mask` unions multiple channels and
        feeds the result to `apply_sharpening`."""
        shape = (50, 50)
        rng = np.random.default_rng(123)
        # Three distinct channels so the coverage mask is a meaningful union.
        mock_pipeline.return_value = (
            {
                "ch0": rng.normal(1000, 100, shape).astype(np.float64),
                "ch1": rng.normal(1000, 100, shape).astype(np.float64),
                "ch2": rng.normal(1000, 100, shape).astype(np.float64),
            },
            shape,
        )

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [
                    {"file_paths": ["r.fits"], "color": {"hue": 0.0}, "label": "R"},
                    {"file_paths": ["g.fits"], "color": {"hue": 120.0}, "label": "G"},
                    {"file_paths": ["b.fits"], "color": {"hue": 240.0}, "label": "B"},
                ],
                "background_neutralization": True,
                "sharpening": {"radius": 2.0, "amount": 1.0, "threshold": 0.0},
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        img = Image.open(io.BytesIO(response.content))
        assert img.size == (100, 100)

    def test_sharpening_out_of_range_returns_422(self, client):
        """Amount > 3 is rejected by pydantic validation (no pipeline mock needed)."""
        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [{"file_paths": ["test.fits"], "color": {"hue": 0.0}}],
                "sharpening": {"amount": 5.0},
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 422

    def test_with_saturation_enabled(self, client, mock_pipeline):
        """Saturation config flows through the endpoint and returns a valid image."""
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = ({"ch0": data}, shape)

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [{"file_paths": ["test.fits"], "color": {"hue": 0.0}}],
                "saturation": {"saturation": 1.5, "vibrancy": 0.3, "hue_rotation": 10.0},
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"

    def test_saturation_identity_matches_no_config(self, client, mock_pipeline):
        """Default saturation config (1.0/0.0/0.0) should produce identical output."""
        shape = (50, 50)
        rng = np.random.default_rng(42)
        data = rng.normal(1000, 100, shape).astype(np.float64)
        mock_pipeline.return_value = ({"ch0": data}, shape)

        base_request = {
            "channels": [{"file_paths": ["test.fits"], "color": {"hue": 120.0}}],
            "width": 100,
            "height": 100,
        }

        response_no_sat = client.post("/composite/generate-nchannel", json=base_request)
        response_identity = client.post(
            "/composite/generate-nchannel",
            json={
                **base_request,
                "saturation": {"saturation": 1.0, "vibrancy": 0.0, "hue_rotation": 0.0},
            },
        )
        assert response_no_sat.status_code == 200
        assert response_identity.status_code == 200
        assert response_no_sat.content == response_identity.content

    def test_saturation_out_of_range_returns_422(self, client):
        """saturation > 2.0 is rejected by pydantic validation."""
        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [{"file_paths": ["test.fits"], "color": {"hue": 0.0}}],
                "saturation": {"saturation": 5.0},
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 422

    def test_hue_rotation_out_of_range_returns_422(self, client):
        """hue_rotation outside [-30, 30] is rejected."""
        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [{"file_paths": ["test.fits"], "color": {"hue": 0.0}}],
                "saturation": {"hue_rotation": 200.0},
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 422

    def test_background_neutralization_disabled(self, client, mock_pipeline):
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = ({"ch0": data}, shape)

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [{"file_paths": ["test.fits"], "color": {"hue": 0.0}}],
                "background_neutralization": False,
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200

    def test_empty_channels_returns_422(self, client):
        response = client.post(
            "/composite/generate-nchannel",
            json={"channels": []},
        )
        assert response.status_code == 422

    def test_missing_color_returns_422(self, client):
        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [{"file_paths": ["test.fits"]}],
            },
        )
        assert response.status_code == 422

    def test_with_channel_weight(self, client, mock_pipeline):
        """Per-channel weight is applied to the stretched data."""
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = ({"ch0": data}, shape)

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [
                    {
                        "file_paths": ["test.fits"],
                        "color": {"hue": 0.0},
                        "weight": 0.5,
                    }
                ],
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200

    def test_with_labels_and_wavelength(self, client, mock_pipeline):
        """Labels and wavelength metadata are accepted."""
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = (
            {"F090W": data.copy(), "F444W": data.copy()},
            shape,
        )

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [
                    {
                        "file_paths": ["f090w.fits"],
                        "color": {"hue": 240.0},
                        "label": "F090W",
                        "wavelength_um": 0.9,
                    },
                    {
                        "file_paths": ["f444w.fits"],
                        "color": {"hue": 0.0},
                        "label": "F444W",
                        "wavelength_um": 4.44,
                    },
                ],
                "width": 200,
                "height": 200,
            },
        )
        assert response.status_code == 200

    def test_lrgb_composite(self, client, mock_pipeline):
        """3 color + 1 luminance channel produces a valid image."""
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = (
            {
                "Red": data.copy(),
                "Green": data.copy(),
                "Blue": data.copy(),
                "Lum": data.copy(),
            },
            shape,
        )

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [
                    {"file_paths": ["r.fits"], "color": {"hue": 0.0}, "label": "Red"},
                    {"file_paths": ["g.fits"], "color": {"hue": 120.0}, "label": "Green"},
                    {"file_paths": ["b.fits"], "color": {"hue": 240.0}, "label": "Blue"},
                    {
                        "file_paths": ["lum.fits"],
                        "color": {"luminance": True},
                        "label": "Lum",
                        "weight": 0.8,
                    },
                ],
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 200
        img = Image.open(response)
        assert img.size == (100, 100)

    def test_multiple_luminance_rejected(self, client, mock_pipeline):
        """Two luminance channels should be rejected with 422."""
        shape = (50, 50)
        data = _make_test_data(shape)
        mock_pipeline.return_value = (
            {"ch0": data.copy(), "ch1": data.copy(), "ch2": data.copy()},
            shape,
        )

        response = client.post(
            "/composite/generate-nchannel",
            json={
                "channels": [
                    {"file_paths": ["color.fits"], "color": {"hue": 0.0}},
                    {"file_paths": ["lum1.fits"], "color": {"luminance": True}},
                    {"file_paths": ["lum2.fits"], "color": {"luminance": True}},
                ],
                "width": 100,
                "height": 100,
            },
        )
        assert response.status_code == 422
        assert "luminance" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Unit tests for extracted pipeline functions (#963, #1002)
# ---------------------------------------------------------------------------


class TestDetectChannelInstruments:
    """Tests for _detect_channel_instruments."""

    def test_returns_none_on_missing_file(self):
        """Unresolvable file paths produce None (not an exception)."""
        channels = [
            NChannelConfig(file_paths=["nonexistent.fits"], color=ChannelColor(hue=0.0)),
        ]
        result = _detect_channel_instruments(channels)
        assert result == [None]
        assert len(result) == 1

    def test_returns_none_per_channel(self):
        """Multiple channels with bad paths all get None."""
        channels = [
            NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=0.0)),
            NChannelConfig(file_paths=["b.fits"], color=ChannelColor(hue=120.0)),
        ]
        result = _detect_channel_instruments(channels)
        assert result == [None, None]

    def test_returns_instrument_when_resolvable(self):
        """Mock a successful header read to verify instrument is returned."""
        channels = [
            NChannelConfig(file_paths=["test.fits"], color=ChannelColor(hue=0.0)),
        ]
        with (
            patch("app.composite.routes.resolve_fits_path", return_value="test.fits"),
            patch(
                "app.composite.routes.load_fits_wcs_shape_and_instrument",
                return_value=(None, 100, 100, "NIRCAM"),
            ),
        ):
            result = _detect_channel_instruments(channels)
        assert result == ["NIRCAM"]

    def test_mixed_resolvable_and_missing(self):
        """One valid channel, one bad — returns [instrument, None]."""
        channels = [
            NChannelConfig(file_paths=["good.fits"], color=ChannelColor(hue=0.0)),
            NChannelConfig(file_paths=["bad.fits"], color=ChannelColor(hue=120.0)),
        ]

        def mock_resolve(path):
            if path == "good.fits":
                return "good.fits"
            raise ValueError("not found")

        with (
            patch("app.composite.routes.resolve_fits_path", side_effect=mock_resolve),
            patch(
                "app.composite.routes.load_fits_wcs_shape_and_instrument",
                return_value=(None, 100, 100, "MIRI"),
            ),
        ):
            result = _detect_channel_instruments(channels)
        assert result == ["MIRI", None]


class TestResolveFeatherStrength:
    """Tests for _resolve_feather_strength."""

    def _make_request(self, feather_strength=None, n_channels=2, wavelengths=None):
        """Build a minimal request with N channels."""
        channels = []
        for i in range(n_channels):
            ch = NChannelConfig(
                file_paths=[f"f{i}.fits"],
                color=ChannelColor(hue=i * 120.0),
                wavelength_um=wavelengths[i] if wavelengths else None,
            )
            channels.append(ch)
        return NChannelCompositeRequest(
            channels=channels,
            feather_strength=feather_strength,
            width=100,
            height=100,
        )

    def test_manual_override(self):
        """User-provided feather_strength is returned as-is."""
        request = self._make_request(feather_strength=0.5)
        feather, auto = _resolve_feather_strength(request, [None, None])
        assert feather == 0.5
        assert auto is False

    def test_manual_zero_disables(self):
        """feather_strength=0 explicitly disables feathering."""
        request = self._make_request(feather_strength=0.0)
        feather, auto = _resolve_feather_strength(request, ["NIRCAM", "MIRI"])
        assert feather == 0.0
        assert auto is False

    def test_single_instrument_no_feather(self):
        """Single instrument → no feathering, no auto."""
        request = self._make_request()
        feather, auto = _resolve_feather_strength(request, ["NIRCAM", "NIRCAM"])
        assert feather == 0.0
        assert auto is False

    def test_unknown_instruments_no_feather(self):
        """All None instruments → no feathering."""
        request = self._make_request()
        feather, auto = _resolve_feather_strength(request, [None, None])
        assert feather == 0.0
        assert auto is False

    def test_multi_instrument_auto_feather(self):
        """NIRCAM + MIRI → auto-feathering with scale-based strength."""
        request = self._make_request(wavelengths=[1.0, 7.7])
        feather, auto = _resolve_feather_strength(request, ["NIRCAM", "MIRI"])
        assert feather > 0.0
        assert auto is True
        # Feather should be capped at 0.3
        assert feather <= 0.3


class TestStretchAndMapChannels:
    """Tests for _stretch_and_map_channels."""

    def _make_request_and_data(self, n_color=2, with_lum=False):
        """Build a request + synthetic stretch_input for testing."""
        channels = []
        data = {}
        for i in range(n_color):
            label = f"ch{i}"
            ch = NChannelConfig(
                file_paths=[f"{label}.fits"],
                color=ChannelColor(hue=i * 120.0),
                label=label,
            )
            channels.append(ch)
            data[label] = _make_test_data((50, 50))

        if with_lum:
            ch = NChannelConfig(
                file_paths=["lum.fits"],
                color=ChannelColor(luminance=True),
                label="Lum",
                weight=0.8,
            )
            channels.append(ch)
            data["Lum"] = _make_test_data((50, 50))

        request = NChannelCompositeRequest(channels=channels, width=100, height=100)
        instruments = [None] * len(channels)
        return request, data, instruments

    def test_basic_two_channel(self):
        """Two color channels produce StretchResult with correct structure."""
        request, data, instruments = self._make_request_and_data(n_color=2)
        result = _stretch_and_map_channels(request, data, instruments)

        assert isinstance(result, StretchResult)
        assert len(result.color_mapped) == 2
        assert len(result.color_ch_names) == 2
        assert result.color_ch_names == ["ch0", "ch1"]
        assert result.lum_data is None

    def test_with_luminance_channel(self):
        """Color + luminance channels are properly separated."""
        request, data, instruments = self._make_request_and_data(n_color=2, with_lum=True)
        result = _stretch_and_map_channels(request, data, instruments)

        assert len(result.color_mapped) == 2
        assert result.lum_data is not None
        assert result.lum_weight == 0.8
        # Luminance should NOT appear in color lists
        assert "Lum" not in result.color_ch_names

    def test_multiple_luminance_rejected(self):
        """Two luminance channels raise HTTPException."""
        channels = [
            NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=0.0), label="ch0"),
            NChannelConfig(
                file_paths=["lum1.fits"], color=ChannelColor(luminance=True), label="L1"
            ),
            NChannelConfig(
                file_paths=["lum2.fits"], color=ChannelColor(luminance=True), label="L2"
            ),
        ]
        request = NChannelCompositeRequest(channels=channels, width=100, height=100)
        data = {name: _make_test_data((50, 50)) for name in ["ch0", "L1", "L2"]}

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            _stretch_and_map_channels(request, data, [None, None, None])
        assert exc_info.value.status_code == 422

    def test_no_color_channels_rejected(self):
        """All-luminance request raises HTTPException."""
        channels = [
            NChannelConfig(
                file_paths=["lum.fits"], color=ChannelColor(luminance=True), label="Lum"
            ),
        ]
        request = NChannelCompositeRequest(channels=channels, width=100, height=100)
        data = {"Lum": _make_test_data((50, 50))}

        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            _stretch_and_map_channels(request, data, [None])
        assert exc_info.value.status_code == 422

    def test_channel_weight_applied(self):
        """Per-channel weight scales the stretched data."""
        channels = [
            NChannelConfig(
                file_paths=["a.fits"],
                color=ChannelColor(hue=0.0),
                label="ch0",
                weight=0.5,
            ),
        ]
        request = NChannelCompositeRequest(channels=channels, width=100, height=100)
        data = {"ch0": _make_test_data((50, 50))}

        result = _stretch_and_map_channels(request, data, [None])
        # With weight=0.5, all values should be <= 0.5
        assert result.color_mapped[0][0].max() <= 0.5 + 1e-6

    def test_instruments_tracked_in_result(self):
        """Channel instruments are propagated into StretchResult."""
        request, data, _ = self._make_request_and_data(n_color=2)
        instruments = ["NIRCAM", "MIRI"]
        result = _stretch_and_map_channels(request, data, instruments)

        assert result.color_ch_instruments == ["NIRCAM", "MIRI"]


class TestCombineToRgb:
    """Tests for _combine_to_rgb."""

    def _make_mapped(self, n_channels=2, shape=(50, 50)):
        """Build a StretchResult with synthetic stretched data."""
        result = StretchResult()
        for i in range(n_channels):
            data = np.random.default_rng(42 + i).uniform(0, 1, size=shape)
            hue = i * (360.0 / n_channels)
            import colorsys

            r, g, b = colorsys.hsv_to_rgb(hue / 360.0, 1.0, 1.0)
            result.color_mapped.append((data, (r, g, b)))
            result.color_ch_names.append(f"ch{i}")
            result.color_ch_instruments.append(None)
        return result

    def _make_request(self):
        """Minimal request for combine tests."""
        return NChannelCompositeRequest(
            channels=[
                NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=0.0)),
                NChannelConfig(file_paths=["b.fits"], color=ChannelColor(hue=180.0)),
            ],
            width=100,
            height=100,
        )

    def test_basic_combination(self):
        """Two color channels produce an RGB array in [0, 1]."""
        mapped = self._make_mapped(n_channels=2)
        reprojected = {"ch0": np.ones((50, 50)), "ch1": np.ones((50, 50))}
        request = self._make_request()

        rgb = _combine_to_rgb(mapped, reprojected, request, 0.0, [None, None])

        assert rgb.shape == (50, 50, 3)
        assert rgb.min() >= 0.0
        assert rgb.max() <= 1.0

    def test_with_luminance(self):
        """Luminance blending modifies the output."""
        mapped = self._make_mapped(n_channels=1, shape=(30, 30))
        mapped.lum_data = np.full((30, 30), 0.5)
        mapped.lum_weight = 1.0
        reprojected = {"ch0": np.ones((30, 30))}
        request = NChannelCompositeRequest(
            channels=[
                NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=0.0)),
                NChannelConfig(file_paths=["lum.fits"], color=ChannelColor(luminance=True)),
            ],
            width=100,
            height=100,
        )

        rgb = _combine_to_rgb(mapped, reprojected, request, 0.0, [None, None])

        assert rgb.shape == (30, 30, 3)
        assert rgb.min() >= 0.0
        assert rgb.max() <= 1.0

    def test_with_overall_adjustments(self):
        """Overall adjustments are applied when present."""
        from app.composite.models import OverallAdjustments

        mapped = self._make_mapped(n_channels=1, shape=(30, 30))
        reprojected = {"ch0": np.ones((30, 30))}
        request = NChannelCompositeRequest(
            channels=[
                NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=0.0)),
            ],
            overall=OverallAdjustments(stretch="sqrt"),
            width=100,
            height=100,
        )

        rgb = _combine_to_rgb(mapped, reprojected, request, 0.0, [None])

        assert rgb.shape == (30, 30, 3)
        assert rgb.min() >= 0.0
        assert rgb.max() <= 1.0

    def test_multi_instrument_blending(self):
        """Multi-instrument with feathering exercises blend_instrument_groups path."""
        shape = (60, 60)
        rng = np.random.default_rng(99)

        # NIRCAM channel covers full FOV, MIRI covers center only
        nircam_data = rng.uniform(0.2, 0.8, size=shape)
        miri_data = np.zeros(shape)
        miri_data[15:45, 15:45] = rng.uniform(0.2, 0.8, size=(30, 30))

        mapped = StretchResult(
            color_mapped=[
                (nircam_data, (0.0, 0.0, 1.0)),  # Blue
                (miri_data, (1.0, 0.0, 0.0)),  # Red
            ],
            color_ch_names=["nircam_ch", "miri_ch"],
            color_ch_instruments=["NIRCAM", "MIRI"],
        )
        reprojected = {
            "nircam_ch": nircam_data.copy(),
            "miri_ch": miri_data.copy(),
        }
        request = NChannelCompositeRequest(
            channels=[
                NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=240.0)),
                NChannelConfig(file_paths=["b.fits"], color=ChannelColor(hue=0.0)),
            ],
            width=100,
            height=100,
        )

        rgb = _combine_to_rgb(mapped, reprojected, request, 0.15, ["NIRCAM", "MIRI"])

        assert rgb.shape == (60, 60, 3)
        assert rgb.min() >= 0.0
        assert rgb.max() <= 1.0


class TestEncodeAndRespond:
    """Tests for _encode_and_respond."""

    def _make_rgb(self, shape=(50, 50)):
        """Create a synthetic RGB array."""
        rng = np.random.default_rng(42)
        return rng.uniform(0, 1, size=(*shape, 3))

    def _make_request(self, fmt="png", width=100, height=100, rotation=0.0, zoom=1.0):
        """Minimal request for encode tests."""
        return NChannelCompositeRequest(
            channels=[
                NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=0.0)),
            ],
            output_format=fmt,
            width=width,
            height=height,
            rotation_degrees=rotation,
            crop_zoom=zoom,
        )

    def test_png_output(self):
        """PNG output is valid and has correct dimensions."""
        rgb = self._make_rgb()
        request = self._make_request(fmt="png", width=100, height=100)

        response = _encode_and_respond(rgb, request, False, 0.0)

        assert response.media_type == "image/png"
        img = Image.open(io.BytesIO(response.body))
        assert img.size == (100, 100)

    def test_jpeg_output(self):
        """JPEG output has correct media type."""
        rgb = self._make_rgb()
        request = self._make_request(fmt="jpeg")

        response = _encode_and_respond(rgb, request, False, 0.0)

        assert response.media_type == "image/jpeg"

    def test_quality_headers_present(self):
        """Response includes all quality metric headers."""
        rgb = self._make_rgb()
        request = self._make_request()

        response = _encode_and_respond(rgb, request, True, 0.15)

        assert "x-quality-score" in response.headers
        assert "x-quality-snr" in response.headers
        assert "x-quality-balance" in response.headers
        assert "x-quality-spread" in response.headers
        assert "x-quality-coverage" in response.headers
        assert response.headers["x-composite-auto-feather"] == "true"
        assert response.headers["x-composite-feather-strength"] == "0.150"

    def test_rotation_applied(self):
        """Non-zero rotation produces a valid image."""
        rgb = self._make_rgb()
        request = self._make_request(rotation=45.0)

        response = _encode_and_respond(rgb, request, False, 0.0)

        img = Image.open(io.BytesIO(response.body))
        assert img.size == (100, 100)

    def test_zoom_applied(self):
        """Zoom > 1 produces a valid image at target dimensions."""
        rgb = self._make_rgb()
        request = self._make_request(zoom=2.0)

        response = _encode_and_respond(rgb, request, False, 0.0)

        img = Image.open(io.BytesIO(response.body))
        assert img.size == (100, 100)


class TestRenderDebugMasksResponse:
    """Tests for _render_debug_masks_response."""

    def test_basic_two_channel(self):
        """Two color channels produce a PNG response with channel labels."""
        shape = (50, 50)
        reprojected = {
            "F090W": np.ones(shape),
            "F444W": np.ones(shape),
        }
        request = NChannelCompositeRequest(
            channels=[
                NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=240.0), label="F090W"),
                NChannelConfig(file_paths=["b.fits"], color=ChannelColor(hue=0.0), label="F444W"),
            ],
            width=200,
            height=100,
            debug_masks=True,
        )

        response = _render_debug_masks_response(request, reprojected, [None, None], 0.0)

        assert response.media_type == "image/png"
        assert "x-debug-channels" in response.headers
        assert "F090W" in response.headers["x-debug-channels"]
        assert "F444W" in response.headers["x-debug-channels"]

    def test_luminance_channel_excluded(self):
        """Luminance channels are excluded from debug mask panels."""
        shape = (50, 50)
        reprojected = {
            "Color": np.ones(shape),
            "Lum": np.ones(shape),
        }
        request = NChannelCompositeRequest(
            channels=[
                NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=0.0), label="Color"),
                NChannelConfig(
                    file_paths=["b.fits"], color=ChannelColor(luminance=True), label="Lum"
                ),
            ],
            width=200,
            height=100,
            debug_masks=True,
        )

        response = _render_debug_masks_response(request, reprojected, [None, None], 0.0)

        channels_header = response.headers["x-debug-channels"]
        assert "Color" in channels_header
        assert "Lum" not in channels_header

    def test_instrument_blending_warning_header(self):
        """Multi-instrument composites get the X-Debug-Warning header."""
        shape = (50, 50)
        reprojected = {
            "ch0": np.ones(shape),
            "ch1": np.ones(shape),
        }
        request = NChannelCompositeRequest(
            channels=[
                NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=240.0), label="ch0"),
                NChannelConfig(file_paths=["b.fits"], color=ChannelColor(hue=0.0), label="ch1"),
            ],
            width=200,
            height=100,
            debug_masks=True,
        )

        response = _render_debug_masks_response(request, reprojected, ["NIRCAM", "MIRI"], 0.15)

        assert "x-debug-warning" in response.headers
        assert "instrument-blending-active" in response.headers["x-debug-warning"]

    def test_no_warning_for_single_instrument(self):
        """Single-instrument composites don't get the warning header."""
        shape = (50, 50)
        reprojected = {"ch0": np.ones(shape), "ch1": np.ones(shape)}
        request = NChannelCompositeRequest(
            channels=[
                NChannelConfig(file_paths=["a.fits"], color=ChannelColor(hue=240.0), label="ch0"),
                NChannelConfig(file_paths=["b.fits"], color=ChannelColor(hue=0.0), label="ch1"),
            ],
            width=200,
            height=100,
            debug_masks=True,
        )

        response = _render_debug_masks_response(request, reprojected, ["NIRCAM", "NIRCAM"], 0.0)

        assert "x-debug-warning" not in response.headers


class TestApplySharpening:
    """Tests for the apply_sharpening helper (luminance-preserving unsharp mask)."""

    @staticmethod
    def _high_freq_energy(rgb: np.ndarray) -> float:
        """Rough high-frequency measure — mean abs of the Laplacian of luminance."""
        lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
        laplacian = (
            4 * lum[1:-1, 1:-1] - lum[:-2, 1:-1] - lum[2:, 1:-1] - lum[1:-1, :-2] - lum[1:-1, 2:]
        )
        return float(np.mean(np.abs(laplacian)))

    @staticmethod
    def _synthetic_rgb(seed: int = 7) -> np.ndarray:
        """Deterministic noisy RGB with a central high-contrast disc."""
        rng = np.random.default_rng(seed)
        h, w = 64, 64
        rgb = rng.uniform(0.2, 0.4, size=(h, w, 3)).astype(np.float64)
        yy, xx = np.mgrid[:h, :w]
        disc = ((yy - h / 2) ** 2 + (xx - w / 2) ** 2) < (h / 6) ** 2
        rgb[disc] = 0.85
        return rgb

    def test_amount_zero_is_identity(self):
        """amount=0 returns the input byte-for-byte."""
        rgb = self._synthetic_rgb()
        config = SharpeningConfig(radius=2.0, amount=0.0, threshold=0.0)

        result = apply_sharpening(rgb, config)

        np.testing.assert_array_equal(result, rgb)

    def test_positive_amount_increases_high_freq(self):
        """Non-zero amount measurably increases high-frequency energy."""
        rgb = self._synthetic_rgb()
        config = SharpeningConfig(radius=1.5, amount=1.0, threshold=0.0)

        result = apply_sharpening(rgb, config)

        assert self._high_freq_energy(result) > self._high_freq_energy(rgb)

    def test_output_clipped_to_unit_range(self):
        """Sharpened output stays within [0, 1] even at high amount."""
        rgb = self._synthetic_rgb()
        config = SharpeningConfig(radius=1.0, amount=3.0, threshold=0.0)

        result = apply_sharpening(rgb, config)

        assert result.min() >= 0.0
        assert result.max() <= 1.0

    def test_threshold_suppresses_small_deltas(self):
        """A high threshold prevents noise-level deltas from being amplified."""
        rgb = self._synthetic_rgb()
        # Flat regions have tiny luminance deltas — threshold >= 1 kills them all.
        config_strict = SharpeningConfig(radius=2.0, amount=1.0, threshold=1.0)
        config_open = SharpeningConfig(radius=2.0, amount=1.0, threshold=0.0)

        strict = apply_sharpening(rgb, config_strict)
        open_ = apply_sharpening(rgb, config_open)

        # Threshold=1.0 clamps everything → output identical to input.
        np.testing.assert_array_equal(strict, rgb)
        assert not np.array_equal(open_, rgb)

    def test_preserves_zero_coverage_pixels(self):
        """Pixels outside the coverage footprint stay at zero after sharpening."""
        rgb = self._synthetic_rgb()
        rgb[:10, :, :] = 0.0  # Simulated no-coverage border
        coverage = np.ones(rgb.shape[:2], dtype=bool)
        coverage[:10, :] = False
        config = SharpeningConfig(radius=1.5, amount=1.0, threshold=0.0)

        result = apply_sharpening(rgb, config, coverage_mask=coverage)

        assert np.all(result[:10, :, :] == 0.0)

    def test_coverage_mask_respected_when_supplied(self):
        """apply_sharpening uses the explicit coverage_mask rather than
        inferring one from rgb_array. Regression guard: the previous
        implementation derived coverage from ``rgb_array > 0``, which
        treated in-footprint (0,0,0) pixels as no-coverage and produced
        a discontinuous sharpening mask at dark-sky boundaries."""
        rgb = self._synthetic_rgb()
        # Mask out a band inside the bright disc so the supplied mask
        # differs from any `rgb > 0` heuristic — the rgb values there
        # are non-zero so the old heuristic would have kept them.
        coverage = np.ones(rgb.shape[:2], dtype=bool)
        coverage[30:34, 30:34] = False
        config = SharpeningConfig(radius=1.5, amount=1.0, threshold=0.0)

        result = apply_sharpening(rgb, config, coverage_mask=coverage)
        # The masked band's delta was zeroed — output equals input there.
        np.testing.assert_array_equal(result[30:34, 30:34], rgb[30:34, 30:34])
        # A pixel *outside* the masked band still receives the sharpening delta.
        assert not np.array_equal(result[0, 0], rgb[0, 0])

    def test_build_coverage_mask_unions_channels(self):
        """_build_coverage_mask ORs per-channel coverage — any channel
        non-zero at a pixel marks it covered."""
        ch_a = np.zeros((4, 4))
        ch_a[0, 0] = 1.0
        ch_b = np.zeros((4, 4))
        ch_b[0, 1] = 1.0
        ch_c = np.zeros((4, 4))

        mask = _build_coverage_mask({"a": ch_a, "b": ch_b, "c": ch_c})

        assert mask[0, 0]
        assert mask[0, 1]
        assert not mask[1, 0]
        assert not mask[3, 3]

    def test_build_coverage_mask_raises_on_empty_dict(self):
        """Empty reprojected dict raises ValueError, not AssertionError — #1190.

        Assertions are stripped under `python -O`; ValueError survives and
        gives callers a meaningful exception type to catch.
        """
        with pytest.raises(ValueError, match="at least one channel"):
            _build_coverage_mask({})

    def test_preserves_color_balance_on_gray(self):
        """Sharpening gray input (R=G=B) keeps R=G=B — luminance-based, not per-channel."""
        rng = np.random.default_rng(11)
        gray = rng.uniform(0.2, 0.8, size=(64, 64)).astype(np.float64)
        rgb = np.stack([gray, gray, gray], axis=-1)
        config = SharpeningConfig(radius=1.5, amount=1.5, threshold=0.0)

        result = apply_sharpening(rgb, config)

        np.testing.assert_allclose(result[..., 0], result[..., 1])
        np.testing.assert_allclose(result[..., 1], result[..., 2])
