"""
Recipe engine for generating composite suggestions from observation sets.

Given a set of MAST observations (filter, instrument, wavelength), generates
ranked composite recipes with chromatic-ordered color assignments.
"""

import logging
import math
from datetime import UTC, datetime

from app.composite.color_mapping import chromatic_order_hues, hue_to_rgb_weights

from .models import ObservationInput, Recipe


# MJD epoch: November 17, 1858
_MJD_EPOCH = datetime(1858, 11, 17, tzinfo=UTC)


logger = logging.getLogger(__name__)

# Known JWST filter wavelengths (micrometers)
# Keep in sync with frontend/jwst-frontend/src/utils/wavelengthUtils.ts:FILTER_WAVELENGTHS
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

# Known JWST instrument FOV radii (arcminutes) — conservative estimates
INSTRUMENT_FOV_RADIUS_ARCMIN = {
    "NIRCAM": 1.1,  # ~2.2' square field
    "MIRI": 0.75,  # ~1.23'×1.88' (conservative)
    "NIRISS": 1.1,
    "NIRSPEC": 1.6,  # MSA
}

# Default FOV radius when instrument not in lookup
DEFAULT_FOV_RADIUS_ARCMIN = 1.1


# Curated NASA-style recipes for famous JWST targets.
# Each entry maps a target name (lowered) to a list of recipe definitions.
# Filters are listed shortest→longest wavelength; color_mapping uses exact hex colors
# matching STScI/NASA press-release color assignments.
# Only filters available in the user's observation set are used — if a recipe's
# required filters aren't all present, it's silently skipped.
CURATED_RECIPES: dict[str, list[dict]] = {
    "ngc 3132": [
        {
            "name": "NASA NIRCam (Southern Ring)",
            "filters": ["F090W", "F187N", "F212N", "F356W"],
            "color_mapping": {
                "F090W": "#0000ff",  # Blue
                "F187N": "#00ffff",  # Cyan
                "F212N": "#00ff00",  # Green
                "F356W": "#ff0000",  # Red
            },
            "instruments": ["NIRCAM"],
            "description": "NASA press-release color assignment for the Southern Ring Nebula (NIRCam)",
        },
        {
            "name": "NASA MIRI (Southern Ring)",
            "filters": ["F770W", "F1130W", "F1280W", "F1800W"],
            "color_mapping": {
                "F770W": "#0000ff",  # Blue
                "F1130W": "#00ffff",  # Cyan
                "F1280W": "#ffff00",  # Yellow
                "F1800W": "#ff0000",  # Red
            },
            "instruments": ["MIRI"],
            "description": "NASA press-release color assignment for the Southern Ring Nebula (MIRI)",
        },
    ],
    "ngc 3324": [
        {
            "name": "NASA NIRCam (Cosmic Cliffs)",
            "filters": ["F090W", "F187N", "F200W", "F335M", "F444W"],
            "color_mapping": {
                "F090W": "#0000ff",  # Blue
                "F187N": "#00ffff",  # Cyan
                "F200W": "#00ff00",  # Green
                "F335M": "#ff8000",  # Orange
                "F444W": "#ff0000",  # Red
            },
            "instruments": ["NIRCAM"],
            "description": "NASA press-release color assignment for the Carina Nebula Cosmic Cliffs",
        },
    ],
    "stephan's quintet": [
        {
            "name": "NASA NIRCam+MIRI (Stephan's Quintet)",
            "filters": ["F090W", "F150W", "F200W", "F277W", "F356W", "F444W", "F770W"],
            "color_mapping": {
                "F090W": "#0000ff",  # Blue
                "F150W": "#0080ff",  # Blue-cyan
                "F200W": "#00ffff",  # Cyan
                "F277W": "#00ff00",  # Green
                "F356W": "#ffff00",  # Yellow
                "F444W": "#ff8000",  # Orange
                "F770W": "#ff0000",  # Red
            },
            "instruments": ["NIRCAM", "MIRI"],
            "description": "NASA press-release color assignment for Stephan's Quintet",
        },
    ],
    "smacs 0723": [
        {
            "name": "NASA Deep Field (SMACS 0723)",
            "filters": ["F090W", "F150W", "F200W", "F277W", "F356W", "F444W"],
            "color_mapping": {
                "F090W": "#0000ff",  # Blue
                "F150W": "#0080ff",  # Blue-cyan
                "F200W": "#00ffff",  # Cyan
                "F277W": "#00ff00",  # Green
                "F356W": "#ffff00",  # Yellow
                "F444W": "#ff0000",  # Red
            },
            "instruments": ["NIRCAM"],
            "description": "NASA press-release color assignment for Webb's First Deep Field",
        },
    ],
    "m16": [
        {
            "name": "NASA Pillars of Creation",
            "filters": ["F090W", "F187N", "F200W", "F335M", "F444W"],
            "color_mapping": {
                "F090W": "#0000ff",
                "F187N": "#00ffff",
                "F200W": "#00ff00",
                "F335M": "#ff8000",
                "F444W": "#ff0000",
            },
            "instruments": ["NIRCAM"],
            "description": "NASA press-release color assignment for the Pillars of Creation",
        },
    ],
}

