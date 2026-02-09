# AGENTS.md

> **AI-Assisted Development**: This project is built with multiple AI coding agents
> (Claude Code, Codex) working in parallel from isolated git worktrees.
> This file defines the shared rules they follow. It is intentionally committed
> to the public repository as part of the project's development methodology.

Primary guidance for all coding agents working in this repository.

## Scope and Precedence

- This file defines shared workflow, process, and project expectations for every agent.
- Tool-specific config files (gitignored) may add tips specific to individual tool capabilities.
- If a tool-specific file conflicts with this file on shared process rules, **this file wins**.

## Default Collaboration Style (All Agents)

- Default to constructive challenge, not agreement-first responses.
- Before endorsing an idea, surface the strongest practical reasons it could fail (risk, cost, maintenance, security, or complexity).
- Offer at least one lower-cost alternative when the proposed approach is heavy or premature.
- State clear go/no-go criteria when giving recommendations so decisions are testable.
- If evidence is weak, say so directly and recommend validation steps instead of optimistic assumptions.

## Project Overview

JWST Data Analysis Application — a microservices-based platform for analyzing James Webb Space Telescope data with advanced scientific computing capabilities.

**Architecture**: Frontend (React TypeScript) → Backend (.NET 10 API) → MongoDB + Processing Engine (Python FastAPI) → MAST Portal (STScI)

**Service URLs** (local Docker):

| Service | URL | Tech |
|---------|-----|------|
| Frontend | :3000 | React + Vite + TypeScript |
| Backend API | :5001 | .NET 10 REST API |
| Processing Engine | :8000 | Python FastAPI |
| MongoDB | :27017 | Document database |
| Documentation | :8001 | MkDocs |

## Architecture Notes

See [`docs/architecture.md`](docs/architecture.md) for detailed diagrams.

Key facts for development:

- All DB operations go through `MongoDBService.cs` (repository pattern) — never direct MongoDB calls in controllers.
- All services have interfaces for testability (e.g. `IMongoDBService`, `IMastService`, `ICompositeService`).
- Frontend state: local React hooks (useState/useEffect) + AuthContext for authentication.
- Processing engine fetches data from backend API (not directly from MongoDB).
- Frontend uses SVG overlays for interactive drawing (annotations, regions, WCS grid) and canvas for high-performance rendering (histogram, curves editor).
- Collapsible panel pattern: `collapsed` + `onToggleCollapse()` props on HistogramPanel, CurvesEditor, RegionStatisticsPanel, StretchControls, CubeNavigator.
- Multi-step wizard pattern: CompositeWizard and MosaicWizard both use 3-step navigation with validation.

## Current Development Phase

**Phase 4** — Frontend & FITS Viewer Features.

**Focus**: Complete FITS visualization, image analysis tools, WCS mosaic, and frontend authentication.

See [`docs/development-plan.md`](docs/development-plan.md) for full 6-phase roadmap, completed items, and remaining work.

## Quick Start (Docker — Recommended)

```bash
cd docker && cp .env.example .env       # First time: copy env template
docker compose up -d                     # Start all services
docker compose logs -f                   # View logs
docker compose down                      # Stop services
docker compose up -d --build             # Rebuild after code changes
```

`.env` is gitignored. Default values work for local dev. See [`docs/setup-guide.md`](docs/setup-guide.md) for full setup including default credentials.

### Git Hooks (Recommended)

```bash
./scripts/setup-hooks.sh   # Installs pre-push hook that blocks direct pushes to main
```

### Service-Specific Development

**Backend (.NET 10)**:
```bash
cd backend
dotnet restore JwstDataAnalysis.sln
dotnet build JwstDataAnalysis.sln
dotnet test JwstDataAnalysis.API.Tests --verbosity normal
cd JwstDataAnalysis.API && dotnet run
```

**Frontend (React + Vite)**:
```bash
cd frontend/jwst-frontend
npm install
npm run dev         # Dev server on :3000
npm run build       # Production build
```

**Processing Engine (Python)**:
```bash
cd processing-engine
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload    # Server on :8000
pytest
```

## Core Workflow Rules

