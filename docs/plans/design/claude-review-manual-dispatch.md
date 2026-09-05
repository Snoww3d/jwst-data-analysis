# Spec: Manual Claude Code Review for external PRs

- **Status:** approved
- **Intent:** none — direct request during triage of PR #1963. Recorded here so the chain is not silently broken.
- **Date:** 2026-09-04
- **Slug:** `claude-review-manual-dispatch`

## Summary

The Claude Code Review workflow fails on every pull request from a fork. GitHub
does not expose repository secrets or an OIDC token to fork-triggered
`pull_request` runs, so the action cannot authenticate and reports a red check
that means nothing. External contributions are exactly where an automated first
pass is most useful, so the review must still be reachable for them — but only
on the maintainer's say-so, because it runs on the maintainer's Claude
subscription.

## Requirements

| # | Requirement | Verified by |
|---|-------------|-------------|
| R1 | Fork PRs no longer produce a failing Claude review check | Job `if` skips `head.repo.fork == true` on `pull_request` |
| R2 | A maintainer can run the review on any PR, including forks, on demand | `workflow_dispatch` with a `pr` input; `gh workflow run claude-code-review.yml -f pr=N` |
| R3 | External contributors cannot trigger the review or spend the maintainer's usage | `workflow_dispatch` is restricted by GitHub to users with write access; no `pull_request_target`, no `allowed_non_write_users` |
| R4 | Untrusted PR code is never checked out or executed | Checkout has no `ref:`; on dispatch that is the dispatching ref in this repo. The review plugin reads the PR only via `gh pr diff` / `gh pr view` |
| R5 | Existing automatic reviews on in-repo branches are unchanged | Same trigger types, same action inputs; PR number resolves from the event as before |
| R6 | The review remains advisory | Not added to required status checks (still `Validate PR Standards`, `CI Gate`, `Danger Zone Gate`) |

## Approach

Keep one workflow, add a second entry point.

- `pull_request` keeps firing for in-repo branches. The job condition gains a
  fork check next to the existing Dependabot check, so fork PRs are skipped
  rather than failed.
- `workflow_dispatch` takes a PR number. The prompt resolves the number from
  the event when present and from the input otherwise, so both paths run the
  identical review command.

The manual path is safe by construction rather than by configuration:

1. **Who can trigger.** GitHub only allows write-access users to dispatch a
   workflow. That is the whole usage-limit guard — nothing an outside account
   does can start a run.
2. **What runs.** The checkout is the dispatching ref in this repo. The fork
   head is never fetched. The `code-review` plugin declares its own tool
   allowlist (`gh pr view`, `gh pr diff`, `gh pr comment`, `gh issue`,
   `gh search`, inline-comment tool) and pulls the diff through the GitHub API.
3. **What it can reach.** Job permissions stay `contents: read`,
   `pull-requests: read`, `issues: read`, `id-token: write`. The action posts
   comments through its own app token obtained via OIDC, as today.

### Alternatives rejected

| Option | Why not |
|--------|---------|
| `pull_request_target` on every fork PR | Runs with secrets in the base repo's context for any PR anyone opens. Any GitHub account could burn the maintainer's Claude usage by opening PRs or pushing commits, and each run is a prompt-injection attempt against a reviewer holding a static OAuth token. |
| Label-gated `pull_request_target` (`safe-to-review`) | Safer than the above but still needs `allowed_non_write_users`, which the action's docs flag as risky, because the fork author is the triggering actor. Dispatch makes the maintainer the actor and needs no such override. |
| Skip fork PRs entirely | Removes the red check but loses the review where it is most valuable. |
| Switch the workflow to a Console API key with a spend cap | A valid billing choice that bounds cost independently of who triggers. Orthogonal to this change; deferred to the maintainer. |
| Add `--max-turns` as a per-run cost cap | The plugin fans out subagents and the working turn budget is unknown; a guessed cap could truncate reviews that work today. Deferred until a real run gives a baseline. |

## Data model and API changes

None. One workflow file changes; no runtime code.

## Failure modes

| Failure | Detected how | Behaviour |
|---------|--------------|-----------|
| Dispatched with a PR number that does not exist | `gh pr view` fails inside the review | Job fails with a clear `gh` error; no comment posted |
| Dispatched from a branch that lacks the `workflow_dispatch` trigger | GitHub refuses the dispatch | `gh workflow run` errors before anything runs |
| Secret missing on dispatch | Action reports the same OIDC/token error seen on fork runs | Job fails; nothing is blocked because the check is not required |
| Fork detection expression evaluates unexpectedly | Run appears (fails) on a fork PR, or is skipped on an in-repo PR | Visible in the Actions tab; check is advisory either way. Verified in the test plan against one fork PR and one in-repo PR |
| Inline comments on dispatch | The action's inline-comment tool may lack PR context outside a `pull_request` event | Summary comment via `gh pr comment` still lands; inline placement is best-effort. Observed in the smoke test and recorded in the PR |

## Flagged concerns

- [x] **Touches `.github/workflows/**`**, a declared danger zone. This PR trips
      its own gate and needs a human approving review. Intended.
- [x] **Spends the maintainer's Claude usage.** Only on manual dispatch, only
      by write-access users. No path lets an external account start a run.
- [x] **Reviewer reads untrusted diff content.** Prompt-injection surface exists
      on any review of external code. Mitigated by the plugin's narrow tool
      allowlist and read-only job permissions; the OAuth token is never exposed
      to the diff's code because that code never executes.

## Open questions carried forward

- Whether to move CI reviews to a spend-capped API key so CI cost can never
  touch interactive usage. Maintainer's billing decision.
- Whether to re-run automatically when a dispatched fork PR is updated.
  Currently a maintainer dispatches again by hand. Deliberate: it keeps every
  run behind a human click.
