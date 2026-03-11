"""Tests for the N-channel color mapping engine."""

import numpy as np
import pytest
from pydantic import ValidationError

from app.composite.color_mapping import (
    chromatic_order_hues,
    combine_channels_to_rgb,
    hue_to_rgb_weights,
    wavelength_to_hue,
)
from app.composite.models import ChannelColor


class TestHueToRgbWeights:
    """Tests for hue_to_rgb_weights conversion."""

    def test_red_at_0_degrees(self):
        r, g, b = hue_to_rgb_weights(0)
        assert r == pytest.approx(1.0)
        assert g == pytest.approx(0.0)
        assert b == pytest.approx(0.0)

    def test_green_at_120_degrees(self):
        r, g, b = hue_to_rgb_weights(120)
        assert r == pytest.approx(0.0)
        assert g == pytest.approx(1.0)
        assert b == pytest.approx(0.0)

    def test_blue_at_240_degrees(self):
        r, g, b = hue_to_rgb_weights(240)
        assert r == pytest.approx(0.0)
        assert g == pytest.approx(0.0)
        assert b == pytest.approx(1.0)

    def test_yellow_at_60_degrees(self):
        r, g, b = hue_to_rgb_weights(60)
        assert r == pytest.approx(1.0)
        assert g == pytest.approx(1.0)
        assert b == pytest.approx(0.0)

    def test_cyan_at_180_degrees(self):
        r, g, b = hue_to_rgb_weights(180)
        assert r == pytest.approx(0.0)
        assert g == pytest.approx(1.0)
        assert b == pytest.approx(1.0)

    def test_magenta_at_300_degrees(self):
        r, g, b = hue_to_rgb_weights(300)
        assert r == pytest.approx(1.0)
        assert g == pytest.approx(0.0)
        assert b == pytest.approx(1.0)

    def test_360_wraps_to_red(self):
        assert hue_to_rgb_weights(360) == pytest.approx(hue_to_rgb_weights(0))

    def test_negative_wraps(self):
        # -60° should equal 300°
        assert hue_to_rgb_weights(-60) == pytest.approx(hue_to_rgb_weights(300))

    def test_large_value_wraps(self):
        assert hue_to_rgb_weights(480) == pytest.approx(hue_to_rgb_weights(120))

    def test_all_components_in_range(self):
        """Property: all outputs should be in [0, 1] for any hue."""
        for hue in range(0, 360, 5):
            r, g, b = hue_to_rgb_weights(hue)
            assert 0.0 <= r <= 1.0, f"r={r} out of range at hue={hue}"
            assert 0.0 <= g <= 1.0, f"g={g} out of range at hue={hue}"
            assert 0.0 <= b <= 1.0, f"b={b} out of range at hue={hue}"


class TestWavelengthToHue:
    """Tests for wavelength_to_hue mapping."""

    def test_shortest_wavelength_maps_to_blue(self):
        hue = wavelength_to_hue(0.6)
        assert hue == pytest.approx(270.0)

    def test_longest_wavelength_maps_to_red(self):
        hue = wavelength_to_hue(28.0)
        assert hue == pytest.approx(0.0)

    def test_monotonically_decreasing(self):
        """Longer wavelengths should produce lower hue values."""
        wavelengths = [0.7, 1.0, 2.0, 5.0, 10.0, 20.0, 28.0]
        hues = [wavelength_to_hue(wl) for wl in wavelengths]
        for i in range(len(hues) - 1):
            assert hues[i] > hues[i + 1], (
                f"Not monotonically decreasing: hue({wavelengths[i]})={hues[i]} "
                f"<= hue({wavelengths[i + 1]})={hues[i + 1]}"
            )

    def test_clamping_below_range(self):
        """Wavelengths below 0.6 µm should clamp to boundary."""
        assert wavelength_to_hue(0.1) == pytest.approx(wavelength_to_hue(0.6))

    def test_clamping_above_range(self):
        """Wavelengths above 28 µm should clamp to boundary."""
        assert wavelength_to_hue(100.0) == pytest.approx(wavelength_to_hue(28.0))

    def test_hue_within_valid_range(self):
        """All hues should be in [0, 270]."""
        wavelengths = [0.6, 0.7, 1.0, 2.0, 5.0, 10.0, 15.0, 20.0, 28.0]
        for wl in wavelengths:
            hue = wavelength_to_hue(wl)
            assert 0.0 <= hue <= 270.0, f"hue={hue} out of range at wl={wl}"

    def test_log_distribution_balance(self):
        """Mid-point of JWST range (geometric mean) should map near mid-hue."""
        import math

        geometric_mid = math.sqrt(0.6 * 28.0)
        hue = wavelength_to_hue(geometric_mid)
        assert hue == pytest.approx(135.0, abs=1.0)


