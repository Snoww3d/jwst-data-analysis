# Spec: Danger Zone gate accepts an owner-applied `danger-approved` label

- **Status:** approved
- **Intent:** none — surfaced 2026-09-05 while merging PR #1967, when the gate could not be satisfied. Recorded here so the chain is not silently broken.
- **Date:** 2026-09-05
- **Slug:** `danger-gate-owner-label`
- **Reference implementation:** `personal-os` `.github/scripts/danger-zone.cjs` (PRs #146, #148, #150 there)

## Summary

The Danger Zone gate releases only on an approving review from a non-bot. This
repo has one collaborator, who authors every PR, and GitHub forbids approving
your own PR. So the gate has never been green on a danger-zone change: #1958
and #1967 both merged through the branch-protection bypass. A gate that can
only be bypassed trains the habit of bypassing, which is the opposite of its
purpose. Port the personal-os gate, which accepts an owner-applied
`danger-approved` label as the human signal, and protect the gate script
itself.

## Requirements

| # | Requirement | Verified by |
|---|-------------|-------------|
| R1 | An approving review from a non-bot still releases the human signal | `danger-zone.test.cjs`: "approving human review releases" |
| R2 | The `danger-approved` label releases the human signal only when the repo owner applied it most recently | tests: owner label releases; non-owner label does not; removal un-approves; re-apply counts again |
| R3 | Other labels, including `decision:approve`, never count | test: "a different label from the owner does not count" |
| R4 | Applying or removing the label re-runs the gate without a push | `danger-zone.yml` triggers on `labeled` / `unlabeled` |
| R5 | The spec signal accepts a spec in the diff, a `Spec:` body line naming a spec already on `main`, or a small-diff `SDLC-Exception` marker | tests for each, including malformed and CRLF bodies |
| R6 | The gate script cannot be changed without tripping the gate | `.github/scripts/**` added to `danger_zones.paths`; test: "the gate script itself is a danger-zone path" |
| R7 | The gate's own tests run in CI before its verdict is trusted | `danger-zone.yml` "Test the gate logic" step |
| R8 | The gate fails closed when GitHub state cannot be read | `main()` catches and fails on any `gh api` error |

## Approach

Replace `.github/scripts/danger-zone.js` with the personal-os
`danger-zone.cjs`, byte-for-byte. It splits a pure `evaluate()` from a CLI
wrapper, so the decision logic is unit-tested without GitHub. The test file is
adapted to this repo's paths and includes a regression test for the label the
owner reached for by mistake (`decision:approve`).

The label check replays the issue timeline rather than reading the current
label list, because the label list does not say who applied a label. The
most recent `labeled` event for `danger-approved` must have the owner as
actor; an `unlabeled` event after it resets to unapproved.

Create the `danger-approved` label in the repo (done 2026-09-05, colour
`0E8A16`, description matches personal-os).

### Alternatives rejected

| Option | Why not |
|--------|---------|
| Keep bypassing branch protection | Every danger-zone merge becomes a bypass, and the check stops meaning anything. |
| Accept any write-access user's label | There is one write-access user today, so equivalent now, but the owner check is stricter for free and matches personal-os. |
| Accept the label from the current label list without checking who applied it | A session running under the owner's `gh` token can apply a label. Timeline actor is the same token, so this is not a real distinction today, but the timeline check at least records who and when, and un-approves on removal. |
| A second GitHub account to approve PRs | Ceremony for a solo maintainer; a label is one tap on mobile. |
| Write a fresh implementation | personal-os already has one with 20 tests and a live run. Byte-identical script keeps the two repos' gates in step. |

## Data model and API changes

None. CI script and config only.

## Failure modes

| Failure | Detected how | Behaviour |
|---------|--------------|-----------|
| Label applied by a non-owner | Actor check in `ownerLabelApproval` | Not counted; error names the label and the owner requirement |
| Label removed after approval | `unlabeled` event resets state | Gate closes again on the `unlabeled` trigger |
| Issue events API unreachable | `execFileSync` throws | Fails closed with the API error |
| Gate unit tests fail | "Test the gate logic" step exits non-zero | Check fails before the verdict step runs |
| `Spec:` line names a missing file | `contents` lookup at PR head | Fails with "does not exist at the PR head" |
| Owner's own session applies the label | Not detectable: same token as the human | Accepted risk, same as today's bypass. The label leaves an audit trail the bypass does not |

## Flagged concerns

- [x] **Touches `.github/workflows/**`, `.github/scripts/**`, `.claude/sdlc.json`**: all danger zones. This PR trips its own gate. The new script runs on the PR (workflow runs from the merge ref), so applying `danger-approved` to this PR is the gate's live test.
- [x] **Security-adjacent policy.** Changes what counts as human approval on the repo's most sensitive paths. Reviewed against the personal-os implementation and its test suite; 21 tests here.
- [x] **A session can apply the label.** The instruction to sessions is: never apply `danger-approved`; tell the owner to. Recorded in project memory.

## Open questions carried forward

- Whether `validate-pr.js` (now also protected under `.github/scripts/**`) deserves its own tests. Not in scope here.
