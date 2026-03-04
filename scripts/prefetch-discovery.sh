#!/usr/bin/env bash
# Prefetch and validate MIRI composites for discovery page featured targets.
#
# Copies the featured-targets config into the processing container and runs
# the prefetch script. All MAST queries and downloads happen inside the
# container where astroquery and processing dependencies are available.
#
# Usage:
#   ./scripts/prefetch-discovery.sh                                    # all MIRI targets
#   ./scripts/prefetch-discovery.sh --dry-run                          # survey only
#   ./scripts/prefetch-discovery.sh --target "Southern Ring Nebula"    # single target
#   ./scripts/prefetch-discovery.sh --all-instruments                  # include NIRCam

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Helpers ---
info()  { printf '\033[0;34m%s\033[0m\n' "$*"; }
ok()    { printf '\033[0;32m%s\033[0m\n' "$*"; }
warn()  { printf '\033[0;33m%s\033[0m\n' "$*"; }
err()   { printf '\033[0;31m%s\033[0m\n' "$*" >&2; }
die()   { err "$@"; exit 1; }

CONTAINER="jwst-processing"
TARGETS_SRC="$PROJECT_ROOT/backend/JwstDataAnalysis.API/Configuration/featured-targets.json"
TARGETS_DEST="/tmp/featured-targets.json"

# --- Preflight checks ---
[ -f "$TARGETS_SRC" ] || die "featured-targets.json not found at $TARGETS_SRC"

if ! docker inspect "$CONTAINER" &>/dev/null; then
    die "Container '$CONTAINER' is not running. Start with: docker compose up -d"
fi

# --- Copy config into container ---
info "Copying featured-targets.json into $CONTAINER..."
docker cp "$TARGETS_SRC" "$CONTAINER:$TARGETS_DEST"

# --- Run prefetch script ---
info "Running prefetch_discovery.py..."
docker exec "$CONTAINER" python scripts/prefetch_discovery.py \
    --targets "$TARGETS_DEST" "$@"

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    ok "Prefetch completed successfully"
else
    err "Prefetch exited with code $EXIT_CODE"
fi

exit $EXIT_CODE
