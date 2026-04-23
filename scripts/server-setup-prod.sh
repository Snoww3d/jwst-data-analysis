#!/usr/bin/env bash
# server-setup-prod.sh — Bootstrap the JWST app on a production EC2 instance.
#
# Differences from server-setup.sh (staging):
#   - Requires DOMAIN_NAME env var; validates hostname format
#   - DNS pre-flight: dig $DOMAIN_NAME must resolve to the EIP before any
#     certbot work, to avoid Let's Encrypt rate-limit lockout
#   - SSL cert presence check before bringing up the stack
#   - HTTPS CORS origin (instead of http://<ip>)
#   - Uses docker-compose.prod.yml (not staging.yml)
#   - Refuses to silently overwrite an existing staging .env
#
# Usage:
#   DOMAIN_NAME=jwst.example.com ./server-setup-prod.sh
#
# Cert acquisition order (first-time deploy):
#   1. Run this script — it will fail at the cert check and print instructions
#   2. Acquire certs via certbot (standalone or webroot)
#   3. Place fullchain.pem + privkey.pem in $APP_DIR/docker/ssl/
#   4. Re-run this script — it proceeds past the cert check this time
#
# Re-running is safe — pulls latest, rebuilds, restarts.

set -euo pipefail

# --- Configuration ----------------------------------------------------------
REPO_URL="${REPO_URL:-https://github.com/Snoww3d/jwst-data-analysis.git}"
APP_DIR="${APP_DIR:-$HOME/jwst-app}"
BRANCH="${BRANCH:-main}"
SSL_DIR="$APP_DIR/docker/ssl"

# --- Helpers ----------------------------------------------------------------
info()  { printf "\033[1;34m[INFO]\033[0m  %s\n" "$*"; }
ok()    { printf "\033[1;32m[OK]\033[0m    %s\n" "$*"; }
warn()  { printf "\033[1;33m[WARN]\033[0m  %s\n" "$*"; }
err()   { printf "\033[1;31m[ERROR]\033[0m %s\n" "$*" >&2; }
die()   { err "$*"; exit 1; }

# --- Validate DOMAIN_NAME ---------------------------------------------------
[[ -n "${DOMAIN_NAME:-}" ]] \
  || die "DOMAIN_NAME env var is required (e.g. DOMAIN_NAME=jwst.example.com $0)"

