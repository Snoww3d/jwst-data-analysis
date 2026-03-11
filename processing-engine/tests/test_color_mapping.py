"""Tests for the N-channel color mapping engine."""

import numpy as np
import pytest
from pydantic import ValidationError

from app.composite.color_mapping import (
    chromatic_order_hues,
    combine_channels_to_rgb,
    compute_feather_weights,
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

    def test_feather_weights_smooth_transition(self):
        """Float feather weights create smooth color transition at FOV boundary.

        Full-coverage channels get no feathering (all-ones mask).
        Partial-coverage channels get tapered, creating a smooth gradient.
        """
        h, w = 100, 100
        # NIRCam: full coverage → compute_feather_weights returns None
        nircam = np.ones((h, w)) * 0.5
        # MIRI: small centered FOV, red channel
        miri = np.zeros((h, w))
        miri[30:70, 30:70] = 0.7

        channels = [
            (nircam, (0.0, 0.0, 1.0)),
            (miri, (1.0, 0.0, 0.0)),
        ]
        fw_nircam = compute_feather_weights(nircam)
        fw_miri = compute_feather_weights(miri, radius=15)

        assert fw_nircam is None  # full coverage → no feathering
        assert fw_miri is not None

        # Replace None with all-ones (as routes.py does)
        masks = [
            np.ones((h, w), dtype=np.float64),  # NIRCam: full weight
            fw_miri,  # MIRI: feathered
        ]
        result = combine_channels_to_rgb(channels, coverage_masks=masks)

        # Corner pixel (outside MIRI): blue only
        assert result[5, 5, 0] == pytest.approx(0.0)
        assert result[5, 5, 2] > 0.0

        # Center pixel (both instruments): has both colors
        assert result[50, 50, 0] > 0.0
        assert result[50, 50, 2] > 0.0

        # Smooth transition: red at MIRI edge should be less than center
        center_red = result[50, 50, 0]
        edge_red = result[50, 31, 0]  # 1px inside MIRI boundary
        assert 0 < edge_red < center_red

    def test_coverage_masks_explicit(self):
        """Explicit float masks zero out data outside coverage."""
        h, w = 4, 4
        data = np.ones((h, w)) * 0.5
        mask = np.zeros((h, w), dtype=np.float64)
        mask[:2, :2] = 1.0

        channels = [(data, (1.0, 0.0, 0.0))]
        result = combine_channels_to_rgb(channels, coverage_masks=[mask])

        # Masked region: data contributes, normalized to 1.0
        assert result[0, 0, 0] == pytest.approx(1.0)
        # Unmasked region: data zeroed out
        assert result[3, 3, 0] == pytest.approx(0.0)

    def test_coverage_masks_none_backward_compat(self):
        """coverage_masks=None uses global normalization (original behavior)."""
        h, w = 6, 6
        rng = np.random.RandomState(42)
        data = rng.rand(h, w)
        channels = [(data, (1.0, 0.5, 0.0))]

        # None = global normalization, no feathering
        result = combine_channels_to_rgb(channels, coverage_masks=None)

        # Should produce the same as the original algorithm
        assert result.shape == (h, w, 3)
        assert result[:, :, 0].max() == pytest.approx(1.0)

    def test_coverage_masks_length_mismatch_raises(self):
        """Mismatched coverage_masks length should raise ValueError."""
        data = np.ones((4, 4))
        channels = [(data, (1.0, 0.0, 0.0)), (data, (0.0, 1.0, 0.0))]
        masks = [np.ones((4, 4))]  # only 1 mask for 2 channels
        with pytest.raises(ValueError, match="coverage_masks length"):
            combine_channels_to_rgb(channels, coverage_masks=masks)

    def test_coverage_masks_shape_mismatch_raises(self):
        """Coverage mask with wrong shape should raise ValueError."""
        data = np.ones((4, 4))
        channels = [(data, (1.0, 0.0, 0.0))]
        masks = [np.ones((6, 6))]  # wrong shape
        with pytest.raises(ValueError, match="coverage_masks.*shape"):
            combine_channels_to_rgb(channels, coverage_masks=masks)

    def test_multi_channel_full_coverage_feathered(self):
        """Full-coverage feathered: all-ones masks = same as no masks."""
        h, w = 8, 8
        rng = np.random.RandomState(99)
        channels = [
            (rng.rand(h, w) * 0.8 + 0.1, (1.0, 0.0, 0.0)),
            (rng.rand(h, w) * 0.6 + 0.1, (0.0, 1.0, 0.0)),
        ]

        result_none = combine_channels_to_rgb(channels, coverage_masks=None)
        all_ones = [np.ones((h, w))] * 2
        result_feathered = combine_channels_to_rgb(channels, coverage_masks=all_ones)

        # All-ones masks multiply data by 1.0 → identical to no masks
        np.testing.assert_array_almost_equal(result_none, result_feathered)

    def test_feathered_partial_coverage_multi_channel(self):
        """Two channels with non-overlapping coverage and feather weights."""
        h, w = 100, 100
        ch1_data = np.zeros((h, w))
        ch1_data[:, :50] = 0.6  # left half (50% coverage)
        ch2_data = np.zeros((h, w))
        ch2_data[:, 50:] = 0.8  # right half (50% coverage)

        channels = [
            (ch1_data, (1.0, 0.0, 0.0)),  # red
            (ch2_data, (0.0, 0.0, 1.0)),  # blue
        ]
        # Both have partial coverage, so compute_feather_weights returns arrays
        fw1 = compute_feather_weights(ch1_data, radius=20)
        fw2 = compute_feather_weights(ch2_data, radius=20)
        assert fw1 is not None
        assert fw2 is not None
        result = combine_channels_to_rgb(channels, coverage_masks=[fw1, fw2])

        # Far left: pure red
        assert result[50, 5, 0] > 0
        assert result[50, 5, 2] == pytest.approx(0.0)

        # Far right: pure blue
        assert result[50, 95, 0] == pytest.approx(0.0)
        assert result[50, 95, 2] > 0

        # At boundary (col 50): both colors should be present with reduced intensity
        assert result[50, 48, 0] > 0  # some red near boundary
        assert result[50, 52, 2] > 0  # some blue near boundary

    def test_multi_instrument_fov_no_feathering(self):
        """Without feathering, partial coverage still works (global normalization)."""
        h, w = 100, 100
        nircam = np.ones((h, w)) * 0.5
        miri = np.zeros((h, w))
        miri[30:70, 30:70] = 0.7

        channels = [
            (nircam, (0.0, 0.0, 1.0)),
            (miri, (1.0, 0.0, 0.0)),
        ]
        result = combine_channels_to_rgb(channels)

        assert result[5, 5, 0] == pytest.approx(0.0)
        assert result[5, 5, 2] > 0.0
        assert result[50, 50, 0] > 0.0
        assert result[50, 50, 2] > 0.0


class TestComputeFeatherWeights:
    """Tests for compute_feather_weights."""

    def test_full_coverage_returns_none(self):
        """Data with >95% coverage → returns None (no feathering needed)."""
        data = np.ones((50, 50)) * 0.5
        weights = compute_feather_weights(data)
        assert weights is None

    def test_no_coverage_all_zeros(self):
        """All-zero data → all weights are 0.0."""
        data = np.zeros((20, 20))
        weights = compute_feather_weights(data)
        assert weights is not None
        assert weights.max() == pytest.approx(0.0)

    def test_centered_square_feathers_edges(self):
        """Centered square of data: edges taper, interior is 1.0."""
        data = np.zeros((100, 100))
        data[20:80, 20:80] = 1.0

        weights = compute_feather_weights(data, radius=15)

        # Center should be 1.0 (>15px from boundary)
        assert weights[50, 50] == pytest.approx(1.0)
        # Just inside boundary should be < 1.0
        assert 0.0 < weights[21, 50] < 1.0
        # Outside boundary should be 0.0
        assert weights[10, 50] == pytest.approx(0.0)

    def test_radius_zero_returns_binary(self):
        """radius=0 disables feathering, returns binary mask."""
        data = np.zeros((20, 20))
        data[5:15, 5:15] = 0.7
        weights = compute_feather_weights(data, radius=0)
        # Should be exactly 0.0 or 1.0
        unique = np.unique(weights)
        assert len(unique) <= 2
        assert set(unique).issubset({0.0, 1.0})

    def test_output_shape_and_range(self):
        """Output has same shape as input, values in [0, 1]."""
        data = np.random.RandomState(42).rand(30, 40)
        data[:, :10] = 0.0
        weights = compute_feather_weights(data, radius=5)
        assert weights.shape == data.shape
        assert weights.min() >= 0.0
        assert weights.max() <= 1.0

    def test_auto_radius_scales_with_image(self):
        """Auto radius = 15% of smaller dimension."""
        data = np.zeros((200, 400))
        data[40:160, 80:320] = 1.0  # 60% coverage

        weights = compute_feather_weights(data)  # auto radius = 200 * 0.15 = 30
        assert weights is not None
        # At half-radius (15px inside boundary), weight should be ~0.5
        assert 0.3 < weights[55, 200] < 0.7
        # Deep interior (>30px from boundary) should be 1.0
        assert weights[100, 200] == pytest.approx(1.0)

    def test_larger_radius_wider_taper(self):
        """Larger radius creates a wider taper zone."""
        data = np.zeros((100, 100))
        data[20:80, 20:80] = 1.0

        w_small = compute_feather_weights(data, radius=5)
        w_large = compute_feather_weights(data, radius=30)

        # At 10px inside boundary (row 30), small radius should be ~1.0
        # but large radius should be significantly less than 1.0
        assert w_small[30, 50] > w_large[30, 50]

    def test_fraction_zero_returns_binary_mask(self):
        """fraction=0 disables feathering, returning a binary mask."""
        data = np.zeros((100, 100))
        data[20:80, 20:80] = 1.0

        weights = compute_feather_weights(data, fraction=0.0)
        assert weights is not None
        # Should be binary: 1.0 where data != 0, 0.0 where data == 0
        assert set(np.unique(weights)) == {0.0, 1.0}
        assert weights[50, 50] == 1.0
        assert weights[0, 0] == 0.0

    def test_custom_fraction_scales_radius(self):
        """Custom fraction produces proportional feather radius."""
        data = np.zeros((200, 400))
        data[10:190, 10:390] = 1.0

        w_small = compute_feather_weights(data, fraction=0.05)
        w_large = compute_feather_weights(data, fraction=0.30)

        # Both should produce feathered results (not None — partial coverage)
        assert w_small is not None
        assert w_large is not None
        # Larger fraction → wider taper → lower weight at same distance from edge
        assert w_small[20, 200] > w_large[20, 200]


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
