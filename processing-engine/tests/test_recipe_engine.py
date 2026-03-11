"""Tests for the discovery recipe engine."""

from datetime import UTC, datetime, timedelta

from app.discovery.models import ObservationInput
from app.discovery.recipe_engine import (
    _MJD_EPOCH,
    CURATED_RECIPES,
    _angular_separation_arcmin,
    _inject_curated_recipes,
    build_color_mapping,
    build_cross_instrument_color_mapping,
    generate_recipes,
    group_by_spatial_overlap,
    hue_to_hex,
    is_broadband,
    is_narrowband,
    resolve_wavelength,
)


class TestResolveWavelength:
    """Tests for wavelength resolution from observations."""

    def test_uses_explicit_wavelength(self):
        obs = ObservationInput(filter="F444W", instrument="NIRCAM", wavelength_um=4.5)
        assert resolve_wavelength(obs) == 4.5

    def test_falls_back_to_lookup_table(self):
        obs = ObservationInput(filter="F444W", instrument="NIRCAM")
        assert resolve_wavelength(obs) == 4.421

    def test_returns_none_for_unknown_filter(self):
        obs = ObservationInput(filter="UNKNOWN", instrument="NIRCAM")
        assert resolve_wavelength(obs) is None

    def test_case_insensitive_lookup(self):
        obs = ObservationInput(filter="f444w", instrument="NIRCAM")
        assert resolve_wavelength(obs) == 4.421


class TestFilterClassification:
    """Tests for narrowband/broadband filter classification."""

    def test_narrowband_filters(self):
        assert is_narrowband("F187N")
        assert is_narrowband("F470N")
        assert is_narrowband("F164N")
        assert is_narrowband("F323N")

    def test_broadband_filters(self):
        assert is_broadband("F444W")
        assert is_broadband("F200W")
        assert is_broadband("F150W2")
        assert is_broadband("F090W")

    def test_medium_band_not_narrowband(self):
        assert not is_narrowband("F335M")
        assert not is_narrowband("F410M")

    def test_medium_band_not_broadband(self):
        assert not is_broadband("F335M")
        assert not is_broadband("F410M")


class TestHueToHex:
    """Tests for hue-to-hex conversion."""

    def test_red(self):
        assert hue_to_hex(0) == "#ff0000"

    def test_green(self):
        assert hue_to_hex(120) == "#00ff00"

    def test_blue(self):
        assert hue_to_hex(240) == "#0000ff"


class TestBuildColorMapping:
    """Tests for chromatic-ordered color mapping."""

    def test_two_filters_bicolor(self):
        mapping = build_color_mapping(["F090W", "F444W"])
        assert len(mapping) == 2
        assert "F090W" in mapping
        assert "F444W" in mapping
        # 2-filter bicolor: short → cyan-blue, long → orange-red (synthetic green)
        assert mapping["F090W"] == "#0080ff"
        assert mapping["F444W"] == "#ff8000"

    def test_three_filters(self):
        mapping = build_color_mapping(["F090W", "F200W", "F444W"])
        assert len(mapping) == 3
        assert mapping["F090W"] == "#0000ff"
        assert mapping["F444W"] == "#ff0000"

    def test_single_filter(self):
        mapping = build_color_mapping(["F444W"])
        assert mapping["F444W"] == "#ff0000"


