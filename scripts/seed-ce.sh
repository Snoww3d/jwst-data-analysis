#!/usr/bin/env bash
# Build the Community Edition seed bundle (CE plan Phase 5).
#
# Runs against the DEV stack (jwst-processing + its Mongo), which owns the
# authoritative metadata: the .NET scan pipeline wrote the jwst_data docs and
# prefetch-discovery.sh downloaded the FITS. This script replays the stranger
# flow (search → recipes → availability → render estimate) via
# processing-engine/scripts/seed_ce.py, refuses to build a bundle with dead
# ends, then assembles:
#
#   <out>/data/...            curated FITS tree (rsync'd per files.txt)
#   <out>/jwst_data.extjson   matching Mongo docs (IsPublic=true, UserId=null)
#   <out>/files.txt           relative FITS paths in the bundle
#   <out>/manifest.json       recipes, verdicts, sizes
#   <out>/restore-seed.sh     import script to run next to the CE stack
#
# Usage:
#   ./scripts/seed-ce.sh report                   # sizing/coverage survey only
#   ./scripts/seed-ce.sh gate                     # completeness gate, no bundle
#   ./scripts/seed-ce.sh build --out /tmp/ce-seed # gate + assemble the bundle
#   ./scripts/seed-ce.sh build --target "Carina Nebula" --out /tmp/ce-seed
#
# Extra flags after the command are passed through to seed_ce.py
# (--target, --budget-gb, --base-url).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

info()  { printf '\033[0;34m%s\033[0m\n' "$*"; }
ok()    { printf '\033[0;32m%s\033[0m\n' "$*"; }
err()   { printf '\033[0;31m%s\033[0m\n' "$*" >&2; }
die()   { err "$@"; exit 1; }

CONTAINER="jwst-processing"
# Override when the repo checkout is not where the FITS live (e.g. worktrees)
DATA_ROOT="${JWST_DATA_DIR:-$PROJECT_ROOT/data}"
ENGINE_TARGETS="$PROJECT_ROOT/processing-engine/app/discovery/featured_targets.json"
DOTNET_TARGETS="$PROJECT_ROOT/backend/JwstDataAnalysis.API/Configuration/featured-targets.json"
CONTAINER_OUT="/tmp/ce-seed-out"

COMMAND="${1:-}"
case "$COMMAND" in
    report|gate|build) shift ;;
    *) die "Usage: $0 report|gate|build [seed_ce.py flags]" ;;
esac

# --- Preflight ---
if ! docker inspect "$CONTAINER" &>/dev/null; then
    die "Container '$CONTAINER' is not running. Start with: docker compose up -d"
fi

# The engine serves its own copy of the featured list while prefetch reads
# the .NET copy — a drifted pair would gate against one list and serve
# another. Refuse to build until they match.
if ! diff -q "$ENGINE_TARGETS" "$DOTNET_TARGETS" >/dev/null; then
    die "featured target lists have drifted: $ENGINE_TARGETS vs $DOTNET_TARGETS — sync them first"
fi
ok "Featured target lists in sync"

OUT_DIR=""
PASSTHROUGH=()
while [ $# -gt 0 ]; do
    case "$1" in
        --out) [ $# -ge 2 ] || die "--out requires a directory argument"; OUT_DIR="$2"; shift 2 ;;
        *) PASSTHROUGH+=("$1"); shift ;;
    esac
done

if [ "$COMMAND" = "build" ]; then
    [ -n "$OUT_DIR" ] || die "build requires --out <dir>"
    mkdir -p "$OUT_DIR"
fi

# --- Evaluate (and export bundle inputs when building) ---
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$COMMAND" = "build" ]; then
    info "Running completeness gate + export in $CONTAINER..."
    docker exec "$CONTAINER" python scripts/seed_ce.py export \
        --out "$CONTAINER_OUT" --generated-at "$GENERATED_AT" ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}
else
    info "Running seed_ce.py $COMMAND in $CONTAINER..."
    docker exec "$CONTAINER" python scripts/seed_ce.py "$COMMAND" \
        ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}
    ok "$COMMAND completed"
    exit 0
fi

# --- Assemble the bundle on the host ---
info "Collecting bundle inputs..."
docker cp "$CONTAINER:$CONTAINER_OUT/jwst_data.extjson" "$OUT_DIR/jwst_data.extjson"
docker cp "$CONTAINER:$CONTAINER_OUT/files.txt" "$OUT_DIR/files.txt"
docker cp "$CONTAINER:$CONTAINER_OUT/manifest.json" "$OUT_DIR/manifest.json"

info "Copying FITS tree (rsync --files-from)..."
# Defense in depth: seed_ce.py already refuses unsafe FilePaths at export;
# re-check here because files.txt feeds rsync verbatim and a `..` or
# absolute entry would read outside the data root.
if grep -qE '(^/|(^|/)\.\.(/|$))' "$OUT_DIR/files.txt"; then
    die "files.txt contains absolute or parent-traversal paths — refusing to rsync"
fi
mkdir -p "$OUT_DIR/data"
rsync -a --files-from="$OUT_DIR/files.txt" "$DATA_ROOT/" "$OUT_DIR/data/"

MISSING=0
while IFS= read -r rel; do
    [ -f "$OUT_DIR/data/$rel" ] || { err "missing from bundle: $rel"; MISSING=1; }
done < "$OUT_DIR/files.txt"
[ "$MISSING" -eq 0 ] || die "bundle is incomplete — files listed in Mongo are absent on disk"

cp "$SCRIPT_DIR/restore-seed.sh" "$OUT_DIR/restore-seed.sh"
chmod +x "$OUT_DIR/restore-seed.sh"

BUNDLE_GB=$(du -sh "$OUT_DIR" | cut -f1)
ok "Seed bundle assembled at $OUT_DIR ($BUNDLE_GB)"
info "Next: transfer to the CE host, point CE_DATA_DIR at $OUT_DIR/data, and run restore-seed.sh (see script header)."
