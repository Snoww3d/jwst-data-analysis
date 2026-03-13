"""Tests for the discovery recipe engine."""

from datetime import UTC, datetime, timedelta

from app.discovery.models import ObservationInput
from app.discovery.recipe_engine import (
    _MJD_EPOCH,
    CURATED_RECIPES,
    DEMOTED_ALL_RANK,
    _angular_separation_arcmin,
    _bandpass_priority,
    _inject_curated_recipes,
    _is_c_prefix,
    _is_o_prefix,
    build_color_mapping,
    build_cross_instrument_color_mapping,
    deduplicate_mosaic_observations,
    generate_recipes,
    group_by_spatial_overlap,
    hue_to_hex,
    is_broadband,
    is_medium_band,
    is_narrowband,
    prune_redundant_filters,
    resolve_wavelength,
    select_best_n_filters,
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


class TestMosaicObsIdDetection:
    """Tests for c-prefix and o-prefix obs_id pattern detection."""

    def test_c_prefix_detected(self):
        assert _is_c_prefix("jw02079-c1001_t001_nircam_f200w")
        assert _is_c_prefix("jw01345-c0001_t002_miri_f770w")

    def test_o_prefix_detected(self):
        assert _is_o_prefix("jw02079-o004_t001_nircam_f200w")
        assert _is_o_prefix("jw01345-o012_t002_miri_f770w")

    def test_c_prefix_not_o(self):
        assert not _is_o_prefix("jw02079-c1001_t001_nircam_f200w")

    def test_o_prefix_not_c(self):
        assert not _is_c_prefix("jw02079-o004_t001_nircam_f200w")

    def test_neither_prefix(self):
        assert not _is_c_prefix("some-random-obs-id")
        assert not _is_o_prefix("some-random-obs-id")


class TestDeduplicateMosaicObservations:
    """Tests for c-prefix vs o-prefix observation deduplication."""

    def test_empty_observations(self):
        result = deduplicate_mosaic_observations([])
        assert result == []

    def test_no_obs_ids_unchanged(self):
        """Observations without obs_ids pass through unchanged."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        result = deduplicate_mosaic_observations(obs)
        assert len(result) == 2

    def test_o_prefix_only_unchanged(self):
        """o-prefix only observations pass through unchanged."""
        obs = [
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f200w",
            ),
            ObservationInput(
                filter="F444W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f444w",
            ),
        ]
        result = deduplicate_mosaic_observations(obs)
        assert len(result) == 2

    def test_c_prefix_only_unchanged(self):
        """c-prefix only observations pass through unchanged."""
        obs = [
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-c1001_t001_nircam_f200w",
            ),
        ]
        result = deduplicate_mosaic_observations(obs)
        assert len(result) == 1

    def test_mixed_prefers_o_prefix_without_checker(self):
        """Without availability checker, prefers o-prefix when both exist."""
        obs = [
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-c1001_t001_nircam_f200w",
            ),
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f200w",
            ),
        ]
        result = deduplicate_mosaic_observations(obs)
        assert len(result) == 1
        assert _is_o_prefix(result[0].observation_id)

    def test_mixed_always_prefers_o_prefix_even_with_checker(self):
        """Even with availability checker returning True, always prefers o-prefix.

        c-prefix products have unreliable download availability — MAST metadata
        reports them as available but actual downloads frequently fail.
        """
        obs = [
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-c1001_t001_nircam_f200w",
            ),
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f200w",
            ),
        ]
        result = deduplicate_mosaic_observations(obs, availability_checker=lambda _: True)
        assert len(result) == 1
        assert _is_o_prefix(result[0].observation_id)

    def test_mixed_prefers_o_prefix_with_false_checker(self):
        """With availability checker returning False, still prefers o-prefix."""
        obs = [
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-c1001_t001_nircam_f200w",
            ),
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f200w",
            ),
        ]
        result = deduplicate_mosaic_observations(obs, availability_checker=lambda _: False)
        assert len(result) == 1
        assert _is_o_prefix(result[0].observation_id)

    def test_checker_ignored_o_prefix_always_preferred(self):
        """Availability checker is ignored — o-prefix always preferred."""

        def failing_checker(_obs_id):
            raise ConnectionError("MAST unreachable")

        obs = [
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-c1001_t001_nircam_f200w",
            ),
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f200w",
            ),
        ]
        result = deduplicate_mosaic_observations(obs, availability_checker=failing_checker)
        assert len(result) == 1
        assert _is_o_prefix(result[0].observation_id)

    def test_different_filters_not_deduped(self):
        """c-prefix and o-prefix for different filters are kept."""
        obs = [
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-c1001_t001_nircam_f200w",
            ),
            ObservationInput(
                filter="F444W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f444w",
            ),
        ]
        result = deduplicate_mosaic_observations(obs)
        assert len(result) == 2

    def test_different_instruments_not_deduped(self):
        """c-prefix and o-prefix for different instruments are kept."""
        obs = [
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-c1001_t001_nircam_f200w",
            ),
            ObservationInput(
                filter="F200W",
                instrument="MIRI",
                observation_id="jw02079-o004_t001_miri_f200w",
            ),
        ]
        result = deduplicate_mosaic_observations(obs)
        assert len(result) == 2

    def test_multiple_filters_mixed_dedup(self):
        """Real-world scenario: multiple filters each with c-prefix and o-prefix."""
        obs = [
            # F200W: both c and o
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-c1001_t001_nircam_f200w",
            ),
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f200w",
            ),
            # F444W: both c and o
            ObservationInput(
                filter="F444W",
                instrument="NIRCAM",
                observation_id="jw02079-c1001_t001_nircam_f444w",
            ),
            ObservationInput(
                filter="F444W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f444w",
            ),
            # F770W: only o (MIRI)
            ObservationInput(
                filter="F770W",
                instrument="MIRI",
                observation_id="jw02079-o004_t001_miri_f770w",
            ),
        ]
        result = deduplicate_mosaic_observations(obs, availability_checker=lambda _: False)
        assert len(result) == 3
        obs_ids = [o.observation_id for o in result]
        # F200W and F444W should have o-prefix (c unavailable)
        assert "jw02079-o004_t001_nircam_f200w" in obs_ids
        assert "jw02079-o004_t001_nircam_f444w" in obs_ids
        # F770W kept as-is
        assert "jw02079-o004_t001_miri_f770w" in obs_ids

    def test_recipes_with_deduped_observations(self):
        """End-to-end: dedup feeds into recipe generation correctly."""
        obs = [
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-c1001_t001_nircam_f200w",
            ),
            ObservationInput(
                filter="F200W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f200w",
            ),
            ObservationInput(
                filter="F444W",
                instrument="NIRCAM",
                observation_id="jw02079-o004_t001_nircam_f444w",
            ),
        ]
        deduped = deduplicate_mosaic_observations(obs)
        recipes = generate_recipes(deduped)
        # Should have 2 unique filters, not 3 observations
        all_recipe = recipes[0]
        assert set(all_recipe.filters) == {"F200W", "F444W"}
        assert len(all_recipe.observation_ids) == 2


class TestMediumBandAndPriority:
    """Tests for medium-band detection and bandpass priority."""

    def test_medium_band_filters(self):
        assert is_medium_band("F335M")
        assert is_medium_band("F410M")
        assert is_medium_band("F140M")
        assert is_medium_band("F480M")

    def test_non_medium_band(self):
        assert not is_medium_band("F444W")
        assert not is_medium_band("F187N")
        assert not is_medium_band("F090W")

    def test_bandpass_priority_broadband_best(self):
        assert _bandpass_priority("F444W") == 0
        assert _bandpass_priority("F200W") == 0

    def test_bandpass_priority_medium_middle(self):
        assert _bandpass_priority("F335M") == 1
        assert _bandpass_priority("F410M") == 1

    def test_bandpass_priority_narrowband_lowest(self):
        assert _bandpass_priority("F187N") == 2
        assert _bandpass_priority("F470N") == 2

    def test_bandpass_priority_ordering(self):
        assert _bandpass_priority("F200W") < _bandpass_priority("F335M")
        assert _bandpass_priority("F335M") < _bandpass_priority("F187N")


class TestCuratedNGC346:
    """Tests for NGC 346 curated recipe."""

    def test_ngc346_nircam_recipe(self):
        """NGC 346 with NIRCam filters should get the STScI 2023-101 recipe."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F277W", instrument="NIRCAM"),
            ObservationInput(filter="F335M", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 346")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 1
        assert curated[0].name == "NASA NIRCam (NGC 346)"
        assert curated[0].color_mapping["F200W"] == "#0000ff"
        assert curated[0].color_mapping["F444W"] == "#ff0000"

    def test_ngc346_miri_recipe(self):
        """NGC 346 with MIRI filters should get the STScI 2023-145 recipe."""
        obs = [
            ObservationInput(filter="F770W", instrument="MIRI"),
            ObservationInput(filter="F1000W", instrument="MIRI"),
            ObservationInput(filter="F1130W", instrument="MIRI"),
            ObservationInput(filter="F1500W", instrument="MIRI"),
            ObservationInput(filter="F2100W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 346")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 1
        assert curated[0].name == "NASA MIRI (NGC 346)"
        assert curated[0].color_mapping["F1130W"] == "#00ff00"

    def test_ngc346_both_instruments(self):
        """NGC 346 with both NIRCam and MIRI should get both curated recipes."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F277W", instrument="NIRCAM"),
            ObservationInput(filter="F335M", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F770W", instrument="MIRI"),
            ObservationInput(filter="F1000W", instrument="MIRI"),
            ObservationInput(filter="F1130W", instrument="MIRI"),
            ObservationInput(filter="F1500W", instrument="MIRI"),
            ObservationInput(filter="F2100W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs, target_name="NGC 346")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 2
        names = {r.name for r in curated}
        assert "NASA NIRCam (NGC 346)" in names
        assert "NASA MIRI (NGC 346)" in names

    def test_ngc346_no_space_normalization(self):
        """'NGC346' without space should still match."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F277W", instrument="NIRCAM"),
            ObservationInput(filter="F335M", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        result = _inject_curated_recipes("NGC346", obs)
        assert len(result) == 1

    def test_ngc346_partial_filter_skip(self):
        """NGC 346 with only some MIRI filters should skip that curated recipe."""
        obs = [
            ObservationInput(filter="F770W", instrument="MIRI"),
            ObservationInput(filter="F1000W", instrument="MIRI"),
            # Missing F1130W, F1500W, F2100W
        ]
        recipes = generate_recipes(obs, target_name="NGC 346")
        curated = [r for r in recipes if r.tag == "NASA-style"]
        assert len(curated) == 0


class TestSelectBestNFilters:
    """Tests for the Best-N filter selection algorithm."""

    def test_best_n_returns_5_to_7(self):
        """Result should be clamped to 5-7 filters."""
        # 13 NIRCam filters — should select 5-7
        filters = [
            "F090W",
            "F115W",
            "F150W",
            "F200W",
            "F277W",
            "F335M",
            "F356W",
            "F410M",
            "F444W",
            "F460M",
            "F480M",
            "F140M",
            "F182M",
        ]
        instruments = dict.fromkeys(filters, "NIRCAM")
        result = select_best_n_filters(filters, instruments)
        assert 5 <= len(result) <= 7

    def test_best_n_not_generated_when_few_filters(self):
        """When <= MAX_FILTERS_FOR_BEST_N, returns all filters."""
        filters = ["F090W", "F200W", "F444W"]
        instruments = dict.fromkeys(filters, "NIRCAM")
        result = select_best_n_filters(filters, instruments)
        assert result == filters

    def test_best_n_prefers_broadband(self):
        """Broadband filters should be preferred over medium/narrow at same wavelength."""
        filters = [
            "F090W",
            "F140M",
            "F150W",
            "F200W",
            "F277W",
            "F335M",
            "F356W",
            "F410M",
            "F444W",
        ]
        instruments = dict.fromkeys(filters, "NIRCAM")
        result = select_best_n_filters(filters, instruments)
        # At ~3.5µm, F356W (broadband) should be preferred over F335M (medium)
        # At ~4.1µm, F444W (broadband) should be preferred over F410M (medium)
        broadband_count = sum(1 for f in result if is_broadband(f))
        medium_count = sum(1 for f in result if is_medium_band(f))
        assert broadband_count >= medium_count

    def test_best_n_instrument_representation(self):
        """Both instruments should be represented with min_per_instrument."""
        nircam = ["F090W", "F115W", "F150W", "F200W", "F277W", "F356W", "F444W"]
        miri = ["F770W", "F1000W", "F1500W", "F2100W"]
        all_filters = nircam + miri
        instruments = dict.fromkeys(nircam, "NIRCAM")
        instruments.update(dict.fromkeys(miri, "MIRI"))
        result = select_best_n_filters(all_filters, instruments)
        nircam_selected = [f for f in result if instruments[f] == "NIRCAM"]
        miri_selected = [f for f in result if instruments[f] == "MIRI"]
        assert len(nircam_selected) >= 2
        assert len(miri_selected) >= 2

    def test_best_n_sorted_by_wavelength(self):
        """Result should be sorted by wavelength."""
        from app.discovery.recipe_engine import FILTER_WAVELENGTHS

        filters = [
            "F090W",
            "F115W",
            "F150W",
            "F200W",
            "F277W",
            "F335M",
            "F356W",
            "F410M",
            "F444W",
        ]
        instruments = dict.fromkeys(filters, "NIRCAM")
        result = select_best_n_filters(filters, instruments)
        wavelengths = [FILTER_WAVELENGTHS[f] for f in result]
        assert wavelengths == sorted(wavelengths)

    def test_best_n_cross_instrument_integration(self):
        """Full NGC 346-like scenario: many filters → Best-N generated."""
        # Simulate 21-filter cross-instrument set
        nircam = [
            "F090W",
            "F115W",
            "F150W",
            "F162M",
            "F200W",
            "F210M",
            "F277W",
            "F300M",
            "F335M",
            "F356W",
            "F410M",
            "F444W",
            "F480M",
        ]
        miri = [
            "F560W",
            "F770W",
            "F1000W",
            "F1130W",
            "F1280W",
            "F1500W",
            "F1800W",
            "F2100W",
            "F2550W",
        ]
        obs = [ObservationInput(filter=f, instrument="NIRCAM") for f in nircam]
        obs += [ObservationInput(filter=f, instrument="MIRI") for f in miri]
        recipes = generate_recipes(obs)
        best_n = [r for r in recipes if r.tag == "Recommended"]
        all_data = [r for r in recipes if r.tag == "All data"]
        assert len(best_n) >= 1
        assert len(all_data) >= 1
        assert best_n[0].rank == 1
        assert all_data[0].rank == DEMOTED_ALL_RANK
        assert 5 <= len(best_n[0].filters) <= 7

    def test_no_best_n_when_few_cross_instrument(self):
        """When cross-instrument has <= MAX_FILTERS_FOR_BEST_N, no Best-N generated."""
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F277W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F770W", instrument="MIRI"),
            ObservationInput(filter="F1000W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs)
        best_n = [r for r in recipes if r.tag == "Recommended"]
        assert len(best_n) == 0
        # Should have a single cross-instrument recipe at rank 1
        cross = [r for r in recipes if len(r.instruments) > 1]
        assert len(cross) == 1
        assert cross[0].rank == 1


class TestPruneRedundantFilters:
    """Tests for wavelength redundancy pruning."""

    def test_close_filters_pruned(self):
        """F335M/F356W/F360M are very close — should prune to one."""
        filters = ["F277W", "F335M", "F356W", "F360M", "F444W"]
        result = prune_redundant_filters(filters)
        # F335M (3.36), F356W (3.57), F360M (3.62) are within 30% ratios
        # Should keep fewer filters in this range
        assert len(result) < len(filters)
        # Should still keep endpoints
        assert "F277W" in result
        assert "F444W" in result

    def test_separated_filters_kept(self):
        """Well-separated filters should all be kept."""
        filters = ["F090W", "F200W", "F444W"]
        result = prune_redundant_filters(filters)
        assert result == filters

    def test_broadband_preferred_in_prune(self):
        """When pruning a pair, broadband should be preferred over medium."""
        # F356W (broadband, 3.57) and F335M (medium, 3.36): ratio = 1.06 < 1.3
        filters = ["F200W", "F335M", "F356W", "F770W"]
        result = prune_redundant_filters(filters)
        # Should keep F356W (broadband) over F335M (medium)
        assert "F356W" in result
        assert "F335M" not in result

    def test_single_filter_unchanged(self):
        """Single filter should pass through unchanged."""
        result = prune_redundant_filters(["F444W"])
        assert result == ["F444W"]

    def test_empty_list(self):
        """Empty list should return empty."""
        result = prune_redundant_filters([])
        assert result == []

    def test_per_instrument_pruning_integration(self):
        """13 NIRCam filters should produce a pruned recipe + demoted all-data recipe."""
        filters = [
            "F090W",
            "F115W",
            "F140M",
            "F150W",
            "F162M",
            "F182M",
            "F200W",
            "F210M",
            "F277W",
            "F335M",
            "F356W",
            "F410M",
            "F444W",
        ]
        obs = [ObservationInput(filter=f, instrument="NIRCAM") for f in filters]
        recipes = generate_recipes(obs)
        # Should have a pruned recipe and a demoted "All data" recipe
        all_data = [r for r in recipes if r.tag == "All data"]
        assert len(all_data) >= 1
        # All-data recipe should have all 13 filters
        assert len(all_data[0].filters) == 13
        # Pruned recipe should have fewer
        nircam_recipes = [r for r in recipes if "NIRCAM" in r.instruments and r.tag != "All data"]
        pruned = [r for r in nircam_recipes if "redundant" in (r.description or "")]
        assert len(pruned) >= 1
        assert len(pruned[0].filters) < 13

    def test_no_pruning_when_few_filters(self):
        """When <= MAX_FILTERS_FOR_BEST_N filters, no pruning occurs."""
        obs = [
            ObservationInput(filter="F090W", instrument="NIRCAM"),
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
        ]
        recipes = generate_recipes(obs)
        all_data = [r for r in recipes if r.tag == "All data"]
        assert len(all_data) == 0  # No demoted recipe
