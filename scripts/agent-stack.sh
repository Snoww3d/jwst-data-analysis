#!/usr/bin/env bash
# agent-stack.sh — Manage isolated Docker stacks for agent worktrees
#
# Each agent/team gets its own frontend + backend + processing-engine stack
# with unique ports, all sharing a single MongoDB instance.
#
# Usage:
#   ./scripts/agent-stack.sh up <name> [--branch <branch>] [--pr <number>] [--frontend-only] [--rebuild]
#   ./scripts/agent-stack.sh down <name> [--cleanup]
#   ./scripts/agent-stack.sh down --all
#   ./scripts/agent-stack.sh rebuild <name> [service]
#   ./scripts/agent-stack.sh status
#   ./scripts/agent-stack.sh url <name>

set -euo pipefail

# ─── Configuration ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCKER_DIR="$PROJECT_ROOT/docker"
REGISTRY_FILE="$DOCKER_DIR/.agent-registry.json"
MAIN_COMPOSE="$DOCKER_DIR/docker-compose.yml"
AGENT_COMPOSE="$DOCKER_DIR/docker-compose.agent.yml"
ENV_FILE="$DOCKER_DIR/.env"

# Port allocation: agent N gets frontend=3000+N, backend=5001+N
MAX_AGENTS=9

# ─── Helpers ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }
die()   { err "$@"; exit 1; }

# ─── Registry Management ───────────────────────────────────────────────────
init_registry() {
  if [[ ! -f "$REGISTRY_FILE" ]]; then
    echo '{"agents":{}}' > "$REGISTRY_FILE"
  fi
}

get_agent_json() {
  local name="$1"
  jq -r ".agents[\"$name\"] // empty" "$REGISTRY_FILE"
}

get_agent_field() {
  local name="$1" field="$2"
  jq -r ".agents[\"$name\"].$field // empty" "$REGISTRY_FILE"
}

list_agents() {
  jq -r '.agents | keys[]' "$REGISTRY_FILE" 2>/dev/null
}

next_slot() {
  local used_slots
  used_slots=$(jq -r '.agents[].slot // empty' "$REGISTRY_FILE" 2>/dev/null | sort -n)
  for i in $(seq 1 $MAX_AGENTS); do
    if ! echo "$used_slots" | grep -q "^${i}$"; then
      echo "$i"
      return
    fi
  done
  die "All $MAX_AGENTS agent slots are in use. Run 'agent-stack.sh down <name>' to free one."
}

register_agent() {
  local name="$1" slot="$2" worktree="$3" branch="$4" mode="$5"
  local frontend_port=$((3000 + slot))
  local backend_port=$((5001 + slot))
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  jq --arg name "$name" \
     --argjson slot "$slot" \
     --arg worktree "$worktree" \
     --arg branch "$branch" \
     --arg mode "$mode" \
     --argjson fp "$frontend_port" \
     --argjson bp "$backend_port" \
     --arg started "$now" \
     '.agents[$name] = {slot: $slot, worktree: $worktree, branch: $branch, mode: $mode, frontend_port: $fp, backend_port: $bp, started: $started}' \
     "$REGISTRY_FILE" > "${REGISTRY_FILE}.tmp" && mv "${REGISTRY_FILE}.tmp" "$REGISTRY_FILE"
}

unregister_agent() {
  local name="$1"
  jq --arg name "$name" 'del(.agents[$name])' \
     "$REGISTRY_FILE" > "${REGISTRY_FILE}.tmp" && mv "${REGISTRY_FILE}.tmp" "$REGISTRY_FILE"
}

# ─── Main Stack Check ───────────────────────────────────────────────────────
ensure_main_stack() {
  # Agent stacks need the main stack running (it owns MongoDB + jwst-shared network)
  if ! docker network inspect jwst-shared &>/dev/null; then
    info "Main stack not running — starting it (needed for MongoDB + shared network)..."
    (cd "$DOCKER_DIR" && docker compose --env-file "$ENV_FILE" up -d)
    ok "Main stack started"
  elif ! docker ps --format '{{.Names}}' | grep -q '^jwst-mongodb$'; then
    info "jwst-shared network exists but MongoDB is down — starting main stack..."
    (cd "$DOCKER_DIR" && docker compose --env-file "$ENV_FILE" up -d)
    ok "Main stack started"
  fi
}

# ─── Port Availability Check ───────────────────────────────────────────────
check_port() {
  local port="$1" label="$2"
  if lsof -i ":$port" -sTCP:LISTEN &>/dev/null; then
    die "Port $port ($label) is already in use"
  fi
}

