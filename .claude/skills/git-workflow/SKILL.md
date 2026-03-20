---
name: git-workflow
description: Git workflow for the JWST project — branch creation, commit flow, PR creation, and merge process. Use this skill whenever creating branches, committing code, creating PRs, or merging. Also triggers on "commit this", "push this", "create a PR", "merge", "git flow", or any git operation beyond simple status/log/diff checks.
---

# Git Workflow

This skill covers the full branch → commit → PR → merge lifecycle for this project.

## Branch-First Rule

Before making any file edits:

1. `git rev-parse --abbrev-ref HEAD` — confirm you're not on main.
2. If on main: `git checkout -b <type>/<short-description>`.
3. Only then begin changes.

The pre-commit hook blocks commits to main as a safety net, but don't rely on it — create the branch first.

### Branch Naming

`{type}/{short-description}` — valid prefixes: `feature/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`, `perf/`, `ci/`, `dependabot/`, `codex/`.

The PreToolUse hook validates branch prefixes on `gh pr create` and will block invalid names.

## Commit Flow

- Use **conventional commit prefixes**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Keep commits **focused and atomic**.
- `git add <specific-files>` — never `git add .` (picks up unintended files).
- Pre-commit hook runs automatically: ESLint, Prettier, tsc, vitest, dotnet build+test, ruff. Don't duplicate these manually.

## PR Creation

1 Task = 1 PR. Each task gets its own branch and PR.

```bash
git push -u origin <branch>
gh pr create --title "<type>: Summary" --body "$(cat <<'EOF'
## Summary
...
## Changes Made
- ...
## Test Plan
- [x] ...
## Documentation Checklist
- [x] ...
## Tech Debt Impact
- [x] ...
## Risk & Rollback
Risk: ...
Rollback: ...

Closes #N
EOF
)"
```

The PreToolUse hook validates that all required sections are present before `gh pr create` runs. It will block if any section is missing.

### PR Title Format

`{type}: Description` or `{type}: Description (Task #N)`

### Tiered Merge Policy

- **Auto-merge** (no review needed): docs-only, test-only, config/linting, dependency bumps, style fixes
- **Skim review**: Low-risk feature/bug PRs — ping user, merge unless they want to look closer
- **Full review required**: Medium+ risk, auth changes, data model changes, storage/security changes — always wait for explicit approval

## No Dangling Changes

After completing a PR, `git status` and resolve uncommitted changes immediately:

- Related to completed work → follow-up PR
- Separate concern → separate PR
- Not needed → `git restore` / `git clean`

## Before Pushing to Existing Branches

Check if the branch's PR was already merged: `gh pr list --head <branch> --state merged`. The PreToolUse hook (`block-push-merged-branch.sh`) also enforces this — if a PR was merged, create a new branch from main.

## Plan Review Before Implementation

Before writing code for any feature, bug fix, or refactor:

1. **`/plan-ceo-review`** — rethinks the problem, challenges premises
2. **`/plan-eng-review`** for medium+ complexity — challenges architecture, catches complexity traps

Both reviews should complete before the first line of implementation code is written.
