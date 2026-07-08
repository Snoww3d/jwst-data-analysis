#!/usr/bin/env bash
# Admin gap-fill: download the missing data for ONE featured recipe (#1675).
#
# Runs against the DEV stack — CE itself is anonymous/read-only by design,
# so admin writes happen here and reach CE via bundle rebuild + reseed
# (the tool prints that checklist when it finishes).
#
# Usage:
#   ./scripts/fetch-recipe.sh --target "SMACS 0723" --recipe "NASA Deep Field (SMACS 0723)" --dry-run
#   ./scripts/fetch-recipe.sh --target "SMACS 0723" --recipe "NASA Deep Field (SMACS 0723)" --max-file-size 20
#
# Flags pass through to seed_ce.py fetch (--max-file-size GB, --dry-run,
# --fail-threshold; default cap 6GB — fetching bigger files must be typed out).
#
# Exit codes (propagated from seed_ce.py fetch):
#   0  fetched (or nothing to fetch) and the recipe renders at the CE posture
#   1  hard error (no mosaics on MAST, download failure)
#   2  usage error
#   3  a needed file exceeds --max-file-size — nothing downloaded
#   4  downloaded, but the recipe STILL fails the render estimate

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

info()  { printf '\033[0;34m%s\033[0m\n' "$*"; }
err()   { printf '\033[0;31m%s\033[0m\n' "$*" >&2; }
die()   { err "$@"; exit 1; }

CONTAINER="jwst-processing"
ENGINE_TARGETS="$PROJECT_ROOT/processing-engine/app/discovery/featured_targets.json"
DOTNET_TARGETS="$PROJECT_ROOT/backend/JwstDataAnalysis.API/Configuration/featured-targets.json"

docker inspect "$CONTAINER" &>/dev/null || die "Container '$CONTAINER' is not running. Start with: docker compose up -d"

if ! diff -q "$ENGINE_TARGETS" "$DOTNET_TARGETS" >/dev/null; then
    die "featured target lists have drifted — sync them first"
fi

info "Running seed_ce.py fetch in $CONTAINER..."
docker exec "$CONTAINER" python scripts/seed_ce.py fetch --fail-threshold 0.15 "$@"