# ─── Worktree Management ───────────────────────────────────────────────────
find_worktree() {
  local name="$1"
  # Check common worktree locations
  local patterns=(
    "$PROJECT_ROOT-${name}"
    "$PROJECT_ROOT-agent-${name}"
  )
  for path in "${patterns[@]}"; do
    if [[ -d "$path" && -d "$path/.git" ]] || [[ -d "$path" && -f "$path/.git" ]]; then
      echo "$path"
      return
    fi
  done
}

create_worktree() {
  local name="$1" branch="$2"
  local worktree_path="$PROJECT_ROOT-${name}"

  if [[ -d "$worktree_path" ]]; then
    warn "Directory $worktree_path already exists" >&2
    echo "$worktree_path"
    return
  fi

  info "Creating worktree at $worktree_path from branch $branch..." >&2
  # Fetch the branch if it's remote
  git -C "$PROJECT_ROOT" fetch origin "$branch" &>/dev/null || true
  git -C "$PROJECT_ROOT" worktree add "$worktree_path" "$branch" &>/dev/null \
    || git -C "$PROJECT_ROOT" worktree add "$worktree_path" "origin/$branch" &>/dev/null \
    || die "Failed to create worktree from branch '$branch'"
  ok "Worktree created at $worktree_path" >&2
  echo "$worktree_path"
}

# ─── Commands ───────────────────────────────────────────────────────────────

cmd_up() {
  local name="" branch="" pr_number="" frontend_only=false do_rebuild=false

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --branch)        branch="$2"; shift 2 ;;
      --pr)            pr_number="$2"; shift 2 ;;
      --frontend-only) frontend_only=true; shift ;;
      --rebuild)       do_rebuild=true; shift ;;
      -*)              die "Unknown option: $1" ;;
      *)               name="$1"; shift ;;
    esac
  done

  # Resolve --pr to branch name
  if [[ -n "$pr_number" ]]; then
    info "Looking up PR #${pr_number}..."
    branch=$(gh pr view "$pr_number" --json headRefName -q .headRefName 2>/dev/null) \
      || die "Could not find PR #${pr_number}. Is it open?"
    ok "PR #${pr_number} → branch '$branch'"
    # Auto-derive stack name from PR if not provided
    if [[ -z "$name" ]]; then
      name="pr-${pr_number}"
    fi
  fi

  [[ -n "$name" ]] || die "Usage: agent-stack.sh up <name> [--branch <branch>] [--pr <number>] [--frontend-only] [--rebuild]"

  init_registry

  # Check if already running
  local existing
  existing=$(get_agent_json "$name")
  if [[ -n "$existing" ]]; then
    local fp bp wt
    fp=$(echo "$existing" | jq -r '.frontend_port')
    bp=$(echo "$existing" | jq -r '.backend_port')
    wt=$(echo "$existing" | jq -r '.worktree')
    ok "Agent '$name' is already registered"
    echo -e "  Frontend: ${BOLD}http://localhost:${fp}${NC}"
    echo -e "  Backend:  :${bp}"
    echo -e "  Worktree: $wt"

    if $do_rebuild; then
      info "Rebuilding..."
      cmd_rebuild "$name"
    fi
    return
  fi

  # Find or create worktree
  local worktree=""
  if [[ -n "$branch" ]]; then
    worktree=$(create_worktree "$name" "$branch")
  else
    worktree=$(find_worktree "$name")
    [[ -n "$worktree" ]] || die "No worktree found for '$name'. Use --branch to create one, or ensure $PROJECT_ROOT-${name} exists."
  fi

  # Get the branch name from the worktree
  if [[ -z "$branch" ]]; then
    branch=$(git -C "$worktree" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  fi

  # Allocate port slot
  local slot
  slot=$(next_slot)
  local frontend_port=$((3000 + slot))
  local backend_port=$((5001 + slot))

  local mode="full"
  if $frontend_only; then
    mode="frontend-only"
    backend_port=5001  # Use main backend
  fi

  # Check port availability
  check_port "$frontend_port" "frontend"
  if [[ "$mode" == "full" ]]; then
    check_port "$backend_port" "backend"
  fi

  # Ensure shared infra is running
  ensure_main_stack

  # Register agent
  register_agent "$name" "$slot" "$worktree" "$branch" "$mode"

  # Load MongoDB credentials from .env
  if [[ ! -f "$ENV_FILE" ]]; then
    die "No .env file found at $ENV_FILE — copy from .env.example"
  fi

  # Build environment for docker compose
  local compose_project="jwst-agent-${name}"
  local data_dir="$PROJECT_ROOT/data"

  info "Starting agent stack '$name' (${mode})..."
  echo -e "  Frontend: ${BOLD}http://localhost:${frontend_port}${NC}"
  echo -e "  Backend:  :${backend_port}"
  echo -e "  Worktree: $worktree"
  echo -e "  Branch:   $branch"

  local compose_env=(
    "COMPOSE_PROJECT_NAME=$compose_project"
    "SOURCE_ROOT=$worktree"
    "DATA_DIR=$data_dir"
    "FRONTEND_PORT=$frontend_port"
    "BACKEND_PORT=$backend_port"
  )

  local services=""
  if [[ "$mode" == "frontend-only" ]]; then
    services="frontend"
  fi

  # Run docker compose with all env vars
  # -V renews anonymous volumes (prevents stale node_modules/esbuild binaries)
  (
    export "${compose_env[@]}"
    docker compose \
      -f "$AGENT_COMPOSE" \
      --env-file "$ENV_FILE" \
      up -d --build -V $services
  )

  ok "Agent stack '$name' is running at http://localhost:${frontend_port}"
}

