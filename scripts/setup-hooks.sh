#!/bin/bash
#
# Setup script to install git hooks for this repository.
#
# Usage: ./scripts/setup-hooks.sh
#
# This installs hooks that:
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
echo "  - pre-push: Prevents direct pushes to main branch"
echo ""