- **Never push directly to `main`** — not even for "quick fixes" or docs-only changes.
- Every change goes through a **feature branch + PR**.
- Use **conventional commit prefixes**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Do **not merge without explicit maintainer approval**.
- Keep commits **focused and atomic**.

### Branch-First Rule

Before making any file edits:
1. Run `git status` to confirm current branch and state.
2. Create the feature branch: `git checkout -b <type>/<short-description>`.
3. Only then begin making changes.

This prevents accidental work on `main`.

### No Dangling Changes

After completing a PR, run `git status` and resolve any uncommitted changes immediately:
- Related to completed work → follow-up PR.
- Separate concern → separate PR or flag for maintainer decision.
- Not needed → discard with `git restore` / `git clean`.

Never proceed to new tasks with uncommitted changes lingering.

## Standard Git Flow

```bash
git status                                          # Confirm clean state
git checkout -b <type>/<short-description>          # Create branch

# Make changes and commit
git add <specific-files>
git commit -m "<type>: <summary>"

# Push and create PR
git push -u origin <branch>
gh pr create --title "<type>: Summary" --body "..."

# Wait for CI, then request review
gh pr checks <pr-number>
# STOP — report PR URL, CI status, wait for maintainer approval

# After approval
gh pr merge <pr-number> --merge --delete-branch
```

### Branch Naming

`{type}/{short-description}` or `{type}/task-{N}-{short-description}`

Examples:
- `feature/spectral-line-tool`
- `fix/task-3-auth-refresh-loop`
- `refactor/task-6-mast-import`
- `docs/expand-agents-md`

### PR Title Format

`{type}: Description` or `{type}: Description (Task #N)`

### 1 Task = 1 PR

Each task gets its own feature branch and PR. This ensures atomic, reviewable changes, clear commit history, and easy rollback.

## Pre-PR Checklist

Before creating a PR, verify:

