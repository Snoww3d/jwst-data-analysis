#!/usr/bin/env python3
"""
Recipe Walkthrough Generator

Generates composite images for every recipe across all available targets.
Queries the database for downloaded MAST data, generates recipes via the
discovery API, and renders composites via the composite API.

Output: data/recipe-review/{target}/{recipe_name}.png

Usage:
    python3 scripts/recipe-walkthrough.py [--target NGC-3324] [--preset nasa_press]

Requires: requests (pip install requests)
Docker stack must be running.
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime
from collections import defaultdict
from pathlib import Path

try:
    import requests
except ImportError:
    print("Missing 'requests' library. Install: pip install requests")
    sys.exit(1)

import os

BASE_URL = os.environ.get("BASE_URL", "http://localhost:5001")
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "data/recipe-review"))

# Filter wavelengths (micrometers) — matches processing engine's recipe_engine.py
FILTER_WAVELENGTHS = {
    "F070W": 0.704,
    "F090W": 0.901,
    "F115W": 1.154,
    "F140M": 1.405,
    "F150W": 1.501,
    "F162M": 1.627,
    "F182M": 1.845,
    "F187N": 1.874,
    "F200W": 1.989,
    "F210M": 2.093,
    "F212N": 2.120,
    "F250M": 2.503,
    "F277W": 2.762,
    "F300M": 2.989,
    "F322W2": 3.232,
    "F335M": 3.365,
    "F356W": 3.568,
    "F360M": 3.621,
    "F410M": 4.082,
    "F430M": 4.280,
    "F444W": 4.421,
    "F460M": 4.624,
    "F480M": 4.834,
    "F560W": 5.6,
    "F770W": 7.7,
    "F1000W": 10.0,
    "F1065C": 10.65,
    "F1130W": 11.3,
    "F1140C": 11.4,
    "F1280W": 12.8,
    "F1500W": 15.0,
    "F1550C": 15.5,
    "F1800W": 18.0,
    "F2100W": 21.0,
    "F2300C": 23.0,
    "F2550W": 25.5,
}

# Composite presets — synced from frontend/jwst-frontend/src/types/CompositeTypes.ts
# Keep in sync: if you change values here, update CompositeTypes.ts and vice versa.
PRESETS = {
    "auto": {
        "auto_stretch": True,  # Server computes params from data statistics
        "stretch": "asinh",
        "black_point": 0.02,
        "white_point": 0.995,
        "gamma": 1.2,
        "asinh_a": 0.02,
        "curve": "s_curve",
    },
    "natural": {
        "stretch": "sqrt",
        "black_point": 0.01,
        "white_point": 1.0,
        "gamma": 1.0,
        "asinh_a": 0.1,
        "curve": "linear",
    },
    "nasa_press": {
        "stretch": "asinh",
        "black_point": 0.02,
        "white_point": 0.995,
        "gamma": 1.2,
        "asinh_a": 0.02,
        "curve": "s_curve",
    },
    "high_contrast": {
        "stretch": "asinh",
        "black_point": 0.05,
        "white_point": 0.98,
        "gamma": 1.4,
        "asinh_a": 0.05,
        "curve": "s_curve",
    },
    "faint_emission": {
        "stretch": "asinh",
        "black_point": 0.0,
        "white_point": 1.0,
        "gamma": 1.8,
        "asinh_a": 0.005,
        "curve": "shadows",
    },
    "scientific": {
        "stretch": "zscale",
        "black_point": 0.0,
        "white_point": 1.0,
        "gamma": 1.0,
        "asinh_a": 0.1,
        "curve": "linear",
    },
}

# MIRI-specific overrides — higher black points and softer stretch to handle
# thermal background, broader dynamic range, and lower SNR vs NIRCAM.
MIRI_OVERRIDES = {
    "natural": {
        "stretch": "sqrt",
        "black_point": 0.03,  # vs 0.01 — clips MIRI thermal floor
        "white_point": 1.0,
        "gamma": 1.0,
        "asinh_a": 0.1,
        "curve": "linear",
    },
    "nasa_press": {
        "stretch": "asinh",
        "black_point": 0.08,  # vs 0.02 — clips MIRI thermal floor
        "white_point": 0.995,
        "gamma": 1.0,  # vs 1.2 — less boost on noisy data
        "asinh_a": 0.08,  # vs 0.02 — softer to prevent noise amplification
        "curve": "shadows",  # vs s_curve — gentler on MIRI noise
    },
    "high_contrast": {
        "stretch": "asinh",
        "black_point": 0.1,  # vs 0.05 — aggressive thermal floor clip
        "white_point": 0.98,
        "gamma": 1.1,  # vs 1.4 — less amplification on noisy data
        "asinh_a": 0.1,  # vs 0.05 — softer asinh
        "curve": "shadows",  # vs s_curve — gentler on MIRI noise
    },
    "faint_emission": {
        "stretch": "asinh",
        "black_point": 0.0,
        "white_point": 1.0,
        "gamma": 1.4,  # vs 1.8 — less aggressive on noisy MIRI background
        "asinh_a": 0.02,  # vs 0.005 — slightly higher softening
        "curve": "shadows",
    },
    # scientific: no MIRI override — zscale is instrument-agnostic
}


def login(username: str, password: str) -> str:
    """Authenticate and return access token."""
    resp = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": password},
    )
    resp.raise_for_status()
    return resp.json()["accessToken"]


def get_all_data(token: str) -> list[dict]:
    """Fetch all data records from the backend API."""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(
        f"{BASE_URL}/api/jwstdata",
        headers=headers,
    )
    resp.raise_for_status()
    data = resp.json()
    # API may return a list directly or a paginated wrapper
    if isinstance(data, list):
        return data
    return data.get("items", data.get("data", []))


def group_by_target(records: list[dict]) -> dict[str, list[dict]]:
    """Group records by target name, filtering to imaging data with known filters."""
    targets: dict[str, list[dict]] = defaultdict(list)

    # Skip IFU, spectral, and unknown data
    skip_instruments = {"MIRI/IFU", "NIRSPEC/IFU", "NIRISS/WFSS"}
    skip_filter_patterns = re.compile(r"^(CH\d|GR|CLEAR;PRISM|F290LP)")

    for r in records:
        info = r.get("imageInfo") or r.get("ImageInfo") or {}
        filt = info.get("filter") or info.get("Filter")
        instrument = info.get("instrument") or info.get("Instrument")
        target = info.get("targetName") or info.get("TargetName")

        if not filt or not target:
            continue
        if instrument in skip_instruments:
            continue
        if skip_filter_patterns.match(filt):
            continue
        # Skip compound filters like "F444W;F470N" — keep base filter only
        if ";" in filt:
            continue

        targets[target].append(r)

    return targets


def get_unique_filters(records: list[dict]) -> dict[str, list[str]]:
    """Map filter name → list of dataIds, sorted by file size descending.

    Largest files first ensures the engine's memory guard keeps the
    best-coverage tiles when it caps file count.
    """
    filter_to_records: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for r in records:
        info = r.get("imageInfo") or r.get("ImageInfo") or {}
        filt = info.get("filter") or info.get("Filter")
        data_id = r.get("id") or str(r.get("_id"))
        file_size = r.get("fileSize") or 0
        if filt and data_id:
            filter_to_records[filt].append((file_size, data_id))
    # Sort by file size descending — largest (most coverage) first
    return {
        filt: [data_id for _, data_id in sorted(recs, reverse=True)]
        for filt, recs in filter_to_records.items()
    }


def build_observations(records: list[dict]) -> list[dict]:
    """Build observation list for suggest-recipes API."""
    seen = set()
    observations = []
    for r in records:
        info = r.get("imageInfo") or r.get("ImageInfo") or {}
        filt = info.get("filter") or info.get("Filter")
        instrument = info.get("instrument") or info.get("Instrument") or ""
        obs_id = r.get("observationBaseId") or r.get("ObservationBaseId") or ""

        if not filt:
            continue
        # Deduplicate by filter
        if filt in seen:
            continue
        seen.add(filt)

        # Normalize instrument name (NIRCAM/IMAGE → NIRCAM)
        inst_short = instrument.split("/")[0]

        observations.append(
            {
                "filter": filt,
                "instrument": inst_short,
                "wavelengthUm": FILTER_WAVELENGTHS.get(filt, 0),
                "observationId": obs_id,
                "dataProductType": "image",
            }
        )
    return observations


def wait_for_healthy(max_wait: int = 120) -> bool:
    """Wait for processing engine to become healthy after a crash."""
    for i in range(max_wait // 5):
        try:
            resp = requests.get(f"{BASE_URL}/api/health", timeout=5)
            if resp.ok:
                return True
        except Exception:
            pass
        time.sleep(5)
    return False


def suggest_recipes(target_name: str, observations: list[dict]) -> list[dict]:
    """Call suggest-recipes API and return recipe list."""
    resp = requests.post(
        f"{BASE_URL}/api/discovery/suggest-recipes",
        json={"targetName": target_name, "observations": observations},
    )
    if resp.status_code == 503:
        print("\n    Processing engine unavailable — waiting for recovery...", end=" ", flush=True)
        if wait_for_healthy():
            print("OK, retrying")
            resp = requests.post(
                f"{BASE_URL}/api/discovery/suggest-recipes",
                json={"targetName": target_name, "observations": observations},
            )
        else:
            print("TIMEOUT")
    resp.raise_for_status()
    data = resp.json()
    return data.get("recipes", [])


def hex_to_hue(hex_color: str) -> float | None:
    """Convert hex color to hue angle (0-360). Returns None for grays."""
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    max_c = max(r, g, b)
    min_c = min(r, g, b)
    diff = max_c - min_c
    if diff < 0.001:
        return 0.0  # Gray → red (fallback)
    if max_c == r:
        hue = 60 * (((g - b) / diff) % 6)
    elif max_c == g:
        hue = 60 * (((b - r) / diff) + 2)
    else:
        hue = 60 * (((r - g) / diff) + 4)
    return hue % 360


def generate_composite(
    channels: list[dict],
    preset_name: str = "nasa_press",
    width: int = 2000,
    height: int = 2000,
) -> bytes:
    """Call generate-nchannel composite API and return PNG bytes."""
    preset = PRESETS.get(preset_name, PRESETS["nasa_press"])
    miri_preset = MIRI_OVERRIDES.get(preset_name)
    is_auto = preset.get("auto_stretch", False)

    # Apply preset to each channel — use MIRI overrides for filters >= 5µm
    for ch in channels:
        wl = FILTER_WAVELENGTHS.get(ch.get("label", ""), 0)
        params = miri_preset if miri_preset and wl >= 5.0 else preset
        ch.update(
            {
                "stretch": params["stretch"],
                "blackPoint": params["black_point"],
                "whitePoint": params["white_point"],
                "gamma": params["gamma"],
                "asinhA": params["asinh_a"],
                "curve": params["curve"],
                "weight": 1.0,
            }
        )
        if is_auto:
            ch["autoStretch"] = True

    # Large output grids can take 3-5 min even with few files; use 300s baseline,
    # 600s for multi-tile mosaics that need streaming reproject.
    timeout = 600 if any(len(ch.get("dataIds", [])) > 5 for ch in channels) else 300
    payload = {
        "channels": channels,
        "width": width,
        "height": height,
        "outputFormat": "png",
        "quality": 95,
        "featherStrength": 0.0,
        "backgroundNeutralization": True,
    }
    resp = requests.post(
        f"{BASE_URL}/api/composite/generate-nchannel",
        json=payload,
        timeout=timeout,
    )
    if resp.status_code == 503:
        print("503 — waiting for recovery...", end=" ", flush=True)
        if wait_for_healthy():
            print("OK, retrying...", end=" ", flush=True)
            resp = requests.post(
                f"{BASE_URL}/api/composite/generate-nchannel",
                json=payload,
                timeout=timeout,
            )
        else:
            print("TIMEOUT")
    resp.raise_for_status()
    return resp.content


def run(
    target_filter: str | None = None,
    preset_name: str = "nasa_press",
    username: str = "snoww3d",
    password: str = "",
    run_id: str | None = None,
    max_files: int | None = None,
    fail_fast: bool = False,
):
    """Main entry point."""
    if not password:
        print("Password required: --password or WALKTHROUGH_PASSWORD env var")
        sys.exit(1)

    if not run_id:
        run_id = datetime.now().strftime("%Y%m%d-%H%M")

    print("=== Recipe Walkthrough Generator ===")
    print(f"  Run ID: v{run_id}\n")

    # Step 1: Login
    print("Logging in...", end=" ", flush=True)
    try:
        token = login(username, password)
    except Exception as e:
        print(f"FAILED: {e}")
        print("Check credentials and that Docker stack is running.")
        sys.exit(1)
    print("OK")

    # Step 2: Fetch all data
    print("Fetching data records...", end=" ", flush=True)
    records = get_all_data(token)
    print(f"{len(records)} records")

    # Step 3: Group by target
    targets = group_by_target(records)
    print(f"Found {len(targets)} targets with imaging data\n")

    if target_filter:
        matched = {
            k: v for k, v in targets.items() if target_filter.lower() in k.lower()
        }
        if not matched:
            print(f"No target matching '{target_filter}'. Available:")
            for t in sorted(targets.keys()):
                print(f"  {t}")
            sys.exit(1)
        targets = matched

    # Step 4: Process each target
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    summary = []

    # Load or create metadata file (tracks timing per composite across runs)
    meta_path = OUTPUT_DIR / "meta.json"
    meta: dict = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
        except json.JSONDecodeError:
            meta = {}

    for target_name, target_records in sorted(targets.items()):
        filter_to_ids = get_unique_filters(target_records)

        # Need at least 2 filters for a composite
        if len(filter_to_ids) < 2:
            print(f"  SKIP {target_name} — only {len(filter_to_ids)} filter(s)")
            continue

        print(f"\n{'=' * 60}")
        print(f"  {target_name}")
        print(f"  Filters: {', '.join(sorted(filter_to_ids.keys()))}")
        print(f"{'=' * 60}")

        # Get recipes
        observations = build_observations(target_records)
        try:
            recipes = suggest_recipes(target_name, observations)
        except Exception as e:
            print(f"  SKIP — suggest-recipes failed: {e}")
            continue

        if not recipes:
            print("  SKIP — no recipes generated")
            continue

        print(f"  {len(recipes)} recipe(s) generated")

        # Create target output directory
        safe_target = re.sub(r"[^\w\-]", "_", target_name)
        target_dir = OUTPUT_DIR / safe_target
        target_dir.mkdir(parents=True, exist_ok=True)

        for recipe in recipes:
            recipe_name = recipe.get("name", "unnamed")
            recipe_filters = recipe.get("filters", [])
            color_mapping = recipe.get("colorMapping", {})
            safe_recipe = re.sub(r"[^\w\-]", "_", recipe_name)

            output_path = target_dir / f"{safe_recipe}_{preset_name}.v{run_id}.png"
            if output_path.exists():
                print(f"    SKIP {recipe_name} — v{run_id} already exists")
                summary.append((target_name, recipe_name, "skipped"))
                continue

            # Build channels: map recipe filters to dataIds
            channels = []
            missing = []
            for filt in recipe_filters:
                ids = filter_to_ids.get(filt)
                if not ids:
                    missing.append(filt)
                    continue
                hue = hex_to_hue(color_mapping.get(filt, "#ffffff"))
                ch_ids = ids if max_files is None else ids[:max_files]
                channels.append(
                    {
                        "dataIds": ch_ids,
                        "color": {"hue": hue},
                        "label": filt,
                        "wavelengthUm": FILTER_WAVELENGTHS.get(filt),
                    }
                )

            if missing:
                print(f"    SKIP {recipe_name} — missing filters: {', '.join(missing)}")
                summary.append(
                    (target_name, recipe_name, f"missing: {', '.join(missing)}")
                )
                continue

            if len(channels) < 2:
                print(f"    SKIP {recipe_name} — only {len(channels)} channel(s)")
                summary.append((target_name, recipe_name, "too few channels"))
                continue

            # Generate composite
            print(f"    {recipe_name} ({len(channels)} ch)...", end=" ", flush=True)
            t0 = time.time()
            try:
                png_data = generate_composite(channels, preset_name)
                output_path.write_bytes(png_data)
                elapsed = time.time() - t0
                size_kb = len(png_data) / 1024
                print(f"OK ({elapsed:.1f}s, {size_kb:.0f} KB)")
                summary.append((target_name, recipe_name, f"ok ({elapsed:.1f}s)"))

                # Record metadata for grader
                meta_key = f"{safe_target}/{output_path.name}"
                meta[meta_key] = {
                    "time_s": round(elapsed, 1),
                    "size_kb": round(size_kb),
                    "run_id": run_id,
                    "preset": preset_name,
                    "generated_at": datetime.now().isoformat(timespec="seconds"),
                }
            except requests.HTTPError as e:
                elapsed = time.time() - t0
                print(f"FAILED ({elapsed:.1f}s): {e}")
                # Try to get error details
                try:
                    err = e.response.json() if e.response else {}
                    print(f"      {err.get('message', err.get('detail', ''))}")
                except Exception:
                    pass
                summary.append((target_name, recipe_name, f"failed: {e}"))
                if fail_fast:
                    print("\n*** --fail-fast: stopping on first failure ***")
                    return 1
            except Exception as e:
                print(f"FAILED: {e}")
                summary.append((target_name, recipe_name, f"error: {e}"))
                if fail_fast:
                    print("\n*** --fail-fast: stopping on first failure ***")
                    return 1

    # Print summary
    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print(f"{'=' * 60}")
    ok = sum(1 for _, _, s in summary if s.startswith("ok"))
    failed = sum(1 for _, _, s in summary if "failed" in s or "error" in s)
    skipped = len(summary) - ok - failed
    print(f"  Generated: {ok}  Skipped: {skipped}  Failed: {failed}")
    print(f"  Output: {OUTPUT_DIR.resolve()}")

    # Save metadata
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"  Metadata: {meta_path.resolve()}")

    if failed:
        print("\nFailed recipes:")
        for target, recipe, status in summary:
            if "failed" in status or "error" in status:
                print(f"  {target} / {recipe}: {status}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate composite images for every recipe"
    )
    parser.add_argument(
        "--target", help="Filter to a specific target (substring match)"
    )
    parser.add_argument(
        "--preset",
        default="nasa_press",
        choices=PRESETS.keys(),
        help="Stretch preset (default: nasa_press)",
    )
    parser.add_argument("--username", default="snoww3d", help="Login username")
    parser.add_argument(
        "--password",
        default=None,
        help="Login password (or set WALKTHROUGH_PASSWORD env var)",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="Version tag for output files (default: YYYYMMDD-HHMM)",
    )
    parser.add_argument(
        "--max-files-per-channel",
        type=int,
        default=None,
        help="Max FITS files per channel (default: unlimited — use all files, mosaic if needed)",
    )
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        help="Stop on first failure instead of continuing",
    )
    args = parser.parse_args()

    password = args.password or os.environ.get("WALKTHROUGH_PASSWORD")

    sys.exit(
        run(
            target_filter=args.target,
            preset_name=args.preset,
            username=args.username,
            password=password or "",
            run_id=args.run_id,
            max_files=args.max_files_per_channel,
            fail_fast=args.fail_fast,
        )
    )
