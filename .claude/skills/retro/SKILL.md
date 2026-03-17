---
name: retro
description: Git velocity retrospective. Analyzes commit history to surface velocity metrics, session patterns, hotspots, and what's slowing you down. Produces a tweetable summary. Use at end of a work session or weekly review. Triggers on "retro", "retrospective", "velocity check", "how productive was I", "/retro". Accepts optional time window argument (default 7d): /retro 24h, /retro 14d, /retro 30d.
allowed-tools:
  - Bash
  - Read
  - Glob
---

# Retrospective — Velocity Analysis

Parse the argument for a time window. Default: `7d`.
- `/retro` → 7d
- `/retro 24h` → 1 day
- `/retro 14d` → 14 days
- `/retro 30d` → 30 days
- `/retro compare` → compare current 7d vs prior 7d

**Repo root:** Detect dynamically via `git rev-parse --show-toplevel`

---

## Step 1: Gather Raw Data (run all in parallel)

```bash
# Commits in window (author = Shanon or Co-Authored-By Claude)
git -C $(git rev-parse --show-toplevel) log --oneline --since="TIME_WINDOW" --format="%H %ad %s" --date=short

# Files changed per commit
git -C $(git rev-parse --show-toplevel) log --since="TIME_WINDOW" --name-only --format="COMMIT:%H %s"

# LOC stats
git -C $(git rev-parse --show-toplevel) log --since="TIME_WINDOW" --shortstat --format="COMMIT:%H %s"

# PRs merged (approximated by merge commits)
git -C $(git rev-parse --show-toplevel) log --since="TIME_WINDOW" --merges --oneline

# All branches touched
git -C $(git rev-parse --show-toplevel) log --since="TIME_WINDOW" --format="%D" | grep -oE '(feature|fix|docs|refactor|test|chore|codex)/[^ ,]+' | sort | uniq

# Commit timestamps for session detection
git -C $(git rev-parse --show-toplevel) log --since="TIME_WINDOW" --format="%ad" --date=format:'%Y-%m-%d %H:%M'
```

---

## Step 2: Core Metrics Table

Compute and display:

```
VELOCITY METRICS — [start date] to [end date]
════════════════════════════════════════════
Total commits          [N]
Merge commits          [N]  (= PRs shipped)
Lines added            [N]
Lines deleted          [N]
Net LOC delta          [+/-N]
Files changed          [N unique files]
Active days            [N / N calendar days]
Avg commits/day        [N]
Avg LOC/day            [N]
```

---

## Step 3: Session Detection

Group commits into "sessions" — a session is a sequence of commits where no gap exceeds 90 minutes.

Display:
```
WORK SESSIONS
═════════════
[Date]  [start time] – [end time]  ([duration])  [N commits]
...

Longest session:  [date]  [duration]
Most productive:  [date]  [N commits, N LOC]
```

---

## Step 4: Commit Type Breakdown

Parse commit prefixes (feat/fix/docs/refactor/test/chore):

```
COMMIT TYPES
════════════
feat:      [N] commits  [████████░░]  [N%]
fix:       [N] commits  [████░░░░░░]  [N%]
refactor:  [N] commits  [███░░░░░░░]  [N%]
docs:      [N] commits  [██░░░░░░░░]  [N%]
test:      [N] commits  [█░░░░░░░░░]  [N%]
chore:     [N] commits  [░░░░░░░░░░]  [N%]
other:     [N] commits
```

Flag if `fix:` > 40% — may indicate reactive work or insufficient pre-implementation review.
Flag if `test:` < 10% — test coverage may be falling behind.

---

## Step 5: File Hotspot Analysis

Top 10 most-touched files in the window:

```
HOTSPOTS
════════
[N changes]  frontend/jwst-frontend/src/...
[N changes]  backend/src/...
[N changes]  ...
```

Flag hotspots that appear in >50% of commits — these are churn candidates worth extracting or stabilizing.

---

## Step 6: Branch Health

```
BRANCHES IN WINDOW
══════════════════
[branch name]  [status: merged/open/stale]  [age]  [commits]
```

Flag any branches open >7 days — these may be blocking forward progress.

---

## Step 7: What Slowed You Down

Infer friction from the data:
- Commits with message "fix:" within 2 hours of a "feat:" on the same files → regression pattern
- Large gaps between sessions (>2 days) → blocked or context-switching
- High churn on same files → unclear spec or complex refactor
- Many small commits on same feature → may indicate iterative struggle

Surface as:
```
FRICTION SIGNALS
════════════════
[signal type]: [evidence from git log]
```

---

## Step 8: Ship of the Week

Identify the single most impactful merged PR (by LOC, file breadth, or commit description). Write one sentence about it.

---

## Step 9: Tweetable Summary

Write a 1-3 sentence summary that a developer would find satisfying to read. Include:
- Key wins
- One honest friction point
- One pattern to repeat or avoid

Format:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Tweetable summary here]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Step 10: Save Snapshot (optional)

If the user says "save" or the window is 7d+, write a snapshot:

```bash
mkdir -p $(git rev-parse --show-toplevel)/.claude/retros
# Write JSON snapshot to .claude/retros/YYYY-MM-DD.json
```

Fields: date, window, commits, locs_added, locs_deleted, active_days, sessions, top_files, friction_signals, summary.