1. **Linting passes** — run relevant quality tools (see [Code Quality Tools](#code-quality-tools)).
2. **Tests pass** — `dotnet test`, `npm run test`, `pytest` as applicable.
3. **Docker verification** — for integration/backend changes, rebuild and test in Docker (`docker compose up -d --build`).
4. **Documentation updated** — update relevant docs if the change affects APIs, features, models, or milestones (see [Documentation Expectations](#documentation-expectations)).
5. **Test plan executed** — run all items in the PR's test plan using the Docker environment. Document results (pass/fail). If a test item cannot be executed (e.g. requires manual UI interaction), note that clearly.

## Agent Coordination

This project uses multiple agents working in parallel from separate **git worktrees**. Each agent has an assigned role.

### Agent Roles

| Worktree | Role | Scope |
|----------|------|-------|
| `<repo>-agent-1` | **Features** | New functionality and enhancements |
| `<repo>-agent-2` | **Tech Debt & Bug Fixes** | Items from `docs/tech-debt.md`, bug investigation and fixes |

Worktrees are siblings of the primary clone (e.g. if the primary is at `~/Source/Astronomy`, agent 1 is at `~/Source/Astronomy-agent-1`).

### Ownership Rules

1. **Stay in your lane** — only work on tasks matching your role. If you find work outside your scope (e.g. a feature agent finds a bug), document it but do NOT fix it.

2. **Shared file ownership**:

   | File | Owner |
   |------|-------|
   | `docs/tech-debt.md` | Agent 2 (Tech Debt & Bug Fixes) |
   | `docs/development-plan.md` | Agent 1 (Features) |

3. **What every agent can update**: Source code, tests, and config files related to your task. Documentation sections relevant to your changes.

4. **Branch naming by role**:
   - Features agent: `feature/*`
   - Tech debt agent: `feature/task-N-*` or `fix/task-N-*`
   - Bug fixes: `fix/*`

5. **Avoid merge conflicts** — before starting a task, `git fetch --all` and check if another agent has an open PR touching the same files. If so, coordinate with the maintainer.

6. **Coordinate via tracking files** — use `docs/tech-debt.md` and `docs/bugs.md` to avoid overlapping work.

7. **Worktree isolation** — each agent MUST operate only in its own worktree. Never write files outside the assigned worktree directory. After merging PRs, do NOT switch to `main` — worktrees block this. Confirm merge via `gh pr view` and stay on the current branch.

### Isolated Docker Stacks

Each agent runs its own Docker stack on separate ports to avoid conflicts.

| Stack | Project Name | Frontend | Backend | Processing | MongoDB |
|-------|-------------|----------|---------|------------|---------|
| **Primary** (user) | `jwst` | :3000 | :5001 | :8000 | :27017 |
| **Agent 1** | `jwst-agent1` | :3010 | :5011 | :8010 | :27027 |
| **Agent 2** | `jwst-agent2` | :3020 | :5021 | :8020 | :27037 |

**Agent commands** (via helper script):
```bash
./scripts/agent-docker.sh up 1       # Start Agent 1's stack
./scripts/agent-docker.sh down 2     # Stop Agent 2's stack
./scripts/agent-docker.sh logs 1     # Tail Agent 1's logs
./scripts/agent-docker.sh restart 1  # Rebuild and restart
./scripts/agent-docker.sh exec 1 processing python -m pytest  # Run tests
```

The script auto-generates `.env.agent*` files on first run. Each agent gets its own MongoDB database and data directory.

## Coding Standards

### Backend (.NET)

- Async/await for all database operations
- Dependency injection for services
- MongoDB.Driver for database access (never direct queries)
- Nullable reference types enabled
- PascalCase for public members
- Structured logging with ILogger
- DTOs for request/response validation
- JSON casing: backend uses **snake_case** — verify DTO mapping when connecting new endpoints

### Frontend (React)

- TypeScript interfaces mirror backend models (keep in sync)
- Functional components with hooks
- Semantic HTML with ARIA attributes
- CSS classes (no inline styles)
- Error boundaries with try-catch
- Loading states for async operations
- JSON casing: frontend uses **camelCase**

### Processing Engine (Python)

- Type hints with Pydantic models
- Async routes in FastAPI
- Astropy for FITS file handling
- NumPy for numerical operations
- pytest for testing
- Uses **Python 3.10+ syntax** — do not use 3.9 patterns
- **Always run `ruff check . && ruff format .` before committing** (CI will fail otherwise)

## Testing Standards

### Never Delete or Weaken Tests

- If tests fail due to architectural limitations (e.g. can't mock a concrete class), **fix the architecture**, not the tests.
- Create interfaces for dependencies to enable proper mocking.
- Removing or simplifying tests to make them pass is never acceptable.

### Test Architecture

- All services should have interfaces for testability (e.g. `IMongoDBService`, `IMastService`).
- Use Moq for mocking interfaces in .NET unit tests.
- Use `NullLogger<T>` only for the class under test, not for its dependencies.
- Controller tests should mock all service dependencies.

### When Tests Fail

1. Identify the root cause (missing interface, tight coupling, etc.).
2. Fix the architectural issue first.
3. Keep the original test logic intact.
4. Add the fix as a separate commit with clear explanation.

### Gotchas

- **JSON casing mismatch**: backend snake_case vs frontend camelCase. Verify DTO mapping for new endpoints.
- **Python processing engine** uses 3.10+ syntax — do not use 3.9 patterns.
- Always run the **full test suite** before committing.

## Code Quality Tools

### Frontend (ESLint + Prettier)
```bash
cd frontend/jwst-frontend
npm run lint          # Check for linting issues
npm run lint:fix      # Auto-fix linting issues
npm run format        # Format code with Prettier
npm run format:check  # Check formatting without changes
```

### Backend (.NET Analyzers)
```bash
cd backend/JwstDataAnalysis.API
dotnet build          # Analyzers run automatically during build
dotnet format         # Format code according to .editorconfig
```

### Processing Engine (Ruff)
```bash
cd processing-engine
ruff check .          # Lint Python code
ruff check --fix .    # Auto-fix lint issues
ruff format .         # Format Python code
```

CI runs all linting checks on every PR.

## Security Notes

### Environment Configuration

- All credentials are configured via environment variables in `docker/.env`.
- `.env` is gitignored and should never be committed. Copy from `.env.example`.
- Default values in docker-compose.yml are for local development only.

### Processing Engine Resource Limits (DoS Protection)

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_FITS_FILE_SIZE_MB` | 2048 (2 GB) | Maximum FITS file size |
| `MAX_FITS_ARRAY_ELEMENTS` | 100,000,000 | Maximum array elements before loading |
| `MAX_MOSAIC_OUTPUT_PIXELS` | 64,000,000 | Maximum mosaic output grid size |

Files/arrays exceeding limits return HTTP 413 Payload Too Large.

### Before Production

- Set a strong, unique `MONGO_ROOT_PASSWORD` in `.env`.
- Review authentication configuration for production requirements.
- Review CORS configuration for production.
- Remove or change passwords for any seed accounts (`admin`/`demo`).
- Review all environment variables for production values.

## Bug & Tech Debt Workflow

- When asked about "the next bug" or "next tech debt item", **always check** `docs/bugs.md` and `docs/tech-debt.md` first. Do not start generic investigation workflows.
- Auth flow is currently fragile — be extra careful when touching it.

### Debugging Approach

- When errors are reported (e.g. 401, download failures), check server logs and existing code **first** before suggesting the user troubleshoot manually.
- Trace issues through the full stack (frontend → API → backend → processing engine) rather than stopping at the first layer.

## Documentation Expectations

Update docs when behavior changes:

| Change Type | Files to Update |
|-------------|-----------------|
| New API endpoint | `docs/quick-reference.md`, `docs/standards/backend-development.md` |
| New data model field | `docs/standards/database-models.md`, `docs/standards/backend-development.md` |
| New frontend feature | `docs/standards/frontend-development.md` |
| Phase completion | `docs/development-plan.md` |
| New TypeScript type | `docs/standards/frontend-development.md` |
| Tech debt / bugs | Update `docs/tech-debt.md` or `docs/bugs.md` |
| **Any feature change** | `docs/desktop-requirements.md` (keep desktop spec in sync) |

> **Desktop Requirements Sync**: `docs/desktop-requirements.md` captures all features as platform-agnostic requirements for a future desktop version. When adding or modifying features, update the corresponding functional requirements (FR-*) to keep the spec aligned.

## Authoritative Project References

| Resource | Location |
|----------|----------|
| Setup and local runbook | [`docs/setup-guide.md`](docs/setup-guide.md) |
| Architecture and flows | [`docs/architecture.md`](docs/architecture.md) |
| Key file map | [`docs/key-files.md`](docs/key-files.md) |
| Quick reference & API | [`docs/quick-reference.md`](docs/quick-reference.md) |
| Technical standards | `docs/standards/` |
| Backlog tracking | [`docs/tech-debt.md`](docs/tech-debt.md), [`docs/bugs.md`](docs/bugs.md) |
| Development roadmap | [`docs/development-plan.md`](docs/development-plan.md) |
| Desktop requirements | [`docs/desktop-requirements.md`](docs/desktop-requirements.md) |
| Feature ideas | [`docs/feature-ideas.md`](docs/feature-ideas.md) |
| Swagger UI | http://localhost:5001/swagger |

## Tooling Notes

- Prefer repository scripts and standard CLI commands over tool-specific slash commands.
- Keep instructions repository-relative and portable; avoid machine-specific absolute paths in shared docs.
- Run processing engine tests via Docker (local macOS Python may be too old): `docker exec jwst-processing python -m pytest`.

### Browser Automation (playwright-cli)

- **playwright-cli** is used for agent-driven browser automation and screenshot capture. Config: `playwright-cli.json`.
- **@playwright/test** (in `frontend/jwst-frontend/`) remains the CI test runner for e2e tests. These are separate tools.
- Capture documentation screenshots: `./scripts/capture-screenshots.sh` (requires Docker stack running).
- The screenshot script handles auth injection (registers a temp user, sets localStorage tokens).
- Use `--headed` flag for visible browser debugging.
- playwright-cli is installed globally (`npm install -g @playwright/cli@latest`) to avoid version conflicts with @playwright/test v1.49.
