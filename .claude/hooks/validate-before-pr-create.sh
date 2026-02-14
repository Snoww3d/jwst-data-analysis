#!/usr/bin/env bash
# PreToolUse hook: validates PR body BEFORE gh pr create runs.
# Blocks if required sections are missing, preventing CI failure emails.
# Exit 2 = block the tool call.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only intercept gh pr create commands
if ! echo "$COMMAND" | grep -qE 'gh pr create'; then
  exit 0
fi

# Validate branch name prefix
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
VALID_PREFIXES="feature/|fix/|docs/|refactor/|test/|chore/|dependabot/|codex/"
if [[ -n "$BRANCH" ]] && ! echo "$BRANCH" | grep -qE "^($VALID_PREFIXES)"; then
  echo "BLOCKED: Branch name '$BRANCH' does not start with a valid prefix." >&2
  echo "  Must start with: feature/, fix/, docs/, refactor/, test/, chore/, dependabot/, or codex/" >&2
  echo "  Rename with: git branch -m $BRANCH feature/<name>" >&2
  exit 2
fi

# Extract the --body content from the command.
# The agent typically uses: --body "$(cat <<'EOF' ... EOF)"
# which embeds a literal HEREDOC. We extract everything between the first
# pair of EOF markers (or fall back to simpler patterns).
BODY=""

if echo "$COMMAND" | grep -q -- '--body'; then
  # Method 1: Extract content between HEREDOC EOF markers
  BODY=$(echo "$COMMAND" | sed -n "/<<'EOF'/,/^EOF/{/<<'EOF'/d;/^EOF/d;p;}" | head -200)

  # Method 2: Simple --body "..." (no heredoc)
  if [[ -z "$BODY" ]]; then
    BODY=$(echo "$COMMAND" | sed -n 's/.*--body "\([^"]*\)".*/\1/p' | head -1)
  fi
fi

# If we couldn't extract the body, let it through (the CI check will catch it)
if [[ -z "$BODY" ]]; then
  exit 0
fi

# Check for required sections
MISSING=()
# Must match REQUIRED_SECTIONS in .github/scripts/validate-pr.js
for section in "## Summary" "## Why" "## Type of Change" "## Changes Made" "## Test Plan" "## Documentation Checklist" "## Tech Debt Impact" "## Risk & Rollback" "## Quality Checklist"; do
  if ! echo "$BODY" | grep -qF "$section"; then
    MISSING+=("$section")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "BLOCKED: PR body is missing required sections:" >&2
  for s in "${MISSING[@]}"; do
    echo "  - $s" >&2
  done
  echo "Use the PR template from .github/pull_request_template.md" >&2
  exit 2
fi

exit 0
