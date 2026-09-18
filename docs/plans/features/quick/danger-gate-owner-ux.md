# Plan: Danger Zone gate tells the owner what to do

- **Status:** in review
- **Spec:** [`docs/plans/design/danger-gate-owner-ux.md`](../../design/danger-gate-owner-ux.md)
- **Branch:** `feature/danger-gate-owner-ux`

## Steps

1. **Structured problems**: files `.github/scripts/danger-zone.cjs`. `evaluate()` also returns `problems`; proof: existing gate tests pass unchanged
2. **Status module**: files `.github/scripts/danger-status.cjs`. `staleLabel`, `render`, `upsertAction`, `writeSkipReason`; proof: `danger-status.test.cjs`
3. **CLI wiring**: files `.github/scripts/danger-zone.cjs`. Best-effort `reportStatus()` after the verdict; proof: CLI tests with fake `git`/`gh`
4. **Workflow**: files `.github/workflows/danger-zone.yml`. `edited` trigger, `HEAD_REPO`/`ACTOR` env; proof: YAML parses and the test step still runs `danger*.test.cjs`
5. **Docs**: files `AGENTS.md`, `REVIEW.md`; proof: both describe "apply once; the gate removes a stale label and tells you; re-apply"

## Verification

`node --test .github/scripts/danger*.test.cjs` gives 36 pass, 0 fail.
Live check after merge: push a commit to an approved danger-zone PR and
expect the label to be removed and the status comment to read "Approval was
for `<old>` ... label removed, re-apply `danger-approved`".

## Blast radius

Only the Danger Zone check. The verdict is unchanged; PRs outside danger zones
make no API calls, as before.
