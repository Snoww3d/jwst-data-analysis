# Danger gate: exempt Dependabot action bumps

**Branch**: `feature/danger-gate-dependabot-exemption`
**Effort**: <1 hr · **Risk**: Low (gate logic; fails closed)
**Spec**: `docs/plans/design/danger-gate-dependabot-exemption.md`

## Problem

`.github/workflows/**` is a danger zone, so every Dependabot bump of a GitHub
Action (CodeQL, checkout, setup-*) blocks on the owner's `danger-approved`
label. Dependabot ships several a month; each one queues on a human for a
change that pins a version tag and nothing else. PR #2015 is the current one.

## Change

1. `.claude/sdlc.json`: add `danger_zones.dependabot_action_bumps: true`
   (opt-in switch) and add `.github/scripts/**` to `paths`, since the gate
   script itself was not gated (#1995 touched it ungated).
2. `.github/scripts/danger-zone.cjs`: in `evaluate()`, before the human and
   spec signals, release the gate when **all** of:
   - the switch is on;
   - the PR author is `dependabot[bot]` and the head repo is this repo;
   - every gated hit is under `.github/workflows/`;
   - every `+`/`-` line of the diff for those files is a `uses: owner/repo@ref`
     line (optional `# vX` comment), and the action name is unchanged between
     the removed and added line.
   The CLI passes `author`, `headRepo`, and the unified diff of the hit files.
3. `danger-zone.test.cjs`: cover release, and hold on non-Dependabot author,
   fork head, extra non-workflow file, a diff that changes anything other than
   a `uses:` ref, and a swapped action name.

## Proof

- `node --test .github/scripts/danger*.test.cjs` green.
- Danger Zone Gate on this PR still requires the label (it touches
  `.claude/sdlc.json`).
- After merge: re-run the gate on #2015 and confirm it passes without a label.

## Rollback

Revert the PR, or set `dependabot_action_bumps` to `false`.