cmd_down() {
  local name="" all=false cleanup=false

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --all)     all=true; shift ;;
      --cleanup) cleanup=true; shift ;;
      -*)        die "Unknown option: $1" ;;
      *)         name="$1"; shift ;;
    esac
  done

  init_registry

  if $all; then
    local agents
    agents=$(list_agents)
    if [[ -z "$agents" ]]; then
      info "No agent stacks registered"
      return
    fi
    while IFS= read -r agent_name; do
      _stop_agent "$agent_name" "$cleanup"
    done <<< "$agents"
    ok "All agent stacks stopped"
    return
  fi

  [[ -n "$name" ]] || die "Usage: agent-stack.sh down <name> [--cleanup] | agent-stack.sh down --all"
  _stop_agent "$name" "$cleanup"
}

_stop_agent() {
  local name="$1" cleanup="${2:-false}"

  local existing
  existing=$(get_agent_json "$name")
  if [[ -z "$existing" ]]; then
    warn "Agent '$name' is not registered"
    return
  fi

  local worktree
  worktree=$(echo "$existing" | jq -r '.worktree')
  local compose_project="jwst-agent-${name}"

  info "Stopping agent stack '$name'..."

  # Stop the compose project
  (
    export COMPOSE_PROJECT_NAME="$compose_project"
    export SOURCE_ROOT="$worktree"
    export DATA_DIR="$PROJECT_ROOT/data"
    export FRONTEND_PORT=0  # dummy values for compose parse
    export BACKEND_PORT=0
    docker compose \
      -f "$AGENT_COMPOSE" \
      --env-file "$ENV_FILE" \
      down --remove-orphans 2>/dev/null || true
  )

  # Unregister
  unregister_agent "$name"
  ok "Agent stack '$name' stopped"

  # Optionally clean up worktree
  if [[ "$cleanup" == "true" && -n "$worktree" && "$worktree" != "$PROJECT_ROOT" ]]; then
    info "Removing worktree at $worktree..."
    git -C "$PROJECT_ROOT" worktree remove "$worktree" --force 2>/dev/null || true
    ok "Worktree removed"
  fi
}

cmd_rebuild() {
  local name="${1:?Usage: agent-stack.sh rebuild <name> [service]}"
  local service="${2:-}"

  init_registry

  local existing
  existing=$(get_agent_json "$name")
  [[ -n "$existing" ]] || die "Agent '$name' is not registered. Run 'up' first."

  local worktree frontend_port backend_port mode
  worktree=$(echo "$existing" | jq -r '.worktree')
  frontend_port=$(echo "$existing" | jq -r '.frontend_port')
  backend_port=$(echo "$existing" | jq -r '.backend_port')
  mode=$(echo "$existing" | jq -r '.mode')

  local compose_project="jwst-agent-${name}"

  info "Rebuilding agent stack '$name'${service:+ (service: $service)}..."

  local services="$service"
  if [[ -z "$services" && "$mode" == "frontend-only" ]]; then
    services="frontend"
  fi

  (
    export COMPOSE_PROJECT_NAME="$compose_project"
    export SOURCE_ROOT="$worktree"
    export DATA_DIR="$PROJECT_ROOT/data"
    export FRONTEND_PORT="$frontend_port"
    export BACKEND_PORT="$backend_port"
    docker compose \
      -f "$AGENT_COMPOSE" \
      --env-file "$ENV_FILE" \
      up -d --build $services
  )

  ok "Agent stack '$name' rebuilt"
}

