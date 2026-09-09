# Spec: Revision-specific danger approval

Status: implementation authorized by the owner’s dispatcher improvement request.
Intent: [Revision-specific danger approval](../intent/revision-danger-approval.md).

## Requirements

1. Accept an owner-authored personal-os approval receipt for exactly the current PR head and base.
2. Preserve GitHub mobile labels: the gate records a bot receipt from an explicit owner label event, bound to that event’s revision and label identity. A rerun cannot transfer it to a new revision.
3. Require the latest owner label event for label receipts; removing danger-approved revokes earlier receipts. Reviews need an undismissed owner approval of the current commit and an event-scoped receipt.
4. Continue requiring the existing spec signal. Read danger path policy from the base and include both sides of renames.
5. Use the same versioned format and regression fixtures as personal-os. Unknown API data, stale revisions, absent capability or receipt publication errors fail closed.

## Design and alternatives

Use `pos-danger-approval:v1` JSON inside a GitHub comment. App receipts are owner-authored. Mobile/review receipts must be authored by github-actions[bot] and identify the corresponding owner event. The workflow gains pull-requests write solely to record these receipts; it does not merge or publish approving reviews.

A perpetual label was rejected because it approves later code. Parsing arbitrary prose was rejected because a reply is not revision approval. New heads and base revisions deliberately require fresh approval. The existing label remains the mobile shortcut; reapply it for a new revision.

## Risks and rollback

Approval policy is sensitive and requires the final owner approval on this PR. GitHub API or token failures hold the gate. Reverting the UI is safe while retaining this stricter gate; reverting the gate restores older semantics and must itself receive owner approval. Fork workflow tokens may lack receipt write permission and fail closed; the owner-authored app receipt path remains available once this gate is on the base.

## Plan reviews

CEO review — hold the already accepted scope. The existing gate/label mechanism is reused; no user-facing JWST feature or merge automation is added. Revision reuse is the concrete failure being fixed. No diagrams in scope.

Engineering review — medium security-sensitive change, isolated to gate logic/workflow, tests and policy documentation. No application services or data paths. API failures hold approval; exact revision and event identity handle races. Sequential implementation, no parallelization opportunity. No unresolved implementation decisions.
