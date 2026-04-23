#!/usr/bin/env bash
# backup-mongo.sh — Snapshot the JWST MongoDB to a compressed archive.
#
# Usage:
#   backup-mongo.sh [--dry-run]
#
# Reads credentials from the project .env (default: ../docker/.env relative to
# this script). Never inlines the password as a CLI arg — the URI is passed via
# `docker exec -e MONGO_URI` so host `ps aux` doesn't see the secret.
#
# On success: writes jwst-backup-YYYYMMDD-HHMMSS.archive.gz to $BACKUP_DIR
#   and (if $S3_BACKUP_BUCKET is set) uploads it to s3://$BUCKET/backups/.
# On failure: exits non-zero with a readable error and removes any partial
#   archive. The local copy is preserved when only the S3 step fails.
#
# Cron entry example (logs go to file, not mail):
#   0 3 * * * /home/ec2-user/jwst-app/scripts/backup-mongo.sh >> /var/log/jwst-backup.log 2>&1

set -euo pipefail

# Cron's default PATH is /usr/bin:/bin. AWS CLI on Amazon Linux 2023 lives at
# /usr/local/bin/aws — make sure both cron and interactive runs find it.
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH:-}"

# --- Defaults (env overrides) ------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../docker/.env}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/jwst-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
CONTAINER="${CONTAINER:-jwst-mongodb}"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# --- Helpers ----------------------------------------------------------------
log()  { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
info() { log "INFO  $*"; }
ok()   { log "OK    $*"; }
err()  { log "ERROR $*" >&2; }
die()  { err "$*"; exit 1; }

# run() executes its argv list directly (no eval, no string parsing). Dry-run
# uses %q to quote args so the printed line is copy-pasteable.
run() {
    if [[ $DRY_RUN -eq 1 ]]; then
        printf 'DRY-RUN:'
        printf ' %q' "$@"
        printf '\n'
    else
        "$@"
    fi
}

# mongo_in_container runs an arbitrary mongo-tool command inside $CONTAINER
# with $MONGO_URI inherited via -e (no value on the docker exec argv) and
# expanded by the in-container shell. Keeps the password out of host ps aux.
mongo_in_container() {
    run docker exec -e MONGO_URI "$CONTAINER" sh -c "$1"
}

# --- Pre-flight: load credentials -------------------------------------------
[[ -f "$ENV_FILE" ]] || die "Env file not found: $ENV_FILE (set ENV_FILE to override)"

# Source only the two vars we need; ignore the rest of the file.
MONGO_USER="$(grep -E '^MONGO_ROOT_USERNAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
MONGO_PASS="$(grep -E '^MONGO_ROOT_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
S3_BACKUP_BUCKET="$(grep -E '^S3_BACKUP_BUCKET=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"

[[ -n "$MONGO_USER" ]] || die "MONGO_ROOT_USERNAME not set in $ENV_FILE"
[[ -n "$MONGO_PASS" ]] || die "MONGO_ROOT_PASSWORD not set in $ENV_FILE"

# --- Pre-flight: container health -------------------------------------------
info "Checking container '$CONTAINER' is running..."
status="$(docker inspect "$CONTAINER" --format '{{.State.Status}}' 2>/dev/null || echo "missing")"
[[ "$status" == "running" ]] || die "Container '$CONTAINER' status='$status' (expected 'running')"

info "Verifying mongodump is available in the container..."
docker exec "$CONTAINER" which mongodump >/dev/null \
  || die "mongodump not found in container '$CONTAINER'"

# --- Pre-flight: free disk space --------------------------------------------
mkdir -p "$BACKUP_DIR"

# Estimate dataset size in bytes via mongosh; default to 0 if unreachable
# (we still proceed but skip the 2x check). totalSize is a 64-bit Long;
# .toString() gives a clean decimal that bash can compare. The mongosh
# invocation runs INSIDE the container via `sh -c` so the URI (with password)
# is expanded by the container shell, never appearing on host argv.
export MONGO_URI="mongodb://$MONGO_USER:$MONGO_PASS@mongodb:27017/?authSource=admin"
data_bytes="$(docker exec -e MONGO_URI "$CONTAINER" \
    sh -c 'mongosh --quiet --norc "$MONGO_URI" --eval "print(db.adminCommand({listDatabases:1}).totalSize.toString())"' \
    2>/dev/null | tail -1 || echo "0")"

if [[ "$data_bytes" =~ ^[0-9]+$ ]] && [[ "$data_bytes" -gt 0 ]]; then
  free_bytes="$(df -P "$BACKUP_DIR" | awk 'NR==2 {print $4 * 1024}')"
  required_bytes=$((data_bytes * 2))
  if [[ "$free_bytes" -lt "$required_bytes" ]]; then
    die "Insufficient disk space at $BACKUP_DIR: need $required_bytes bytes (2x dataset), have $free_bytes"
  fi
  info "Disk OK ($((free_bytes / 1024 / 1024)) MiB free, $((data_bytes / 1024 / 1024)) MiB dataset)"
else
  info "Could not estimate dataset size (mongosh unavailable?) — skipping 2x disk check"
fi

# --- Backup -----------------------------------------------------------------
TS="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="jwst-backup-$TS.archive.gz"
HOST_PATH="$BACKUP_DIR/$ARCHIVE_NAME"
CONTAINER_PATH="/tmp/$ARCHIVE_NAME"

info "Running mongodump (output: $HOST_PATH)"
# Inner sh -c expands $MONGO_URI from the env injected by `-e MONGO_URI`,
# so the password never appears on the docker exec argv (visible via host
# `ps aux`). $CONTAINER_PATH IS a literal interpolation — no secrets in it.
mongo_in_container "mongodump --uri=\"\$MONGO_URI\" --archive='$CONTAINER_PATH' --gzip --quiet"

run docker cp "$CONTAINER:$CONTAINER_PATH" "$HOST_PATH"
run docker exec "$CONTAINER" rm -f "$CONTAINER_PATH"

if [[ $DRY_RUN -eq 0 ]]; then
  # Integrity check — gzip -t verifies the gzip stream isn't truncated.
  if ! gzip -t "$HOST_PATH" 2>/dev/null; then
    err "Integrity check FAILED for $HOST_PATH — removing partial archive"
    rm -f "$HOST_PATH"
    die "mongodump archive is corrupt"
  fi
  size_human="$(du -h "$HOST_PATH" | cut -f1)"
  ok "Backup complete: $HOST_PATH ($size_human)"
fi

# --- Optional S3 upload -----------------------------------------------------
if [[ -n "$S3_BACKUP_BUCKET" ]]; then
  info "Uploading to s3://$S3_BACKUP_BUCKET/backups/$ARCHIVE_NAME"
  if ! run aws s3 cp "$HOST_PATH" "s3://$S3_BACKUP_BUCKET/backups/$ARCHIVE_NAME"; then
    err "S3 upload failed — local archive preserved at $HOST_PATH"
    exit 1
  fi
  [[ $DRY_RUN -eq 0 ]] && ok "Uploaded to s3://$S3_BACKUP_BUCKET/backups/$ARCHIVE_NAME"
else
  info "S3_BACKUP_BUCKET not set — skipping S3 upload (local-only retention)"
fi

# --- Retention --------------------------------------------------------------
info "Pruning local backups older than $RETENTION_DAYS days from $BACKUP_DIR"
if [[ $DRY_RUN -eq 1 ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -name 'jwst-backup-*.archive.gz' \
    -mtime "+$RETENTION_DAYS" -print | sed 's/^/DRY-RUN: would delete: /'
else
  pruned="$(find "$BACKUP_DIR" -maxdepth 1 -name 'jwst-backup-*.archive.gz' \
    -mtime "+$RETENTION_DAYS" -delete -print | wc -l | tr -d ' ')"
  ok "Pruned $pruned old archive(s)"
fi

ok "Backup script finished"
