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
      --json number,title,mergedAt,labels,url,body \
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

format_date() {
  local date="$1"
  if date -j -f "%Y-%m-%d" "$date" "+%B %-d, %Y" 2>/dev/null; then return; fi
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

# --- Tag Extraction ---

get_tags() {
  local date="$1"
  local pr_count="$2"

  if [[ "$pr_count" -gt 0 ]]; then
    jq -r --arg d "$date" '
      [.[] | select(.mergedAt | startswith($d))] | [.[].title | ascii_downcase] as $t |
      (if ($t | any(test("auth|jwt|token|login|credential"))) then ["auth"] else [] end) +
      (if ($t | any(test("security|authorization|access.control|idor|bfla|traversal"))) then ["security"] else [] end) +
      (if ($t | any(test("mosaic|composite|rgb|color.map|nchannel"))) then ["imaging"] else [] end) +
      (if ($t | any(test("viewer|histogram|curves|stretch|level|canvas"))) then ["viewer"] else [] end) +
      (if ($t | any(test("wizard|guided|discovery"))) then ["guided-wizard"] else [] end) +
      (if ($t | any(test("docker|deploy|container|infra"))) then ["infrastructure"] else [] end) +
      (if ($t | any(test("e2e|playwright"))) then ["e2e-tests"] else [] end) +
      (if ($t | any(test("mast|import"))) then ["mast-data"] else [] end) +
      (if ($t | any(test("export"))) then ["export"] else [] end) +
      (if ($t | any(test("signalr|websocket|queue|job"))) then ["job-queue"] else [] end) +
      (if ($t | any(test("deps|bump|dependabot"))) then ["dependencies"] else [] end) +
      (if ($t | any(test("lint|format|eslint|prettier|ruff"))) then ["code-quality"] else [] end) +
      (if ($t | any(test("ci|workflow|github.action"))) then ["ci"] else [] end) +
      (if ($t | any(test("sidebar|panel|collaps|margin|layout|css|background"))) then ["ui"] else [] end) +
      (if ($t | any(test("^test"))) then ["testing"] else [] end) +
      (if ($t | any(test("^docs|readme|standard|contributing"))) then ["docs"] else [] end) |
      unique | .[]
    ' "$CACHE_DIR/prs.json" 2>/dev/null || true
  else
    # Pre-PR: extract tags from commit messages
    local commit_msgs
    commit_msgs=$(grep "|${date}|" "$CACHE_DIR/git-log.txt" | cut -d'|' -f3 | tr '[:upper:]' '[:lower:]' || true)
    [[ -z "$commit_msgs" ]] && return
    local tags=""
    echo "$commit_msgs" | grep -qi "fits\|viewer\|image" && tags+="viewer"$'\n' || true
    echo "$commit_msgs" | grep -qi "mongo\|database\|model" && tags+="database"$'\n' || true
    echo "$commit_msgs" | grep -qi "docker\|container" && tags+="infrastructure"$'\n' || true
    echo "$commit_msgs" | grep -qi "api\|endpoint\|controller" && tags+="api"$'\n' || true
    echo "$commit_msgs" | grep -qi "auth\|login\|jwt" && tags+="auth"$'\n' || true
    echo "$commit_msgs" | grep -qi "frontend\|react\|component" && tags+="frontend"$'\n' || true
    echo "$commit_msgs" | grep -qi "test" && tags+="testing"$'\n' || true
    echo "$commit_msgs" | grep -qi "mast\|import" && tags+="mast-data"$'\n' || true
    if [[ -n "$tags" ]]; then
      echo "$tags" | sort -u | grep -v '^$'
    fi
  fi
}

# --- Headline Generation ---

get_headline() {
  local date="$1"
  local pr_count="$2"
  local commit_count="$3"

  if [[ "$pr_count" -gt 0 ]]; then
    jq -r --arg d "$date" '
      [.[] | select(.mergedAt | startswith($d))] |
      (map(select(.title | test("^feat"))) | length) as $feat |
      (map(select(.title | test("^fix"))) | length) as $fix |
      (map(select(.title | test("^docs"))) | length) as $docs |
      (map(select(.title | test("^refactor"))) | length) as $refactor |
      (map(select(.title | test("^test"))) | length) as $tst |
      (map(select(.title | (test("deps") or test("^Bump")))) | length) as $deps |
      (map(select(.title | (test("^chore") and (test("deps") | not)))) | length) as $chore |
      (
        (if $feat > 0 then ["\($feat) feature" + (if $feat > 1 then "s" else "" end)] else [] end) +
        (if $fix > 0 then ["\($fix) fix" + (if $fix > 1 then "es" else "" end)] else [] end) +
        (if $docs > 0 then ["\($docs) docs"] else [] end) +
        (if $refactor > 0 then ["\($refactor) refactor" + (if $refactor > 1 then "s" else "" end)] else [] end) +
        (if $tst > 0 then ["\($tst) test" + (if $tst > 1 then "s" else "" end)] else [] end) +
        (if $chore > 0 then ["\($chore) maintenance"] else [] end) +
        (if $deps > 0 then ["\($deps) dep update" + (if $deps > 1 then "s" else "" end)] else [] end)
      ) | join(", ")
    ' "$CACHE_DIR/prs.json" 2>/dev/null || true
  elif [[ "$commit_count" -gt 0 ]]; then
    # Pre-PR: summarize from commit messages
    grep "|${date}|" "$CACHE_DIR/git-log.txt" | cut -d'|' -f3 | sed 's/^[[:space:]]*//' | head -3 | tr '\n' '|' | sed 's/|$//' | sed 's/|/; /g'
  fi
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

  # --- Compute metrics ---

  local commit_count
  commit_count=$(grep -c "|${date}|" "$CACHE_DIR/git-log.txt" || true)

  local pr_count
  pr_count=$(jq --arg d "$date" '[.[] | select(.mergedAt | startswith($d))] | length' "$CACHE_DIR/prs.json" 2>/dev/null || echo 0)

  # --- Generate headline and tags ---

  local headline
  headline=$(get_headline "$date" "$pr_count" "$commit_count")

  local tags_list
  tags_list=$(get_tags "$date" "$pr_count")

  local tag_inline=""
  if [[ -n "$tags_list" ]]; then
    tag_inline=$(echo "$tags_list" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
  fi

  # --- Gather content ---

  # PRs (rich format with body excerpts)
  local pr_content
  pr_content=$(jq -r --arg d "$date" '
    def extract_section(header):
      (.body // "") | gsub("\r"; "") |
      if test(header) then
        split(header)[1] | split("\n## ")[0] | gsub("^\n+|\n+$"; "")
      else "" end;

    def first_para:
      if . == "" then ""
      elif test("\n\n") then split("\n\n")[0] | gsub("^\n+|\n+$"; "")
      else gsub("^\n+|\n+$"; "") end;

    def trunc(n):
      if length > n then .[0:n] + "..." else . end;

    [.[] | select(.mergedAt | startswith($d))] | sort_by(.number) |
    [.[] |
      (extract_section("## Summary\n") | first_para | trunc(400)) as $summary |
      (extract_section("## Why\n") | first_para | trunc(300) | gsub("\n+"; " ") | gsub("^ +| +$"; "")) as $why |
      "- **[#\(.number)](\(.url))** \(.title)"
      + (if $summary != "" then "\n\n    " + ($summary | gsub("\n"; "\n    ")) else "" end)
      + (if $why != "" then "\n\n    *" + $why + "*" else "" end)
    ] | join("\n\n")
  ' "$CACHE_DIR/prs.json" 2>/dev/null || true)

  # Issues opened (with titles)
  local issues_opened
  issues_opened=$(jq -r --arg d "$date" '
    [.[] | select(.createdAt | startswith($d))]
    | sort_by(.number)
    | if length > 0 then
        [.[] | "- [#\(.number)](\(.url)) — \(.title)"] | join("\n")
      else "" end
  ' "$CACHE_DIR/issues.json" 2>/dev/null || true)

  # Issues closed (with titles)
  local issues_closed
  issues_closed=$(jq -r --arg d "$date" '
    [.[] | select(.closedAt != null and (.closedAt | startswith($d)))]
    | sort_by(.number)
    | if length > 0 then
        [.[] | "- [#\(.number)](\(.url)) — \(.title)"] | join("\n")
      else "" end
  ' "$CACHE_DIR/issues.json" 2>/dev/null || true)

  # Commit messages (for pre-PR days)
  local commit_messages=""
  if [[ "$pr_count" -eq 0 && "$commit_count" -gt 0 ]]; then
    commit_messages=$(grep "|${date}|" "$CACHE_DIR/git-log.txt" | cut -d'|' -f3 | sed 's/^[[:space:]]*//' | while IFS= read -r msg; do
      echo "- ${msg}"
    done)
  fi

  # --- Build frontmatter ---

  local categories_yaml=""
  while IFS= read -r cat; do
    [[ -z "$cat" ]] && continue
    categories_yaml+="  - ${cat}"$'\n'
  done < <(get_categories "$date")

  local tags_yaml=""
  if [[ -n "$tags_list" ]]; then
    while IFS= read -r tag; do
      [[ -z "$tag" ]] && continue
      tags_yaml+="  - ${tag}"$'\n'
    done <<< "$tags_list"
  fi

  # Build headline line
  local headline_line=""
  if [[ -n "$headline" && -n "$tag_inline" ]]; then
    headline_line="**${headline}** — ${tag_inline}"
  elif [[ -n "$headline" ]]; then
    headline_line="**${headline}**"
  fi

  # --- Write post ---

  {
    echo "---"
    echo "date:"
    echo "  created: ${date}"
    echo "categories:"
    printf '%s' "$categories_yaml"
    if [[ -n "$tags_yaml" ]]; then
      echo "tags:"
      printf '%s' "$tags_yaml"
    fi
    echo "authors:"
    echo "  - shanon"
    echo "---"
    echo ""
    echo "# Session: ${display_date}"
    echo ""
    echo "<!-- generated -->"
    echo ""
    if [[ -n "$headline_line" ]]; then
      echo "${headline_line}"
      echo ""
    fi
    echo "<!-- more -->"
    echo ""
  } > "$post_file"

  # PRs section
  if [[ -n "$pr_content" ]]; then
    echo "## Pull Requests Merged" >> "$post_file"
    echo "" >> "$post_file"
    echo "$pr_content" >> "$post_file"
    echo "" >> "$post_file"
  fi

  # Commit messages (pre-PR days)
  if [[ -n "$commit_messages" ]]; then
    echo "## Commits" >> "$post_file"
    echo "" >> "$post_file"
    echo "$commit_messages" >> "$post_file"
    echo "" >> "$post_file"
  fi

  # Issues section
  if [[ -n "$issues_opened" || -n "$issues_closed" ]]; then
    echo "## Issues" >> "$post_file"
    echo "" >> "$post_file"
    if [[ -n "$issues_opened" ]]; then
      echo "**Opened:**" >> "$post_file"
      echo "" >> "$post_file"
      echo "$issues_opened" >> "$post_file"
      echo "" >> "$post_file"
    fi
    if [[ -n "$issues_closed" ]]; then
      echo "**Closed:**" >> "$post_file"
      echo "" >> "$post_file"
      echo "$issues_closed" >> "$post_file"
      echo "" >> "$post_file"
    fi
  fi

  # Stats footer
  echo "---" >> "$post_file"
  echo "*${commit_count} commits across this session.*" >> "$post_file"

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