cmd_status() {
  init_registry

  echo ""
  echo -e "${BOLD}SHARED INFRASTRUCTURE${NC}"

  # Check MongoDB
  if docker ps --format '{{.Names}}' | grep -q '^jwst-mongodb$'; then
    echo -e "  mongodb    ${GREEN}● running${NC}   :27017"
  else
    echo -e "  mongodb    ${RED}○ stopped${NC}"
  fi

  # Check docs
  if docker ps --format '{{.Names}}' | grep -q '^jwst-docs$'; then
    echo -e "  docs       ${GREEN}● running${NC}   :8001"
  else
    echo -e "  docs       ${RED}○ stopped${NC}"
  fi

  echo ""
  echo -e "${BOLD}MAIN STACK${NC}"

  # Check main services
  for svc in jwst-frontend jwst-backend jwst-processing; do
    local label="${svc#jwst-}"
    if docker ps --format '{{.Names}}' | grep -q "^${svc}$"; then
      local port_info=""
      case "$label" in
        frontend) port_info="http://localhost:3000" ;;
        backend)  port_info=":5001" ;;
        processing) port_info=":8000" ;;
      esac
      printf "  %-12s ${GREEN}● running${NC}   %s\n" "$label" "$port_info"
    else
      printf "  %-12s ${RED}○ stopped${NC}\n" "$label"
    fi
  done

  echo ""
  echo -e "${BOLD}AGENT STACKS${NC}"

  local agents
  agents=$(list_agents)
  if [[ -z "$agents" ]]; then
    echo "  (none)"
  else
    local total_active=0
    while IFS= read -r agent_name; do
      local fp bp wt branch mode
      fp=$(get_agent_field "$agent_name" "frontend_port")
      bp=$(get_agent_field "$agent_name" "backend_port")
      wt=$(get_agent_field "$agent_name" "worktree")
      branch=$(get_agent_field "$agent_name" "branch")
      mode=$(get_agent_field "$agent_name" "mode")

      local project="jwst-agent-${agent_name}"
      # Check if the frontend container is running
      local running=false
      if docker ps --format '{{.Names}}' | grep -q "^${project}-frontend"; then
        running=true
        total_active=$((total_active + 1))
      fi

      if $running; then
        printf "  %-16s ${GREEN}● running${NC}   ${BOLD}http://localhost:%-5s${NC} %-40s [%s]\n" \
          "$agent_name" "$fp" "$branch" "$mode"
      else
        printf "  %-16s ${RED}○ stopped${NC}   %-47s %-40s [%s]\n" \
          "$agent_name" "" "$branch" "$mode"
      fi
    done <<< "$agents"

    echo ""
    echo -e "  ${total_active} agent(s) active"
  fi
  echo ""
}

cmd_url() {
  local name="${1:?Usage: agent-stack.sh url <name>}"
  init_registry
  local fp
  fp=$(get_agent_field "$name" "frontend_port")
  [[ -n "$fp" ]] || die "Agent '$name' is not registered"
  echo "http://localhost:${fp}"
}

# ─── Main ───────────────────────────────────────────────────────────────────
cmd="${1:-}"
shift || true

case "$cmd" in
  up)      cmd_up "$@" ;;
  down)    cmd_down "$@" ;;
  rebuild) cmd_rebuild "$@" ;;
  status)  cmd_status ;;
  url)     cmd_url "$@" ;;
  *)
    echo "Usage: agent-stack.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  up <name> [--branch <branch>] [--pr <number>] [--frontend-only] [--rebuild]"
    echo "      Start an agent stack. Auto-detects worktree or creates from branch."
    echo "      --pr resolves a GitHub PR number to its branch (name defaults to pr-N)."
    echo ""
    echo "  down <name> [--cleanup]"
    echo "      Stop an agent stack. --cleanup also removes the worktree."
    echo ""
    echo "  down --all"
    echo "      Stop all agent stacks."
    echo ""
    echo "  rebuild <name> [service]"
    echo "      Rebuild an agent stack (or specific service like 'backend')."
    echo ""
    echo "  status"
    echo "      Show all running stacks with ports and URLs."
    echo ""
    echo "  url <name>"
    echo "      Print the frontend URL for an agent."
    echo ""
    echo "Port allocation:"
    echo "  Agent slot 1: frontend=3001, backend=5002"
    echo "  Agent slot 2: frontend=3002, backend=5003"
    echo "  ... up to slot $MAX_AGENTS"
    exit 1
    ;;
esac
