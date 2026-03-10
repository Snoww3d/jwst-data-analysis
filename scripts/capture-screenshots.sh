#!/usr/bin/env bash
#
# Capture screenshots of the JWST application for documentation.
#
# Prerequisites:
#   - playwright-cli installed globally: npm install -g @anthropic-ai/playwright-cli
#   - Docker stack running
#
# Usage:
#   ./scripts/capture-screenshots.sh            # Headless (default)
#   ./scripts/capture-screenshots.sh --headed   # Visible browser for debugging
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
FRONTEND_URL="http://localhost:3000"
BACKEND_URL="http://localhost:5001"
OUTPUT_DIR="$ROOT_DIR/docs/images"
SESSION="screenshots-$$"
HEADED_FLAG=""

# Parse arguments
for arg in "$@"; do
    case $arg in
        --headed)
            HEADED_FLAG="--headed"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--headed]"
            echo ""
            echo "Options:"
            echo "  --headed   Run browser in visible mode (for debugging)"
            exit 0
            ;;
    esac
done

CLI="playwright-cli -s=$SESSION"

# Check prerequisites
if ! command -v playwright-cli &> /dev/null; then
    echo -e "${RED}Error: playwright-cli is not installed${NC}"
    echo "Install with: npm install -g @anthropic-ai/playwright-cli"
    exit 1
fi

# Check services are running
echo -e "${BLUE}Checking services...${NC}"
if ! curl -sf "$BACKEND_URL/api/health" > /dev/null 2>&1; then
    echo -e "${RED}Error: Backend is not running at $BACKEND_URL${NC}"
    echo "Start Docker stack first: docker compose -f docker/docker-compose.yml -f docker/docker-compose.override.yml up -d"
    exit 1
fi

if ! curl -sf "$FRONTEND_URL" > /dev/null 2>&1; then
    echo -e "${RED}Error: Frontend is not running at $FRONTEND_URL${NC}"
    echo "Start Docker stack first: docker compose -f docker/docker-compose.yml -f docker/docker-compose.override.yml up -d"
    exit 1
fi
echo -e "${GREEN}✓ Services are running${NC}"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Ensure browser session is cleaned up on exit
cleanup() {
    $CLI close 2>/dev/null || true
}
trap cleanup EXIT

# --- Discover page (public, no auth needed) ---
echo -e "${BLUE}Capturing Discover page...${NC}"
$CLI open "$FRONTEND_URL" $HEADED_FLAG
$CLI resize 1512 780
# Wait for featured targets to load
sleep 3
$CLI screenshot --filename "$OUTPUT_DIR/screenshot-dashboard.png"
echo -e "${GREEN}✓ Dashboard saved${NC}"

# --- Login page ---
echo -e "${BLUE}Capturing Login page...${NC}"
$CLI goto "$FRONTEND_URL/login"
sleep 1
$CLI screenshot --filename "$OUTPUT_DIR/screenshot-login.png"
echo -e "${GREEN}✓ Login page saved${NC}"

# Close browser
$CLI close

echo ""
echo -e "${GREEN}Screenshots saved to $OUTPUT_DIR/${NC}"
ls -la "$OUTPUT_DIR"/screenshot-*.png 2>/dev/null || true