class TestChromaticOrderHues:
    """Tests for chromatic_order_hues (NASA discrete palette)."""

    def test_single_filter_returns_red(self):
        assert chromatic_order_hues(1) == [0.0]

    def test_two_filters_blue_red(self):
        assert chromatic_order_hues(2) == [240.0, 0.0]

    def test_three_filters_blue_green_red(self):
        assert chromatic_order_hues(3) == [240.0, 120.0, 0.0]

    def test_four_filters_nasa_convention(self):
        """4-filter: Blue, Green, Orange, Red (matches NASA Cranium Nebula)."""
        assert chromatic_order_hues(4) == [240.0, 120.0, 30.0, 0.0]

    def test_five_filters(self):
        """5-filter: Purple, Blue, Green, Orange, Red."""
        assert chromatic_order_hues(5) == [280.0, 240.0, 120.0, 30.0, 0.0]

    def test_six_filters(self):
        """6-filter: Purple, Blue, Green, Yellow, Orange, Red."""
        assert chromatic_order_hues(6) == [280.0, 240.0, 120.0, 60.0, 30.0, 0.0]

    def test_seven_filters_full_palette(self):
        """7-filter: All NASA palette colors."""
        assert chromatic_order_hues(7) == [280.0, 240.0, 180.0, 120.0, 60.0, 30.0, 0.0]

    def test_eight_filters_interpolates(self):
        """N>7: interpolates extras between widest gaps."""
        hues = chromatic_order_hues(8)
        assert len(hues) == 8
        assert hues[0] == 280.0
        assert hues[-1] == 0.0

    def test_monotonically_decreasing(self):
        for n in [2, 3, 4, 5, 6, 7, 8]:
            hues = chromatic_order_hues(n)
            for i in range(len(hues) - 1):
                assert hues[i] > hues[i + 1], f"Not decreasing at n={n}, i={i}"

    def test_all_hues_in_valid_range(self):
        for n in range(1, 11):
            hues = chromatic_order_hues(n)
            for h in hues:
                assert 0.0 <= h <= 280.0, f"Hue {h} out of range at n={n}"

    def test_zero_raises(self):
        with pytest.raises(ValueError, match="at least 1"):
            chromatic_order_hues(0)

    def test_negative_raises(self):
        with pytest.raises(ValueError, match="at least 1"):
            chromatic_order_hues(-1)

    def test_hues_produce_valid_rgb_weights(self):
        """All chromatic hues should produce valid RGB weights."""
        for n in [2, 3, 4, 5, 6]:
            hues = chromatic_order_hues(n)
            for hue in hues:
                r, g, b = hue_to_rgb_weights(hue)
                assert 0.0 <= r <= 1.0
                assert 0.0 <= g <= 1.0
                assert 0.0 <= b <= 1.0


