"""
Recipe engine for generating composite suggestions from observation sets.

Given a set of MAST observations (filter, instrument, wavelength), generates
ranked composite recipes with chromatic-ordered color assignments.
"""

import logging

from app.composite.color_mapping import chromatic_order_hues, hue_to_rgb_weights

from .models import ObservationInput, Recipe


logger = logging.getLogger(__name__)

# Known JWST filter wavelengths (micrometers) — mirrors frontend FILTER_WAVELENGTHS
FILTER_WAVELENGTHS: dict[str, float] = {
    "F070W": 0.704,
    "F090W": 0.901,
    "F115W": 1.154,
    "F140M": 1.404,
    "F150W": 1.501,
    "F162M": 1.626,
    "F164N": 1.644,
    "F150W2": 1.659,
    "F182M": 1.845,
    "F187N": 1.874,
    "F200W": 1.989,
    "F210M": 2.093,
    "F212N": 2.12,
    "F250M": 2.503,
    "F277W": 2.762,
    "F300M": 2.989,
    "F322W2": 3.232,
    "F323N": 3.237,
    "F335M": 3.362,
    "F356W": 3.568,
    "F360M": 3.624,
    "F405N": 4.052,
    "F410M": 4.082,
    "F430M": 4.28,
    "F444W": 4.421,
    "F460M": 4.624,
    "F466N": 4.654,
    "F470N": 4.707,
    "F480M": 4.817,
    "F560W": 5.6,
    "F770W": 7.7,
    "F1000W": 10.0,
    "F1130W": 11.3,
    "F1280W": 12.8,
    "F1500W": 15.0,
    "F1800W": 18.0,
    "F2100W": 21.0,
    "F2550W": 25.5,
}

# Base processing time per filter in seconds
BASE_TIME_PER_FILTER = 8


def resolve_wavelength(obs: ObservationInput) -> float | None:
    """Resolve wavelength from observation, falling back to known filter table."""
    if obs.wavelength_um is not None:
        return obs.wavelength_um
    return FILTER_WAVELENGTHS.get(obs.filter.upper())


def is_narrowband(filter_name: str) -> bool:
    """Check if a filter is narrowband (N suffix convention)."""
    return filter_name.upper().rstrip("0123456789").endswith("N") or filter_name.upper().endswith(
        "N"
    )


def is_broadband(filter_name: str) -> bool:
    """Check if a filter is broadband (W suffix convention)."""
    upper = filter_name.upper()
    return upper.endswith("W") or upper.endswith("W2")


def hue_to_hex(hue: float) -> str:
    """Convert a hue angle to a hex color string."""
    r, g, b = hue_to_rgb_weights(hue)
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"


def build_color_mapping(filters_sorted: list[str]) -> dict[str, str]:
    """Build chromatic-ordered color mapping for a sorted filter list."""
    hues = chromatic_order_hues(len(filters_sorted))
    return {f: hue_to_hex(h) for f, h in zip(filters_sorted, hues, strict=True)}


def estimate_time(num_filters: int, requires_mosaic: bool) -> int:
    """Estimate processing time in seconds."""
    base = num_filters * BASE_TIME_PER_FILTER
    if requires_mosaic:
        base = int(base * 1.5)
    return base


