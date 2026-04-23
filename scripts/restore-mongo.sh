#!/usr/bin/env bash
# restore-mongo.sh — Restore the JWST MongoDB from an archive produced by
# backup-mongo.sh. Drops existing collections (--drop) before restoring.
#
# Usage:
#   restore-mongo.sh <archive-path-or-s3-uri> [--dry-run]
#
# Examples:
#   restore-mongo.sh ~/jwst-backups/jwst-backup-20260423-030000.archive.gz
#   restore-mongo.sh s3://my-bucket/backups/jwst-backup-20260423-030000.archive.gz
#
# Safety:
#   - Refuses to run if the backend has active connections to MongoDB unless
#     the operator types the literal string "RESTORE OVER LIVE DB".
#   - Always prompts for "yes" confirmation before invoking mongorestore.
#   - --dry-run uses mongorestore's own --dryRun and prints planned actions.

set -euo pipefail

# Ensure /usr/local/bin (AWS CLI on Amazon Linux) is on PATH for cron-style
# invocations and for consistency with backup-mongo.sh.
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH:-}"

# --- Args -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../docker/.env}"
CONTAINER="${CONTAINER:-jwst-mongodb}"

if [[ $# -lt 1 ]]; then
  echo "Usage: $(basename "$0") <archive-path-or-s3-uri> [--dry-run]" >&2
  exit 64
fi

ARCHIVE_ARG="$1"
DRY_RUN=0
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=1

# --- Helpers ----------------------------------------------------------------
log()  { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
info() { log "INFO  $*"; }
ok()   { log "OK    $*"; }
err()  { log "ERROR $*" >&2; }
die()  { err "$*"; exit 1; }

# --- Resolve archive: download from S3 if needed ----------------------------
if [[ "$ARCHIVE_ARG" == s3://* ]]; then
  # GNU mktemp on Amazon Linux requires the X's at the END of the template,
  # so the .archive.gz suffix is appended after creation. Trap is installed
  # BEFORE mv so a failure in mv (e.g. ENOSPC between mktemp and mv) doesn't
  # orphan the temp file.
  TMP_ARCHIVE_BASE="$(mktemp -t jwst-restore.XXXXXX)"
  TMP_ARCHIVE=""
  trap 'rm -f "$TMP_ARCHIVE_BASE" "${TMP_ARCHIVE:-}"' EXIT
  TMP_ARCHIVE="${TMP_ARCHIVE_BASE}.archive.gz"
  mv "$TMP_ARCHIVE_BASE" "$TMP_ARCHIVE"
  info "Downloading archive from $ARCHIVE_ARG"
  aws s3 cp "$ARCHIVE_ARG" "$TMP_ARCHIVE" \
    || die "Failed to download $ARCHIVE_ARG"
  ARCHIVE="$TMP_ARCHIVE"
else
  ARCHIVE="$ARCHIVE_ARG"
  [[ -f "$ARCHIVE" ]] || die "Archive not found: $ARCHIVE"
fi

# --- Integrity check before going further -----------------------------------
info "Verifying archive integrity ($ARCHIVE)"
gzip -t "$ARCHIVE" 2>/dev/null \
  || die "Archive is corrupt (gzip integrity check failed): $ARCHIVE"

archive_size="$(du -h "$ARCHIVE" | cut -f1)"
archive_mtime="$(date -r "$ARCHIVE" -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || stat -c %y "$ARCHIVE" 2>/dev/null || echo "unknown")"
ok "Archive OK: $archive_size, modified $archive_mtime"

# --- Pre-flight: load credentials ------------------------------------------
[[ -f "$ENV_FILE" ]] || die "Env file not found: $ENV_FILE"
MONGO_USER="$(grep -E '^MONGO_ROOT_USERNAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
MONGO_PASS="$(grep -E '^MONGO_ROOT_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[[ -n "$MONGO_USER" && -n "$MONGO_PASS" ]] \
  || die "MONGO_ROOT_USERNAME / MONGO_ROOT_PASSWORD missing in $ENV_FILE"

# --- Pre-flight: container health -------------------------------------------
status="$(docker inspect "$CONTAINER" --format '{{.State.Status}}' 2>/dev/null || echo "missing")"
[[ "$status" == "running" ]] || die "Container '$CONTAINER' status='$status' (expected 'running')"

docker exec "$CONTAINER" which mongorestore >/dev/null \
  || die "mongorestore not found in container '$CONTAINER'"

# --- Pre-flight: active-connections check -----------------------------------
# URI password is expanded INSIDE the container by `sh -c`, so it never
# appears on host argv (visible via `ps aux`).
export MONGO_URI="mongodb://$MONGO_USER:$MONGO_PASS@mongodb:27017/?authSource=admin"

active_conns="$(docker exec -e MONGO_URI "$CONTAINER" \
    sh -c 'mongosh --quiet --norc "$MONGO_URI" --eval "print(db.serverStatus().connections.current.toString())"' \
    2>/dev/null | tail -1 || echo "")"

# A baseline of 1 (this mongosh) is normal; >1 means real clients are connected.
# If we can't parse the count, fail closed — refuse to proceed rather than
# silently assume zero connections and overwrite a live DB.
if [[ ! "$active_conns" =~ ^[0-9]+$ ]]; then
  err "Could not parse active-connection count (raw output: '$active_conns')."
  err "Refusing to proceed without confirming the DB is idle."
  die "Active-connections check failed; verify backend is stopped manually before restoring."
fi
if [[ "$active_conns" -gt 1 ]]; then
  err "WARNING: $active_conns active connections detected — backend is likely connected."
  err "Restoring now will overwrite live data. Stop the backend first:"
  err "    cd docker && docker compose stop backend"
  read -r -p 'Type "RESTORE OVER LIVE DB" to proceed anyway: ' override
  [[ "$override" == "RESTORE OVER LIVE DB" ]] || die "Aborted by user"
fi

# --- Final confirmation -----------------------------------------------------
echo
info "About to restore (with --drop):"
info "  Archive: $ARCHIVE"
info "  Size:    $archive_size"
info "  Target:  container=$CONTAINER, db=admin auth"
info "  Mode:    $([[ $DRY_RUN -eq 1 ]] && echo 'DRY RUN' || echo 'LIVE — collections WILL be dropped before restore')"
echo
read -r -p 'Type "yes" to proceed: ' confirm
[[ "$confirm" == "yes" ]] || die "Aborted by user"

# --- Restore ----------------------------------------------------------------
CONTAINER_PATH="/tmp/jwst-restore-$(date -u +%s).archive.gz"
info "Copying archive into container at $CONTAINER_PATH"
docker cp "$ARCHIVE" "$CONTAINER:$CONTAINER_PATH"

# Build a literal sh-c command string. Single-quoting around \"\$MONGO_URI\"
# keeps the URI unexpanded by the host bash; only the in-container sh expands
# it from the env injected by `docker exec -e MONGO_URI`. Naive joining via
# `sh -c "mongorestore ${args[*]}"` would get re-scanned by host bash and
# expand $MONGO_URI on the host, leaking the password to host `ps aux`.
restore_cmd='mongorestore --uri="$MONGO_URI" --archive='"'$CONTAINER_PATH'"' --gzip --drop --quiet'
[[ $DRY_RUN -eq 1 ]] && restore_cmd="$restore_cmd --dryRun"

info "Running mongorestore"
if ! docker exec -e MONGO_URI "$CONTAINER" sh -c "$restore_cmd"; then
  docker exec "$CONTAINER" rm -f "$CONTAINER_PATH" || true
  err ""
  err "================================================================"
  err "  RESTORE FAILED — DATABASE MAY BE IN A PARTIALLY-RESTORED STATE"
  err "================================================================"
  err "  mongorestore --drop drops each collection right before"
  err "  restoring it. A mid-run failure can leave some collections"
  err "  restored, some empty (dropped-but-not-restored), and some"
  err "  untouched."
  err ""
  err "  DO NOT start the backend against this database."
  err "  Re-run this script with the same archive to recover."
  err "================================================================"
  die "mongorestore failed"
fi

docker exec "$CONTAINER" rm -f "$CONTAINER_PATH"

# --- Post-restore verification ---------------------------------------------
if [[ $DRY_RUN -eq 0 ]]; then
  info "Collection counts after restore:"
  docker exec -e MONGO_URI "$CONTAINER" sh -c '
    mongosh --quiet --norc "$MONGO_URI" --eval "
      db.getMongo().getDBNames().filter(n => ![\"admin\",\"local\",\"config\"].includes(n))
        .forEach(name => {
          const d = db.getSiblingDB(name);
          d.getCollectionNames().forEach(c => {
            print(\"  \" + name + \".\" + c + \": \" + d.getCollection(c).countDocuments({}));
          });
        });"'
fi

ok "Restore script finished"