# Aliases: alternate catalog names pointing to the same curated recipes
_CURATED_ALIASES: dict[str, str] = {
    "ngc 7320": "stephan's quintet",
    "ngc 6611": "m16",
}


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


def build_cross_instrument_color_mapping(
    filters_sorted: list[str],
    filter_instruments: dict[str, str] | None = None,
) -> dict[str, str]:
    """Build instrument-aware color mapping for cross-instrument recipes.

    NIRCam filters get cool hues (blue 240° → green 120°) representing starlight.
    MIRI filters get warm hues (yellow 60° → red 0°) representing dust emission.
    This matches physical intuition and NASA/ESA convention.

    Uses per-instrument "all" recipes keep the full chromatic range via
    build_color_mapping(), while cross-instrument recipes constrain each
    instrument to a distinct hue band so users can visually distinguish
    stellar (NIRCam) from dust (MIRI) contributions.

    Args:
        filters_sorted: Filter names sorted by wavelength.
        filter_instruments: Optional map of filter name → instrument name.
            If provided, uses authoritative instrument data. Falls back to
            wavelength-based inference (NIRCam < 5µm, MIRI >= 5µm).
    """

    def is_miri(f: str) -> bool:
        if filter_instruments and f in filter_instruments:
            return filter_instruments[f].upper().startswith("MIRI")
        # Fallback: infer from wavelength lookup table
        wl = FILTER_WAVELENGTHS.get(f.upper())
        return wl is not None and wl >= 5.0

    nircam = [f for f in filters_sorted if not is_miri(f)]
    miri = [f for f in filters_sorted if is_miri(f)]

    mapping: dict[str, str] = {}

    # NIRCam: blue (240°) → green (120°), evenly spaced
    if len(nircam) == 1:
        mapping[nircam[0]] = hue_to_hex(180.0)  # cyan
    else:
        for i, f in enumerate(nircam):
            hue = 240.0 - (120.0 * i / (len(nircam) - 1))
            mapping[f] = hue_to_hex(hue)

    # MIRI: yellow (60°) → red (0°), evenly spaced
    if len(miri) == 1:
        mapping[miri[0]] = hue_to_hex(30.0)  # orange
    else:
        for i, f in enumerate(miri):
            hue = 60.0 - (60.0 * i / (len(miri) - 1))
            mapping[f] = hue_to_hex(hue)

    return mapping


def build_color_mapping(filters_sorted: list[str]) -> dict[str, str]:
    """Build chromatic-ordered color mapping for a sorted filter list.

    For exactly 2 filters, uses bicolor hex values that represent synthetic
    green weights: short → #0080ff (rgb [0, 0.5, 1.0]),
    long → #ff8000 (rgb [1.0, 0.5, 0]). This produces Green = 0.5*(short+long),
    the standard astronomical technique for 2-filter composites.
    """
    if len(filters_sorted) == 2:
        return {
            filters_sorted[0]: "#0080ff",  # short: blue + half green
            filters_sorted[1]: "#ff8000",  # long: red + half green
        }
    hues = chromatic_order_hues(len(filters_sorted))
    return {f: hue_to_hex(h) for f, h in zip(filters_sorted, hues, strict=True)}


def estimate_time(num_filters: int, requires_mosaic: bool) -> int:
    """Estimate processing time in seconds."""
    base = num_filters * BASE_TIME_PER_FILTER
    if requires_mosaic:
        base = int(base * 1.5)
    return base


