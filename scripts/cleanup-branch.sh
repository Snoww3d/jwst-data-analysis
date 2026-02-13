#!/bin/bash
#
# Safely delete a local branch after verifying its PR was merged on GitHub.
# Handles squash merges where `git branch -d` can't detect the merge.
#
# Usage:
#   ./scripts/cleanup-branch.sh <branch-name>
#   ./scripts/cleanup-branch.sh --all    # Clean up all merged PR branches
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

usage() {
    echo "Usage: $0 <branch-name> | --all"
    echo ""
    echo "  <branch-name>  Delete a single branch after verifying its PR was merged"
    echo "  --all          Find and delete all local branches with merged PRs"
    exit 1
}

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: gh CLI not found. Install it from https://cli.github.com${NC}"
    exit 1
fi

delete_branch() {
    local branch="$1"

    # Don't delete main
    if [ "$branch" = "main" ]; then
        echo -e "${YELLOW}  Skipping main${NC}"
        return 1
    fi

    # Check if branch is used by a worktree
    if git worktree list 2>/dev/null | grep -q "\[$branch\]"; then
        echo -e "${YELLOW}  Skipping $branch (in use by a worktree)${NC}"
        return 1
    fi

    # Skip current branch
    local current_branch
    current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ "$branch" = "$current_branch" ]; then
        echo -e "${YELLOW}  Skipping $branch (currently checked out)${NC}"
        return 1
    fi

    # Check GitHub for a merged PR on this branch
    local pr_info
    pr_info=$(gh pr list --head "$branch" --state merged --json number,title --jq '.[0] | "#\(.number) \(.title)"' 2>/dev/null)

    # gh/jq returns "#null null" when no results — treat as empty
    if [[ -z "$pr_info" || "$pr_info" == *"null"* ]]; then
        # Also check closed (not merged)
        local closed_info
        closed_info=$(gh pr list --head "$branch" --state closed --json number,title --jq '.[0] | "#\(.number) \(.title)"' 2>/dev/null)

        if [[ -n "$closed_info" && "$closed_info" != *"null"* ]]; then
            echo -e "${YELLOW}  $branch — PR $closed_info was closed (not merged), skipping${NC}"
        else
            echo -e "${YELLOW}  $branch — no merged PR found, skipping${NC}"
        fi
        return 1
    fi

    git branch -D "$branch" >/dev/null 2>&1
    echo -e "${GREEN}  Deleted $branch (PR $pr_info)${NC}"
    return 0
}

if [ $# -eq 0 ]; then
    usage
fi

if [ "$1" = "--all" ]; then
    echo "Scanning local branches for merged PRs..."
    echo ""

    deleted=0
    skipped=0

    for branch in $(git branch --format='%(refname:short)' | grep -v '^main$'); do
        if delete_branch "$branch"; then
            ((deleted++))
        else
            ((skipped++))
        fi
    done

    echo ""
    echo "Done: $deleted deleted, $skipped skipped."

    # Prune stale remote tracking refs
    pruned=$(git remote prune origin 2>&1 | grep -c '\[pruned\]' || true)
    if [ "$pruned" -gt 0 ]; then
        echo "Pruned $pruned stale remote tracking refs."
    fi
else
    branch="$1"

    # Check the branch exists locally
    if ! git rev-parse --verify "$branch" >/dev/null 2>&1; then
        echo -e "${RED}Error: branch '$branch' does not exist locally${NC}"
        exit 1
    fi

    echo "Checking branch: $branch"
    if delete_branch "$branch"; then
        git remote prune origin >/dev/null 2>&1
    else
        exit 1
    fi
fi
