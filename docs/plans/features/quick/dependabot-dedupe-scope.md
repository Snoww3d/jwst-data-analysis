# Plan: Remove duplicate scope from Dependabot PR titles

**Complexity**: Quick (single-file YAML change)

## Problem

`Validate PR Standards` has been rejecting dependabot PRs because titles arrive as `chore(deps)(deps): bump ...` (double scope). The title regex expects a single conventional-commit scope, so all 9 open dependabot PRs in the 2026-04-18 batch had to be manually retitled to merge.

Root cause in `.github/dependabot.yml`: every ecosystem sets both

```yaml
commit-message:
  prefix: "chore(deps)"
  include: "scope"
```

Dependabot treats `prefix` as a literal string and still appends its own inferred scope (`deps` / `deps-dev`) when `include: scope` is set, producing `chore(deps)(deps):`.

## Fix

Remove `include: "scope"` from the `commit-message` block of every ecosystem (npm, nuget, pip, docker, github-actions). The literal `(deps)` already inside the prefix is sufficient and was the original design intent (see top-of-file comment).

## Files Changed

| File | Change |
|------|--------|
| `.github/dependabot.yml` | Drop `include: "scope"` from all 5 `commit-message` blocks |

## Verification

- No immediate CI effect (config is read by dependabot, not CI).
- Next scheduled run (weekly) should produce titles like `chore(deps): bump X from A to B` — single scope, passes `Validate PR Standards`.
- Manual verification: trigger a dependabot recreate on an existing PR (`@dependabot recreate`) after merge; the new title should have single scope.

## Risk

- Risk: Minimal. Single YAML edit; only affects future dependabot PR titles. No effect on production code or CI pipelines.
- Rollback: `git revert` the commit; titles return to doubled-scope (but currently unblocked manually).