def _angular_separation_arcmin(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Compute angular separation between two sky positions in arcminutes.

    Uses the Vincenty formula for numerical stability at small separations.
    All inputs in degrees; output in arcminutes.
    """

    ra1_r, dec1_r = math.radians(ra1), math.radians(dec1)
    ra2_r, dec2_r = math.radians(ra2), math.radians(dec2)
    dra = ra2_r - ra1_r

    sin_dec1, cos_dec1 = math.sin(dec1_r), math.cos(dec1_r)
    sin_dec2, cos_dec2 = math.sin(dec2_r), math.cos(dec2_r)
    sin_dra, cos_dra = math.sin(dra), math.cos(dra)

    num = math.sqrt(
        (cos_dec2 * sin_dra) ** 2 + (cos_dec1 * sin_dec2 - sin_dec1 * cos_dec2 * cos_dra) ** 2
    )
    den = sin_dec1 * sin_dec2 + cos_dec1 * cos_dec2 * cos_dra

    sep_rad = math.atan2(num, den)
    return math.degrees(sep_rad) * 60.0  # degrees → arcminutes


def group_by_spatial_overlap(observations: list[ObservationInput]) -> list[list[ObservationInput]]:
    """Group observations by spatial overlap using single-linkage clustering.

    Two observations overlap if their center separation is less than the sum
    of their FOV radii. Observations without coordinates are included in all
    groups (conservative — preserves current behavior for missing data).

    Returns:
        List of groups, where each group is a list of overlapping observations.
    """
    has_coords = [obs for obs in observations if obs.s_ra is not None and obs.s_dec is not None]
    no_coords = [obs for obs in observations if obs.s_ra is None or obs.s_dec is None]

    if not has_coords:
        # No spatial data at all — single group (backward compat)
        return [list(observations)]

    n = len(has_coords)
    # Union-Find for single-linkage clustering
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(n):
        for j in range(i + 1, n):
            obs_i, obs_j = has_coords[i], has_coords[j]
            fov_i = INSTRUMENT_FOV_RADIUS_ARCMIN.get(
                obs_i.instrument.upper(), DEFAULT_FOV_RADIUS_ARCMIN
            )
            fov_j = INSTRUMENT_FOV_RADIUS_ARCMIN.get(
                obs_j.instrument.upper(), DEFAULT_FOV_RADIUS_ARCMIN
            )
            sep = _angular_separation_arcmin(obs_i.s_ra, obs_i.s_dec, obs_j.s_ra, obs_j.s_dec)  # type: ignore[arg-type]
            if sep < fov_i + fov_j:
                union(i, j)

    # Collect groups
    groups_map: dict[int, list[ObservationInput]] = {}
    for i, obs in enumerate(has_coords):
        root = find(i)
        groups_map.setdefault(root, []).append(obs)

    groups = list(groups_map.values())

    # Add no-coords observations to every group
    if no_coords:
        for group in groups:
            group.extend(no_coords)

    return groups


def _has_multiple_pointings(
    observations: list[ObservationInput], threshold_arcsec: float = 10.0
) -> bool:
    """Check if any single filter appears at multiple distinct pointings.

    Used to set requires_mosaic flag. Two pointings are distinct if
    separated by more than threshold_arcsec.
    """
    filter_positions: dict[str, list[tuple[float, float]]] = {}
    for obs in observations:
        if obs.s_ra is not None and obs.s_dec is not None:
            key = obs.filter.upper()
            filter_positions.setdefault(key, []).append((obs.s_ra, obs.s_dec))

    threshold_arcmin = threshold_arcsec / 60.0
    for positions in filter_positions.values():
        for i in range(len(positions)):
            for j in range(i + 1, len(positions)):
                sep = _angular_separation_arcmin(
                    positions[i][0],
                    positions[i][1],
                    positions[j][0],
                    positions[j][1],
                )
                if sep > threshold_arcmin:
                    return True
    return False


def _normalize_target_name(name: str) -> str:
    """Normalize a target name for curated recipe lookup.

    Handles common variations: case, whitespace, missing spaces in catalog IDs
    (e.g. "NGC3132" → "ngc 3132"), and resolves aliases.
    """
    import re

    key = name.strip().lower()
    # Insert space between letter prefix and number if missing (e.g. "ngc3132" → "ngc 3132")
    key = re.sub(r"([a-z])(\d)", r"\1 \2", key)
    # Resolve aliases
    key = _CURATED_ALIASES.get(key, key)
    return key


def _inject_curated_recipes(
    target_name: str,
    observations: list[ObservationInput],
) -> list[Recipe]:
    """Check if curated NASA-style recipes exist for the target and return matching ones.

    A curated recipe is included only if ALL its required filters are present in
    the user's available observations. Observation IDs are filtered to only those
    matching the recipe's filters, and mosaic detection runs on the relevant subset.
    """
    key = _normalize_target_name(target_name)
    curated_defs = CURATED_RECIPES.get(key)
    if not curated_defs:
        return []

    available_filters = {obs.filter.upper() for obs in observations}

    recipes: list[Recipe] = []
    for defn in curated_defs:
        required = {f.upper() for f in defn["filters"]}
        if not required.issubset(available_filters):
            logger.info(
                f"Skipping curated recipe '{defn['name']}': "
                f"missing filters {required - available_filters}"
            )
            continue

        # Filter observations to only those matching this recipe's filters
        relevant_obs = [obs for obs in observations if obs.filter.upper() in required]
        relevant_ids = [obs.observation_id for obs in relevant_obs if obs.observation_id]
        needs_mosaic = _has_multiple_pointings(relevant_obs)

        recipes.append(
            Recipe(
                name=defn["name"],
                rank=0,  # Curated recipes appear first
                filters=defn["filters"],
                color_mapping=defn["color_mapping"],
                instruments=defn["instruments"],
                requires_mosaic=needs_mosaic,
                estimated_time_seconds=estimate_time(len(defn["filters"]), needs_mosaic),
                observation_ids=relevant_ids or None,
                description=defn["description"],
                tag="NASA-style",
            )
        )

    if recipes:
        logger.info(f"Injected {len(recipes)} curated recipe(s) for target '{target_name}'")

    return recipes


def generate_recipes(
    observations: list[ObservationInput],
    target_name: str | None = None,
) -> list[Recipe]:
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

    # Filter out spectral observations (no 2D image data for composites)
    image_observations = [
        obs
        for obs in observations
        if obs.dataproduct_type is None or obs.dataproduct_type.lower() != "spectrum"
    ]
    if len(image_observations) < len(observations):
        dropped = len(observations) - len(image_observations)
        logger.info(f"Filtered {dropped} spectral observation(s) from recipe input")
    observations = image_observations

    if not observations:
        return []

    # Filter out non-science observations (calibration darks, flats, etc.).
    # Only keep filters with a known wavelength — this excludes entries like
    # OPAQUE;MIRROR, CLEAR, FLAT, GR150R, etc. that aren't imaging filters.
    science_observations = [obs for obs in observations if resolve_wavelength(obs) is not None]
    if len(science_observations) < len(observations):
        dropped_filters = sorted(
            {obs.filter for obs in observations if resolve_wavelength(obs) is None}
        )
        logger.info(
            f"Filtered {len(observations) - len(science_observations)} non-science "
            f"observation(s) with unknown filters: {', '.join(dropped_filters)}"
        )
    observations = science_observations

    if not observations:
        return []

    # Filter out proprietary observations (Option B safety net)
    today_mjd = (datetime.now(UTC) - _MJD_EPOCH).days
    public_observations = [
        obs for obs in observations if obs.t_obs_release is None or obs.t_obs_release <= today_mjd
    ]
    if len(public_observations) < len(observations):
        dropped = len(observations) - len(public_observations)
        logger.info(f"Filtered {dropped} proprietary observation(s) from recipe input")
    observations = public_observations

    if not observations:
        return []

    # Group by instrument
    instrument_groups: dict[str, list[ObservationInput]] = {}
    for obs in observations:
        inst = obs.instrument.upper()
        instrument_groups.setdefault(inst, []).append(obs)

    all_recipes: list[Recipe] = []
    multi_instrument = len(instrument_groups) > 1

    # Rank offset: if multi-instrument, cross-instrument recipe takes rank 1,
    # so single-instrument recipes shift up by 1.
    rank_offset = 1 if multi_instrument else 0

    # If multiple instruments, add combined recipe FIRST (rank 1 = recommended).
    # Cross-instrument composites show the full wavelength story — starlight (NIRCam)
    # plus dust emission (MIRI) — and are the most visually compelling result.
    if multi_instrument:
        # Check if any observations have spatial data
        has_spatial = any(obs.s_ra is not None and obs.s_dec is not None for obs in observations)

        if has_spatial:
            # Group observations by spatial overlap
            spatial_groups = group_by_spatial_overlap(observations)
            logger.info(
                f"Spatial grouping: {len(spatial_groups)} group(s) from {len(observations)} observations"
            )

            for group in spatial_groups:
                # Check if this spatial group has multiple instruments
                group_instruments = sorted({obs.instrument.upper() for obs in group})
                if len(group_instruments) < 2:
                    continue

                # Build cross-instrument recipe for this overlap group
                all_obs_map: dict[str, ObservationInput] = {}
                for obs in group:
                    key = obs.filter.upper()
                    if key not in all_obs_map:
                        all_obs_map[key] = obs

                combined_sorted = sorted(
                    all_obs_map.keys(),
                    key=lambda f: resolve_wavelength(all_obs_map[f]) or float("inf"),
                )
                all_obs_ids = [obs.observation_id for obs in group if obs.observation_id]
                filter_instruments = {f: all_obs_map[f].instrument.upper() for f in combined_sorted}
                needs_mosaic = _has_multiple_pointings(group)

                all_recipes.append(
                    Recipe(
                        name=f"{len(combined_sorted)}-filter {'+'.join(group_instruments)}",
                        rank=1,
                        filters=combined_sorted,
                        color_mapping=build_cross_instrument_color_mapping(
                            combined_sorted, filter_instruments
                        ),
                        instruments=group_instruments,
                        requires_mosaic=needs_mosaic,
                        estimated_time_seconds=estimate_time(len(combined_sorted), needs_mosaic),
                        observation_ids=all_obs_ids or None,
                        description="Stars and dust \u2014 full near- to mid-infrared wavelength coverage",
                    ),
                )

            # If no cross-instrument overlap groups found, don't create cross-instrument recipe
            cross_inst_count = len([r for r in all_recipes if len(r.instruments) > 1])
            if cross_inst_count == 0:
                rank_offset = 0  # No cross-instrument recipe, so no offset needed
        else:
            # No spatial data — current behavior (assume overlap)
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
            filter_instruments = {f: all_obs_map[f].instrument.upper() for f in combined_sorted}

            all_recipes.append(
                Recipe(
                    name=f"{len(combined_sorted)}-filter {'+'.join(all_instruments)}",
                    rank=1,
                    filters=combined_sorted,
                    color_mapping=build_cross_instrument_color_mapping(
                        combined_sorted, filter_instruments
                    ),
                    instruments=all_instruments,
                    requires_mosaic=False,
                    estimated_time_seconds=estimate_time(len(combined_sorted), False),
                    observation_ids=all_obs_ids or None,
                    description="Stars and dust \u2014 full near- to mid-infrared wavelength coverage",
                    overlap_warning="No coordinate data \u2014 spatial overlap assumed. Result may combine non-overlapping pointings.",
                ),
            )

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

        # Recipe: All available filters for this instrument
        inst_needs_mosaic = _has_multiple_pointings(obs_list)
        all_recipes.append(
            Recipe(
                name=f"{n_filters}-filter {instrument}",
                rank=1 + rank_offset,
                filters=sorted_filters,
                color_mapping=build_color_mapping(sorted_filters),
                instruments=[instrument],
                requires_mosaic=inst_needs_mosaic,
                estimated_time_seconds=estimate_time(n_filters, inst_needs_mosaic),
                observation_ids=obs_ids or None,
                description=f"All {n_filters} {instrument} filters for maximum detail",
            )
        )

        # Recipe: Classic 3-color (if 3+ filters with known wavelengths)
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
                    rank=2 + rank_offset,
                    filters=classic_filters,
                    color_mapping=build_color_mapping(classic_filters),
                    instruments=[instrument],
                    requires_mosaic=False,
                    estimated_time_seconds=estimate_time(3, False),
                    observation_ids=obs_ids or None,
                    description="Three well-separated wavelengths for balanced color",
                )
            )

        # Recipe: Narrowband highlight (if 2+ narrowband filters, and different from "all")
        narrowband = [f for f in sorted_filters if is_narrowband(f)]
        if len(narrowband) >= 2 and narrowband != sorted_filters:
            all_recipes.append(
                Recipe(
                    name=f"Narrowband {instrument}",
                    rank=3 + rank_offset,
                    filters=narrowband,
                    color_mapping=build_color_mapping(narrowband),
                    instruments=[instrument],
                    requires_mosaic=False,
                    estimated_time_seconds=estimate_time(len(narrowband), False),
                    observation_ids=obs_ids or None,
                    description="Emission-line filters highlighting gas structures",
                )
            )

        # Recipe: Broadband clean (if 3+ broadband filters, and different from "all")
        broadband = [f for f in sorted_filters if is_broadband(f)]
        if len(broadband) >= 3 and broadband != sorted_filters:
            all_recipes.append(
                Recipe(
                    name=f"Broadband {instrument}",
                    rank=4 + rank_offset,
                    filters=broadband,
                    color_mapping=build_color_mapping(broadband),
                    instruments=[instrument],
                    requires_mosaic=False,
                    estimated_time_seconds=estimate_time(len(broadband), False),
                    observation_ids=obs_ids or None,
                    description="Broadband filters for a clean continuum view",
                )
            )

    # Inject curated NASA-style recipes if the target matches a known famous image
    if target_name:
        curated = _inject_curated_recipes(target_name, observations)
        all_recipes = curated + all_recipes

    return all_recipes
