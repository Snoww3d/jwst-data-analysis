---
name: doc-update
description: Documentation update guide for the JWST project — which docs to update for each type of change. Use this skill when finishing a feature, adding endpoints, changing models, updating frontend components, or when the doc drift hook fires a warning. Also triggers on "update docs", "which docs need updating", "documentation checklist".
---

# Documentation Update Guide

When source code changes affect behavior, update the corresponding documentation in the same PR.

## Update Matrix

| Change Type            | Files to Update                                                              |
| ---------------------- | ---------------------------------------------------------------------------- |
| New API endpoint       | `docs/quick-reference.md`, `docs/standards/backend-development.md`           |
| New data model field   | `docs/standards/database-models.md`, `docs/standards/backend-development.md` |
| New frontend feature   | `docs/standards/frontend-development.md`                                     |
| Phase completion       | `docs/development-plan.md`                                                   |
| New TypeScript type    | `docs/standards/frontend-development.md`                                     |
| Tech debt / bugs       | File as [GitHub Issue](https://github.com/Snoww3d/jwst-data-analysis/issues) with `tech-debt` or `bug` label |
| **Any feature change** | `docs/plans/exploration/desktop-requirements.md` (keep desktop spec in sync)  |

## Desktop Requirements Sync

`docs/plans/exploration/desktop-requirements.md` captures all features as platform-agnostic requirements for a future desktop version. When adding or modifying features, update the corresponding functional requirements (FR-*) to keep the spec aligned.

## Verification

Before pushing, run: `grep -rn '<changed-name>' docs/` to confirm documentation references are consistent.

## When Controller/Service/Endpoint Changes

If a PR adds or renames a controller, service, or endpoint, update in the same PR:
- `docs/key-files.md`
- `docs/standards/backend-development.md`
- `docs/architecture/`
- `docs/quick-reference.md`

Also triggered by: new API params, new frontend components, workflow changes, removed endpoints/files.

## Before Marking Dev-Plan Tasks Complete

Before checking off a broad task in `docs/development-plan.md`, grep for other places the task applies. Break into sub-items if others remain.
