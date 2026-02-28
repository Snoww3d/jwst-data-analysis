"""Tests for the discovery recipe engine."""

from datetime import UTC, datetime, timedelta

from app.discovery.models import ObservationInput
from app.discovery.recipe_engine import (
    _MJD_EPOCH,
    build_color_mapping,
    generate_recipes,
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

    def test_two_filters(self):
        mapping = build_color_mapping(["F090W", "F444W"])
        assert len(mapping) == 2
        assert "F090W" in mapping
        assert "F444W" in mapping
        # First filter should be blue-ish, last should be red
        assert mapping["F090W"] == "#0000ff"
        assert mapping["F444W"] == "#ff0000"

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

    def test_multi_instrument_adds_combined_recipe(self):
        obs = [
            ObservationInput(filter="F200W", instrument="NIRCAM"),
            ObservationInput(filter="F444W", instrument="NIRCAM"),
            ObservationInput(filter="F770W", instrument="MIRI"),
            ObservationInput(filter="F1000W", instrument="MIRI"),
        ]
        recipes = generate_recipes(obs)
        # First recipe should be the combined one
        assert "MIRI+NIRCAM" in recipes[0].name or "NIRCAM+MIRI" in recipes[0].name
        assert recipes[0].rank == 1
        assert len(recipes[0].filters) == 4

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
