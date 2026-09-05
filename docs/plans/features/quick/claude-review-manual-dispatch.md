# Plan: Manual Claude Code Review for external PRs

- **Status:** done
- **Spec:** [`docs/plans/design/claude-review-manual-dispatch.md`](../../design/claude-review-manual-dispatch.md)
- **Branch:** `ci/claude-review-manual-dispatch`
- **Issue:** none — surfaced while triaging PR #1963

## Approach

Single-file workflow change. Add a `workflow_dispatch` trigger with a `pr`
input, skip fork PRs on the automatic trigger, and make the review prompt
resolve the PR number from whichever event fired. Write the spec first because
the path is a danger zone; smoke-test the dispatch path against the fork PR
that exposed the problem before merging.

## Steps

1. **Spec** — files: `docs/plans/design/claude-review-manual-dispatch.md` — proof: danger-zone gate finds a spec in the diff
2. **Workflow** — files: `.github/workflows/claude-code-review.yml` — proof: `actionlint` clean; the `if` expression skips forks and allows dispatch
3. **Smoke test** — dispatch against PR #1963 from this branch — proof: the dispatch is accepted and the job completes. Note: the action skips the actual review when the workflow file differs from `main` (its own guard against modified workflows), so this only proves the trigger, input, `if`, and checkout. The review itself is proven post-merge (step 5)
4. **Verify the automatic path still runs** — this PR's own Claude review — proof: green check on this PR
5. **Post-merge dispatch** — `gh workflow run claude-code-review.yml -f pr=1963` from `main` — proof: run succeeds and a review comment appears on #1963

## Files changed

| File | Change |
|------|--------|
| `.github/workflows/claude-code-review.yml` | Add `workflow_dispatch` (input `pr`), fork skip in job `if`, PR number fallback in prompt, header comment explaining both paths |
| `docs/plans/design/claude-review-manual-dispatch.md` | Spec (danger-zone requirement) |
| `docs/plans/features/quick/claude-review-manual-dispatch.md` | This plan |

## Test plan

1. Open the PR. Expect the `Claude Code Review` check to run and pass (in-repo branch, automatic path unchanged).
2. Pre-merge: `gh workflow run claude-code-review.yml --ref ci/claude-review-manual-dispatch -f pr=1963`. Expect a run under the Actions tab that completes successfully, with the action logging that it skipped due to workflow validation (file differs from `main`). Done 2026-09-04, run 33936829763.
3. Post-merge: `gh workflow run claude-code-review.yml -f pr=1963`. Expect a successful run and a Claude review comment on PR #1963.
4. Confirm the fork skip: the run list for `Claude Code Review` on #1963's next push (if any) shows `skipped`, not `failure`.

## Rollback

Revert the single workflow commit. The `pull_request` behaviour returns to
today's (fork PRs fail the check again); nothing else depends on the change.

## Blast radius

The workflow file only. No other job, hook, or script reads it. Required
status checks are untouched, so merges cannot be newly blocked.

## Out of scope

- [ ] Spend-capped API key for CI reviews (maintainer billing decision, no issue filed)
- [ ] `--max-turns` cost cap once a baseline exists (folded into the above)
