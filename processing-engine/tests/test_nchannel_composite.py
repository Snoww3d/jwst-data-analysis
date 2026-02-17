"""
Tests for the N-channel composite API endpoint (B3.2).

Tests the /composite/generate-nchannel route, cache key generation,
and the color resolution helper.
"""

from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
from astropy.wcs import WCS
from fastapi.testclient import TestClient
from PIL import Image

from app.composite.cache import CompositeCache
from app.composite.color_mapping import blend_luminance, hsl_to_rgb, rgb_to_hsl
from app.composite.models import ChannelColor, NChannelCompositeRequest, NChannelConfig
from app.composite.routes import resolve_channel_color


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_wcs(naxis1: int = 100, naxis2: int = 100, cdelt: float = -0.001) -> WCS:
    """Create a minimal celestial WCS for testing."""
    header = {
        "NAXIS": 2,
        "NAXIS1": naxis1,
        "NAXIS2": naxis2,
        "CTYPE1": "RA---TAN",
        "CTYPE2": "DEC--TAN",
        "CRPIX1": naxis1 / 2.0,
        "CRPIX2": naxis2 / 2.0,
        "CRVAL1": 180.0,
        "CRVAL2": 45.0,
        "CDELT1": cdelt,
        "CDELT2": abs(cdelt),
    }
    return WCS(header, naxis=2)


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
        assert config.stretch == "zscale"
        assert config.weight == 1.0
        assert config.gamma == 1.0

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
        """Mock the heavy pipeline components (FITS loading, reprojection)."""
        shape = (50, 50)
        wcs = _make_wcs(50, 50)
        data = _make_test_data(shape)

        with (
            patch(
                "app.composite.routes.resolve_fits_path",
                return_value=Path("/app/data/test.fits"),
            ),
            patch(
                "app.composite.routes.load_fits_2d_with_wcs",
                return_value=(data, wcs),
            ),
            patch(
                "app.composite.routes.downscale_for_composite",
                return_value=(data, wcs),
            ),
            patch(
                "app.composite.routes.reproject_channels_to_common_wcs",
                return_value=(
                    {f"ch{i}": data.copy() for i in range(6)},
                    shape,
                ),
            ) as mock_reproject,
            patch(
                "app.composite.routes.neutralize_raw_backgrounds",
                side_effect=lambda ch: ch,
            ),
        ):
            yield mock_reproject

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
