# AGENTS.md

Primary guidance for all agents working in this repository.

## Project Overview

JWST Data Analysis Application — a microservices-based platform for analyzing James Webb Space Telescope data.

**Architecture**: Frontend (React TypeScript) → Backend (.NET 10 API) → MongoDB + Processing Engine (Python FastAPI) → MAST Portal (STScI)

| Service           | URL    | Tech                      |
| ----------------- | ------ | ------------------------- |
| Frontend          | :3000  | React + Vite + TypeScript |
| Backend API       | :5001  | .NET 10 REST API          |
| Processing Engine | :8000  | Python FastAPI            |
| MongoDB           | :27017 | Document database         |
| Documentation     | :8001  | MkDocs                    |

## Architecture Constraints

- All DB operations go through `MongoDBService.cs` (repository pattern) — never direct MongoDB calls in controllers.
- All services have interfaces for testability (e.g. `IMongoDBService`, `IMastService`, `ICompositeService`).
- Frontend state: local React hooks + AuthContext for authentication.
- Processing engine fetches data from backend API (not directly from MongoDB).
- Async job queue: composite/mosaic/import jobs use `IJobTracker` with SignalR push.
- JSON casing: backend uses **snake_case**, frontend uses **camelCase** — verify DTO mapping for new endpoints.
- Auth flow is currently fragile — be extra careful when touching it.

## Current Phase

**Phases 1–4 complete.** Working across Phases 5–7. See [`docs/development-plan.md`](docs/development-plan.md) for details.

## Quick Start

```bash
cd docker && cp .env.example .env       # First time
docker compose up -d                     # Start all services
docker compose up -d --build             # Rebuild after changes
```

For full setup: [`docs/setup-guide.md`](docs/setup-guide.md). For service-specific dev commands: same file.

## Core Rules

- **Never push directly to `main`** — hooks enforce this at commit and push time.
- Every change goes through a **feature branch + PR** (see `/git-workflow` skill).
- **Conventional commit prefixes**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- **1 Task = 1 PR** — atomic, reviewable changes.
- **Plan review before implementation**: `/plan-ceo-review` always, `/plan-eng-review` for medium+ complexity.

## Testing Philosophy

- **Never delete or weaken tests** — if tests fail due to architecture, fix the architecture.
- Create interfaces for dependencies to enable proper mocking.
- Use Moq for .NET unit tests; `NullLogger<T>` only for the class under test.
- Python tests run via Docker: `docker exec jwst-processing python -m pytest`.

## Hook Enforcement

Quality is enforced structurally, not by memory:

| Hook | When | What |
|------|------|------|
| Pre-commit (git) | At commit | Blocks main, runs ESLint, Prettier, tsc, vitest, dotnet build+test, ruff |
| Pre-push (git) | At push | Blocks pushes to main |
| validate-before-pr-create | Before `gh pr create` | Validates PR body sections and branch prefix |
| warn-pr-merge | Before `gh pr merge` | Warns — get user approval |
| block-push-merged-branch | Before `git push` | Blocks pushes to branches with merged PRs |
| post-edit-typecheck | After Edit/Write | Per-file tsc on .ts/.tsx files |
| post-edit-lint | After Edit/Write | Anti-pattern scan (inline styles, `any`, unexplained suppressions, debug logging) |
| post-edit-doc-drift | After Edit/Write | Scores changes, warns when docs may need updating |

Don't manually run checks the hooks already enforce.

## Security

- Credentials via environment variables in `docker/.env` (gitignored, copy from `.env.example`).
- Processing engine has DoS limits: `MAX_FITS_FILE_SIZE_MB` (10GB), `MAX_FITS_ARRAY_ELEMENTS` (100M), `MAX_MOSAIC_OUTPUT_PIXELS` (64M).
- Before production: strong passwords, review CORS/auth config, remove seed accounts.

## Bug & Tech Debt

- Tracked in [GitHub Issues](https://github.com/Snoww3d/jwst-data-analysis/issues) (`tech-debt`, `bug` labels).
- `docs/tech-debt.md` and `docs/bugs.md` are historical references only.

## Agent Coordination

> **Status**: Multi-agent parallel development was attempted but didn't work well in practice. The infrastructure (`scripts/agent-docker.sh`, isolated Docker stacks) still exists if revisited later, but is not actively used.

Current workflow: **single agent, sequential tasks**.

## Skills

Procedural knowledge lives in skills (loaded on demand, zero tokens when inactive):

| Skill | When |
|-------|------|
| `/git-workflow` | Branch, commit, PR, merge operations |
| `/doc-update` | Finishing features, the doc drift hook fires |
| `/debug` | Investigating errors or unexpected behavior |
| `/plan-ceo-review` | Before any implementation |
| `/plan-eng-review` | Medium+ complexity work |
| `/retro` | End of session |
| `/compliance-check` | Before merge |

## Session Wrap-up

Run `/retro` at the end of every session.

## References

| Resource                | Location                                                                 |
| ----------------------- | ------------------------------------------------------------------------ |
| Setup and local runbook | [`docs/setup-guide.md`](docs/setup-guide.md)                             |
| Architecture and flows  | [`docs/architecture/`](docs/architecture/index.md)                       |
| Key file map            | [`docs/key-files.md`](docs/key-files.md)                                 |
| Quick reference & API   | [`docs/quick-reference.md`](docs/quick-reference.md)                     |
| Technical standards     | `docs/standards/`                                                        |
| Backlog tracking        | [GitHub Issues](https://github.com/Snoww3d/jwst-data-analysis/issues)   |
| Development roadmap     | [`docs/development-plan.md`](docs/development-plan.md)                   |
| Desktop requirements    | [`docs/plans/exploration/desktop-requirements.md`](docs/plans/exploration/desktop-requirements.md) |
| Feature ideas           | [`docs/feature-ideas.md`](docs/feature-ideas.md)                         |
| Swagger UI              | <http://localhost:5001/swagger>                                          |

## Tooling

- Run processing engine tests via Docker: `docker exec jwst-processing python -m pytest`.
- **playwright-cli** for browser automation; **@playwright/test** for CI e2e tests. These are separate tools.
