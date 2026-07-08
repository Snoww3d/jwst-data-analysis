#!/usr/bin/env bash
# Import the CE seed bundle's Mongo metadata into the CE stack's MongoDB.
# Ships inside the bundle produced by scripts/seed-ce.sh; run it on the CE
# host from the bundle directory AFTER `docker compose -f docker-compose.ce.yml
# up -d` has started the mongodb container.
#
#   MONGO_ROOT_USERNAME=... MONGO_ROOT_PASSWORD=... ./restore-seed.sh
#
# Idempotent: documents keep their _id, so re-running upserts in place.
# CE is re-seedable by design — "restore" is re-running this script (plus
# re-pointing CE_DATA_DIR at the bundle's data/); no backup cron needed.
#
# NOTE: the engine connects as the read-only ceReader user, which cannot
# import. This script uses the root credentials, and (re)creates ceReader
# afterwards for pre-seeded volumes where the init script never ran.

set -euo pipefail

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${CE_MONGO_CONTAINER:-jwst-ce-mongodb}"
DB_NAME="${MONGO_DATABASE:-jwst_data_analysis}"

err() { printf '\033[0;31m%s\033[0m\n' "$*" >&2; }
die() { err "$@"; exit 1; }

[ -f "$BUNDLE_DIR/jwst_data.extjson" ] || die "jwst_data.extjson not found next to this script"
[ -n "${MONGO_ROOT_USERNAME:-}" ] || die "MONGO_ROOT_USERNAME is not set"
[ -n "${MONGO_ROOT_PASSWORD:-}" ] || die "MONGO_ROOT_PASSWORD is not set"
docker inspect "$CONTAINER" &>/dev/null || die "Container '$CONTAINER' is not running"

echo "Importing jwst_data documents into $DB_NAME..."
docker cp "$BUNDLE_DIR/jwst_data.extjson" "$CONTAINER:/tmp/jwst_data.extjson"
# Credentials and the db name travel via -e (never interpolated into the
# command string). The password does appear on mongoimport's in-container
# argv — accepted residual risk: the CE host is single-tenant and the
# container's PID namespace has no other workloads. (Same applies to the
# mongosh call below.)
docker exec -e MONGO_ROOT_USERNAME -e MONGO_ROOT_PASSWORD -e MONGO_DATABASE="$DB_NAME" \
    "$CONTAINER" bash -c '
    mongoimport --username "$MONGO_ROOT_USERNAME" --password "$MONGO_ROOT_PASSWORD" \
        --authenticationDatabase admin --db "$MONGO_DATABASE" --collection jwst_data \
        --file /tmp/jwst_data.extjson --mode upsert
    rm -f /tmp/jwst_data.extjson
'

if [ -n "${CE_MONGO_READER_PASSWORD:-}" ]; then
    echo "Ensuring ceReader user exists (pre-seeded volumes skip the init script)..."
    docker exec -e MONGO_ROOT_USERNAME -e MONGO_ROOT_PASSWORD \
        -e MONGO_CE_READER_PASSWORD="$CE_MONGO_READER_PASSWORD" \
        -e MONGO_DATABASE="$DB_NAME" "$CONTAINER" bash -c '
        mongosh --username "$MONGO_ROOT_USERNAME" --password "$MONGO_ROOT_PASSWORD" \
            --authenticationDatabase admin --quiet /docker-entrypoint-initdb.d/create-ce-reader.js
    '
else
    echo "CE_MONGO_READER_PASSWORD not set — skipping ceReader creation (fine if the volume was initialized by compose)."
fi

echo "Seed import complete. Restart the engine to pick up fresh data: docker restart jwst-ce-engine"