class TestCombineChannelsToRgb:
    """Tests for combine_channels_to_rgb."""

    def test_three_channel_basic(self):
        """3-channel with pure R/G/B weights should produce expected result."""
        h, w = 10, 10
        r_data = np.ones((h, w)) * 0.8
        g_data = np.ones((h, w)) * 0.5
        b_data = np.ones((h, w)) * 0.3

        channels = [
            (r_data, (1.0, 0.0, 0.0)),
            (g_data, (0.0, 1.0, 0.0)),
            (b_data, (0.0, 0.0, 1.0)),
        ]
        result = combine_channels_to_rgb(channels)

        assert result.shape == (h, w, 3)
        # Per-component normalization: each channel's max becomes 1.0
        assert result[0, 0, 0] == pytest.approx(1.0)  # 0.8/0.8
        assert result[0, 0, 1] == pytest.approx(1.0)  # 0.5/0.5
        assert result[0, 0, 2] == pytest.approx(1.0)  # 0.3/0.3

    def test_single_channel_monochromatic(self):
        """Single channel with a hue should produce monochromatic image."""
        h, w = 5, 5
        data = np.ones((h, w)) * 0.7
        # Yellow weights: R=1, G=1, B=0
        channels = [(data, (1.0, 1.0, 0.0))]
        result = combine_channels_to_rgb(channels)

        assert result.shape == (h, w, 3)
        assert result[0, 0, 0] == pytest.approx(1.0)
        assert result[0, 0, 1] == pytest.approx(1.0)
        assert result[0, 0, 2] == pytest.approx(0.0)

    def test_five_channel_combination(self):
        """Five channels combine correctly with various hues."""
        h, w = 8, 8
        channels = []
        for i in range(5):
            data = np.ones((h, w)) * (i + 1) * 0.1
            hue = i * 60  # 0, 60, 120, 180, 240
            from app.composite.color_mapping import hue_to_rgb_weights

            weights = hue_to_rgb_weights(hue)
            channels.append((data, weights))

        result = combine_channels_to_rgb(channels)
        assert result.shape == (h, w, 3)
        # All values should be in [0, 1]
        assert result.min() >= 0.0
        assert result.max() <= 1.0

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="At least one channel"):
            combine_channels_to_rgb([])

    def test_mismatched_shapes_raises(self):
        a = np.ones((10, 10))
        b = np.ones((10, 12))
        with pytest.raises(ValueError, match="doesn't match"):
            combine_channels_to_rgb([(a, (1, 0, 0)), (b, (0, 1, 0))])

    def test_3d_input_raises(self):
        a = np.ones((10, 10, 3))
        with pytest.raises(ValueError, match="must be 2D"):
            combine_channels_to_rgb([(a, (1, 0, 0))])

    def test_all_zero_data(self):
        """All-zero data should produce all-zero output."""
        h, w = 5, 5
        data = np.zeros((h, w))
        channels = [(data, (1.0, 0.0, 0.0)), (data, (0.0, 1.0, 0.0))]
        result = combine_channels_to_rgb(channels)
        np.testing.assert_array_equal(result, np.zeros((h, w, 3)))

    def test_output_shape_various_n(self):
        """Output is always [H, W, 3] regardless of N."""
        h, w = 6, 8
        for n in [1, 2, 3, 4, 6]:
            channels = [(np.ones((h, w)), (0.5, 0.5, 0.5))] * n
            result = combine_channels_to_rgb(channels)
            assert result.shape == (h, w, 3), f"Wrong shape for N={n}"

    def test_output_dtype_float64(self):
        data = np.ones((4, 4), dtype=np.float32)
        result = combine_channels_to_rgb([(data, (1.0, 0.0, 0.0))])
        assert result.dtype == np.float64

    def test_varying_pixel_values(self):
        """Non-uniform data should normalize correctly."""
        data = np.array([[1.0, 0.5], [0.25, 0.0]])
        channels = [(data, (1.0, 0.0, 0.0))]
        result = combine_channels_to_rgb(channels)
        # Max red value is 1.0, so normalized: 1.0, 0.5, 0.25, 0.0
        assert result[0, 0, 0] == pytest.approx(1.0)
        assert result[0, 1, 0] == pytest.approx(0.5)
        assert result[1, 0, 0] == pytest.approx(0.25)
        assert result[1, 1, 0] == pytest.approx(0.0)

    def test_partial_coverage_regions(self):
        """Partial coverage: one channel covers full image, one covers half.

        Zeros from no-coverage regions contribute nothing to the sum,
        so the right half (blue only) and left half (red + blue) both
        show the expected colors with global normalization.
        """
        h, w = 10, 20
        # Blue channel covers full image
        blue_data = np.ones((h, w)) * 0.6
        # Red channel covers only the left half
        red_data = np.zeros((h, w))
        red_data[:, :10] = 0.8

        channels = [
            (red_data, (1.0, 0.0, 0.0)),
            (blue_data, (0.0, 0.0, 1.0)),
        ]
        result = combine_channels_to_rgb(channels)

        # Right half: only blue contributes — normalized to 1.0
        assert result[0, 15, 2] == pytest.approx(1.0)
        # Right half: no red data
        assert result[0, 15, 0] == pytest.approx(0.0)
        # Left half: both red and blue present
        assert result[0, 5, 0] > 0.0
        assert result[0, 5, 2] > 0.0

    def test_coverage_masks_explicit(self):
        """Explicit coverage masks zero out data outside the mask."""
        h, w = 4, 4
        # Channel with all 0.5 data but mask says only top-left quadrant
        data = np.ones((h, w)) * 0.5
        mask = np.zeros((h, w), dtype=bool)
        mask[:2, :2] = True

        channels = [(data, (1.0, 0.0, 0.0))]
        coverage_masks = [mask]
        result = combine_channels_to_rgb(channels, coverage_masks=coverage_masks)

        # Top-left quadrant (masked=True): data contributes, normalized to 1.0
        assert result[0, 0, 0] == pytest.approx(1.0)
        # Bottom-right quadrant (masked=False): data zeroed out, should be 0.0
        assert result[3, 3, 0] == pytest.approx(0.0)

    def test_coverage_masks_none_backward_compat(self):
        """coverage_masks=None (no masking) matches all-True explicit masks."""
        h, w = 6, 6
        data = np.random.RandomState(42).rand(h, w)
        channels = [(data, (1.0, 0.5, 0.0))]

        result_none = combine_channels_to_rgb(channels, coverage_masks=None)
        # All-True mask = no masking, should produce identical result
        masks = [np.ones((h, w), dtype=bool)]
        result_explicit = combine_channels_to_rgb(channels, coverage_masks=masks)

        np.testing.assert_array_almost_equal(result_none, result_explicit)

    def test_coverage_masks_length_mismatch_raises(self):
        """Mismatched coverage_masks length should raise ValueError."""
        data = np.ones((4, 4))
        channels = [(data, (1.0, 0.0, 0.0)), (data, (0.0, 1.0, 0.0))]
        masks = [np.ones((4, 4), dtype=bool)]  # only 1 mask for 2 channels
        with pytest.raises(ValueError, match="coverage_masks length"):
            combine_channels_to_rgb(channels, coverage_masks=masks)

    def test_coverage_masks_shape_mismatch_raises(self):
        """Coverage mask with wrong shape should raise ValueError."""
        data = np.ones((4, 4))
        channels = [(data, (1.0, 0.0, 0.0))]
        masks = [np.ones((6, 6), dtype=bool)]  # wrong shape
        with pytest.raises(ValueError, match="coverage_masks.*shape"):
            combine_channels_to_rgb(channels, coverage_masks=masks)

    def test_multi_channel_backward_compat(self):
        """Multi-channel full-coverage: masks=None matches explicit all-True masks."""
        h, w = 8, 8
        rng = np.random.RandomState(99)
        channels = [
            (rng.rand(h, w) * 0.8 + 0.1, (1.0, 0.2, 0.0)),
            (rng.rand(h, w) * 0.6 + 0.1, (0.0, 0.8, 0.3)),
            (rng.rand(h, w) * 0.4 + 0.1, (0.1, 0.0, 1.0)),
        ]
        # All data > 0, so data > 0 mask is all True
        all_true = [np.ones((h, w), dtype=bool)] * 3

        result_none = combine_channels_to_rgb(channels, coverage_masks=None)
        result_explicit = combine_channels_to_rgb(channels, coverage_masks=all_true)

        np.testing.assert_array_almost_equal(result_none, result_explicit)

    def test_explicit_masks_partial_coverage_multi_channel(self):
        """Two channels with explicit masks: different spatial coverage."""
        h, w = 10, 10
        ch1_data = np.ones((h, w)) * 0.6
        ch2_data = np.ones((h, w)) * 0.8

        # ch1 covers left half, ch2 covers right half
        mask1 = np.zeros((h, w), dtype=bool)
        mask1[:, :5] = True
        mask2 = np.zeros((h, w), dtype=bool)
        mask2[:, 5:] = True

        channels = [
            (ch1_data, (1.0, 0.0, 0.0)),  # red
            (ch2_data, (0.0, 0.0, 1.0)),  # blue
        ]
        masks = [mask1, mask2]
        result = combine_channels_to_rgb(channels, coverage_masks=masks)

        # Left half: only red channel contributes
        assert result[0, 2, 0] > 0  # has red
        assert result[0, 2, 2] == pytest.approx(0.0)  # no blue

        # Right half: only blue channel contributes
        assert result[0, 7, 0] == pytest.approx(0.0)  # no red
        assert result[0, 7, 2] > 0  # has blue

    def test_multi_instrument_fov_scenario(self):
        """Simulates MIRI (small FOV) + NIRCam (large FOV) composite.

        MIRI data occupies a centered rectangle; NIRCam covers the full field.
        The outer region (NIRCam only) should show NIRCam colors, not artifacts.
        """
        h, w = 100, 100
        # NIRCam: full coverage, blue channel
        nircam = np.ones((h, w)) * 0.5
        # MIRI: small centered FOV, red channel
        miri = np.zeros((h, w))
        miri[30:70, 30:70] = 0.7

        channels = [
            (nircam, (0.0, 0.0, 1.0)),  # NIRCam → blue
            (miri, (1.0, 0.0, 0.0)),  # MIRI → red
        ]
        result = combine_channels_to_rgb(channels)

        # Corner pixel (outside MIRI FOV): should be pure blue
        assert result[5, 5, 0] == pytest.approx(0.0)  # no red
        assert result[5, 5, 2] > 0.0  # has blue

        # Center pixel (both instruments): should have both red and blue
        assert result[50, 50, 0] > 0.0  # has red
        assert result[50, 50, 2] > 0.0  # has blue


