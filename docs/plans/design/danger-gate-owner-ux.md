# Spec: Danger Zone gate tells the owner what to do

- **Status:** proposed
- **Builds on:** [Revision-specific danger approval](revision-danger-approval.md), [owner label](danger-gate-owner-label.md)
- **Plan:** [`docs/plans/features/quick/danger-gate-owner-ux.md`](../features/quick/danger-gate-owner-ux.md)

## Problem

Approval is per revision: a `danger-approved` label counts only for the head
and base it was applied on. A later commit (a repair, a merge from main)
silently invalidates it, but the label stays on the PR looking valid, and
re-approving takes remove + re-add because GitHub emits `labeled` only on add.
Every failure (stale approval, no approval, missing spec) shows as the same
red check, with the reason buried in the log. The owner called this "VERY
unclear and confusing".

## Requirements

| # | Requirement | Proof |
|---|-------------|-------|
| R1 | The set of PR states that pass is unchanged. `approved()` and the pass/fail branch of `evaluate()` are untouched | existing 24 tests unchanged in assertion; `danger-status.test.cjs` "fork and Dependabot runs ... keep the same verdict", "write failure" cases |
| R2 | A `danger-approved` label that is provably stale for the current head/base is removed, so re-approval is one add | "CLI: stale label is removed" |
| R3 | Removal happens only when provable; ambiguity or read errors leave the label and fail as before | "ambiguous states are not stale", "CLI: read error removes nothing" |
| R4 | One sticky status comment, found by `<!-- danger-gate-status -->`, updated in place, with status, protected paths and exactly one next step | "status body per state", "CLI: unchanged status is not rewritten; a changed one is patched" |
| R5 | Fork and Dependabot runs (read-only token) skip the writes with a log line; no write failure changes the verdict | "CLI: fork and Dependabot runs skip writes" |
| R6 | The existing log output stays | "CLI: stale label ..." asserts the `no human signal` log |

## Approach

The verdict is computed exactly as today, then a best-effort report step runs
and the process exits on the verdict. New code lives in
`.github/scripts/danger-status.cjs`; `danger-zone.cjs` calls it inside a
`try` after `evaluate()` and before `fail()`.

**Staleness** (`staleLabel()`) reuses the binding `approval.approved()` in
`danger-approval.cjs` already enforces for label receipts: a receipt counts
only when its `eventId` equals the latest `danger-approved` `labeled` event by
the owner. The label is stale when all hold: the pulls API lists the label;
`approved()` is false for this head/base; the latest label event is the
owner's `labeled`; at least one bot-authored `source: "label"` receipt exists
for that event id; and none of them names this head and base. Before deleting,
the CLI re-reads the PR, comments and label events and recomputes, so an
approval that landed after the first read is not revoked. It deletes only if
the head and base are still the ones evaluated.

**Status comment** (`render()`): one `**Status:**` line per problem (✅
approved for `<sha>`; ❌ needs your approval; ❌ approval was for `<old>`, N
new commit(s) since, label removed, re-apply; ❌ needs a spec with its two
ways; any other reason verbatim), the protected paths, and one
`**Next step:**`. When both a spec and approval are missing, the next step is
the spec, since a spec commit would stale an approval given first. File names
are stripped of newlines and backticks so no comment line can start with the
receipt prefix.

**Upsert** (`upsertAction()`): the first comment by `github-actions[bot]`
starting with the marker is PATCHed when its body differs, left alone when
identical, and created when absent. Before writing, the CLI checks that the
PR head/base still match the run, so an older run cannot overwrite a newer
status.

**Workflow**: adds `edited` so a PR body gaining `Spec:` or
`SDLC-Exception:` re-runs the gate, and passes `HEAD_REPO` and `ACTOR` for
the write-skip decision. Permissions are unchanged: the job already has
`pull-requests: write` for receipts, which also covers issue comments and PR
label removal.

## Alternatives rejected

| Alternative | Why not |
|-------------|---------|
| Let the label approve any later revision | Loosens approval; the exact thing revision receipts were built to stop |
| Remove the label on every failing run | Removes labels that are not provably stale (no receipt, non-owner label), which is guesswork on a security control |
| Remove the label on every `synchronize` | Would also fire when an app approval already covers the new head, and on read errors |
| `pull_request_target` for a write token on forks | Runs with secrets on untrusted code paths for a cosmetic feature; the fork path keeps working, just without the comment |
| Separate job for the writes | Permissions are per job and receipt minting already needs write in the gate step; a split only adds a second checkout |
| New comment per run | Buries the current status in history; the owner asked for one place to look |
| Check-run summary instead of a comment | Needs `checks: write` and is still one click away from the PR conversation where the owner applies the label |

## Failure modes

| Failure | Behaviour |
|---------|-----------|
| Any GitHub read fails | Unchanged: the gate fails with "Could not read PR state"; no removal, no comment |
| Label DELETE or comment write fails (403, 404, network) | Logged; the verdict stands; the comment, if written, says "remove and re-apply" instead of "label removed" |
| Fork or Dependabot run | Writes skipped with a log line; verdict unchanged |
| The bot's own `unlabeled` event | GITHUB_TOKEN events start no workflow runs, so no loop. `fromEvent()` requires the owner as sender, so it never mints a receipt; `approved()` treats it like any removal |
| Owner approves in the app between the first read and the DELETE | The re-read catches it and the label stays. A residual window of one API call remains; if hit, the removal revokes that receipt and the gate fails closed, and the comment says to re-apply |
| Owner force-pushes back to a previously approved head after the gate removed the label | Needs a fresh approval. Before this change the old label receipt would have counted again. This is the only behavioural difference, and it is stricter |
| Two runs race on the comment | Each checks the live head/base before writing; the newest revision's run wins. Duplicate creation in a narrow race is possible; the upsert then edits the first one |
| PR stops touching danger-zone paths | The early exit makes no API calls, so an earlier status comment stays as last written. The check itself is green |
| Label present, owner-applied, but no receipt (for example, applied during a fork run) | Not provably stale: left in place, and the comment says to remove and re-apply |

## Rollback

Revert the PR. The verdict logic is unchanged, so rollback only removes the
comment and the removal. A leftover status comment is inert: it is not a
receipt and `approved()` ignores it.
