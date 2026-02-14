#!/usr/bin/env bash
# start.sh — Start the full JWST application stack (shared infra + main services)
#
# Usage:
#   ./scripts/start.sh              # start all
#   ./scripts/start.sh --build      # start with rebuild
#   ./scripts/start.sh --down       # stop everything

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../docker" && pwd)"

cd "$DOCKER_DIR"

if [[ "${1:-}" == "--down" ]]; then
  docker compose down
  docker compose -f docker-compose.shared.yml --env-file .env down
  exit 0
fi

BUILD_FLAG=""
if [[ "${1:-}" == "--build" ]]; then
  BUILD_FLAG="--build"
fi

# Start shared infrastructure (MongoDB + docs)
docker compose -f docker-compose.shared.yml --env-file .env up -d

# Start main stack
docker compose up -d $BUILD_FLAG
