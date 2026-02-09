#!/usr/bin/env bash
# Public repository preflight audit.
# Usage: ./scripts/public-preflight.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

failures=0
warnings=0

pass() {
    echo -e "${GREEN}PASS${NC}: $1"
}

warn() {
    echo -e "${YELLOW}WARN${NC}: $1"
    warnings=$((warnings + 1))
}

fail() {
    echo -e "${RED}FAIL${NC}: $1"
    failures=$((failures + 1))
}

show_matches() {
    local matches="$1"
    if [[ -n "$matches" ]]; then
        echo "$matches" | sed 's/^/  - /'
    fi
}

require_command() {
    local command_name="$1"
    local install_hint="$2"
    if command -v "$command_name" >/dev/null 2>&1; then
        pass "Required command available: ${command_name}"
    else
        fail "Missing required command: ${command_name} (${install_hint})"
    fi
}

echo -e "${BLUE}Running public preflight audit from ${ROOT_DIR}${NC}"
echo

require_command "git" "install Git"
require_command "rg" "install ripgrep"

if [[ "$failures" -gt 0 ]]; then
    echo
    echo -e "${RED}Public preflight cannot continue until required command(s) are installed.${NC}"
    exit 1
fi

# 1) Baseline docs expected in public repos.
for required_file in README.md LICENSE SECURITY.md; do
    if [[ -f "$required_file" ]]; then
        pass "Required file present: ${required_file}"
    else
        fail "Missing required public file: ${required_file}"
    fi
done

# 2) Agentic/internal control files should not be tracked in public repo.
blocked_current_paths="$(git ls-files | rg '^(AGENTS\.md|CLAUDE\.md|\.claude$|\.agent/)' || true)"
if [[ -n "$blocked_current_paths" ]]; then
    fail "Tracked files include internal/agentic paths that should not be public"
    show_matches "$blocked_current_paths"
else
    pass "No tracked internal/agentic root files"
fi

# 3) Agentic files in history still leak if repo visibility is flipped directly.
blocked_history_paths="$(git log --all --name-only --pretty=format: | sort -u | rg '^(AGENTS\.md|CLAUDE\.md|\.claude$|\.agent/)' || true)"
if [[ -n "$blocked_history_paths" ]]; then
    fail "Git history contains internal/agentic paths (requires history rewrite or mirror strategy)"
    show_matches "$blocked_history_paths"
else
    pass "No internal/agentic paths found in git history"
fi

# 4) Absolute local machine paths leak environment details.
absolute_path_hits="$(rg -n --hidden \
    --glob '!.git' \
    --glob '!**/node_modules/**' \
    --glob '!**/dist/**' \
    --glob '!**/build/**' \
    '(/Users/[A-Za-z0-9._-]{2,}|/home/[A-Za-z0-9._-]{2,}|[A-Za-z]:\\\\Users\\\\[A-Za-z0-9._-]{2,})' . || true)"
if [[ -n "$absolute_path_hits" ]]; then
    fail "Absolute user-specific filesystem paths detected in tracked content"
    show_matches "$absolute_path_hits"
else
    pass "No user-specific absolute filesystem paths detected"
fi

# 5) Symlinks with absolute targets break portability and leak local paths.
absolute_symlink_hits=""
symlink_paths="$(git ls-files -s | awk '$1=="120000" {print $4}')"
if [[ -n "$symlink_paths" ]]; then
    while IFS= read -r symlink_path; do
        [[ -z "$symlink_path" ]] && continue
        link_target="$(git cat-file -p "HEAD:${symlink_path}" 2>/dev/null || true)"
        if [[ "$link_target" =~ ^/ || "$link_target" =~ ^[A-Za-z]:\\ ]]; then
            absolute_symlink_hits+="${symlink_path} -> ${link_target}"$'\n'
        fi
    done <<< "$symlink_paths"
fi

if [[ -n "$absolute_symlink_hits" ]]; then
    fail "Tracked symlink(s) point to absolute paths"
    show_matches "${absolute_symlink_hits%$'\n'}"
else
    pass "No tracked symlinks with absolute targets"
fi

# 6) Real env files should not be tracked.
tracked_env_files="$(git ls-files | rg '(^|/)\.env($|\.)' | rg -v '(^|/)\.env\.example$|(^|/)\.env\.template$|(^|/)\.env\.sample$' || true)"
if [[ -n "$tracked_env_files" ]]; then
    fail "Tracked env files detected (only .env.example/.template/.sample should be committed)"
    show_matches "$tracked_env_files"
else
    pass "No tracked runtime env files"
fi

# 7) Secret scanning (working tree + full history).
if ! command -v gitleaks >/dev/null 2>&1; then
    fail "gitleaks is required for preflight but is not installed"
else
    working_report="/tmp/public-preflight-gitleaks-working.json"
    history_report="/tmp/public-preflight-gitleaks-history.json"

    if gitleaks detect --source . --no-banner --redact --report-format json --report-path "$working_report" >/tmp/public-preflight-gitleaks-working.log 2>&1; then
        pass "gitleaks working-tree scan passed"
    else
        fail "gitleaks working-tree scan found potential leaks (see ${working_report})"
        sed 's/^/  /' /tmp/public-preflight-gitleaks-working.log
    fi

    if gitleaks git --no-banner --redact --report-format json --report-path "$history_report" >/tmp/public-preflight-gitleaks-history.log 2>&1; then
        pass "gitleaks git-history scan passed"
    else
        fail "gitleaks git-history scan found potential leaks (see ${history_report})"
        sed 's/^/  /' /tmp/public-preflight-gitleaks-history.log
    fi
fi

# 8) Public docs should not depend on internal-only files if those are excluded.
internal_doc_refs="$(rg -n --glob '*.md' 'AGENTS\.md|CLAUDE\.md|\.agent/workflows|\.claude' README.md CONTRIBUTING.md docs scripts .github || true)"
if [[ -n "$internal_doc_refs" ]]; then
    warn "Markdown docs reference internal/agentic files; public mirror may need docs pruning"
    show_matches "$internal_doc_refs"
else
    pass "No markdown references to internal/agentic docs"
fi

# 9) Non-noreply author emails are public metadata once repo is public.
non_noreply_emails="$(git log --all --format='%ae' | sort -u | rg -v '(noreply|example\.com|example\.org|example\.net)' || true)"
if [[ -n "$non_noreply_emails" ]]; then
    warn "Non-noreply commit author email(s) detected in history"
    show_matches "$non_noreply_emails"
else
    pass "Author emails are noreply/example-only"
fi

echo
if [[ "$failures" -gt 0 ]]; then
    echo -e "${RED}Public preflight failed with ${failures} blocking issue(s) and ${warnings} warning(s).${NC}"
    exit 1
fi

echo -e "${GREEN}Public preflight passed with ${warnings} warning(s).${NC}"
