"""
Prefetch and validate MIRI composites for discovery page featured targets.

Downloads only the single combined L3 mosaic per observation (not per-detector
files), validates them via the processing engine's composite endpoint, and
reports results.

Usage (inside the jwst-processing container):
    python scripts/prefetch_discovery.py --targets /tmp/featured-targets.json
    python scripts/prefetch_discovery.py --targets /tmp/featured-targets.json --dry-run
    python scripts/prefetch_discovery.py --targets /tmp/featured-targets.json --target "Southern Ring Nebula"
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import requests


# Add the processing-engine root to sys.path so we can import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.discovery.models import ObservationInput
from app.discovery.recipe_engine import FILTER_WAVELENGTHS, generate_recipes
from app.mast.mast_service import MastService


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("prefetch")

# Detector name fragments that appear in per-detector i2d filenames
DETECTOR_FRAGMENTS = (
    "nrca1",
    "nrca2",
    "nrca3",
    "nrca4",
    "nrcb1",
    "nrcb2",
    "nrcb3",
    "nrcb4",
    "nrcalong",
    "nrcblong",
    "mirimage",
    "mirifushort",
    "mirifulong",
)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class MosaicInfo:
    """Info about a single combined L3 mosaic file."""

    obs_id: str
    filename: str
    filter_name: str
    instrument: str
    size_bytes: int
    data_uri: str


@dataclass
class TargetReport:
    """Per-target prefetch/validation report."""

    name: str
    mosaics_found: int = 0
    mosaics_downloaded: int = 0
    mosaics_skipped: int = 0
    bytes_downloaded: int = 0
    recipes_generated: int = 0
    validations_passed: int = 0
    validations_failed: int = 0
    validations_skipped: int = 0
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Combined mosaic detection
# ---------------------------------------------------------------------------


def find_combined_mosaics(
    products: list[dict[str, Any]],
    obs_id: str,
    instrument_filter: str | None = None,
) -> list[MosaicInfo]:
    """Find combined L3 mosaics (not per-detector files) from product list.

    The combined mosaic has a filename like:
        jw02731-o001_t017_miri_f770w_i2d.fits
    Per-detector files have detector names embedded:
        jw02731001001_04101_00001_mirimage_i2d.fits

    Strategy: keep only _i2d.fits files whose names do NOT contain detector
    fragments. Also filter by instrument/filter if specified.
    """
    mosaics: list[MosaicInfo] = []
    for p in products:
        fname = p.get("productFilename", "")
        if not fname.endswith("_i2d.fits"):
            continue

        fname_lower = fname.lower()

        # Skip per-detector files
        if any(det in fname_lower for det in DETECTOR_FRAGMENTS):
            continue

        # Extract filter from filename (e.g., jw..._miri_f770w_i2d.fits)
        parts = fname_lower.replace("_i2d.fits", "").split("_")
        filt = None
        for part in parts:
            if part.upper() in FILTER_WAVELENGTHS:
                filt = part.upper()
                break

        if filt is None:
            continue

        # Determine instrument from filter wavelength
        wl = FILTER_WAVELENGTHS.get(filt, 0)
        inst = "MIRI" if wl >= 5.0 else "NIRCAM"

        if instrument_filter and inst != instrument_filter.upper():
            continue

        size = int(p.get("size", 0)) if p.get("size") else 0
        data_uri = str(p.get("dataURI", ""))

        mosaics.append(
            MosaicInfo(
                obs_id=obs_id,
                filename=fname,
                filter_name=filt,
                instrument=inst,
                size_bytes=size,
                data_uri=data_uri,
            )
        )

    return mosaics


# ---------------------------------------------------------------------------
# Disk guard
# ---------------------------------------------------------------------------


def check_disk_ok(
    download_dir: str,
    needed_bytes: int,
    min_free_gb: float,
    max_total_gb: float,
    total_downloaded: int,
    max_file_size_gb: float,
) -> tuple[bool, str]:
    """Check whether a download is safe given disk constraints."""
    if needed_bytes > max_file_size_gb * 1e9:
        return (
            False,
            f"file size {needed_bytes / 1e9:.2f} GB exceeds --max-file-size {max_file_size_gb} GB",
        )

    free = shutil.disk_usage(download_dir).free
    if free - needed_bytes < min_free_gb * 1e9:
        return False, f"would leave {(free - needed_bytes) / 1e9:.1f} GB free (min: {min_free_gb})"

    if total_downloaded + needed_bytes > max_total_gb * 1e9:
        return (
            False,
            f"would exceed {max_total_gb} GB cumulative limit ({(total_downloaded + needed_bytes) / 1e9:.1f} GB)",
        )

    return True, "ok"


# ---------------------------------------------------------------------------
# Hex color to RGB tuple
# ---------------------------------------------------------------------------


def hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
    """Convert '#rrggbb' hex string to (r, g, b) tuple with values in [0, 1]."""
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)


# ---------------------------------------------------------------------------
# Composite validation
# ---------------------------------------------------------------------------


def validate_recipe(
    recipe_name: str,
    filters: list[str],
    color_mapping: dict[str, str],
    file_map: dict[str, str],
    base_url: str = "http://localhost:8000",
) -> dict[str, Any]:
    """Build a minimal composite request and POST to the processing engine.

    Args:
        recipe_name: Display name of the recipe.
        filters: Sorted filter list from the recipe.
        color_mapping: Filter → hex color mapping.
        file_map: Filter → relative storage key mapping.
        base_url: Processing engine URL.

    Returns:
        Dict with status ('pass', 'fail', 'skipped'), details.
    """
    channels = []
    missing = []
    for filt in filters:
        if filt not in file_map:
            missing.append(filt)
            continue
        r, g, b = hex_to_rgb(color_mapping[filt])
        channels.append(
            {
                "file_paths": [file_map[filt]],
                "color": {"rgb": [r, g, b]},
                "stretch": "zscale",
                "black_point": 0.02,
                "white_point": 0.98,
                "label": filt,
                "wavelength_um": FILTER_WAVELENGTHS.get(filt),
            }
        )

    if not channels:
        return {
            "status": "skipped",
            "recipe": recipe_name,
            "reason": f"no data for any filter ({', '.join(missing)})",
        }

    if missing:
        logger.warning(
            "  Recipe '%s': missing filters %s, validating with %d/%d",
            recipe_name,
            missing,
            len(channels),
            len(filters),
        )

    payload = {
        "channels": channels,
        "output_format": "png",
        "width": 256,
        "height": 256,
    }

    try:
        resp = requests.post(
            f"{base_url}/composite/generate-nchannel",
            json=payload,
            timeout=120,
        )
        if resp.ok:
            return {
                "status": "pass",
                "recipe": recipe_name,
                "channels": len(channels),
                "size_bytes": len(resp.content),
            }
        else:
            return {
                "status": "fail",
                "recipe": recipe_name,
                "code": resp.status_code,
                "detail": resp.text[:500],
            }
    except Exception as e:
        return {
            "status": "fail",
            "recipe": recipe_name,
            "error": str(e),
        }


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def run_pipeline(args: argparse.Namespace) -> list[TargetReport]:
    """Execute the prefetch pipeline for all matching targets."""
    # Load targets
    with open(args.targets) as f:
        targets = json.load(f)

    if args.target:
        targets = [t for t in targets if t["name"].lower() == args.target.lower()]
        if not targets:
            logger.error("Target '%s' not found in featured-targets.json", args.target)
            sys.exit(1)

    mast = MastService()
    reports: list[TargetReport] = []
    total_downloaded = 0

    for target in targets:
        name = target["name"]
        search_target = target["mastSearchParams"]["target"]
        report = TargetReport(name=name)
        reports.append(report)

        logger.info("=" * 60)
        logger.info("TARGET: %s (search: %s)", name, search_target)
        logger.info("=" * 60)

        # Step 1: Search MAST
        try:
            observations = mast.search_by_target(search_target, calib_level=[3])
        except Exception as e:
            report.errors.append(f"MAST search failed: {e}")
            logger.error("  MAST search failed: %s", e)
            continue

        logger.info("  Found %d level-3 observations", len(observations))

        if not observations:
            # Fall back to level 2
            try:
                observations = mast.search_by_target(search_target, calib_level=[2])
                logger.info("  Fallback: found %d level-2 observations", len(observations))
            except Exception as e:
                report.errors.append(f"MAST search (level-2 fallback) failed: {e}")
                logger.error("  MAST search fallback failed: %s", e)
                continue

        if not observations:
            report.errors.append("No observations found")
            logger.warning("  No observations found, skipping")
            continue

        # Step 2: Filter to IMAGE observations for the requested instrument(s)
        instrument_filter = "MIRI" if args.miri_only else None
        image_obs = []
        for obs in observations:
            inst = str(obs.get("instrument_name", "")).upper()
            dptype = str(obs.get("dataproduct_type", "")).lower()
            if dptype != "image":
                continue
            if instrument_filter and instrument_filter not in inst:
                continue
            image_obs.append(obs)

        logger.info(
            "  %d IMAGE observations after instrument filter (%s)",
            len(image_obs),
            instrument_filter or "all",
        )

        if not image_obs:
            report.errors.append(f"No {'MIRI ' if args.miri_only else ''}IMAGE observations")
            logger.warning("  No matching IMAGE observations, skipping")
            continue

        # Step 3: Generate recipes
        recipe_inputs = []
        for obs in image_obs:
            filt = str(obs.get("filters", ""))
            if not filt or filt == "None":
                continue
            inst = str(obs.get("instrument_name", "")).split("/")[0].upper()
            recipe_inputs.append(
                ObservationInput(
                    filter=filt,
                    instrument=inst,
                    observation_id=str(obs.get("obs_id", "")),
                    t_obs_release=obs.get("t_obs_release"),
                    dataproduct_type=str(obs.get("dataproduct_type", "")),
                )
            )

        recipes = generate_recipes(recipe_inputs)
        report.recipes_generated = len(recipes)
        logger.info("  Generated %d recipes", len(recipes))

        if recipes:
            for r in recipes[:3]:
                logger.info("    [rank %d] %s: %s", r.rank, r.name, ", ".join(r.filters))

        # Step 4: Size survey — find combined L3 mosaics across all obs_ids
        all_mosaics: dict[str, MosaicInfo] = {}  # filter → mosaic info (best per filter)
        seen_obs_ids: set[str] = set()
        for obs in image_obs:
            oid = str(obs.get("obs_id", ""))
            if not oid or oid in seen_obs_ids:
                continue
            seen_obs_ids.add(oid)

            try:
                products = mast.get_data_products(oid)
            except Exception as e:
                logger.warning("  get_data_products(%s) failed: %s", oid, e)
                continue

            mosaics = find_combined_mosaics(products, oid, instrument_filter)
            for m in mosaics:
                existing = all_mosaics.get(m.filter_name)
                if existing is None or m.size_bytes < existing.size_bytes:
                    all_mosaics[m.filter_name] = m

        report.mosaics_found = len(all_mosaics)
        logger.info("  Found %d unique combined mosaics:", len(all_mosaics))
        for filt, m in sorted(all_mosaics.items(), key=lambda x: FILTER_WAVELENGTHS.get(x[0], 0)):
            logger.info("    %s: %s (%.2f GB)", filt, m.filename, m.size_bytes / 1e9)

        if args.dry_run:
            total_size = sum(m.size_bytes for m in all_mosaics.values())
            logger.info("  [DRY RUN] Total download size: %.2f GB", total_size / 1e9)
            continue

        # Step 5: Download combined mosaics
        file_map: dict[str, str] = {}  # filter → relative storage key
        for filt, mosaic in sorted(all_mosaics.items()):
            ok, reason = check_disk_ok(
                mast.download_dir,
                mosaic.size_bytes,
                args.min_free,
                args.max_disk,
                total_downloaded,
                args.max_file_size,
            )
            if not ok:
                report.mosaics_skipped += 1
                logger.warning("  SKIP %s (%s): %s", filt, mosaic.filename, reason)
                continue

            logger.info(
                "  Downloading %s: %s (%.2f GB)...", filt, mosaic.filename, mosaic.size_bytes / 1e9
            )
            t0 = time.time()

            try:
                result = mast.download_product(mosaic.filename, mosaic.obs_id)
                if result["status"] == "completed" and result.get("files"):
                    downloaded_path = result["files"][0]
                    # Build the relative storage key from the absolute path
                    # Downloaded files land in: {download_dir}/{obs_id}/mastDownload/JWST/{obs_id}/{filename}
                    # Storage key is relative to the data root (parent of download_dir)
                    data_root = os.path.dirname(mast.download_dir)
                    rel_key = os.path.relpath(downloaded_path, data_root)
                    file_map[filt] = rel_key
                    report.mosaics_downloaded += 1
                    report.bytes_downloaded += mosaic.size_bytes
                    total_downloaded += mosaic.size_bytes
                    elapsed = time.time() - t0
                    logger.info("    Downloaded in %.1fs", elapsed)
                else:
                    report.errors.append(
                        f"Download failed for {filt}: {result.get('error', 'unknown')}"
                    )
                    logger.error("    Download failed: %s", result.get("error", "unknown"))
            except Exception as e:
                report.errors.append(f"Download exception for {filt}: {e}")
                logger.error("    Download exception: %s", e)

        if not file_map:
            logger.warning("  No files downloaded, skipping validation")
            continue

        # Step 6: Validate composites
        if args.skip_validate:
            logger.info("  Skipping validation (--skip-validate)")
            continue

        logger.info(
            "  Validating %d recipe(s) with %d downloaded filters...", len(recipes), len(file_map)
        )

        for recipe in recipes:
            # Only validate recipes that use filters we have data for
            available = [f for f in recipe.filters if f in file_map]
            if not available:
                report.validations_skipped += 1
                continue

            result = validate_recipe(
                recipe.name,
                recipe.filters,
                recipe.color_mapping,
                file_map,
                args.base_url,
            )

            if result["status"] == "pass":
                report.validations_passed += 1
                logger.info(
                    "    PASS: %s (%d channels, %d bytes)",
                    recipe.name,
                    result.get("channels", 0),
                    result.get("size_bytes", 0),
                )
            elif result["status"] == "skipped":
                report.validations_skipped += 1
                logger.info("    SKIP: %s — %s", recipe.name, result.get("reason", ""))
            else:
                report.validations_failed += 1
                logger.error(
                    "    FAIL: %s — %s", recipe.name, result.get("detail", result.get("error", ""))
                )

    return reports


def print_summary(reports: list[TargetReport]) -> None:
    """Print a summary table of all target results."""
    print("\n" + "=" * 70)
    print("PREFETCH SUMMARY")
    print("=" * 70)

    total_downloaded = 0
    total_pass = 0
    total_fail = 0

    for r in reports:
        status = "OK" if not r.errors and r.validations_failed == 0 else "ISSUES"
        print(f"\n  {r.name}: {status}")
        print(
            f"    Mosaics: {r.mosaics_found} found, {r.mosaics_downloaded} downloaded, "
            f"{r.mosaics_skipped} skipped"
        )
        print(f"    Downloaded: {r.bytes_downloaded / 1e9:.2f} GB")
        print(f"    Recipes: {r.recipes_generated} generated")
        print(
            f"    Validation: {r.validations_passed} pass, {r.validations_failed} fail, "
            f"{r.validations_skipped} skip"
        )
        if r.errors:
            for err in r.errors:
                print(f"    ERROR: {err}")

        total_downloaded += r.bytes_downloaded
        total_pass += r.validations_passed
        total_fail += r.validations_failed

    print(
        f"\n  TOTAL: {total_downloaded / 1e9:.2f} GB downloaded, "
        f"{total_pass} validations passed, {total_fail} failed"
    )
    print("=" * 70)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prefetch and validate MIRI composites for discovery page targets"
    )
    parser.add_argument("--targets", required=True, help="Path to featured-targets.json")
    parser.add_argument(
        "--dry-run", action="store_true", help="Query MAST and survey sizes without downloading"
    )
    parser.add_argument(
        "--skip-validate", action="store_true", help="Download only, skip composite validation"
    )
    parser.add_argument(
        "--target", type=str, default=None, help="Process only this target (by name)"
    )
    parser.add_argument(
        "--max-disk",
        type=float,
        default=20,
        help="Maximum cumulative download size in GB (default: 20)",
    )
    parser.add_argument(
        "--min-free",
        type=float,
        default=10,
        help="Minimum free disk space to maintain in GB (default: 10)",
    )
    parser.add_argument(
        "--max-file-size", type=float, default=6, help="Maximum single file size in GB (default: 6)"
    )
    parser.add_argument(
        "--miri-only",
        action="store_true",
        default=True,
        help="Only prefetch MIRI filters (default: true)",
    )
    parser.add_argument(
        "--all-instruments",
        action="store_true",
        help="Prefetch all instruments (overrides --miri-only)",
    )
    parser.add_argument(
        "--base-url",
        type=str,
        default="http://localhost:8000",
        help="Processing engine base URL (default: http://localhost:8000)",
    )

    args = parser.parse_args()

    if args.all_instruments:
        args.miri_only = False

    reports = run_pipeline(args)
    print_summary(reports)

    # Exit with error code if any validations failed
    if any(r.validations_failed > 0 for r in reports):
        sys.exit(1)


if __name__ == "__main__":
    main()
