# Plan: Danger Zone gate accepts an owner-applied `danger-approved` label

- **Status:** done
- **Spec:** [`docs/plans/design/danger-gate-owner-label.md`](../../design/danger-gate-owner-label.md)
- **Branch:** `ci/danger-gate-owner-label`
- **Issue:** none — surfaced while merging PR #1967

## Approach

Port, don't rewrite. Copy personal-os's `danger-zone.cjs` unchanged, adapt its
test file to this repo's paths, add the two label triggers to the workflow,
run the tests as a workflow step, and add `.github/scripts/**` to the
danger-zone paths. Update the two docs that describe the gate.

## Steps

1. **Label** — `gh label create danger-approved` — proof: `gh api repos/.../labels/danger-approved` returns it (done)
2. **Script** — files: `.github/scripts/danger-zone.cjs` (new), `.github/scripts/danger-zone.js` (removed) — proof: `diff` against personal-os is empty
3. **Tests** — files: `.github/scripts/danger-zone.test.cjs` — proof: `node --test .github/scripts/danger-zone.test.cjs` → 21 pass
4. **Workflow** — files: `.github/workflows/danger-zone.yml` — proof: `labeled`/`unlabeled` in triggers; test step before evaluate; runs `.cjs`
5. **Config** — files: `.claude/sdlc.json` — proof: `.github/scripts/**` in `danger_zones.paths`; file still parses
6. **Docs** — files: `AGENTS.md`, `REVIEW.md` — proof: both describe the label signal
7. **Live test** — owner applies `danger-approved` to this PR — proof: Danger Zone Gate goes green on the `labeled` run

## Files changed

| File | Change |
|------|--------|
| `.github/scripts/danger-zone.cjs` | New; identical to personal-os |
| `.github/scripts/danger-zone.js` | Removed; superseded |
| `.github/scripts/danger-zone.test.cjs` | New; 21 unit tests over `evaluate()` |
| `.github/workflows/danger-zone.yml` | `labeled`/`unlabeled` triggers, test step, `.cjs` entry point, header comment |
| `.claude/sdlc.json` | Add `.github/scripts/**` to danger zones |
| `AGENTS.md`, `REVIEW.md` | Describe the label and spec signals |
| `docs/plans/design/danger-gate-owner-label.md` | Spec |
| `docs/plans/features/quick/danger-gate-owner-label.md` | This plan |

## Test plan

1. `node --test .github/scripts/danger-zone.test.cjs` → `# pass 21`, `# fail 0`.
2. Open the PR. Expect Danger Zone Gate red with the message naming both the approve-or-label option and (satisfied) spec.
3. Owner applies `danger-approved` in the GitHub UI. Expect a new Danger Zone run on the `labeled` event that passes, with "Danger-zone change has a human signal. Gate released."
4. Remove the label. Expect the `unlabeled` run to fail again. Re-apply to merge.

## Rollback

Revert the commit. The old review-only gate returns and the label is ignored.
The label itself can stay; it is harmless without the script.

## Blast radius

Only the Danger Zone check. Required-check list is unchanged. PRs touching no
danger-zone path are unaffected (same early exit before any API call).

## Out of scope

- [ ] Unit tests for `validate-pr.js`, now also under `.github/scripts/**` (no issue filed; note in spec)
