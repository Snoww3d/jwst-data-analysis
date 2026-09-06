# Plan: Revision-specific danger approval

Status: approved for implementation through the owner’s dispatcher request.
Spec: [Revision-specific danger approval](../design/revision-danger-approval.md).
Branch: `codex/revision-danger-approval`.

## Steps

1. Commit this plan and design before changing the gate.
2. Bring the versioned receipt reader, event receipt writer and shared tests from the paired personal-os change.
3. Wire receipt tests into the workflow and grant only the permission needed to record explicit owner events.
4. Update the danger-zone documentation and include the gate scripts themselves in protected paths.
5. Run the Node gate suite, review against REVIEW.md, open a separate PR and verify CI. Owner approval remains the final merge gate.

## Test plan

- CRITICAL regression: a retained label cannot approve a different head or base.
- Owner app receipt accepted; foreign/bot forgery and malformed receipts rejected.
- Owner mobile label receipt accepted; removed/replaced label and rerun of stale event rejected.
- Owner review receipt accepted only while its matching review remains approved.
- Existing spec-file, Spec reference, small-diff marker, CRLF and traversal cases remain covered.
- Same fixture cases run in personal-os Rust and the Node gate.
- Live CI verifies workflow execution; no live approval is synthesized to test it.

Rollback: revert the compatibility commit through a reviewed PR; retain receipt history. Blast radius: PR approval checks only. No Docker rebuild needed; no application UI or architecture diagrams change.
