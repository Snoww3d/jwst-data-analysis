#!/bin/bash
# Quick one-liner idea capture
# Usage: ./scripts/quick-idea.sh "Your idea here"
# Or: echo "Your idea" | ./scripts/quick-idea.sh

IDEAS_FILE="docs/feature-ideas.md"
date_stamp=$(date +%Y-%m-%d)

# Get idea from argument or stdin
if [ -n "$1" ]; then
    idea="$*"
else
    read -r idea
fi

# Append to file
cat >> "$IDEAS_FILE" << EOF

---

### Quick Idea
**Date**: $date_stamp
**Category**: Other Ideas
**Priority**: TBD

**Description**:
$idea

EOF

echo "✓ Idea captured: $idea"
echo "  Review in: $IDEAS_FILE"
