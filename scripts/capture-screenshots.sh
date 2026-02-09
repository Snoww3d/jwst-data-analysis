#!/usr/bin/env bash
#
# Capture screenshots of the JWST application for documentation.
#
# Prerequisites:
#   - playwright-cli installed globally: npm install -g @playwright/cli@latest
#   - Docker stack running: cd docker && docker compose up -d
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
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
FRONTEND_URL="http://localhost:3000"
BACKEND_URL="http://localhost:5001"
OUTPUT_DIR="$ROOT_DIR/docs/images"
HEADLESS="true"

# Parse arguments
for arg in "$@"; do
    case $arg in
        --headed)
            HEADLESS="false"
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

# Check prerequisites
if ! command -v playwright-cli &> /dev/null; then
    echo -e "${RED}Error: playwright-cli is not installed${NC}"
    echo "Install with: npm install -g @playwright/cli@latest"
    exit 1
fi

# Check services are running
echo -e "${BLUE}Checking services...${NC}"
if ! curl -sf "$BACKEND_URL/api/health" > /dev/null 2>&1; then
    echo -e "${RED}Error: Backend is not running at $BACKEND_URL${NC}"
    echo "Start Docker stack first: cd docker && docker compose up -d"
    exit 1
fi

if ! curl -sf "$FRONTEND_URL" > /dev/null 2>&1; then
    echo -e "${RED}Error: Frontend is not running at $FRONTEND_URL${NC}"
    echo "Start Docker stack first: cd docker && docker compose up -d"
    exit 1
fi
echo -e "${GREEN}✓ Services are running${NC}"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Register a temporary user and get auth tokens
echo -e "${BLUE}Creating temporary user for screenshots...${NC}"
TEMP_USER="screenshot-user-$$"
TEMP_PASS="ScreenshotPass123!"

AUTH_RESPONSE=$(curl -sf "$BACKEND_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"$TEMP_USER\", \"password\": \"$TEMP_PASS\"}" 2>/dev/null || true)

if [ -z "$AUTH_RESPONSE" ]; then
    # User may already exist, try login
    AUTH_RESPONSE=$(curl -sf "$BACKEND_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\": \"$TEMP_USER\", \"password\": \"$TEMP_PASS\"}" 2>/dev/null || true)
fi

if [ -z "$AUTH_RESPONSE" ]; then
    echo -e "${YELLOW}Warning: Could not authenticate. Screenshots will show login page.${NC}"
    TOKEN=""
else
    TOKEN=$(echo "$AUTH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null || true)
    if [ -n "$TOKEN" ]; then
        echo -e "${GREEN}✓ Authenticated as $TEMP_USER${NC}"
    else
        echo -e "${YELLOW}Warning: Auth response missing token. Screenshots will show login page.${NC}"
    fi
fi

# Capture login page screenshot
echo -e "${BLUE}Capturing login page...${NC}"
HEADLESS_FLAG=""
if [ "$HEADLESS" = "true" ]; then
    HEADLESS_FLAG="--headless"
fi

playwright-cli screenshot "$FRONTEND_URL/login" \
    "$OUTPUT_DIR/screenshot-login.png" \
    --viewport-size "1280,720" \
    $HEADLESS_FLAG \
    --wait-for-timeout 3000
echo -e "${GREEN}✓ Login page captured${NC}"

# Capture dashboard with auth
echo -e "${BLUE}Capturing dashboard...${NC}"
if [ -n "$TOKEN" ]; then
    # Inject auth tokens via localStorage before navigating
    playwright-cli localstorage-set "$FRONTEND_URL" \
        --key "token" --value "$TOKEN" \
        $HEADLESS_FLAG 2>/dev/null || true

    playwright-cli screenshot "$FRONTEND_URL" \
        "$OUTPUT_DIR/screenshot-dashboard.png" \
        --viewport-size "1280,720" \
        $HEADLESS_FLAG \
        --wait-for-timeout 5000
else
    playwright-cli screenshot "$FRONTEND_URL" \
        "$OUTPUT_DIR/screenshot-dashboard.png" \
        --viewport-size "1280,720" \
        $HEADLESS_FLAG \
        --wait-for-timeout 3000
fi
echo -e "${GREEN}✓ Dashboard captured${NC}"

echo ""
echo -e "${GREEN}Screenshots saved to $OUTPUT_DIR/${NC}"
ls -la "$OUTPUT_DIR"/screenshot-*.png 2>/dev/null || true
