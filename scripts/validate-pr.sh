#!/usr/bin/env bash

# Validate PR title, body, and branch against the same rules used in CI.
# Reuses .github/scripts/validate-pr.js so local and CI checks never drift.
#
# Usage:
#   ./scripts/validate-pr.sh              # validates PR for current branch
#   ./scripts/validate-pr.sh 238          # validates PR #238
#   ./scripts/validate-pr.sh --dry-run \  # validate before creating PR
#       --title "fix: foo" \
#       --body-file /tmp/body.md \
#       --branch fix/foo

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

PR_NUMBER=""
TITLE=""
BODY=""
BRANCH=""
BODY_FILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --title) TITLE="$2"; shift 2 ;;
        --body) BODY="$2"; shift 2 ;;
        --body-file) BODY_FILE="$2"; shift 2 ;;
        --branch) BRANCH="$2"; shift 2 ;;
        --dry-run) shift ;;  # accepted but no-op (all modes are read-only)
        [0-9]*) PR_NUMBER="$1"; shift ;;
        -h|--help)
            echo "Usage: $0 [PR_NUMBER] [--title TITLE] [--body BODY | --body-file FILE] [--branch BRANCH]"
            echo ""
            echo "  No args          Validate the PR for the current branch"
            echo "  PR_NUMBER        Validate a specific PR by number"
            echo "  --title          PR title (conventional commit format)"
            echo "  --body           PR body as a string"
            echo "  --body-file      Read PR body from a file"
            echo "  --branch         Branch name"
            echo "  --dry-run        Accepted for clarity (all modes are read-only)"
            exit 0
            ;;
        *) echo -e "${RED}Unknown argument: $1${NC}"; exit 1 ;;
    esac
done

# Load body from file if specified
if [[ -n "$BODY_FILE" ]]; then
    if [[ ! -f "$BODY_FILE" ]]; then
        echo -e "${RED}Body file not found: $BODY_FILE${NC}"
        exit 1
    fi
    BODY="$(cat "$BODY_FILE")"
fi

# If PR number given, fetch from GitHub
if [[ -n "$PR_NUMBER" ]]; then
    echo -e "${YELLOW}Fetching PR #${PR_NUMBER}...${NC}"
    PR_JSON="$(gh pr view "$PR_NUMBER" --json title,body,headRefName)"
    TITLE="$(echo "$PR_JSON" | jq -r '.title')"
    BODY="$(echo "$PR_JSON" | jq -r '.body')"
    BRANCH="$(echo "$PR_JSON" | jq -r '.headRefName')"
elif [[ -z "$TITLE" ]]; then
    # Try to find PR for current branch
    BRANCH="$(git rev-parse --abbrev-ref HEAD)"
    PR_JSON="$(gh pr view --json title,body,headRefName 2>/dev/null || true)"
    if [[ -n "$PR_JSON" && "$PR_JSON" != "" ]]; then
        TITLE="$(echo "$PR_JSON" | jq -r '.title')"
        BODY="$(echo "$PR_JSON" | jq -r '.body')"
        BRANCH="$(echo "$PR_JSON" | jq -r '.headRefName')"
        echo -e "Found PR for branch: ${YELLOW}${BRANCH}${NC}"
    else
        echo -e "${RED}No PR found for current branch and no arguments provided.${NC}"
        echo "Usage: $0 [PR_NUMBER] [--title TITLE --body BODY --branch BRANCH]"
        exit 1
    fi
fi

echo -e "Title:  ${YELLOW}${TITLE}${NC}"
echo -e "Branch: ${YELLOW}${BRANCH}${NC}"
echo ""

# Run the same validator used in CI
export PR_TITLE="$TITLE"
export PR_BODY="$BODY"
export PR_HEAD_REF="$BRANCH"

if node "$ROOT_DIR/.github/scripts/validate-pr.js"; then
    echo -e "\n${GREEN}  ✓ PR standards validation passed${NC}"
else
    echo -e "\n${RED}  ✗ Fix the above issues and re-run${NC}"
    exit 1
fi
