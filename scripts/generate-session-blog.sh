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

# Store all filtered dates globally for next-session lookup
ALL_FILTERED_DATES=""

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
    | [.[].title | split(":")[0] | gsub("\\(.*";"") | gsub("^ +| +$";"")]
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
      (if ($t | any(test("^docs|readme|standard|contributing"))) then ["docs"] else [] end) +
      (if ($t | any(test("oom|crash|memory|perf"))) then ["performance"] else [] end) +
      (if ($t | any(test("ec2|staging|nginx|aws"))) then ["deployment"] else [] end) +
      (if ($t | any(test("mast|fits|wcs|simbad"))) then ["astronomy-data"] else [] end) |
      unique | .[]
    ' "$CACHE_DIR/prs.json" 2>/dev/null || true
  else
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

# --- Narrative Generation ---

generate_narrative() {
  local date="$1"
  local pr_count="$2"
  local commit_count="$3"

  # Special case: project inception
  if [[ "$date" == "2025-06-28" ]]; then
    echo "Project inception day. Initial repository setup, Docker configuration, and frontend submodule integration."
    return
  fi

  # First PR date
  local first_pr_date
  first_pr_date=$(jq -r '[.[] | .mergedAt] | sort | first | split("T")[0]' "$CACHE_DIR/prs.json" 2>/dev/null || true)
  if [[ "$date" == "$first_pr_date" ]]; then
    echo "The project restarts with a proper PR workflow. First pull requests merged, CI pipeline established."
    return
  fi

  # Pre-PR era (no PRs)
  if [[ "$pr_count" -eq 0 ]]; then
    echo "Early development — ${commit_count} commits before the PR workflow was established."
    return
  fi

  # Get PR type counts for the narrative
  local counts
  counts=$(jq -r --arg d "$date" '
    [.[] | select(.mergedAt | startswith($d))] |
    {
      feat: (map(select(.title | test("^feat"))) | length),
      fix: (map(select(.title | test("^fix"))) | length),
      docs: (map(select(.title | test("^docs"))) | length),
      refactor: (map(select(.title | test("^refactor"))) | length),
      test: (map(select(.title | test("^test"))) | length),
      deps: (map(select(.title | (test("deps") or test("^Bump")))) | length),
      chore: (map(select(.title | (test("^chore") and (test("deps") | not)))) | length)
    } | "\(.feat)|\(.fix)|\(.docs)|\(.refactor)|\(.test)|\(.deps)|\(.chore)"
  ' "$CACHE_DIR/prs.json" 2>/dev/null || true)

  local feat fix docs refactor tst deps chore
  IFS='|' read -r feat fix docs refactor tst deps chore <<< "$counts"

  # Build a breakdown suffix
  local parts=()
  [[ "$feat" -gt 0 ]] && parts+=("${feat} feature$([ "$feat" -gt 1 ] && echo 's')")
  [[ "$fix" -gt 0 ]] && parts+=("${fix} fix$([ "$fix" -gt 1 ] && echo 'es')")
  [[ "$docs" -gt 0 ]] && parts+=("${docs} docs")
  [[ "$refactor" -gt 0 ]] && parts+=("${refactor} refactor$([ "$refactor" -gt 1 ] && echo 's')")
  [[ "$tst" -gt 0 ]] && parts+=("${tst} test$([ "$tst" -gt 1 ] && echo 's')")
  [[ "$chore" -gt 0 ]] && parts+=("${chore} maintenance")
  [[ "$deps" -gt 0 ]] && parts+=("${deps} dependency update$([ "$deps" -gt 1 ] && echo 's')")

  local breakdown=""
  if [[ ${#parts[@]} -gt 0 ]]; then
    local first=true
    for p in "${parts[@]}"; do
      if [[ "$first" == true ]]; then
        breakdown="$p"
        first=false
      else
        breakdown="$breakdown, $p"
      fi
    done
  fi

  # Detect theme keywords from PR titles
  local theme_suffix=""
  local titles_lower
  titles_lower=$(jq -r --arg d "$date" '
    [.[] | select(.mergedAt | startswith($d))] | [.[].title | ascii_downcase] | join(" ")
  ' "$CACHE_DIR/prs.json" 2>/dev/null || true)

  if echo "$titles_lower" | grep -qi "security\|authorization\|auth.*check\|idor\|traversal"; then
    theme_suffix=" Security hardening across the stack."
  elif echo "$titles_lower" | grep -qi "composite\|mosaic\|color.*palette\|nchannel"; then
    theme_suffix=" Major work on the composite imaging pipeline."
  elif echo "$titles_lower" | grep -qi "deploy\|staging\|ec2\|nginx"; then
    theme_suffix=" Deployment and infrastructure focus."
  elif echo "$titles_lower" | grep -qi "guided\|wizard\|discovery"; then
    theme_suffix=" Guided wizard workflow improvements."
  elif echo "$titles_lower" | grep -qi "oom\|crash\|memory"; then
    theme_suffix=" Tackling stability and memory issues."
  elif echo "$titles_lower" | grep -qi "e2e\|playwright\|test.*fail"; then
    theme_suffix=" Test reliability improvements."
  fi

  # Build narrative by PR count
  local non_dep_count=$((pr_count - deps))
  if [[ "$pr_count" -eq 1 ]]; then
    echo "A focused session with a single pull request.${theme_suffix}"
  elif [[ "$pr_count" -eq 2 ]]; then
    echo "A focused session — ${breakdown}.${theme_suffix}"
  elif [[ "$pr_count" -le 9 ]]; then
    echo "Productive session with ${pr_count} pull requests: ${breakdown}.${theme_suffix}"
  else
    echo "A marathon session: ${pr_count} pull requests merged (${breakdown}).${theme_suffix}"
  fi
}

# --- Highlights Generation ---

generate_highlights() {
  local date="$1"
  local pr_count="$2"

  [[ "$pr_count" -eq 0 ]] && return

  # Score PRs and pick top 1-2 with score >= 5
  local highlights
  highlights=$(jq -r --arg d "$date" '
    def score_pr:
      (if (.title | test("^feat|^fix")) then 3 else 0 end) +
      (if ((.body // "") | length > 500) then 2 else 0 end) +
      (if (.title | ascii_downcase | test("crash|oom|race|security|deploy|wizard|composite|mosaic|staging")) then 2 else 0 end) +
      (if ((.body // "") | test("## Summary")) and ((.body // "") | test("## Why")) then 1 else 0 end) +
      (if (.title | ascii_downcase | (test("deps") or test("^bump"))) then -5 else 0 end);

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

    [.[] | select(.mergedAt | startswith($d))]
    | [.[] | . + {score: score_pr}]
    | sort_by(-.score)
    | [.[] | select(.score >= 5)]
    | .[0:2]
    | if length == 0 then ""
      else
        [.[] |
          (extract_section("## Summary\n") | first_para | trunc(300)) as $summary |
          (extract_section("## Why\n") | first_para | trunc(200) | gsub("\n+"; " ") | gsub("^ +| +$"; "")) as $why |
          (if (.title | test(": ")) then (.title | split(": ") | .[1:] | join(": ")) else .title end) as $short |
          "### [#\(.number)](\(.url)) \($short)\n\n"
          + (if $summary != "" then $summary + "\n\n" else "" end)
          + (if $why != "" then "*" + $why + "*\n" else "" end)
        ] | join("\n")
      end
  ' "$CACHE_DIR/prs.json" 2>/dev/null || true)

  if [[ -n "$highlights" ]]; then
    echo "$highlights"
  fi
}

# --- Grouped PR Generation ---

generate_grouped_prs() {
  local date="$1"
  local pr_count="$2"

  [[ "$pr_count" -eq 0 ]] && return

  # Generate grouped output with jq
  jq -r --arg d "$date" '
    def classify:
      if (.title | test("^feat")) then "Features"
      elif (.title | test("^fix")) then "Bug Fixes"
      elif (.title | test("^refactor")) then "Refactoring"
      elif (.title | test("^test")) then "Testing"
      elif (.title | test("^docs")) then "Documentation"
      elif (.title | (test("deps") or test("^Bump"))) then "Dependencies"
      elif (.title | test("^chore")) then "Maintenance"
      else "Other" end;

    def group_order:
      if . == "Features" then 0
      elif . == "Bug Fixes" then 1
      elif . == "Refactoring" then 2
      elif . == "Testing" then 3
      elif . == "Documentation" then 4
      elif . == "Maintenance" then 5
      elif . == "Dependencies" then 6
      else 7 end;

    def short_title:
      if (.title | test(": ")) then (.title | split(": ") | .[1:] | join(": "))
      else .title end;

    def extract_pkg:
      .title | gsub("^[^:]+:\\s*";"") | gsub("^[Bb]ump\\s+";"") | split(" from ")[0] | split(" in ")[0] | gsub("^ +| +$";"");

    [.[] | select(.mergedAt | startswith($d))]
    | sort_by(.number)
    | group_by(classify)
    | [.[] | {group: (.[0] | classify), items: ., order: (.[0] | classify | group_order)}]
    | sort_by(.order)
    | [.[] |
        if .group == "Dependencies" then
          (.items | length) as $n |
          ([.items[] | extract_pkg] | unique | .[0:8]) as $pkgs |
          (if $n > ($pkgs | length) then
            "**Dependencies** (" + ($n | tostring) + " updates: " + ($pkgs | join(", ")) + " and " + (($n - ($pkgs | length)) | tostring) + " more)"
          else
            "**Dependencies** (" + ($n | tostring) + " updates: " + ($pkgs | join(", ")) + ")"
          end) + "\n"
        else
          "### " + .group + " (" + (.items | length | tostring) + ")\n\n"
          + ([.items[] | "- [#\(.number)](\(.url)) \(short_title)"] | join("\n"))
          + "\n"
        end
      ] | join("\n")
  ' "$CACHE_DIR/prs.json" 2>/dev/null || true
}

# --- Footer Generation ---

generate_footer() {
  local date="$1"
  local commit_count="$2"
  local pr_count="$3"

  # Main stat line
  if [[ "$pr_count" -gt 0 ]]; then
    printf '%s commits across %s pull request%s.' "$commit_count" "$pr_count" "$([ "$pr_count" -gt 1 ] && echo 's')"
  else
    printf '%s commits.' "$commit_count"
  fi
  echo ""

  # Next session teaser
  local next_date=""
  local found_current=false
  while IFS= read -r d; do
    [[ -z "$d" ]] && continue
    if [[ "$found_current" == true ]]; then
      next_date="$d"
      break
    fi
    [[ "$d" == "$date" ]] && found_current=true
  done <<< "$ALL_FILTERED_DATES"

  if [[ -z "$next_date" ]]; then
    echo "*Latest session.*"
  else
    # Get a teaser from next session's PR titles (first 3 non-dep titles)
    local teaser
    teaser=$(jq -r --arg d "$next_date" '
      [.[] | select(.mergedAt | startswith($d)) | select(.title | (test("deps") or test("^Bump")) | not)]
      | sort_by(.number)
      | .[0:3]
      | [.[].title | (if test(": ") then split(": ") | .[1:] | join(": ") else . end) | .[0:50] + (if length > 50 then "..." else "" end)]
      | join(", ")
    ' "$CACHE_DIR/prs.json" 2>/dev/null || true)

    local next_display
    next_display=$(format_date "$next_date")
    if [[ -n "$teaser" ]]; then
      echo "*Next: ${next_display} — ${teaser}*"
    else
      echo "*Next: ${next_display}*"
    fi
  fi
}

# --- Post Generation ---

generate_post() {
  local date="$1"
  local post_file="$POSTS_DIR/$date.md"

  # Skip enriched posts
  if [[ -f "$post_file" ]] && grep -q '<!-- enriched -->' "$post_file"; then
    echo "  Skipping $date (enriched)"
    return
  fi

  local display_date
  display_date=$(format_date "$date")

  # --- Compute metrics ---

  local commit_count
  commit_count=$(grep -c "|${date}|" "$CACHE_DIR/git-log.txt" || true)

  local pr_count
  pr_count=$(jq --arg d "$date" '[.[] | select(.mergedAt | startswith($d))] | length' "$CACHE_DIR/prs.json" 2>/dev/null || echo 0)

  # --- Generate tags ---

  local tags_list
  tags_list=$(get_tags "$date" "$pr_count")

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

  # --- Generate content sections ---

  local narrative
  narrative=$(generate_narrative "$date" "$pr_count" "$commit_count")

  local highlights
  highlights=$(generate_highlights "$date" "$pr_count")

  local grouped_prs
  grouped_prs=$(generate_grouped_prs "$date" "$pr_count")

  # Commit messages (for pre-PR days)
  local commit_messages=""
  if [[ "$pr_count" -eq 0 && "$commit_count" -gt 0 ]]; then
    commit_messages=$(grep "|${date}|" "$CACHE_DIR/git-log.txt" | while IFS='|' read -r hash _ msg; do
      echo "- \`${hash:0:7}\` ${msg}"
    done)
  fi

  # Issues (with titles)
  local issues_opened
  issues_opened=$(jq -r --arg d "$date" '
    [.[] | select(.createdAt | startswith($d))]
    | sort_by(.number)
    | if length > 0 then
        [.[] | "- [#\(.number)](\(.url)) — \(.title)"] | join("\n")
      else "" end
  ' "$CACHE_DIR/issues.json" 2>/dev/null || true)

  local issues_closed
  issues_closed=$(jq -r --arg d "$date" '
    [.[] | select(.closedAt != null and (.closedAt | startswith($d)))]
    | sort_by(.number)
    | if length > 0 then
        [.[] | "- [#\(.number)](\(.url)) — \(.title)"] | join("\n")
      else "" end
  ' "$CACHE_DIR/issues.json" 2>/dev/null || true)

  local footer
  footer=$(generate_footer "$date" "$commit_count" "$pr_count")

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
    echo "${narrative}"
    echo ""
    echo "<!-- more -->"
    echo ""
  } > "$post_file"

  # Highlights section (optional)
  if [[ -n "$highlights" ]]; then
    echo "## Highlights" >> "$post_file"
    echo "" >> "$post_file"
    echo "$highlights" >> "$post_file"
    echo "" >> "$post_file"
  fi

  # What Changed (grouped PRs) or Commits (pre-PR)
  if [[ -n "$grouped_prs" ]]; then
    echo "## What Changed" >> "$post_file"
    echo "" >> "$post_file"
    echo "$grouped_prs" >> "$post_file"
    echo "" >> "$post_file"
  fi

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

  # Footer
  echo "---" >> "$post_file"
  echo "$footer" >> "$post_file"

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
ALL_FILTERED_DATES="$filtered_dates"
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
