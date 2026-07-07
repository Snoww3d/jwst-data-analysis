"""Capture golden JSON contract fixtures from the running .NET API (anonymous).

These are the CE Phase 2 red-green targets: FastAPI must reproduce these
shapes byte-for-byte (field names/casing), so the Phase 3 frontend cutover
is a pure base-URL swap.
"""

import json
import sys
import urllib.request
from pathlib import Path


BASE = "http://localhost:5001"
if len(sys.argv) != 2:
    sys.exit("usage: python3 capture_fixtures.py <output-dir>  (e.g. fixtures/)")
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)


def call(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        data=json.dumps(body).encode() if body is not None else None,
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def save(name: str, data) -> None:
    (OUT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    keys = list(data)[:6] if isinstance(data, dict) else f"list[{len(data)}]"
    print(f"{name}: {keys}")


featured = call("GET", "/api/discovery/featured")
save("get_discovery_featured.json", featured)

search = call(
    "POST", "/api/mast/search/target", {"targetName": "NGC 3132", "radius": 0.2, "calibLevel": [3]}
)
save("post_mast_search_target.json", search)

obs = search.get("results") or []
# mirror frontend toObservationInputs (observationUtils.ts:8)
inputs = [
    {
        "filter": o["filters"],
        "instrument": o["instrument_name"],
        "observationId": o.get("obs_id"),
        "tObsRelease": o.get("t_obs_release"),
        "dataProductType": o.get("dataproduct_type"),
        "sRa": o.get("s_ra"),
        "sDec": o.get("s_dec"),
    }
    for o in obs[:25]
    if o.get("filters") and o.get("instrument_name")
]
recipes = call(
    "POST",
    "/api/discovery/suggest-recipes",
    {"targetName": "NGC 3132", "observations": inputs},
)
save("post_discovery_suggest_recipes.json", recipes)

obs_ids = [o.get("obs_id") for o in obs[:25]]
avail = call(
    "POST", "/api/jwstdata/check-availability", {"observationIds": [i for i in obs_ids if i]}
)
save("post_jwstdata_check_availability.json", avail)

listing = call("GET", "/api/jwstdata?includeArchived=false")
# keep the fixture reviewable: first 5 records (shape is what matters)
save("get_jwstdata_list.json", listing[:5] if isinstance(listing, list) else listing)

health = call("GET", "/api/health")
save("get_health.json", health)
