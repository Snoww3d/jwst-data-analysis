# Intent artifacts

Stage 1 of the [SDLC](../../../.claude/sdlc.json). Each file here captures a
problem before anyone designs a solution to it — the proto-spec.

An intent becomes a spec in [`../design/`](../design/), which becomes an
implementation plan in [`../features/`](../features/), which the
`require-plan-file` hook checks against the current branch.

Create one with `/sdlc intent`. The template is in the global skill at
`~/.claude/skills/sdlc/templates/intent.md`.

Name files `<kebab-slug>.md`, and carry the same slug through the spec and plan
so the chain is greppable.
