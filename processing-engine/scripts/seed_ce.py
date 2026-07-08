"""CE seed bundle tool (CE plan Phase 5).

Builds and gates the Community Edition seed bundle by replaying the exact
stranger flow against a running engine:

    /api/mast/search/target  →  /api/discovery/suggest-recipes
        →  /api/jwstdata/check-availability   (frontend needsDownload logic)
        →  /composite/estimate                (memory-budget preflight)

Subcommands:
    report  — per-target/per-recipe table: filter coverage, estimate verdict,
              bytes; totals against the disk budget. Never fails the build.
    gate    — same evaluation; exit 1 if ANY recipe is missing filters or its
              estimate says "fail". This is the plan's completeness gate:
              files-on-disk ≠ renderable (Phase 1 spike), so both checks run.
    export  — gate first, then write the bundle inputs to --out:
                jwst_data.extjson  one canonical Extended JSON doc per line
                                   (mongoimport-ready; IsPublic=true,
                                   UserId=null — casing stays PascalCase per
                                   the Phase 1 BSON spike)
                files.txt          relative FITS paths for rsync
                manifest.json      targets/recipes/sizes/verdicts

Runs inside the engine container (like prefetch_discovery.py):
    docker exec jwst-processing python scripts/seed_ce.py report

/composite/estimate is called engine-direct (no /api facade exists — the CE
edge doesn't need one; this tool runs at build time against the dev stack).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path, PurePosixPath

import requests
from bson import ObjectId, json_util
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("seed_ce")

DEFAULT_BASE_URL = "http://localhost:8000"
DEFAULT_TARGETS = (
    Path(__file__).resolve().parents[1] / "app" / "discovery" / "featured_targets.json"
)
# GuidedCreate's slow path searches with calibLevel [3] and the model-default
# radius; keep identical so the gate sees what a stranger sees.
SEARCH_RADIUS = 0.2
CHECK_AVAILABILITY_BATCH = 50  # facade caps observationIds per request

# Estimate needs a syntactically valid channel color; hue value is irrelevant
# to the memory math. Spread hues just to keep payloads distinguishable.
_HUE_STEP = 47.0


@dataclass
class RecipeReport:
    target: str
    recipe: str
    missing_filters: list[str]
    estimate_status: str | None
    data_ids: list[str] = field(default_factory=list)
    total_bytes: int = 0

    @property
    def passed(self) -> bool:
        return not self.missing_filters and self.estimate_status in ("ok", "warn")


def _entry_filter(obs_id: str, entry: dict, obs_filters: dict | None) -> str:
    """Availability entry's filter, falling back to the MAST observation's
    filter when the entry carries none (GuidedCreate: item.filter ?? obs.filters)."""
    raw = entry.get("filter")
    # GuidedCreate uses ??, not || — fall back ONLY on null/absent. An empty
    # string stays empty (treated as uncovered), matching the stranger flow.
    flt = raw if raw is not None else (obs_filters or {}).get(obs_id) or ""
    return str(flt).upper()


def missing_filters(recipe: dict, availability: dict, obs_filters: dict | None = None) -> list[str]:
    """Filters of ``recipe`` with no locally-available files.

    Mirrors GuidedCreate: an obsId absent from the results map, or present
    with no dataIds, provides nothing; coverage is keyed by uppercased
    filter name with the observation's filter as fallback.
    """
    covered = {
        _entry_filter(obs_id, entry, obs_filters)
        for obs_id, entry in availability.items()
        if entry.get("available") and entry.get("dataIds")
    }
    return [f for f in recipe.get("filters", []) if str(f).upper() not in covered]


def build_estimate_channels(
    recipe: dict, availability: dict, paths_by_id: dict, obs_filters: dict | None = None
) -> list[dict]:
    """One estimate channel per recipe filter, carrying that filter's files.

    Channels omit width/height on purpose: the estimate verdict keys off the
    WCS-derived original shape and the memory budget, not the output size.
    """
    by_filter: dict[str, list[str]] = {}
    for obs_id, entry in availability.items():
        if not (entry.get("available") and entry.get("dataIds")):
            continue
        flt = _entry_filter(obs_id, entry, obs_filters)
        for data_id in entry["dataIds"]:
            path = paths_by_id.get(data_id)
            if path:
                by_filter.setdefault(flt, []).append(path)
    channels = []
    for i, flt in enumerate(f.upper() for f in recipe.get("filters", [])):
        paths = by_filter.get(flt)
        if paths:
            channels.append({"file_paths": paths, "color": {"hue": (i * _HUE_STEP) % 360.0}})
    return channels


def evaluate_recipe(
    recipe: dict,
    availability: dict,
    paths_by_id: dict,
    estimate: Callable[[list[dict]], dict],
    target: str = "",
    obs_filters: dict | None = None,
) -> RecipeReport:
    """Gate one recipe: filter coverage first, then the estimate preflight."""
    missing = missing_filters(recipe, availability, obs_filters)
    if missing:
        return RecipeReport(
            target=target,
            recipe=recipe.get("name", "?"),
            missing_filters=missing,
            estimate_status=None,
        )

    wanted = {str(f).upper() for f in recipe.get("filters", [])}
    data_ids = sorted(
        {
            data_id
            for obs_id, entry in availability.items()
            if entry.get("available")
            and entry.get("dataIds")
            and _entry_filter(obs_id, entry, obs_filters) in wanted
            for data_id in entry["dataIds"]
        }
    )
    channels = build_estimate_channels(recipe, availability, paths_by_id, obs_filters)
    if not channels:
        # availability said yes but no doc resolved a path — treat as fail,
        # never send an empty channel list (the estimate model 422s on it)
        verdict = {"status": "fail", "detail": "no file paths resolved"}
    else:
        verdict = estimate(channels)
    return RecipeReport(
        target=target,
        recipe=recipe.get("name", "?"),
        missing_filters=[],
        estimate_status=verdict.get("status"),
        data_ids=data_ids,
    )


def apply_threshold(verdict: dict, fail_threshold: float | None) -> dict:
    """Re-verdict an estimate for a different downscale-fail threshold.

    CE runs a relaxed COMPOSITE_DOWNSCALE_FAIL_THRESHOLD (curation decision
    2026-07-08: NIRCam recipes render at 3.5-5k px instead of being refused),
    but the gate usually runs against a dev engine with the strict default.
    side_factor is threshold-independent, so the CE verdict can be derived
    client-side. Verdicts without a side_factor (413 cap, unresolved paths)
    pass through untouched — they can never be upgraded.
    """
    if fail_threshold is None:
        return verdict
    side = verdict.get("side_factor")
    if side is None:
        return verdict
    if side >= 1.0:
        status = "ok"
    elif side >= fail_threshold:
        status = "warn"
    else:
        status = "fail"
    return {**verdict, "status": status}


def transform_doc(doc: dict) -> dict:
    """Seed docs are anonymous-public: force IsPublic, clear ownership.

    _id is preserved so re-running the import is an idempotent upsert.
    """
    out = dict(doc)
    out["IsPublic"] = True
    out["UserId"] = None
    return out


def export_bundle(
    docs: list[dict], reports: list[RecipeReport], out_dir, generated_at: str
) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    seen: set[str] = set()
    unique_docs = []
    for doc in docs:
        key = str(doc["_id"])
        if key in seen:
            continue
        seen.add(key)
        unique_docs.append(transform_doc(doc))

    with open(out / "jwst_data.extjson", "w") as fh:
        for doc in unique_docs:
            fh.write(json_util.dumps(doc, json_options=json_util.CANONICAL_JSON_OPTIONS))
            fh.write("\n")

    files = sorted({d["FilePath"] for d in unique_docs if d.get("FilePath")})
    # files.txt feeds rsync --files-from on the host; a corrupt FilePath with
    # an absolute or parent-traversal component would read outside the data
    # root and silently pull host files into the bundle. Refuse loudly.
    unsafe = [f for f in files if PurePosixPath(f).is_absolute() or ".." in PurePosixPath(f).parts]
    if unsafe:
        raise ValueError(f"unsafe FilePath values in export set: {unsafe[:5]}")
    (out / "files.txt").write_text("\n".join(files) + ("\n" if files else ""))

    total_bytes = sum(int(d.get("FileSize") or 0) for d in unique_docs)
    manifest = {
        "generatedAt": generated_at,
        "documentCount": len(unique_docs),
        "fileCount": len(files),
        "totalBytes": total_bytes,
        "recipes": [{**asdict(r), "passed": r.passed} for r in reports],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    logger.info(
        "bundle inputs written to %s (%d docs, %d files, %.1f GB)",
        out,
        len(unique_docs),
        len(files),
        total_bytes / 1e9,
    )


# --------------------------------------------------------------------------
# Live evaluation against a running engine
# --------------------------------------------------------------------------


class EngineClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        # A 12-target run is long and MAST is the flakiest hop — retry
        # transient upstream errors instead of losing the whole pass.
        retry = Retry(
            total=3,
            backoff_factor=2.0,
            status_forcelist=(429, 502, 503, 504),
            allowed_methods=("POST",),
        )
        self.session.mount("http://", HTTPAdapter(max_retries=retry))

    def _post(self, path: str, payload: dict) -> dict:
        resp = self.session.post(f"{self.base_url}{path}", json=payload, timeout=300)
        resp.raise_for_status()
        return resp.json()

    def search_target(self, target_name: str) -> list[dict]:
        body = {"targetName": target_name, "radius": SEARCH_RADIUS, "calibLevel": [3]}
        return self._post("/api/mast/search/target", body).get("results") or []

    def suggest_recipes(self, target_name: str, observations: list[dict]) -> list[dict]:
        body = {"targetName": target_name, "observations": observations}
        return self._post("/api/discovery/suggest-recipes", body).get("recipes") or []

    def check_availability(self, observation_ids: list[str]) -> dict:
        results: dict = {}
        for i in range(0, len(observation_ids), CHECK_AVAILABILITY_BATCH):
            batch = observation_ids[i : i + CHECK_AVAILABILITY_BATCH]
            results.update(
                self._post("/api/jwstdata/check-availability", {"observationIds": batch}).get(
                    "results"
                )
                or {}
            )
        return results

    def estimate(self, channels: list[dict]) -> dict:
        try:
            return self._post("/composite/estimate", {"channels": channels})
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 413:
                # over the estimate file cap — too big for CE, a normal
                # failing verdict rather than a crashed run
                return {"status": "fail", "detail": "over estimate file cap (413)"}
            raise


def _to_observation_inputs(rows: list[dict]) -> list[dict]:
    """frontend observationUtils.toObservationInputs, verbatim semantics."""
    inputs = []
    for obs in rows:
        if not obs.get("filters") or not obs.get("instrument_name"):
            continue
        inputs.append(
            {
                "filter": obs["filters"],
                "instrument": obs["instrument_name"],
                "observationId": obs.get("obs_id"),
                "tObsRelease": obs.get("t_obs_release"),
                "dataProductType": obs.get("dataproduct_type"),
                "sRa": obs.get("s_ra"),
                "sDec": obs.get("s_dec"),
            }
        )
    return inputs


def _mongo_collection():
    from pymongo import MongoClient

    uri = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
    db_name = os.environ.get("MONGODB_DATABASE", "jwst_data_analysis")
    return MongoClient(uri)[db_name]["jwst_data"]


def _fetch_docs(collection, data_ids: list[str]) -> list[dict]:
    oids = [ObjectId(d) for d in data_ids]
    return list(collection.find({"_id": {"$in": oids}}))


def evaluate_all(
    client: EngineClient, targets: list[dict], collection
) -> tuple[list[RecipeReport], list[dict]]:
    reports: list[RecipeReport] = []
    all_docs: list[dict] = []
    for target in targets:
        name = target["name"]
        search_name = (target.get("mastSearchParams") or {}).get("target") or name
        logger.info("evaluating %s (search: %s)", name, search_name)
        rows = [
            r for r in client.search_target(search_name) if r.get("dataproduct_type") == "image"
        ]
        if not rows:
            reports.append(
                RecipeReport(
                    target=name,
                    recipe="(no observations)",
                    missing_filters=["<no MAST results>"],
                    estimate_status=None,
                )
            )
            continue
        recipes = client.suggest_recipes(name, _to_observation_inputs(rows))
        if not recipes:
            # a featured tile with zero recipes is the worst dead end —
            # fail the gate exactly like a target with no MAST results
            reports.append(
                RecipeReport(
                    target=name,
                    recipe="(no recipes suggested)",
                    missing_filters=["<no recipes>"],
                    estimate_status=None,
                )
            )
            continue
        obs_filters = {
            r.get("obs_id"): str(r.get("filters") or "").upper() for r in rows if r.get("obs_id")
        }
        for recipe in recipes:
            availability = client.check_availability(recipe.get("observationIds") or [])
            usable_ids = [
                data_id
                for entry in availability.values()
                if entry.get("available") and entry.get("dataIds")
                for data_id in entry["dataIds"]
            ]
            docs = _fetch_docs(collection, usable_ids) if usable_ids else []
            paths_by_id = {str(d["_id"]): d.get("FilePath") for d in docs}
            sizes_by_id = {str(d["_id"]): int(d.get("FileSize") or 0) for d in docs}
            report = evaluate_recipe(
                recipe,
                availability,
                paths_by_id,
                client.estimate,
                target=name,
                obs_filters=obs_filters,
            )
            report.total_bytes = sum(sizes_by_id.get(d, 0) for d in report.data_ids)
            reports.append(report)
            if report.passed:
                all_docs.extend(d for d in docs if str(d["_id"]) in set(report.data_ids))
    return reports, all_docs


def print_report(reports: list[RecipeReport], budget_gb: float) -> None:
    width = max((len(f"{r.target} / {r.recipe}") for r in reports), default=20)
    unique: dict[str, int] = {}
    for r in reports:
        print(
            f"{(r.target + ' / ' + r.recipe).ljust(width)}  "
            f"{'PASS' if r.passed else 'FAIL'}  "
            f"estimate={r.estimate_status or '-':4}  "
            f"files={len(r.data_ids):3d}  "
            f"{r.total_bytes / 1e9:6.2f} GB"
            + (f"  missing: {', '.join(r.missing_filters)}" if r.missing_filters else "")
        )
        for d in r.data_ids:
            unique[d] = 1
    passed = [r for r in reports if r.passed]
    print(
        f"\n{len(passed)}/{len(reports)} recipes pass; "
        f"{len(unique)} unique files across passing recipes"
    )
    total = _unique_bytes(reports)
    print(
        f"total unique bytes, approx (passing recipes): {total / 1e9:.1f} GB "
        f"(budget {budget_gb:.0f} GB; export's manifest.json totalBytes is exact)"
    )
    if total > budget_gb * 1e9:
        print("WARNING: over budget — curate targets or trim recipes")


def _unique_bytes(reports: list[RecipeReport]) -> int:
    # per-recipe totals double-count shared files; approximate the unique sum
    # by attributing each data_id's bytes once (first recipe that lists it).
    seen: set[str] = set()
    total = 0
    for r in reports:
        if not r.passed or not r.data_ids:
            continue
        fresh = [d for d in r.data_ids if d not in seen]
        if fresh and len(r.data_ids) > 0:
            total += int(r.total_bytes * (len(fresh) / len(r.data_ids)))
        seen.update(fresh)
    return total


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("command", choices=["report", "gate", "export"])
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--targets", default=str(DEFAULT_TARGETS))
    parser.add_argument("--target", help="limit to a single featured target name")
    parser.add_argument("--out", default="/tmp/ce-seed", help="export output directory")
    parser.add_argument("--budget-gb", type=float, default=100.0, help="disk budget for the report")
    parser.add_argument("--generated-at", help="ISO timestamp stamped into manifest.json (export)")
    parser.add_argument(
        "--fail-threshold",
        type=float,
        help="Evaluate estimates at this downscale-fail threshold instead of "
        "the engine's (e.g. 0.15 to match the CE compose). side_factor is "
        "threshold-independent, so the gate can mirror CE posture against a "
        "dev engine running the strict default.",
    )
    parser.add_argument(
        "--allow-failures",
        action="store_true",
        help="Do not block gate/export on failing recipes; ship only passing "
        "recipes' files (failures stay in manifest.json with passed=false). "
        "CAUTION: failing recipes still show in the CE UI and will error for "
        "strangers — use only for curated/partial bundles while the featured "
        "list is being trimmed to match.",
    )
    args = parser.parse_args(argv)

    with open(args.targets) as fh:
        targets = json.load(fh)
    if args.target:
        targets = [t for t in targets if t["name"].lower() == args.target.lower()]
        if not targets:
            logger.error("no featured target named %r", args.target)
            return 2

    client = EngineClient(args.base_url)
    if args.fail_threshold is not None:
        # visible, not silent: a gate that validated the wrong posture is
        # worse than no gate (green light for recipes strangers can't render)
        logger.info(
            "evaluating estimates at fail-threshold %.2f (engine default overridden "
            "client-side — must match the CE compose value)",
            args.fail_threshold,
        )
        raw_estimate = client.estimate
        client.estimate = lambda channels: apply_threshold(  # type: ignore[method-assign]
            raw_estimate(channels), args.fail_threshold
        )
    reports, docs = evaluate_all(client, targets, _mongo_collection())
    print_report(reports, args.budget_gb)
    if args.fail_threshold is not None:
        print(f"(estimates evaluated at fail-threshold {args.fail_threshold:.2f})")

    if args.command == "report":
        return 0

    failed = [r for r in reports if not r.passed]
    if failed and not args.allow_failures:
        logger.error("completeness gate FAILED: %d recipe(s) not fully renderable", len(failed))
        return 1
    if failed:
        logger.warning(
            "--allow-failures: %d failing recipe(s) EXCLUDED from the bundle "
            "(they will still show in the CE UI — trim the featured list to match)",
            len(failed),
        )
    if not any(r.passed for r in reports):
        logger.error("no recipe passed at all — refusing to build an empty bundle")
        return 1

    if args.command == "export":
        from datetime import datetime, timezone

        generated_at = args.generated_at or datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
        export_bundle(docs, reports, args.out, generated_at=generated_at)
    return 0


if __name__ == "__main__":
    sys.exit(main())
