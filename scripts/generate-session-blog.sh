#!/usr/bin/env bash
set -euo pipefail

# JWST Session Blog Generator
# Generates MkDocs blog posts from GitHub PR, issue, and git commit data.
#
# Usage:
#   ./scripts/generate-session-blog.sh                           # All active days
#   ./scripts/generate-session-blog.sh --from 2026-01-01 --to 2026-01-31  # Date range
#   ./scripts/generate-session-blog.sh --date 2026-03-02         # Single day
#   ./scripts/generate-session-blog.sh --refresh                 # Force re-fetch cached data

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BLOG_DIR="$PROJECT_ROOT/docs/blog"
POSTS_DIR="$BLOG_DIR/posts"
CACHE_DIR="$BLOG_DIR/.cache"

FROM_DATE=""
TO_DATE=""
REFRESH=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --from) FROM_DATE="$2"; shift 2 ;;
    --to) TO_DATE="$2"; shift 2 ;;
    --date) FROM_DATE="$2"; TO_DATE="$2"; shift 2 ;;
    --refresh) REFRESH=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--date YYYY-MM-DD] [--refresh]"
      echo ""
      echo "Options:"
      echo "  --from DATE   Start of date range (inclusive)"
      echo "  --to DATE     End of date range (inclusive)"
      echo "  --date DATE   Single date (shorthand for --from DATE --to DATE)"
      echo "  --refresh     Force re-fetch of cached GitHub data"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$POSTS_DIR" "$CACHE_DIR"

# --- Data Fetching ---

fetch_data() {
  if [[ "$REFRESH" == true ]] || [[ ! -f "$CACHE_DIR/prs.json" ]]; then
    echo "Fetching merged PRs from GitHub..."
    gh pr list --state merged --limit 1000 \
      --json number,title,mergedAt,labels,url \
      > "$CACHE_DIR/prs.json"
    echo "  Cached $(jq 'length' "$CACHE_DIR/prs.json") PRs"
  else
    echo "Using cached PR data ($(jq 'length' "$CACHE_DIR/prs.json") PRs)"
  fi

  if [[ "$REFRESH" == true ]] || [[ ! -f "$CACHE_DIR/issues.json" ]]; then
    echo "Fetching issues from GitHub..."
    gh issue list --state all --limit 1000 \
      --json number,title,createdAt,closedAt,labels,state,url \
      > "$CACHE_DIR/issues.json"
    echo "  Cached $(jq 'length' "$CACHE_DIR/issues.json") issues"
  else
    echo "Using cached issue data ($(jq 'length' "$CACHE_DIR/issues.json") issues)"
  fi

  echo "Collecting git log..."
  git -C "$PROJECT_ROOT" log --format='%H|%ad|%s' --date=short > "$CACHE_DIR/git-log.txt"
  echo "  $(wc -l < "$CACHE_DIR/git-log.txt" | tr -d ' ') commits"
}

# --- Date Handling ---

get_active_dates() {
  local pr_dates issue_dates commit_dates

  pr_dates=$(jq -r '.[].mergedAt | split("T")[0]' "$CACHE_DIR/prs.json" 2>/dev/null || true)
  issue_dates=$(jq -r '.[].createdAt | split("T")[0]' "$CACHE_DIR/issues.json" 2>/dev/null || true)
  commit_dates=$(cut -d'|' -f2 "$CACHE_DIR/git-log.txt")

  printf '%s\n%s\n%s\n' "$pr_dates" "$commit_dates" "$issue_dates" | sort -u | grep -v '^$'
}

filter_dates() {
  local dates="$1"
  if [[ -n "$FROM_DATE" && -n "$TO_DATE" ]]; then
    echo "$dates" | awk -v from="$FROM_DATE" -v to="$TO_DATE" '$1 >= from && $1 <= to'
  else
    echo "$dates"
  fi
}

