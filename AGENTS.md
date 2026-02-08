# AGENTS.md

This file is the primary guidance for all coding agents working in this repository (Codex, Claude Code, or similar tools).

## Scope and Precedence

- This file defines shared workflow and process expectations.
- Tool-specific files (for example `CLAUDE.md`) may add tool-specific tips.
- If a tool-specific file conflicts with this file on shared process rules, `AGENTS.md` wins.

## Core Workflow Rules

- Never push directly to `main`.
- Use a branch for every change, including documentation-only edits.
- Open a PR for every branch.
- Keep commits focused and use conventional commit prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Do not merge without explicit maintainer approval.

## Standard Git Flow

```bash
git status
git checkout -b <type>/<short-description>

# make changes

git add <files>
git commit -m "<type>: <summary>"
git push -u origin <branch>
gh pr create
```

## Verification Expectations

- Run relevant linting and tests for changed areas before asking for review.
- For backend/frontend integration work, verify in Docker (`docker compose up -d --build`).
- If a test cannot be run in the current environment, state that clearly in the PR.

## Documentation Expectations

Update docs when behavior changes:

- API changes: `docs/quick-reference.md`, `docs/standards/backend-development.md`
- Data model changes: `docs/standards/database-models.md` and matching frontend types
- Frontend behavior/features: `docs/standards/frontend-development.md`
- Milestone/phase status changes: `docs/development-plan.md`
- Significant user-visible feature changes: `docs/desktop-requirements.md`

## Authoritative Project References

- Setup and local runbook: `docs/setup-guide.md`
- Architecture and flows: `docs/architecture.md`
- Key file map: `docs/key-files.md`
- Technical standards: `docs/standards/`
- Backlog tracking: `docs/tech-debt.md`, `docs/bugs.md`

## Tooling Notes

- Prefer repository scripts and standard CLI commands over assistant-specific slash commands.
- Keep instructions repository-relative and portable; avoid machine-specific absolute paths in shared docs.
