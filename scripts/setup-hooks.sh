#!/bin/bash
#
# Setup script to install git hooks for this repository.
#
# Usage: ./scripts/setup-hooks.sh
#
# This installs hooks that:
# - Run linting, formatting, and tests before commit (pre-commit)
# - Prevent direct pushes to main branch (pre-push)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_SOURCE="$REPO_ROOT/.githooks"
HOOKS_TARGET="$REPO_ROOT/.git/hooks"

echo "Setting up git hooks for JWST Data Analysis..."
echo ""

# Check we're in a git repo
if [ ! -d "$REPO_ROOT/.git" ]; then
    echo "❌ Error: Not a git repository. Run this from the project root."
    exit 1
fi

# Check hooks source exists
if [ ! -d "$HOOKS_SOURCE" ]; then
    echo "❌ Error: .githooks directory not found."
    exit 1
fi

# Install pre-commit hook
if [ -f "$HOOKS_SOURCE/pre-commit" ]; then
    cp "$HOOKS_SOURCE/pre-commit" "$HOOKS_TARGET/pre-commit"
    chmod +x "$HOOKS_TARGET/pre-commit"
    echo "✅ Installed pre-commit hook (runs lint, format, and tests)"
fi

# Install pre-push hook
if [ -f "$HOOKS_SOURCE/pre-push" ]; then
    cp "$HOOKS_SOURCE/pre-push" "$HOOKS_TARGET/pre-push"
    chmod +x "$HOOKS_TARGET/pre-push"
    echo "✅ Installed pre-push hook (blocks direct pushes to main)"
fi

echo ""
echo "Git hooks installed successfully!"
echo ""
echo "Hooks active:"
echo "  - pre-commit: Runs lint, format check, and tests for changed files"
echo "  - pre-push: Prevents direct pushes to main branch"
echo ""
echo "To skip hooks temporarily (not recommended):"
echo "  git commit --no-verify"
echo "  git push --no-verify"
echo ""
