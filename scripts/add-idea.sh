#!/bin/bash
# Add a feature idea to docs/feature-ideas.md
# Usage: ./scripts/add-idea.sh

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

IDEAS_FILE="docs/feature-ideas.md"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   JWST Feature Idea Capture Tool      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Get idea name
echo -e "${YELLOW}Idea Name:${NC}"
read -r idea_name

# Category selection
echo ""
echo -e "${YELLOW}Category:${NC}"
echo "1) UI/UX Improvements"
echo "2) Scientific Features"
echo "3) Performance Enhancements"
echo "4) Technical Improvements"
echo "5) Mobile/Responsive Features"
echo "6) Security & Authentication"
echo "7) Data Management"
echo "8) Documentation & Tutorials"
echo "9) Other Ideas"
read -r category_num

case $category_num in
    1) category="UI/UX Improvements" ;;
    2) category="Scientific Features" ;;
    3) category="Performance Enhancements" ;;
    4) category="Technical Improvements" ;;
    5) category="Mobile/Responsive Features" ;;
    6) category="Security & Authentication" ;;
    7) category="Data Management" ;;
    8) category="Documentation & Tutorials" ;;
    9) category="Other Ideas" ;;
    *) category="Other Ideas" ;;
esac

# Priority
echo ""
echo -e "${YELLOW}Priority (Low/Medium/High):${NC}"
read -r priority
priority=${priority:-Medium}

# Description
echo ""
echo -e "${YELLOW}Description (press Ctrl+D when done):${NC}"
description=$(cat)

# Use case
echo ""
echo -e "${YELLOW}Use Case (optional, press Ctrl+D when done or Enter to skip):${NC}"
use_case=$(cat)

# Technical notes
echo ""
echo -e "${YELLOW}Technical Notes (optional, press Ctrl+D when done or Enter to skip):${NC}"
tech_notes=$(cat)

# Generate timestamp
date_stamp=$(date +%Y-%m-%d)
timestamp=$(date +"%Y-%m-%d %H:%M:%S")

# Append to file
cat >> "$IDEAS_FILE" << EOF

---

### $idea_name
**Date**: $date_stamp
**Category**: $category
**Priority**: $priority

**Description**:
$description

EOF

if [ -n "$use_case" ]; then
cat >> "$IDEAS_FILE" << EOF
**Use Case**:
$use_case

EOF
fi

if [ -n "$tech_notes" ]; then
cat >> "$IDEAS_FILE" << EOF
**Technical Notes**:
$tech_notes

EOF
fi

echo ""
echo -e "${GREEN}✓ Idea added successfully!${NC}"
echo -e "${GREEN}  File: $IDEAS_FILE${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Review the idea in $IDEAS_FILE"
echo "  2. Commit: git add $IDEAS_FILE && git commit -m \"feat: Add idea - $idea_name\""
echo "  3. Push: git push"
echo ""