class TestGenerateRecipes:
    """Tests for the main recipe generation logic."""

    def test_empty_observations_returns_empty(self):
        assert generate_recipes([]) == []

    def test_single_filter_single_recipe(self):
        obs = [ObservationInput(filter="F444W", instrument="NIRCAM")]
        recipes = generate_recipes(obs)
        assert len(recipes) == 1
        assert recipes[0].name == "1-filter NIRCAM"
        assert recipes[0].rank == 1
        assert recipes[0].filters == ["F444W"]

    def test_three_filters_produces_all_and_classic(self):
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        names = [r.name for r in recipes]
        assert "3-filter NIRCAM" in names
        assert "Classic 3-color NIRCAM" in names

    def test_classic_picks_short_mid_long(self):
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F335M", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        classic = next(r for r in recipes if r.name.startswith("Classic"))
        assert classic.filters[0] == "F090W"  # shortest
        assert classic.filters[-1] == "F444W"  # longest
        assert len(classic.filters) == 3

    def test_narrowband_recipe_generated(self):
        obs = [
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F470N", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        names = [r.name for r in recipes]
        assert "Narrowband NIRCAM" in names
        narrow = next(r for r in recipes if r.name == "Narrowband NIRCAM")
        assert set(narrow.filters) == {"F187N", "F470N"}

    def test_broadband_recipe_generated(self):
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        names = [r.name for r in recipes]
        assert "Broadband NIRCAM" in names
        broad = next(r for r in recipes if r.name == "Broadband NIRCAM")
        assert all(is_broadband(f) for f in broad.filters)

    def test_multi_instrument_cross_instrument_ranked_first(self):
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F770W", instrument="MIRI"),
            ObservationInput(filter="F1000W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs)
        combined = [r for r in recipes if "MIRI+NIRCAM" in r.name or "NIRCAM+MIRI" in r.name]
        assert len(combined) == 1
        # Cross-instrument recipe is rank 1 (recommended) when multiple instruments present
        assert combined[0].rank == 1
        assert len(combined[0].filters) == 4
        # Single-instrument recipes should rank after cross-instrument
        single_inst = [r for r in recipes if len(r.instruments) == 1]
        assert all(r.rank > combined[0].rank for r in single_inst)

    def test_deduplicates_filters(self):
        obs = [
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        all_recipe = next(r for r in recipes if "2-filter" in r.name)
        assert len(all_recipe.filters) == 2

    def test_recipes_have_color_mappings(self):
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        for recipe in recipes:
            assert len(recipe.color_mapping) == len(recipe.filters)
            for f in recipe.filters:
                assert f in recipe.color_mapping
                assert recipe.color_mapping[f].startswith("#")
                assert len(recipe.color_mapping[f]) == 7

    def test_recipes_have_estimated_time(self):
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        for recipe in recipes:
            assert recipe.estimated_time_seconds > 0

    def test_observation_ids_passed_through(self):
        obs = [
            ObservationInput(filter="F444W", instrument="NIRCAM", observation_id="obs-123"),
            ObservationInput(filter="F200W", instrument="NIRCAM", observation_id="obs-456"),
        ]
        recipes = generate_recipes(obs)
        assert recipes[0].observation_ids is not None
        assert "obs-123" in recipes[0].observation_ids
        assert "obs-456" in recipes[0].observation_ids

    def test_filters_sorted_by_wavelength(self):
        obs = [
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        all_recipe = recipes[0]
        assert all_recipe.filters == ["F090W", "F200W", "F444W"]

    def test_cranium_nebula_nircam(self):
        """Real-world test: Cranium Nebula NIRCam filters from NASA release."""
        obs = [
            ObservationInput(filter="F150W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F470N", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        all_recipe = recipes[0]
        # Should produce blue, cyan-green, orange, red — spread across the spectrum
        assert all_recipe.filters == ["F150W", "F187N", "F444W", "F470N"]
        assert len(all_recipe.color_mapping) == 4
        # First filter should be blue
        assert all_recipe.color_mapping["F150W"] == "#0000ff"
        # Last filter should be red
        assert all_recipe.color_mapping["F470N"] == "#ff0000"

    def test_miri_only_instruments(self):
        obs = [
            ObservationInput(filter="F1000W", instrument="MIRI"),
            ObservationInput(filter="F1800W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs)
        assert all("MIRI" in r.instruments for r in recipes)

    def test_two_narrowband_insufficient_for_broadband(self):
        """Two broadband filters shouldn't generate a broadband recipe (need 3+)."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        names = [r.name for r in recipes]
        assert not any("Broadband" in n for n in names)

    def test_no_duplicate_broadband_when_all_broadband(self):
        """When all filters are broadband, skip the Broadband recipe (identical to all)."""
        obs = [
            ObservationInput(filter="F770W", instrument="MIRI"),
            ObservationInput(filter="F1130W", instrument="MIRI"),
            ObservationInput(filter="F1280W", instrument="MIRI"),
            ObservationInput(filter="F1800W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs)
        names = [r.name for r in recipes]
        assert "4-filter MIRI" in names
        assert "Broadband MIRI" not in names

    def test_no_duplicate_narrowband_when_all_narrowband(self):
        """When all filters are narrowband, skip the Narrowband recipe (identical to all)."""
        obs = [
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F212N", instrument="NIRCAM"),
            ObservationInput(filter="F470N", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        names = [r.name for r in recipes]
        assert "3-filter NIRCAM" in names
        assert "Narrowband NIRCAM" not in names


class TestProprietaryFiltering:
    """Tests for filtering proprietary (unreleased) observations."""

    def _future_mjd(self, days_ahead: int = 365) -> float:
        """Return an MJD value in the future."""
        return (datetime.now(UTC) + timedelta(days=days_ahead) - _MJD_EPOCH).days

    def _past_mjd(self, days_ago: int = 365) -> float:
        """Return an MJD value in the past."""
        return (datetime.now(UTC) - timedelta(days=days_ago) - _MJD_EPOCH).days

    def test_proprietary_observations_excluded(self):
        """Observations with future t_obs_release should be filtered out."""
        obs = [
            ObservationInput(filter="F444W", instrument="NIRCAM", t_obs_release=self._future_mjd()),
            ObservationInput(filter="F200W", instrument="NIRCAM", t_obs_release=self._past_mjd()),
        ]
        recipes = generate_recipes(obs)
        assert len(recipes) == 1
        assert recipes[0].filters == ["F200W"]

    def test_all_proprietary_returns_empty(self):
        """If all observations are proprietary, return no recipes."""
        obs = [
            ObservationInput(filter="F444W", instrument="NIRCAM", t_obs_release=self._future_mjd()),
            ObservationInput(filter="F200W", instrument="NIRCAM", t_obs_release=self._future_mjd()),
        ]
        recipes = generate_recipes(obs)
        assert recipes == []

    def test_none_release_date_treated_as_public(self):
        """Observations without t_obs_release should be treated as public."""
        obs = [
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        assert len(recipes) >= 1
        assert set(recipes[0].filters) == {"F200W", "F444W"}

    def test_mixed_public_and_no_release_date(self):
        """Mix of explicit public dates and None should all pass through."""
        obs = [
            ObservationInput(filter="F444W", instrument="NIRCAM", t_obs_release=self._past_mjd()),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F090W", instrument="NIRCAM", t_obs_release=self._future_mjd()),
        ]
        recipes = generate_recipes(obs)
        all_recipe = recipes[0]
        assert "F090W" not in all_recipe.filters
        assert "F444W" in all_recipe.filters
        assert "F200W" in all_recipe.filters


class TestSpectralFiltering:
    """Tests for filtering spectral (non-image) observations."""

    def test_spectral_observations_excluded(self):
        """Observations with dataproduct_type='spectrum' should be filtered out."""
        obs = [
            ObservationInput(filter="G140H", instrument="NIRSPEC", dataproduct_type="spectrum"),
            ObservationInput(filter="G235H", instrument="NIRSPEC", dataproduct_type="spectrum"),
        ]
        recipes = generate_recipes(obs)
        assert recipes == []

    def test_mixed_image_and_spectral(self):
        """Only image observations should produce recipes; spectral ones excluded."""
        obs = [
            ObservationInput(filter="F444W", instrument="NIRCAM", dataproduct_type="image"),
            ObservationInput(filter="F200W", instrument="NIRCAM", dataproduct_type="image"),
            ObservationInput(filter="G140H", instrument="NIRSPEC", dataproduct_type="spectrum"),
        ]
        recipes = generate_recipes(obs)
        assert len(recipes) >= 1
        all_filters = {f for r in recipes for f in r.filters}
        assert "G140H" not in all_filters
        assert "F444W" in all_filters
        assert "F200W" in all_filters

    def test_none_dataproduct_type_treated_as_image(self):
        """Observations without dataproduct_type should pass through (backward compat)."""
        obs = [
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        assert len(recipes) >= 1
        assert set(recipes[0].filters) == {"F200W", "F444W"}


class TestCrossInstrumentColorMapping:
    """Tests for instrument-aware cross-instrument color mapping."""

    def test_nircam_cool_miri_warm(self):
        """NIRCam filters should get cool hues (120-240), MIRI warm hues (0-60)."""
        filters = ["F200W", "F444W", "F770W", "F1000W"]
        mapping = build_cross_instrument_color_mapping(filters)
        assert len(mapping) == 4

        # NIRCam (F200W, F444W) should be blue-to-green range
        # F200W → 240° (blue), F444W → 120° (green)
        assert mapping["F200W"] == hue_to_hex(240.0)
        assert mapping["F444W"] == hue_to_hex(120.0)
        # MIRI (F770W, F1000W) should be yellow-to-red range
        # F770W → 60° (yellow), F1000W → 0° (red)
        assert mapping["F770W"] == hue_to_hex(60.0)
        assert mapping["F1000W"] == hue_to_hex(0.0)

    def test_single_nircam_single_miri(self):
        """Single filter per instrument gets the midpoint hue."""
        filters = ["F200W", "F770W"]
        mapping = build_cross_instrument_color_mapping(filters)
        assert mapping["F200W"] == hue_to_hex(180.0)  # cyan
        assert mapping["F770W"] == hue_to_hex(30.0)  # orange

    def test_cross_instrument_ngc5134(self):
        """Real-world NGC 5134 PHANGS-JWST filter set."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F300M", instrument="NIRCAM"),
            ObservationInput(filter="F335M", instrument="NIRCAM"),
            ObservationInput(filter="F360M", instrument="NIRCAM"),
            ObservationInput(filter="F770W", instrument="MIRI"),
            ObservationInput(filter="F2100W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs)

        # Cross-instrument recipe should be first (rank 1)
        assert recipes[0].rank == 1
        assert len(recipes[0].instruments) == 2
        assert len(recipes[0].filters) == 6

        # Verify color separation: NIRCam filters have cool hues, MIRI warm
        mapping = recipes[0].color_mapping
        nircam_filters = ["F200W", "F300M", "F335M", "F360M"]
        miri_filters = ["F770W", "F2100W"]

        # All NIRCam and MIRI colors should be present
        for f in nircam_filters + miri_filters:
            assert f in mapping

    def test_build_cross_instrument_color_mapping_three_nircam(self):
        """Three NIRCam filters should span blue→green evenly."""
        filters = ["F200W", "F300M", "F444W", "F770W"]
        mapping = build_cross_instrument_color_mapping(filters)
        # F200W → 240° (blue), F300M → 180° (cyan), F444W → 120° (green)
        assert mapping["F200W"] == hue_to_hex(240.0)
        assert mapping["F300M"] == hue_to_hex(180.0)
        assert mapping["F444W"] == hue_to_hex(120.0)
        # Single MIRI → 30° (orange)
        assert mapping["F770W"] == hue_to_hex(30.0)

    def test_uses_authoritative_instrument_data(self):
        """When filter_instruments is provided, uses it instead of wavelength inference."""
        filters = ["F200W", "F770W"]
        # Override: pretend F770W is NIRCam (shouldn't happen, but tests the path)
        mapping = build_cross_instrument_color_mapping(
            filters, filter_instruments={"F200W": "NIRCAM", "F770W": "NIRCAM"}
        )
        # Both should get cool hues since both are "NIRCAM"
        assert mapping["F200W"] == hue_to_hex(240.0)
        assert mapping["F770W"] == hue_to_hex(120.0)

    def test_fallback_when_no_instrument_data(self):
        """Without filter_instruments, falls back to wavelength-based inference."""
        filters = ["F200W", "F770W"]
        mapping_no_inst = build_cross_instrument_color_mapping(filters)
        mapping_with_inst = build_cross_instrument_color_mapping(
            filters, filter_instruments={"F200W": "NIRCAM", "F770W": "MIRI"}
        )
        # Both paths should produce the same result for correct instrument data
        assert mapping_no_inst == mapping_with_inst

    def test_all_nircam_only_cool_hues(self):
        """All-NIRCam filters should produce only cool hues."""
        filters = ["F090W", "F200W", "F444W"]
        mapping = build_cross_instrument_color_mapping(filters)
        # Should span blue → green
        assert mapping["F090W"] == hue_to_hex(240.0)
        assert mapping["F200W"] == hue_to_hex(180.0)
        assert mapping["F444W"] == hue_to_hex(120.0)


class TestSingleInstrumentRankingUnchanged:
    """Verify single-instrument targets are unaffected by ranking changes."""

    def test_single_instrument_rank_starts_at_1(self):
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        assert recipes[0].rank == 1
        assert recipes[0].name == "3-filter NIRCAM"

    def test_single_instrument_classic_rank_2(self):
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        classic = next(r for r in recipes if "Classic" in r.name)
        assert classic.rank == 2


class TestRecipeDescriptions:
    """Tests for recipe description field."""

    def test_recipes_have_descriptions(self):
        """All recipes should have non-None descriptions."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F470N", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        for recipe in recipes:
            assert recipe.description is not None, f"Recipe '{recipe.name}' has no description"
            assert len(recipe.description) > 0

    def test_cross_instrument_description(self):
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F770W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs)
        cross = next(r for r in recipes if len(r.instruments) > 1)
        assert "Stars and dust" in cross.description


class TestNonScienceFilterExclusion:
    """Tests for filtering non-science observations (calibration darks, flats, etc.)."""

    def test_opaque_mirror_excluded(self):
        """OPAQUE;MIRROR (calibration dark) should be filtered out."""
        obs = [
            ObservationInput(filter="OPAQUE;MIRROR", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        all_filters = {f for r in recipes for f in r.filters}
        assert "OPAQUE;MIRROR" not in all_filters
        assert "F200W" in all_filters
        assert "F444W" in all_filters

    def test_all_non_science_returns_empty(self):
        """If all observations are non-science, return no recipes."""
        obs = [
            ObservationInput(filter="OPAQUE;MIRROR", instrument="NIRCAM"),
            ObservationInput(filter="CLEAR", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        assert recipes == []

    def test_mixed_science_and_non_science(self):
        """Non-science filters excluded, science filters produce recipes."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="OPAQUE;MIRROR", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="FLAT", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        assert len(recipes) >= 1
        all_filters = {f for r in recipes for f in r.filters}
        assert all_filters == {"F200W", "F444W"}

    def test_grism_filter_excluded(self):
        """Grism/prism filters (GR150R, GR150C) should be excluded."""
        obs = [
            ObservationInput(filter="GR150R", instrument="NIRISS"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        all_filters = {f for r in recipes for f in r.filters}
        assert "GR150R" not in all_filters
        assert "F200W" in all_filters

    def test_known_science_filters_preserved(self):
        """All standard imaging filters should pass through the filter."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F770W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs)
        all_filters = {f for r in recipes for f in r.filters}
        assert all_filters == {"F090W", "F200W", "F444W", "F770W"}


class TestSpatialGrouping:
    """Tests for spatial overlap detection and grouping."""

    def test_angular_separation_same_point(self):
        """Identical coordinates should have zero separation."""
        assert _angular_separation_arcmin(180.0, -30.0, 180.0, -30.0) == 0.0

    def test_angular_separation_known_distance(self):
        """One degree apart in declination = 60 arcminutes."""
        sep = _angular_separation_arcmin(0.0, 0.0, 0.0, 1.0)
        assert abs(sep - 60.0) < 0.01

    def test_overlapping_observations_same_group(self):
        """Observations at the same position should be in one group."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM", s_ra=180.0, s_dec=-30.0),
            ObservationInput(filter="F770W", instrument="MIRI", s_ra=180.0, s_dec=-30.0),
        ]
        groups = group_by_spatial_overlap(obs)
        assert len(groups) == 1
        assert len(groups[0]) == 2

    def test_non_overlapping_separate_groups(self):
        """Observations 10' apart should be in separate groups."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0),
            ObservationInput(filter="F770W", instrument="MIRI", s_ra=180.2, s_dec=0.0),
        ]
        groups = group_by_spatial_overlap(obs)
        assert len(groups) == 2

    def test_no_coordinates_fallback(self):
        """Observations without coordinates should be in a single group."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F770W", instrument="MIRI"),
        ]
        groups = group_by_spatial_overlap(obs)
        assert len(groups) == 1
        assert len(groups[0]) == 2

    def test_mixed_coords_included_everywhere(self):
        """Obs without coords should be included in all groups."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0),
            ObservationInput(filter="F770W", instrument="MIRI", s_ra=180.2, s_dec=0.0),
            ObservationInput(filter="F444W", instrument="NIRCAM"),  # no coords
        ]
        groups = group_by_spatial_overlap(obs)
        assert len(groups) == 2
        # The no-coords observation should be in both groups
        for group in groups:
            filters = {o.filter for o in group}
            assert "F444W" in filters

    def test_cross_instrument_only_when_overlapping(self):
        """Cross-instrument recipe should only include overlapping observations."""
        obs = [
            # Overlapping group at (180.0, 0.0)
            ObservationInput(filter="F200W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0),
            ObservationInput(filter="F770W", instrument="MIRI", s_ra=180.0, s_dec=0.0),
            # Distant NIRCAM at (180.2, 0.0) — ~12' away
            ObservationInput(filter="F444W", instrument="NIRCAM", s_ra=180.2, s_dec=0.0),
        ]
        recipes = generate_recipes(obs)
        cross = [r for r in recipes if len(r.instruments) > 1]
        assert len(cross) == 1
        # Cross-instrument should only have the overlapping pair
        assert set(cross[0].filters) == {"F200W", "F770W"}

    def test_no_cross_instrument_when_no_overlap(self):
        """No cross-instrument recipe when instruments don't overlap spatially."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0),
            ObservationInput(filter="F444W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0),
            ObservationInput(filter="F770W", instrument="MIRI", s_ra=180.2, s_dec=0.0),
        ]
        recipes = generate_recipes(obs)
        cross = [r for r in recipes if len(r.instruments) > 1]
        assert len(cross) == 0
        # Single-instrument recipes should start at rank 1 (no offset)
        assert recipes[0].rank == 1

    def test_requires_mosaic_different_pointings(self):
        """Same filter at different pointings should set requires_mosaic."""
        obs = [
            ObservationInput(
                filter="F200W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0, observation_id="a"
            ),
            ObservationInput(
                filter="F200W", instrument="NIRCAM", s_ra=180.01, s_dec=0.0, observation_id="b"
            ),
            ObservationInput(
                filter="F444W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0, observation_id="c"
            ),
        ]
        recipes = generate_recipes(obs)
        all_recipe = next(r for r in recipes if "NIRCAM" in r.name and "filter" in r.name)
        assert all_recipe.requires_mosaic is True

    def test_requires_mosaic_same_pointing(self):
        """Same filter at same pointing should not set requires_mosaic."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0),
            ObservationInput(filter="F444W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0),
        ]
        recipes = generate_recipes(obs)
        all_recipe = next(r for r in recipes if "NIRCAM" in r.name and "filter" in r.name)
        assert all_recipe.requires_mosaic is False

    def test_chain_overlap_transitive(self):
        """A overlaps B, B overlaps C, but A doesn't overlap C — all in one group."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0),
            ObservationInput(
                filter="F444W", instrument="NIRCAM", s_ra=180.015, s_dec=0.0
            ),  # ~0.9' from A
            ObservationInput(
                filter="F770W", instrument="MIRI", s_ra=180.03, s_dec=0.0
            ),  # ~1.8' from A, ~0.9' from B
        ]
        groups = group_by_spatial_overlap(obs)
        assert len(groups) == 1
        assert len(groups[0]) == 3

    def test_overlap_warning_when_no_coords(self):
        """Cross-instrument recipe without coords should have overlap warning."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F770W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs)
        cross = next(r for r in recipes if len(r.instruments) > 1)
        assert cross.overlap_warning is not None
        assert "coordinate data" in cross.overlap_warning.lower()

    def test_no_overlap_warning_when_coords_present(self):
        """Cross-instrument recipe with coords should not have overlap warning."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0),
            ObservationInput(filter="F770W", instrument="MIRI", s_ra=180.0, s_dec=0.0),
        ]
        recipes = generate_recipes(obs)
        cross = next(r for r in recipes if len(r.instruments) > 1)
        assert cross.overlap_warning is None


class TestCuratedRecipes:
    """Tests for curated NASA-style recipe injection."""

    def test_curated_recipe_injected_for_known_target(self):
        """NGC 3132 should get a NASA-style curated recipe."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F212N", instrument="NIRCAM"),
            ObservationInput(filter="F356W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 3132")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) >= 1
        assert curated[0].rank == 0
        assert curated[0].name == "NASA NIRCam (Southern Ring)"
        assert curated[0].color_mapping["F090W"] == "#0000ff"

    def test_curated_recipe_skipped_when_filters_missing(self):
        """If required filters are absent, curated recipe is not injected."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 3132")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 0

    def test_curated_recipe_not_injected_for_unknown_target(self):
        """Unknown target names should not produce curated recipes."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F212N", instrument="NIRCAM"),
            ObservationInput(filter="F356W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 9999")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 0

    def test_curated_recipe_case_insensitive(self):
        """Target name matching should be case-insensitive."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F212N", instrument="NIRCAM"),
            ObservationInput(filter="F356W", instrument="NIRCAM"),
        ]
        result = _inject_curated_recipes("ngc 3132", obs)
        assert len(result) >= 1
        result2 = _inject_curated_recipes("NGC 3132", obs)
        assert len(result2) >= 1

    def test_curated_recipes_appear_before_auto(self):
        """Curated recipes (rank 0) should come before auto-generated ones (rank >= 1)."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F212N", instrument="NIRCAM"),
            ObservationInput(filter="F356W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 3132")
        assert recipes[0].tag == "NASA-style"
        assert recipes[0].rank == 0
        assert all(r.rank >= 1 for r in recipes[1:])

    def test_no_target_name_skips_curated(self):
        """When target_name is None, no curated recipes are injected."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F212N", instrument="NIRCAM"),
            ObservationInput(filter="F356W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs, target_name=None)
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 0

    def test_curated_recipes_data_integrity(self):
        """All curated recipes should reference only known filters."""
        from app.discovery.recipe_engine import FILTER_WAVELENGTHS

        for target, defs in CURATED_RECIPES.items():
            for defn in defs:
                for f in defn["filters"]:
                    assert f in FILTER_WAVELENGTHS, (
                        f"Curated recipe '{defn['name']}' for {target} "
                        f"references unknown filter {f}"
                    )
                    assert f in defn["color_mapping"], (
                        f"Curated recipe '{defn['name']}' for {target} missing color for filter {f}"
                    )

    def test_partial_filter_match_nircam_only(self):
        """NGC 3132 with only NIRCam filters should get only the NIRCam curated recipe."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F212N", instrument="NIRCAM"),
            ObservationInput(filter="F356W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 3132")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 1
        assert curated[0].name == "NASA NIRCam (Southern Ring)"

    def test_partial_filter_match_miri_only(self):
        """NGC 3132 with only MIRI filters should get only the MIRI curated recipe."""
        obs = [
            ObservationInput(filter="F770W", instrument="MIRI"),
            ObservationInput(filter="F1130W", instrument="MIRI"),
            ObservationInput(filter="F1280W", instrument="MIRI"),
            ObservationInput(filter="F1800W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 3132")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 1
        assert curated[0].name == "NASA MIRI (Southern Ring)"

    def test_alias_resolution(self):
        """NGC 6611 should resolve to M16 Pillars of Creation curated recipe."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F335M", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 6611")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 1
        assert "Pillars" in curated[0].name

    def test_obs_ids_filtered_to_recipe_filters(self):
        """Curated recipe should only include obs IDs for its own filters."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM", observation_id="obs-090"),
            ObservationInput(filter="F187N", instrument="NIRCAM", observation_id="obs-187"),
            ObservationInput(filter="F212N", instrument="NIRCAM", observation_id="obs-212"),
            ObservationInput(filter="F356W", instrument="NIRCAM", observation_id="obs-356"),
            ObservationInput(filter="F444W", instrument="NIRCAM", observation_id="obs-444"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 3132")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 1
        # Should only have obs IDs for F090W, F187N, F212N, F356W — not F444W
        assert set(curated[0].observation_ids) == {"obs-090", "obs-187", "obs-212", "obs-356"}

    def test_curated_recipe_detects_mosaic(self):
        """Curated recipe should set requires_mosaic when filter has multiple pointings."""
        obs = [
            ObservationInput(
                filter="F090W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0, observation_id="a"
            ),
            ObservationInput(
                filter="F090W", instrument="NIRCAM", s_ra=180.01, s_dec=0.0, observation_id="b"
            ),
            ObservationInput(
                filter="F187N", instrument="NIRCAM", s_ra=180.0, s_dec=0.0, observation_id="c"
            ),
            ObservationInput(
                filter="F212N", instrument="NIRCAM", s_ra=180.0, s_dec=0.0, observation_id="d"
            ),
            ObservationInput(
                filter="F356W", instrument="NIRCAM", s_ra=180.0, s_dec=0.0, observation_id="e"
            ),
        ]
        recipes = generate_recipes(obs, target_name="NGC 3132")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 1
        assert curated[0].requires_mosaic is True

    def test_target_name_no_space_normalized(self):
        """'NGC3132' (no space) should still match 'ngc 3132'."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F187N", instrument="NIRCAM"),
            ObservationInput(filter="F212N", instrument="NIRCAM"),
            ObservationInput(filter="F356W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs, target_name="NGC3132")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) >= 1
