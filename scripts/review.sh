#!/usr/bin/env bash
# review.sh — Preview a pull request locally with one command
#
# Lists open PRs, lets you pick one, spins up an agent stack, and opens the browser.
#
# Usage:
#   ./scripts/review.sh              # Interactive: pick from open PRs
#   ./scripts/review.sh <pr-number>  # Direct: spin up a specific PR
#   ./scripts/review.sh --stop       # Stop all review stacks
#   ./scripts/review.sh --status     # Show running review stacks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_STACK="$SCRIPT_DIR/agent-stack.sh"

# Colors
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${CYAN}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }
die()   { err "$@"; exit 1; }

# ─── Commands ──────────────────────────────────────────────────────────────

review_pr() {
  local pr_number="$1"
  local name="pr-${pr_number}"

  # Spin up the stack
  "$AGENT_STACK" up "$name" --pr "$pr_number"

  # Get the URL and open browser
  local url
  url=$("$AGENT_STACK" url "$name")
  info "Opening ${BOLD}${url}${NC} in your browser..."
  open "$url" 2>/dev/null || xdg-open "$url" 2>/dev/null || echo "  Open manually: $url"
}

pick_pr() {
  # List open PRs
  info "Fetching open pull requests..."
  local pr_list
  pr_list=$(gh pr list --state open --json number,title,headRefName,author --template \
    '{{range .}}{{.number}}	{{.title}}	{{.headRefName}}	{{.author.login}}{{"\n"}}{{end}}' 2>/dev/null) \
    || die "Failed to list PRs. Is 'gh' authenticated?"

  if [[ -z "$pr_list" ]]; then
    info "No open pull requests found."
    exit 0
  fi

  echo ""
  echo -e "${BOLD}Open Pull Requests:${NC}"
  echo ""

  local i=0
  local numbers=()
  while IFS=$'\t' read -r number title branch author; do
    i=$((i + 1))
    numbers+=("$number")
    printf "  ${BOLD}%2d)${NC} #%-5s %-50s ${CYAN}%s${NC}\n" "$i" "$number" "$title" "$author"
  done <<< "$pr_list"

  echo ""
  echo -n "Select a PR to review (1-${i}), or 'q' to quit: "
  read -r choice

  if [[ "$choice" == "q" || "$choice" == "Q" ]]; then
    exit 0
  fi

  if ! [[ "$choice" =~ ^[0-9]+$ ]] || [[ "$choice" -lt 1 || "$choice" -gt "$i" ]]; then
    die "Invalid selection: $choice"
  fi

  local selected_pr="${numbers[$((choice - 1))]}"
  echo ""
  review_pr "$selected_pr"
}

stop_all() {
  info "Stopping all review stacks..."
  "$AGENT_STACK" down --all
}

show_status() {
  "$AGENT_STACK" status
}

# ─── Main ──────────────────────────────────────────────────────────────────

case "${1:-}" in
  --stop)   stop_all ;;
  --status) show_status ;;
  --help|-h)
    echo "Usage: review.sh [<pr-number>|--stop|--status]"
    echo ""
    echo "  review.sh              Interactive: pick from open PRs"
    echo "  review.sh <number>     Preview a specific PR by number"
    echo "  review.sh --stop       Stop all review stacks"
    echo "  review.sh --status     Show running stacks"
    exit 0
    ;;
  "")       pick_pr ;;
  *)
    if [[ "$1" =~ ^[0-9]+$ ]]; then
      review_pr "$1"
    else
      die "Unknown argument: $1. Use --help for usage."
    fi
    ;;
esac