class TestChannelColorModel:
    """Tests for the ChannelColor Pydantic model."""

    def test_hue_only_valid(self):
        color = ChannelColor(hue=120.0)
        assert color.hue == 120.0
        assert color.rgb is None

    def test_rgb_only_valid(self):
        color = ChannelColor(rgb=(0.5, 0.3, 0.8))
        assert color.rgb == (0.5, 0.3, 0.8)
        assert color.hue is None

    def test_both_raises(self):
        with pytest.raises(ValidationError, match="Provide only one of"):
            ChannelColor(hue=120.0, rgb=(0.5, 0.3, 0.8))

    def test_neither_raises(self):
        with pytest.raises(ValidationError, match="Provide one of"):
            ChannelColor()

    def test_hue_out_of_range_raises(self):
        with pytest.raises(ValidationError):
            ChannelColor(hue=400.0)

    def test_hue_negative_raises(self):
        with pytest.raises(ValidationError):
            ChannelColor(hue=-10.0)

    def test_rgb_component_out_of_range_raises(self):
        with pytest.raises(ValidationError, match="outside"):
            ChannelColor(rgb=(1.5, 0.0, 0.0))

    def test_rgb_negative_component_raises(self):
        with pytest.raises(ValidationError, match="outside"):
            ChannelColor(rgb=(0.0, -0.1, 0.0))

    def test_hue_boundary_values(self):
        assert ChannelColor(hue=0.0).hue == 0.0
        assert ChannelColor(hue=360.0).hue == 360.0

    def test_rgb_boundary_values(self):
        color = ChannelColor(rgb=(0.0, 0.0, 0.0))
        assert color.rgb == (0.0, 0.0, 0.0)
        color = ChannelColor(rgb=(1.0, 1.0, 1.0))
        assert color.rgb == (1.0, 1.0, 1.0)
