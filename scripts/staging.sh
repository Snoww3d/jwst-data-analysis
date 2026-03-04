#!/usr/bin/env bash
# staging.sh — Start, stop, and check status of the staging EC2 instance
#
# Usage:
#   ./scripts/staging.sh start    # Start instance, wait for SSH, start Docker services
#   ./scripts/staging.sh stop     # Stop Docker services, then stop instance
#   ./scripts/staging.sh status   # Show instance state and running services
#   ./scripts/staging.sh deploy   # Pull latest staging branch and rebuild (instance must be running)
#   ./scripts/staging.sh ssh      # Open SSH session to staging
#
# Prerequisites:
#   - AWS CLI installed and configured
#   - SSH key at ~/.ssh/jwst-staging.pem
#
# The instance uses an Elastic IP so the address stays stable across stop/start.

set -euo pipefail

# --- Configuration -----------------------------------------------------------
INSTANCE_ID="i-0e018395a289e2b52"
REGION="us-east-1"
KEY_FILE="$HOME/.ssh/jwst-staging.pem"
STAGING_IP="54.84.128.209"
SSH_OPTS="-i $KEY_FILE -o StrictHostKeyChecking=no -o ConnectTimeout=5"
SSH_CMD="ssh $SSH_OPTS ec2-user@$STAGING_IP"

# --- Helpers -----------------------------------------------------------------
info()  { printf '\033[0;34m%s\033[0m\n' "$*"; }
ok()    { printf '\033[0;32m%s\033[0m\n' "$*"; }
warn()  { printf '\033[0;33m%s\033[0m\n' "$*"; }
err()   { printf '\033[0;31m%s\033[0m\n' "$*" >&2; }

get_state() {
  aws ec2 describe-instances \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION" \
    --query 'Reservations[0].Instances[0].State.Name' \
    --output text 2>/dev/null
}

wait_for_state() {
  local target="$1" max_wait="${2:-120}" elapsed=0
  info "Waiting for instance to reach '$target' state..."
  while true; do
    local state
    state=$(get_state)
    if [[ "$state" == "$target" ]]; then
      ok "Instance is $target."
      return 0
    fi
    if (( elapsed >= max_wait )); then
      err "Timeout waiting for '$target' (current: $state)"
      return 1
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done
}

wait_for_ssh() {
  local max_wait=90 elapsed=0
  info "Waiting for SSH to become available..."
  while true; do
    if $SSH_CMD "echo ok" &>/dev/null; then
      ok "SSH is ready."
      return 0
    fi
    if (( elapsed >= max_wait )); then
      err "Timeout waiting for SSH"
      return 1
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done
}

# --- Commands ----------------------------------------------------------------
cmd_start() {
  local state
  state=$(get_state)

  if [[ "$state" == "running" ]]; then
    ok "Instance is already running."
    info "Starting Docker services..."
    $SSH_CMD "cd ~/jwst-app/docker && docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d"
    ok "Staging is up at http://$STAGING_IP"
    return 0
  fi

  if [[ "$state" != "stopped" ]]; then
    err "Instance is in '$state' state. Can only start from 'stopped'."
    return 1
  fi

  info "Starting EC2 instance $INSTANCE_ID..."
  aws ec2 start-instances --instance-ids "$INSTANCE_ID" --region "$REGION" --output text >/dev/null

  wait_for_state "running"
  wait_for_ssh

  info "Starting Docker services..."
  $SSH_CMD "cd ~/jwst-app/docker && docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d"

  # Wait for processing engine health check
  info "Waiting for services to become healthy..."
  local retries=0
  while (( retries < 12 )); do
    if $SSH_CMD "cd ~/jwst-app/docker && docker compose ps --format '{{.Status}}' | grep -q healthy" 2>/dev/null; then
      break
    fi
    sleep 5
    retries=$((retries + 1))
  done

  ok "Staging is up at http://$STAGING_IP"
}

cmd_stop() {
  local state
  state=$(get_state)

  if [[ "$state" == "stopped" ]]; then
    ok "Instance is already stopped."
    return 0
  fi

  if [[ "$state" != "running" ]]; then
    err "Instance is in '$state' state. Can only stop from 'running'."
    return 1
  fi

  info "Stopping Docker services..."
  $SSH_CMD "cd ~/jwst-app/docker && docker compose -f docker-compose.yml -f docker-compose.staging.yml down" 2>/dev/null || true

  info "Stopping EC2 instance $INSTANCE_ID..."
  aws ec2 stop-instances --instance-ids "$INSTANCE_ID" --region "$REGION" --output text >/dev/null

  wait_for_state "stopped" 180
  ok "Instance stopped. EBS and Elastic IP are preserved."
}

cmd_status() {
  local state
  state=$(get_state)
  info "Instance: $INSTANCE_ID ($REGION)"
  info "IP:       $STAGING_IP (Elastic IP)"
  info "State:    $state"

  if [[ "$state" == "running" ]]; then
    echo ""
    info "Docker services:"
    $SSH_CMD "cd ~/jwst-app/docker && docker compose ps --format 'table {{.Name}}\t{{.Status}}'" 2>/dev/null || warn "Could not reach instance via SSH"
    echo ""
    info "Deployed commit:"
    $SSH_CMD "cd ~/jwst-app && git log -1 --format='%h %s (%cr)'" 2>/dev/null || true
  fi
}

cmd_deploy() {
  local state
  state=$(get_state)

  if [[ "$state" != "running" ]]; then
    err "Instance is '$state'. Start it first: ./scripts/staging.sh start"
    return 1
  fi

  info "Deploying latest staging branch to AWS..."
  $SSH_CMD "cd ~/jwst-app && git fetch origin && git checkout staging && git reset --hard origin/staging && cd docker && docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d --build"
  ok "Deployed. Verifying..."

  $SSH_CMD "cd ~/jwst-app && git log -1 --format='%h %s'" 2>/dev/null
  ok "Staging is up at http://$STAGING_IP"
}

cmd_promote() {
  info "Promoting main → staging..."
  git fetch origin
  git checkout staging
  git merge --ff-only origin/main
  git push origin staging
  ok "staging is now at $(git log -1 --format='%h %s')"
  echo ""
  info "Run './scripts/staging.sh deploy' to push to AWS."
}

cmd_ssh() {
  local state
  state=$(get_state)

  if [[ "$state" != "running" ]]; then
    err "Instance is '$state'. Start it first: ./scripts/staging.sh start"
    return 1
  fi

  exec $SSH_CMD
}

# --- Main --------------------------------------------------------------------
case "${1:-}" in
  start)  cmd_start  ;;
  stop)   cmd_stop   ;;
  status) cmd_status ;;
  deploy)  cmd_deploy  ;;
  promote) cmd_promote ;;
  ssh)     cmd_ssh     ;;
  *)
    echo "Usage: $0 {start|stop|status|deploy|promote|ssh}"
    echo ""
    echo "  start    Start instance and Docker services"
    echo "  stop     Stop Docker services and instance"
    echo "  status   Show instance state and services"
    echo "  deploy   Pull latest staging branch and rebuild on AWS"
    echo "  promote  Fast-forward staging to main (then deploy)"
    echo "  ssh      Open SSH session"
    exit 1
    ;;
esac
