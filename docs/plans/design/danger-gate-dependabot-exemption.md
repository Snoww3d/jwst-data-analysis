# Spec: Danger gate exemption for Dependabot action bumps

- **Status:** approved (owner chose this option in session, 2026-09-21)
- **Intent:** none — direct request. Recorded so the chain is not silently broken.
- **Date:** 2026-09-21
- **Slug:** `danger-gate-dependabot-exemption`

## Summary

`.github/workflows/**` is a danger zone, and rightly so: a workflow change can
exfiltrate secrets or alter what CI enforces. But the danger-zone gate does not
distinguish a logic change from Dependabot bumping `github/codeql-action` from
`v4.37.9` to `v4.38.0`. Every such bump queues on the owner's label. This spec
narrows the gate so the bumps merge autonomously while every other workflow
change stays gated.

## Requirements

| # | Requirement | Verified by |
|---|-------------|-------------|
| R1 | A Dependabot PR whose only change is action version refs in workflow files passes the gate without a label or spec | `danger-zone.test.cjs`: release case |
| R2 | Any other workflow change by anyone, including Dependabot, is still gated | tests: non-`uses:` line, renamed action, extra file |
| R3 | A PR merely claiming to be Dependabot is not exempt | author must be `dependabot[bot]` **and** the head repo must be this repo, both read from the GitHub API, not the PR body |
| R4 | The exemption is a switch the owner can turn off without a code change | `danger_zones.dependabot_action_bumps` in `.claude/sdlc.json`, read from the base commit like the rest of the config |
| R5 | The gate script is itself a danger zone | `.github/scripts/**` added to `paths` |
| R6 | Failure to read the diff fails closed | diff is read in the CLI inside the existing try/catch that calls `fail()` |

## Approach

`evaluate()` gains three inputs: `author`, `headRepo` (with `repo`), and
`workflowDiff` (the unified diff of the gated workflow files). Before the human
and spec signals it calls `dependabotActionBump()`, which returns true only
when every hit is under `.github/workflows/` and every `+`/`-` line of the diff
matches:

```
^[+-]\s*(-\s*)?uses:\s*([A-Za-z0-9_.\/-]+)@[A-Za-z0-9_.\/-]+(\s*#.*)?$
```

with the action name (group 2) identical between each removed line and the
added line that follows it. Anything else in the diff, a `with:` change, a new
step, a `run:` line, a different action, holds the gate as today.

### Alternatives rejected

| Option | Why not |
|--------|---------|
| Exempt all Dependabot PRs on workflow paths | Dependabot's diff is normally a `uses:` bump, but the gate should verify that rather than trust the author. Checking the diff costs a regex. |
| Move `.github/workflows/**` out of the danger zones | Loses the gate on real workflow changes, which is where secrets and CI enforcement live. |
| Auto-approve via a separate workflow that applies the label | A bot applying the label defeats the owner-only rule the gate exists to enforce, and needs a PAT. |
| Pin action SHAs instead of tags so bumps are "safer" | Orthogonal. Dependabot still opens a PR per bump, and each still hits the gate. |

## Data model and API changes

None. One boolean added to `.claude/sdlc.json`.

## Failure modes

| Failure | Detected how | Behaviour |
|---------|--------------|-----------|
| Dependabot bump also edits `with:` or a `run:` step | regex mismatch | gated as today |
| Dependabot swaps one action for another at the same line | name mismatch | gated as today |
| Fork PR with author spoofed in body | author and head repo come from the API | gated as today |
| `git diff` fails in CI | exception inside the guarded block | `fail()`, gate held |
| Compromised upstream action publishes a malicious tag | not detectable here | same exposure as any dependency bump; mitigated by CodeQL and review of release notes, not by this gate |

## Rollback

Set `dependabot_action_bumps` to `false` in `.claude/sdlc.json`, or revert.