# macOS-compatible date formatting
format_date() {
  local date="$1"
  if date -j -f "%Y-%m-%d" "$date" "+%B %-d, %Y" 2>/dev/null; then
    return
  fi
  # Linux fallback
  date -d "$date" "+%B %-d, %Y" 2>/dev/null || echo "$date"
}

# --- Category Detection ---

pr_prefix_to_category() {
  case "$1" in
    feat)     echo "Feature" ;;
    fix)      echo "Bug Fix" ;;
    docs)     echo "Documentation" ;;
    refactor) echo "Refactoring" ;;
    test)     echo "Testing" ;;
    chore)    echo "Maintenance" ;;
    perf)     echo "Performance" ;;
    *)        echo "Development" ;;
  esac
}

get_categories() {
  local date="$1"

  local prefixes
  prefixes=$(jq -r --arg d "$date" '
    [.[] | select(.mergedAt | startswith($d))]
    | [.[].title | split(":")[0] | gsub("^ +| +$";"")]
    | unique | .[]
  ' "$CACHE_DIR/prs.json" 2>/dev/null || true)

  if [[ -z "$prefixes" ]]; then
    echo "Development"
    return
  fi

  local seen=()
  while IFS= read -r prefix; do
    [[ -z "$prefix" ]] && continue
    local cat
    cat=$(pr_prefix_to_category "$prefix")
    # Deduplicate
    local found=false
    for s in "${seen[@]+"${seen[@]}"}"; do
      [[ "$s" == "$cat" ]] && found=true && break
    done
    if [[ "$found" == false ]]; then
      seen+=("$cat")
      echo "$cat"
    fi
  done <<< "$prefixes"
}

# --- Post Generation ---

generate_post() {
  local date="$1"
  local post_file="$POSTS_DIR/$date.md"

  # Skip enriched posts
  if [[ -f "$post_file" ]] && grep -q '<!-- enriched -->' "$post_file"; then
    echo "  Skipping $date (enriched — manually edited)"
    return
  fi

  local display_date
  display_date=$(format_date "$date")

  # --- Gather data for this date ---

  # PRs merged on this date
  local pr_rows
  pr_rows=$(jq -r --arg d "$date" '
    [.[] | select(.mergedAt | startswith($d))]
    | sort_by(.number)
    | .[]
    | "| [#\(.number)](\(.url)) | \(.title | gsub("\\|"; "—")) | \(.title | split(":")[0] | gsub("^ +| +$";"")) |"
  ' "$CACHE_DIR/prs.json" 2>/dev/null || true)

  # Issues opened on this date
  local issues_opened
  issues_opened=$(jq -r --arg d "$date" '
    [.[] | select(.createdAt | startswith($d))]
    | sort_by(.number)
    | if length > 0 then [.[] | "[#\(.number)](\(.url))"] | join(", ") else "None" end
  ' "$CACHE_DIR/issues.json" 2>/dev/null || echo "None")

  # Issues closed on this date
  local issues_closed
  issues_closed=$(jq -r --arg d "$date" '
    [.[] | select(.closedAt != null and (.closedAt | startswith($d)))]
    | sort_by(.number)
    | if length > 0 then [.[] | "[#\(.number)](\(.url))"] | join(", ") else "None" end
  ' "$CACHE_DIR/issues.json" 2>/dev/null || echo "None")

  # Commit count
  local commit_count
  commit_count=$(grep -c "|${date}|" "$CACHE_DIR/git-log.txt" || true)

  # Categories
  local categories_yaml=""
  while IFS= read -r cat; do
    [[ -z "$cat" ]] && continue
    categories_yaml+="  - ${cat}"$'\n'
  done < <(get_categories "$date")

  # --- Write post ---

  cat > "$post_file" << POSTEOF
---
date:
  created: ${date}
categories:
${categories_yaml}authors:
  - shanon
---

# Session: ${display_date}

<!-- generated -->

POSTEOF

  # PRs section
  if [[ -n "$pr_rows" ]]; then
    cat >> "$post_file" << 'TABLE_HEADER'
## Pull Requests Merged

| PR | Title | Type |
|----|-------|------|
TABLE_HEADER
    echo "$pr_rows" >> "$post_file"
    echo "" >> "$post_file"
  fi

  # Issues section
  if [[ "$issues_opened" != "None" || "$issues_closed" != "None" ]]; then
    echo "## Issues" >> "$post_file"
    echo "" >> "$post_file"
    echo "- **Opened**: ${issues_opened}" >> "$post_file"
    echo "- **Closed**: ${issues_closed}" >> "$post_file"
    echo "" >> "$post_file"
  fi

  # Commits section
  echo "## Commits: ${commit_count}" >> "$post_file"
  echo "" >> "$post_file"
  echo "---" >> "$post_file"
  echo "*Generated from GitHub data.*" >> "$post_file"

  local pr_count=0
  [[ -n "$pr_rows" ]] && pr_count=$(echo "$pr_rows" | wc -l | tr -d ' ')
  echo "  Generated: $date ($commit_count commits, $pr_count PRs)"
}

# --- Milestone Detection ---

generate_milestones() {
  local milestones_file="$BLOG_DIR/MILESTONES.md"

  cat > "$milestones_file" << 'HEADER'
# Milestone Dates

Dates flagged for narrative enrichment. Edit the post and replace
`<!-- generated -->` with `<!-- enriched -->` when done.

HEADER

  # First commit (tail avoids SIGPIPE from head+pipefail)
  local first_commit
  first_commit=$(git -C "$PROJECT_ROOT" log --format='%ad' --date=short | tail -1)
  echo "- **${first_commit}** — First commit (project inception)" >> "$milestones_file"

  # First merged PR
  local first_pr_date
  first_pr_date=$(jq -r '
    [.[] | .mergedAt] | sort | first | split("T")[0]
  ' "$CACHE_DIR/prs.json" 2>/dev/null || true)
  if [[ -n "$first_pr_date" && "$first_pr_date" != "null" ]]; then
    echo "- **${first_pr_date}** — First merged PR (project restart)" >> "$milestones_file"
  fi

  # High-volume days (10+ PRs)
  jq -r '
    [.[] | .mergedAt | split("T")[0]]
    | group_by(.) | .[]
    | select(length >= 10)
    | "- **\(.[0])** — High-volume day (\(length) PRs merged)"
  ' "$CACHE_DIR/prs.json" >> "$milestones_file" 2>/dev/null || true

  # Architecture-defining days
  jq -r '
    [.[] | {date: (.mergedAt | split("T")[0]), title: .title}]
    | group_by(.date) | .[]
    | {date: .[0].date, titles: [.[].title | ascii_downcase]}
    | select(
        (.titles | any(test("auth|authentication|authorization"))) or
        (.titles | any(test("job.queue|signalr|websocket"))) or
        (.titles | any(test("mosaic|guided|wizard"))) or
        (.titles | any(test("architect|infrastructure|docker")))
      )
    | "- **\(.date)** — Architecture day (\(.titles | length) PRs: \(.titles | join("; ") | .[0:80]))"
  ' "$CACHE_DIR/prs.json" >> "$milestones_file" 2>/dev/null || true

  echo "" >> "$milestones_file"
  echo "Generated: $(date '+%Y-%m-%d %H:%M')" >> "$milestones_file"
  echo "Generated milestones list: $milestones_file"
}

# --- Main ---

echo "=== JWST Session Blog Generator ==="
echo ""

fetch_data

all_dates=$(get_active_dates)
filtered_dates=$(filter_dates "$all_dates")
date_count=$(echo "$filtered_dates" | grep -c . || echo "0")

echo ""
echo "Active dates in range: $date_count"
echo ""

while IFS= read -r date; do
  [[ -z "$date" ]] && continue
  generate_post "$date"
done <<< "$filtered_dates"

echo ""
generate_milestones

echo ""
echo "Done! Generated $date_count posts."
echo "View at: http://localhost:8001/blog/"
