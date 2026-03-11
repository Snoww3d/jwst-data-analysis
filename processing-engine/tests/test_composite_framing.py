# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Unit tests for export framing: rotation, zoom/pan, and canvas placement.
"""

import pytest
from pydantic import ValidationError

from app.composite.models import ChannelColor, NChannelCompositeRequest, NChannelConfig


def _dummy_channel() -> NChannelConfig:
    """Create a minimal valid channel for testing."""
    return NChannelConfig(
        file_paths=["test.fits"],
        color=ChannelColor(hue=0),
    )


class TestFramingModelValidation:
    """Tests for the new framing fields on NChannelCompositeRequest."""

    def test_default_framing_values(self):
        """Default framing: no rotation, centered, fit zoom."""
        req = NChannelCompositeRequest(channels=[_dummy_channel()])
        assert req.rotation_degrees == 0.0
        assert req.crop_center_x == 0.5
        assert req.crop_center_y == 0.5
        assert req.crop_zoom == 1.0

    def test_valid_rotation(self):
        req = NChannelCompositeRequest(channels=[_dummy_channel()], rotation_degrees=-15.0)
        assert req.rotation_degrees == -15.0

    def test_rotation_out_of_range_high(self):
        with pytest.raises(ValidationError, match="rotation_degrees"):
            NChannelCompositeRequest(channels=[_dummy_channel()], rotation_degrees=200.0)

    def test_rotation_out_of_range_low(self):
        with pytest.raises(ValidationError, match="rotation_degrees"):
            NChannelCompositeRequest(channels=[_dummy_channel()], rotation_degrees=-200.0)

    def test_crop_center_out_of_range(self):
        with pytest.raises(ValidationError, match="crop_center_x"):
            NChannelCompositeRequest(channels=[_dummy_channel()], crop_center_x=1.5)

    def test_crop_zoom_out_of_range(self):
        with pytest.raises(ValidationError, match="crop_zoom"):
            NChannelCompositeRequest(channels=[_dummy_channel()], crop_zoom=0.05)

    def test_crop_zoom_max(self):
        req = NChannelCompositeRequest(channels=[_dummy_channel()], crop_zoom=5.0)
        assert req.crop_zoom == 5.0

    def test_boundary_values(self):
        """Edge boundary values should be accepted."""
        req = NChannelCompositeRequest(
            channels=[_dummy_channel()],
            rotation_degrees=-180.0,
            crop_center_x=0.0,
            crop_center_y=1.0,
            crop_zoom=0.1,
        )
        assert req.rotation_degrees == -180.0
        assert req.crop_center_x == 0.0
        assert req.crop_center_y == 1.0
        assert req.crop_zoom == 0.1