# Simplified RFC 1123 hostname check: lowercase labels separated by dots,
# each label 1-63 chars, TLD at least 2 alpha chars.
if ! [[ "$DOMAIN_NAME" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
  die "DOMAIN_NAME='$DOMAIN_NAME' does not look like a valid lowercase hostname"
fi
ok "DOMAIN_NAME=$DOMAIN_NAME"

# --- Wait for Docker --------------------------------------------------------
info "Waiting for Docker to be ready..."
retries=0
while ! docker info &>/dev/null; do
    retries=$((retries + 1))
    if [[ $retries -ge 60 ]]; then
        die "Docker not ready after 5 minutes. Check: sudo systemctl status docker"
    fi
    sleep 5
done
ok "Docker is ready"

docker compose version &>/dev/null || die "Docker Compose plugin not installed"
ok "Docker Compose $(docker compose version --short)"

# --- Detect EIP via EC2 instance metadata -----------------------------------
info "Looking up this instance's public IP from EC2 metadata..."
TOKEN=$(curl -s --max-time 2 -X PUT "http://169.254.169.254/latest/api/token" \
        -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || echo "")
if [[ -n "$TOKEN" ]]; then
    PUBLIC_IP=$(curl -s --max-time 5 -H "X-aws-ec2-metadata-token: $TOKEN" \
                http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "")
else
    PUBLIC_IP=$(curl -s --max-time 5 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "")
fi
[[ -n "$PUBLIC_IP" ]] || die "Could not detect public IP via instance metadata. Are you on EC2?"
ok "Public IP: $PUBLIC_IP"

# --- DNS pre-flight (avoid Let's Encrypt rate-limit lockout) ---------------
# Single-IP A-record assumption: dig may emit a CNAME line before the A line.
# `grep -E '^[0-9.]+'` filters to IPv4-shaped lines so a stray CNAME or warning
# doesn't break parsing. For round-robin / load-balanced setups, this preflight
# would need to compare against any of the published IPs, not just one.
info "Resolving $DOMAIN_NAME via DNS..."
RESOLVED_IP="$(dig +short +time=3 +tries=2 "$DOMAIN_NAME" A \
    | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tail -1 || true)"
if [[ -z "$RESOLVED_IP" ]]; then
    die "DNS lookup for $DOMAIN_NAME returned no A-record. Add an A-record pointing to $PUBLIC_IP and wait for propagation (usually <5 min on Route 53), then re-run this script."
fi
if [[ "$RESOLVED_IP" != "$PUBLIC_IP" ]]; then
    die "DNS mismatch: $DOMAIN_NAME resolves to $RESOLVED_IP but this instance is $PUBLIC_IP. Update the A-record and wait for propagation before re-running. (Avoiding LE rate-limit: 5 failed validations / hour / domain.)"
fi
ok "DNS preflight passed: $DOMAIN_NAME → $PUBLIC_IP"

# --- Clone / Update Repo ----------------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
    info "Repo exists — pulling latest changes..."
    cd "$APP_DIR"
    git fetch origin
    git reset --hard "origin/$BRANCH"
    ok "Updated to latest $BRANCH"
else
    info "Cloning repository..."
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
    ok "Cloned to $APP_DIR"
fi

# --- Data directory ---------------------------------------------------------
mkdir -p "$APP_DIR/data/mast"
sudo chown -R 1001:1001 "$APP_DIR/data"
ok "Data directory ready (owned by container user 1001)"

# --- SSL cert presence check ------------------------------------------------
# The flat fullchain.pem + privkey.pem are what nginx reads. The renewal/
# subdir is what certbot needs to know which cert to renew. Both must be
# present — the in-stack certbot service silently no-ops without renewal/.
if [[ ! -f "$SSL_DIR/fullchain.pem" || ! -f "$SSL_DIR/privkey.pem" \
   || ! -d "$SSL_DIR/renewal" ]]; then
    mkdir -p "$SSL_DIR"
    err "TLS certificates and/or renewal config not found in $SSL_DIR"
    err ""
    err "Acquire and stage them via certbot:"
    err ""
    err "  # 1. Acquire the cert (port 80 must be free — stop any running web server)"
    err "  sudo certbot certonly --standalone -d $DOMAIN_NAME"
    err ""
    err "  # 2. Copy the FULL letsencrypt tree (live/, archive/, renewal/, accounts/)"
    err "  #    so the in-stack certbot service can renew. Use rsync -a to preserve"
    err "  #    the symlinks live/$DOMAIN_NAME/* -> ../../archive/$DOMAIN_NAME/*."
    err "  sudo rsync -a /etc/letsencrypt/ $SSL_DIR/"
    err ""
    err "  # 3. Copy the flat fullchain.pem + privkey.pem that nginx reads at /etc/nginx/ssl/"
    err "  sudo cp $SSL_DIR/live/$DOMAIN_NAME/fullchain.pem $SSL_DIR/fullchain.pem"
    err "  sudo cp $SSL_DIR/live/$DOMAIN_NAME/privkey.pem   $SSL_DIR/privkey.pem"
    err "  sudo chown -R \$USER:\$USER $SSL_DIR"
    err ""
    err "  # 4. Belt-and-suspenders: lock down private keys and the dirs that hold them."
    err "  find $SSL_DIR -type f -name 'privkey*.pem' -exec chmod 600 {} +"
    err "  chmod 600 $SSL_DIR/privkey.pem 2>/dev/null || true"
    err "  chmod 700 $SSL_DIR/archive $SSL_DIR/live 2>/dev/null || true"
    err ""
    err "Then re-run this script."
    exit 1
fi
ok "TLS certificates and renewal config present in $SSL_DIR"

# Defense-in-depth: re-assert privkey perms even if the operator skipped step 4.
find "$SSL_DIR" -type f -name 'privkey*.pem' -exec chmod 600 {} + 2>/dev/null || true
chmod 600 "$SSL_DIR/privkey.pem" 2>/dev/null || true
chmod 700 "$SSL_DIR/archive" "$SSL_DIR/live" 2>/dev/null || true

# --- Environment File -------------------------------------------------------
ENV_FILE="$APP_DIR/docker/.env"
if [[ -f "$ENV_FILE" ]]; then
    # Profile-switch detection: existing staging .env has http:// CORS origin.
    if grep -qE '^CORS_ALLOWED_ORIGINS=http://' "$ENV_FILE"; then
        warn "Existing $ENV_FILE looks like a staging config (HTTP CORS origin)."
        warn "Re-running this script will NOT overwrite .env. To switch this host"
        warn "to production, either:"
        warn "  1. Delete $ENV_FILE and re-run this script, OR"
        warn "  2. Manually update CORS_ALLOWED_ORIGINS to https://$DOMAIN_NAME"
        warn "Continuing with existing .env (no changes made)..."
    else
        info ".env already exists — keeping existing values"
    fi
else
    info "Creating .env file for production..."

    # Generate a strong MongoDB password and JWT secret. The pipeline can
    # in principle short-change us if openssl emits an unusual amount of
    # base64-padding chars (which tr strips), so we explicitly assert the
    # final lengths. JwtTokenService refuses any key under 32 chars.
    MONGO_PW=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
    JWT_KEY=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)
    [[ ${#MONGO_PW} -ge 16 ]] || die "Generated MongoDB password too short (${#MONGO_PW} chars); rerun"
    [[ ${#JWT_KEY}  -ge 32 ]] || die "Generated JWT key too short (${#JWT_KEY} chars); rerun"

    cat > "$ENV_FILE" <<EOF
# JWST Production Environment — generated by server-setup-prod.sh
# To regenerate: delete this file and re-run server-setup-prod.sh

# MongoDB
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=$MONGO_PW
MONGO_DATABASE=jwst_data_analysis

# Backend
ASPNETCORE_ENVIRONMENT=Production
JWT_SECRET_KEY=$JWT_KEY
CORS_ALLOWED_ORIGINS=https://$DOMAIN_NAME

# Frontend — same-origin requests; nginx proxies /api to backend.
VITE_API_URL=

# Processing
MAST_DOWNLOAD_DIR=/app/data/mast
MAST_DOWNLOAD_TIMEOUT=3600

# Storage (defaults to local; switch to s3 + populate keys for prod S3)
STORAGE_PROVIDER=local

# Production
DOMAIN_NAME=$DOMAIN_NAME
EOF

    chmod 600 "$ENV_FILE"
    ok ".env created (MongoDB password + JWT key auto-generated)"
    info "CORS_ALLOWED_ORIGINS set to https://$DOMAIN_NAME"
fi

# --- Build and Start --------------------------------------------------------
info "Building and starting services (this may take several minutes on first run)..."
cd "$APP_DIR/docker"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build 2>&1
ok "Services started"

# --- Health Check -----------------------------------------------------------
info "Waiting for services to become healthy..."

check_container() {
    local name="$1"
    local max_wait="${2:-60}"
    local elapsed=0
    while [[ $elapsed -lt $max_wait ]]; do
        local state
        state=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "missing")
        if [[ "$state" == "running" ]]; then
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
    return 1
}

all_healthy=true
for service in jwst-mongodb jwst-backend jwst-processing jwst-frontend; do
    if check_container "$service" 120; then
        ok "$service is running"
    else
        err "$service failed to start"
        all_healthy=false
    fi
done

echo ""
if $all_healthy; then
    echo "========================================"
    echo "  JWST App (production) is running!"
    echo "========================================"
    echo ""
    echo "  URL: https://$DOMAIN_NAME"
    echo ""
    echo "  TLS auto-renewal: in-stack certbot service runs every 12h."
    echo "  Verify: docker compose -f docker-compose.yml -f docker-compose.prod.yml logs certbot"
    echo ""
    echo "  Backups (set up cron after first deploy):"
    echo "    0 3 * * * $APP_DIR/scripts/backup-mongo.sh >> /var/log/jwst-backup.log 2>&1"
    echo ""
    echo "  Useful commands:"
    echo "    docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f"
    echo "    docker compose -f docker-compose.yml -f docker-compose.prod.yml restart"
    echo "    docker compose -f docker-compose.yml -f docker-compose.prod.yml down"
    echo ""
    echo "  To update after pushing new code, re-run this script."
    echo "========================================"
else
    echo "Some services failed to start. Check logs:"
    echo "  cd $APP_DIR/docker"
    echo "  docker compose -f docker-compose.yml -f docker-compose.prod.yml logs"
    exit 1
fi