def generate_recipes(observations: list[ObservationInput]) -> list[Recipe]:
    """Generate ranked composite recipes from a set of observations.

    Generates up to 4 recipe types per instrument group:
    1. "All available" — every filter with chromatic ordering
    2. "Classic 3-color" — 3 well-separated wavelengths
    3. "Narrowband highlight" — narrowband filters only (if available)
    4. "Broadband clean" — broadband filters only (if enough)

    Args:
        observations: List of observations with filter/instrument/wavelength info.

    Returns:
        Ranked list of Recipe objects.
    """
    if not observations:
        return []

    # Group by instrument
    instrument_groups: dict[str, list[ObservationInput]] = {}
    for obs in observations:
        inst = obs.instrument.upper()
        instrument_groups.setdefault(inst, []).append(obs)

    all_recipes: list[Recipe] = []

    for instrument, obs_list in instrument_groups.items():
        # Deduplicate by filter name and sort by wavelength
        filter_map: dict[str, ObservationInput] = {}
        for obs in obs_list:
            key = obs.filter.upper()
            if key not in filter_map:
                filter_map[key] = obs

        # Sort by wavelength (unknown wavelengths go last)
        sorted_filters = sorted(
            filter_map.keys(),
            key=lambda f: resolve_wavelength(filter_map[f]) or float("inf"),
        )

        # Collect observation IDs
        obs_ids = [obs.observation_id for obs in obs_list if obs.observation_id]

        n_filters = len(sorted_filters)
        if n_filters == 0:
            continue

        # Recipe 1: All available filters
        all_recipes.append(
            Recipe(
                name=f"{n_filters}-filter {instrument}",
                rank=1,
                filters=sorted_filters,
                color_mapping=build_color_mapping(sorted_filters),
                instruments=[instrument],
                requires_mosaic=False,
                estimated_time_seconds=estimate_time(n_filters, False),
                observation_ids=obs_ids or None,
            )
        )

        # Recipe 2: Classic 3-color (if 3+ filters with known wavelengths)
        known_wl = [f for f in sorted_filters if resolve_wavelength(filter_map[f]) is not None]
        if len(known_wl) >= 3:
            # Pick shortest, middle, longest
            short = known_wl[0]
            long = known_wl[-1]
            mid_idx = len(known_wl) // 2
            mid = known_wl[mid_idx]
            classic_filters = [short, mid, long]

            all_recipes.append(
                Recipe(
                    name=f"Classic 3-color {instrument}",
                    rank=2,
                    filters=classic_filters,
                    color_mapping=build_color_mapping(classic_filters),
                    instruments=[instrument],
                    requires_mosaic=False,
                    estimated_time_seconds=estimate_time(3, False),
                    observation_ids=obs_ids or None,
                )
            )

        # Recipe 3: Narrowband highlight (if 2+ narrowband filters)
        narrowband = [f for f in sorted_filters if is_narrowband(f)]
        if len(narrowband) >= 2:
            all_recipes.append(
                Recipe(
                    name=f"Narrowband {instrument}",
                    rank=3,
                    filters=narrowband,
                    color_mapping=build_color_mapping(narrowband),
                    instruments=[instrument],
                    requires_mosaic=False,
                    estimated_time_seconds=estimate_time(len(narrowband), False),
                    observation_ids=obs_ids or None,
                )
            )

        # Recipe 4: Broadband clean (if 3+ broadband filters)
        broadband = [f for f in sorted_filters if is_broadband(f)]
        if len(broadband) >= 3:
            all_recipes.append(
                Recipe(
                    name=f"Broadband {instrument}",
                    rank=4,
                    filters=broadband,
                    color_mapping=build_color_mapping(broadband),
                    instruments=[instrument],
                    requires_mosaic=False,
                    estimated_time_seconds=estimate_time(len(broadband), False),
                    observation_ids=obs_ids or None,
                )
            )

    # If multiple instruments, add a combined "all instruments" recipe
    if len(instrument_groups) > 1:
        all_obs_map: dict[str, ObservationInput] = {}
        for obs in observations:
            key = obs.filter.upper()
            if key not in all_obs_map:
                all_obs_map[key] = obs

        combined_sorted = sorted(
            all_obs_map.keys(),
            key=lambda f: resolve_wavelength(all_obs_map[f]) or float("inf"),
        )
        all_instruments = sorted(instrument_groups.keys())
        all_obs_ids = [obs.observation_id for obs in observations if obs.observation_id]

        all_recipes.insert(
            0,
            Recipe(
                name=f"{len(combined_sorted)}-filter {'+'.join(all_instruments)}",
                rank=1,
                filters=combined_sorted,
                color_mapping=build_color_mapping(combined_sorted),
                instruments=all_instruments,
                requires_mosaic=False,
                estimated_time_seconds=estimate_time(len(combined_sorted), False),
                observation_ids=all_obs_ids or None,
            ),
        )
        # Bump ranks of per-instrument recipes
        for recipe in all_recipes[1:]:
            recipe.rank += 1

    return all_recipes
