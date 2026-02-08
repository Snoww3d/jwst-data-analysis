#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

errors=0

pass() {
    echo "PASS: $1"
}

fail() {
    echo "FAIL: $1"
    errors=$((errors + 1))
}

check_no_match() {
    local pattern="$1"
    local description="$2"
    shift 2
    local output
    output="$(grep -Hn -E "$pattern" "$@" || true)"
    if [[ -n "$output" ]]; then
        fail "$description"
        echo "$output"
    else
        pass "$description"
    fi
}

DOC_FILES=(
    "AGENTS.md"
    "README.md"
    "docs/*.md"
    "docs/standards/*.md"
    "scripts/README.md"
)

# shellcheck disable=SC2068
check_no_match '/Users/[A-Za-z0-9._-]+' \
    "No machine-specific absolute user paths in shared docs" \
    ${DOC_FILES[@]}

# shellcheck disable=SC2068
check_no_match '(/create-feature|/fix-bug|/resolve-tech-debt|TaskCreate|TaskUpdate|`/tasks`|\.agent/workflows/|~/.claude)' \
    "No assistant-specific workflow commands in shared docs" \
    ${DOC_FILES[@]}

react_major="$(awk -F'"' '/"react":/ { split($4, v, "."); gsub(/^\^/, "", v[1]); print v[1]; exit }' frontend/jwst-frontend/package.json)"
if [[ -z "$react_major" ]]; then
    fail "Unable to parse React version from frontend/jwst-frontend/package.json"
elif grep -q "React ${react_major}, TypeScript" README.md; then
    pass "README React version matches frontend package major version"
else
    fail "README React version does not match frontend package major version"
fi

setup_python_req="$(grep -Eo 'Python [0-9]+\.[0-9]+\+' docs/setup-guide.md | head -n1 | awk '{print $2}')"
if [[ -z "$setup_python_req" ]]; then
    fail "Unable to parse Python requirement from docs/setup-guide.md"
elif grep -q "requires ${setup_python_req}" docs/quick-reference.md; then
    pass "Quick Reference Python requirement matches Setup Guide"
else
    fail "Quick Reference Python requirement does not match Setup Guide"
fi

summary_remaining="$(awk -F'|' '/\*\*Remaining\*\*/ {gsub(/ /, "", $3); print $3; exit}' docs/tech-debt.md)"
heading_remaining="$(grep -E '^## Remaining Tasks \([0-9]+\)' docs/tech-debt.md | sed -E 's/^## Remaining Tasks \(([0-9]+)\).*/\1/' | head -n1)"
actual_remaining="$(awk '
BEGIN { section = "" ; count = 0 }
/^## Remaining Tasks/ { section = "remaining"; next }
/^## Resolved Tasks/ { section = "resolved"; next }
/^### [0-9]+\./ { if (section == "remaining") count++ }
END { print count }
' docs/tech-debt.md)"

if [[ -z "$summary_remaining" || -z "$heading_remaining" || -z "$actual_remaining" ]]; then
    fail "Unable to parse one or more tech debt remaining counts"
elif [[ "$summary_remaining" == "$heading_remaining" && "$heading_remaining" == "$actual_remaining" ]]; then
    pass "Tech debt remaining counts are consistent (summary/header/actual)"
else
    fail "Tech debt remaining counts mismatch (summary=${summary_remaining}, header=${heading_remaining}, actual=${actual_remaining})"
fi

phase3_line="$(grep -E '^### \*\*Phase 3:' docs/development-plan.md | head -n1 || true)"
phase4_line="$(grep -E '^### \*\*Phase 4:' docs/development-plan.md | head -n1 || true)"
project_phase3_line="$(grep -E 'Phase 3:' docs/standards/project-overview.md | head -n1 || true)"
project_phase4_line="$(grep -E 'Phase 4:' docs/standards/project-overview.md | head -n1 || true)"

phase3_status=""
phase4_status=""

if [[ "$phase3_line" == *"Complete"* ]]; then
    phase3_status="Complete"
elif [[ "$phase3_line" == *"In Progress"* ]]; then
    phase3_status="In Progress"
fi

if [[ "$phase4_line" == *"Complete"* ]]; then
    phase4_status="Complete"
elif [[ "$phase4_line" == *"In Progress"* ]]; then
    phase4_status="In Progress"
fi

if [[ -n "$phase3_status" && "$project_phase3_line" == *"$phase3_status"* ]]; then
    pass "Phase 3 status in project overview matches development plan"
else
    fail "Phase 3 status mismatch between development plan and project overview"
fi

if [[ -n "$phase4_status" && "$project_phase4_line" == *"$phase4_status"* ]]; then
    pass "Phase 4 status in project overview matches development plan"
else
    fail "Phase 4 status mismatch between development plan and project overview"
fi

if grep -q 'Phase 7:' docs/standards/project-overview.md; then
    pass "Project overview includes Phase 7"
else
    fail "Project overview is missing Phase 7"
fi

if [[ "$errors" -gt 0 ]]; then
    echo
    echo "Documentation consistency checks failed with ${errors} issue(s)."
    exit 1
fi

echo
echo "All documentation consistency checks passed."
