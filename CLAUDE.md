# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JWST Data Analysis Application - A microservices-based platform for analyzing James Webb Space Telescope data with advanced scientific computing capabilities.

**Architecture**: Frontend (React TypeScript) → Backend (.NET 10 API) → MongoDB + Processing Engine (Python FastAPI) → MAST Portal (STScI)

## Quick Start Commands

### Docker (Recommended for full stack)

```bash
cd docker && cp .env.example .env       # First time: copy env template
docker compose up -d                     # Start all services
docker compose logs -f                   # View logs
docker compose down                      # Stop services
docker compose up -d --build             # Rebuild after code changes
```

**Note**: `.env` is gitignored. Default values work for local dev.

**Service URLs**: Frontend :3000 | Backend :5001 | Processing :8000 | MongoDB :27017

### Git Hooks Setup (Recommended)

```bash
# Install git hooks (prevents direct pushes to main)
./scripts/setup-hooks.sh
```

This installs a pre-push hook that blocks accidental direct pushes to the `main` branch, enforcing the PR workflow.

### Backend Development (.NET 10)

```bash
cd backend
dotnet restore JwstDataAnalysis.sln                    # Restore dependencies
dotnet build JwstDataAnalysis.sln                      # Build solution
dotnet test JwstDataAnalysis.API.Tests --verbosity normal  # Run tests
cd JwstDataAnalysis.API && dotnet run                  # Run API
```

**Note**: Update MongoDB connection in `appsettings.json` if running standalone.

### Frontend Development (React + Vite)

```bash
cd frontend/jwst-frontend
npm install                              # Install dependencies
npm run dev                              # Dev server (:3000)
npm run build                            # Production build
npm run test:e2e                         # E2E tests (requires backend running)
```

**Note**: Vite dev builds. Environment variables use `VITE_` prefix.

### Processing Engine (Python)

```bash
cd processing-engine
python3 -m venv .venv && source .venv/bin/activate  # Create/activate venv
pip install -r requirements.txt          # Install dependencies
uvicorn main:app --reload                # Run server (:8000)
pytest                                   # Run tests
```

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for detailed Mermaid diagrams and visual documentation of the full system.

**Key architectural facts** (for quick reference during development):
- All DB operations go through `MongoDBService.cs` (repository pattern) — never direct MongoDB calls in controllers
- All services have interfaces for testability (e.g., `IMongoDBService`, `IMastService`, `ICompositeService`)
- Frontend state: local React hooks (useState/useEffect) + AuthContext for authentication
- Processing engine fetches data from backend API (not directly from MongoDB)
- Frontend uses SVG overlays for interactive drawing (annotations, regions, WCS grid) and canvas for high-performance rendering (histogram, curves editor)
- Collapsible panel pattern: `collapsed` + `onToggleCollapse()` props on HistogramPanel, CurvesEditor, RegionStatisticsPanel, StretchControls, CubeNavigator
- Multi-step wizard pattern: CompositeWizard and MosaicWizard both use 3-step navigation with validation

## Agent Coordination

This project uses multiple Claude Code agents working in parallel from separate git worktrees. Each agent has an assigned role. **Read this section before starting any work.**

### Agent Roles

| Worktree | Role | Scope |
|----------|------|-------|
| `Astronomy-agent-1` | **Features** | Implements new functionality and enhancements |
| `Astronomy-agent-2` | **Tech Debt & Bug Fixes** | Resolves items from `docs/tech-debt.md`, investigates and fixes reported bugs |

### Ownership Rules

1. **Stay in your lane**: Only work on tasks matching your assigned role. If you encounter work outside your scope (e.g., a feature agent finds a bug), document it but do NOT fix it — the responsible agent will handle it.

2. **Shared files — do NOT update unless you own them**:
   | File | Owner |
   |------|-------|
   | `docs/tech-debt.md` | Tech Debt & Bug Fixes agent (`agent-2`) |
   | `docs/development-plan.md` | Features agent (`agent-1`) |

3. **What you CAN always update**: Source code, tests, and config files related to your task. `CLAUDE.md` sections relevant to your changes (e.g., API Quick Reference for a new endpoint).

4. **Branch naming by role**: Use the prefix that matches your role:
   - Features: `feature/*`
   - Tech debt: `feature/task-N-*` or `fix/task-N-*`
   - Bug fixes: `fix/*`

5. **Avoid merge conflicts**: Before starting a task, run `git fetch --all` and check if another agent has an open PR touching the same files. If so, coordinate with the user.

6. **Coordinate via tracking files**: Use `tech-debt.md` and `bugs.md` to avoid overlapping work on the same files. Check for in-progress work by other agents before modifying shared files.

7. **Worktree isolation**: Each agent MUST operate in its own worktree and NEVER write files outside its assigned worktree directory. Verify paths before writing. After merging PRs, do NOT attempt to switch to main — worktrees block this.

### Isolated Docker Stacks

Each agent runs its own Docker stack on separate ports to avoid conflicts with the primary workspace.

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

The script auto-generates `.env.agent*` files on first run. Each agent gets its own MongoDB database and data directory (`data-agent1/`, `data-agent2/`).

You can also generate env files manually: `./scripts/agent-env-init.sh` (creates for all agents).

**Primary stack** (unchanged):
```bash
cd docker && docker compose up -d
```

## Development Workflow

### Current Phase: Phase 4 (Frontend & FITS Viewer Features)

**Focus**: Complete FITS visualization, image analysis tools, WCS mosaic, and frontend authentication.

See [`docs/development-plan.md`](docs/development-plan.md) for full 6-phase roadmap, completed items, and remaining work.

### Bug & Tech Debt Workflow

- When asked about 'the next bug' or 'next tech debt item', ALWAYS check `bugs.md` and `tech-debt.md` first before starting any investigation.
- Do not start generic investigation workflows — consult the tracking documents.

### Debugging Approach

- When users report errors (e.g., 401, download failures), check server logs and existing code FIRST before suggesting the user troubleshoot manually.
- Trace issues through the full stack (frontend → API → backend → processing engine) rather than stopping at the first layer.

### Verification Standards

**CRITICAL**: All implementation plans and verification steps MUST include testing using the Docker environment.
- Any feature that involves backend/frontend integration or database changes must be verified in the full Docker stack.
- "Works on my machine" (local npm/dotnet run) is insufficient for final verification.
- Always include `docker compose up -d` instructions in verification plans.

### Coding Standards

**Backend (.NET)**:
- Async/await for all database operations
- Dependency injection for services
- MongoDB.Driver for database (never direct queries)
- Nullable reference types enabled
- PascalCase for public members
- Structured logging with ILogger
- DTOs for request/response validation

**Frontend (React)**:
- TypeScript interfaces mirror backend models (keep in sync)
- Functional components with hooks
- Semantic HTML with ARIA attributes
- CSS classes (no inline styles)
- Error boundaries with try-catch
- Loading states for async operations

**Processing Engine (Python)**:
- Type hints with Pydantic models
- Async routes in FastAPI
- Astropy for FITS file handling
- NumPy for numerical operations
- pytest for testing
- **ALWAYS run `ruff check . && ruff format .` before committing** (CI will fail otherwise)

### Testing Standards

**Never Delete or Weaken Tests**:
- If tests fail due to architectural limitations (e.g., can't mock a concrete class), **fix the architecture**, not the tests
- Create interfaces for dependencies to enable proper mocking (e.g., `IMastService`, `IImportJobTracker`)
- Tests should be isolated - use mocks for external dependencies, not real instances
- Removing or simplifying tests to make them pass is never acceptable

**Test Architecture**:
- All services should have interfaces for testability (e.g., `IMongoDBService`, `IMastService`)
- Use Moq for mocking interfaces in unit tests
- Use `NullLogger<T>` only for the class under test, not for its dependencies
- Controller tests should mock all service dependencies

**When Tests Fail**:
1. Identify the root cause (missing interface, tight coupling, etc.)
2. Fix the architectural issue first
3. Keep the original test logic intact
4. Add the fix as a separate commit with clear explanation

**Gotchas**:
- JSON casing: backend uses snake_case, frontend uses camelCase. Verify DTO mapping when connecting new endpoints.
- Vitest mock hoisting: fix mocks systematically rather than iterating blindly.
- Python processing engine uses 3.10+ syntax — do not use 3.9 patterns.
- Always run the full test suite before committing.

### Code Quality Tools

**Frontend (ESLint + Prettier)**:
```bash
cd frontend/jwst-frontend
npm run lint          # Check for linting issues
npm run lint:fix      # Auto-fix linting issues
npm run format        # Format code with Prettier
npm run format:check  # Check formatting without changes
```

**Backend (.NET Analyzers)**:
```bash
cd backend/JwstDataAnalysis.API
dotnet build          # Analyzers run automatically during build
dotnet format         # Format code according to .editorconfig
```
Configured analyzers: StyleCop.Analyzers, Microsoft.CodeAnalysis.NetAnalyzers

**Processing Engine (Ruff)**:
```bash
cd processing-engine
ruff check .          # Lint Python code
ruff check --fix .    # Auto-fix lint issues
ruff format .         # Format Python code
ruff format --check . # Check formatting without changes
```

**Pre-commit Hooks** (optional):
```bash
# Install pre-commit (one-time)
pip install pre-commit
pre-commit install

# Run on all files
pre-commit run --all-files
```

**CI Integration**: All linting checks run in GitHub Actions on every PR.

**Pre-PR Checklist**:
- Always run compliance checks (`/compliance-check`) before finalizing PRs.
- Prettier may need a second pass — run formatting before committing.
- Ensure analyzer warnings are resolved for clean builds.

### Security Notes

**Environment Configuration**:
- All credentials are configured via environment variables in `docker/.env`
- Copy `docker/.env.example` to `docker/.env` and customize values
- The `.env` file is gitignored and should never be committed
- Default values in docker-compose.yml are for local development only

**Processing Engine Resource Limits** (DoS protection):
- `MAX_FITS_FILE_SIZE_MB`: Maximum FITS file size in MB (default: 2048 = 2GB)
- `MAX_FITS_ARRAY_ELEMENTS`: Maximum array elements before loading (default: 100000000 = 100M pixels)
- `MAX_MOSAIC_OUTPUT_PIXELS`: Maximum mosaic output grid size in pixels (default: 64000000 = 64M pixels)
- Files/arrays exceeding limits return HTTP 413 Payload Too Large

**Before Production**:
- Set strong, unique `MONGO_ROOT_PASSWORD` in `.env`
- Review authentication configuration for production requirements
- Review CORS configuration for production (see Task #19, resolved in PR #78)
- Remove or change passwords for any seed accounts created during development (`admin`/`demo`)
- Review all environment variables for production values

**MCP Server Security Policy**:

This project does NOT require any MCP (Model Context Protocol) servers for its core functionality. The following policies apply:

| Policy | Rule |
|--------|------|
| **No MCP server installation** | The `mcp-add`, `mcp-config-set` permissions are explicitly denied in `.claude/settings.local.json` |
| **No credential embedding** | Never store API tokens, passwords, or secrets in MCP config files. Use Docker secrets or environment variables |
| **Approved MCP tools only** | If MCP tools are needed in future, they must be explicitly documented here and added to settings.local.json |

**If you need MCP servers** (e.g., for MongoDB management via MCP_DOCKER):
1. Document the specific tools required and their purpose
2. Add only the minimum required tool permissions to `.claude/settings.local.json`
3. Store any credentials using Docker secrets:
   ```bash
   docker mcp secret set SECRET_NAME
   ```
4. Reference secrets in config instead of embedding values

**Currently Approved MCP Tools**: None (project uses direct API calls and Docker Compose services)

### Git Workflow

> ⛔ **ABSOLUTE RULE**: Every change to the codebase—including documentation-only
> fixes—MUST go through a feature branch and PR. Direct pushes to `main` bypass
> CI checks, skip user review, and make rollbacks harder. No exceptions.

> 🔒 **BRANCH-FIRST RULE**: Before making ANY file edits (Edit, Write tools), you MUST:
> 1. Run `git status` to confirm current branch and state
> 2. Create the feature branch: `git checkout -b feature/name`
> 3. ONLY THEN begin making file changes
>
> This prevents accidental work on `main` and ensures all changes are tracked from the start.

> 🧹 **NO DANGLING CHANGES RULE**: After completing a PR, run `git status` to check for uncommitted changes.
> - If changes exist, do NOT leave them dangling - resolve them immediately:
>   - **Related to completed work?** → Should have been in the PR. Create a follow-up PR now.
>   - **Separate concern?** → Create a separate PR or explicitly flag to user for decision.
>   - **Not needed?** → Discard with `git restore <file>` or `git clean -fd` for untracked files.
> - Never proceed to new tasks with uncommitted changes lingering.

- **NEVER** push directly to `main`. Not even for "quick fixes" or "just docs".
- **ALWAYS** create a feature branch first, then push and create a PR.
- **ALWAYS check CI tests pass before merging** (`gh pr checks <pr-number>`).
- **ALWAYS include documentation updates in the same PR**.
- Workflow:
    1. Create feature branch (`git checkout -b feature/name`)
    2. Make changes AND update relevant documentation:
       - Update `CLAUDE.md` with new API endpoints, features, or usage patterns
       - Update `docs/development-plan.md` to mark completed items
       - Update `docs/standards/*.md` for model/API/frontend changes
    3. Commit changes (`git commit`)
    4. Push to origin (`git push ...`)
    5. **IMMEDIATELY** create PR (`gh pr create ...`)
    6. **Wait for CI to pass**: Check status with `gh pr checks <pr-number>`
    7. **STOP for user review**: Open PR in browser (`gh pr view --web`), report PR URL and CI status, wait for user approval
    8. **Only merge after user approves**: `gh pr merge <pr-number> --merge --delete-branch`
    9. After merge, cleanup branches:
       - Switch to main and pull: `git checkout main && git pull`
       - Delete local merged branches: `git branch -d branch-name`
       - Prune stale remote refs: `git fetch --prune`
- Feature branches for development
- Conventional commit messages
- Atomic, focused commits

### Agentic Workflows & Skills

We use two types of automation: **workflows** for development processes and **skills** for utility actions.

#### Workflows (Code Changes + PR)

> ⛔ **MANDATORY**: ALL changes to tracked files MUST use a workflow. No exceptions for "quick fixes", "just docs", or "simple changes". This ensures proper task tracking, consistent branch naming, and full audit trail.

Workflows are multi-step development processes with git integration. Located in `.agent/workflows/`.

| Workflow | Purpose | Branch Prefix |
| :--- | :--- | :--- |
| `/create-feature` | New features or capabilities | `feature/` |
| `/fix-bug` | Bug fixes with reproduction | `fix/` |
| `/resolve-tech-debt` | Items from `docs/tech-debt.md` | `feature/task-N-` |

**Workflow Selection Guide** - Use this to choose the correct workflow:

| Change Type | Workflow | Example |
| :--- | :--- | :--- |
| New functionality | `/create-feature` | Add pagination, new API endpoint |
| New documentation | `/create-feature` | Add security policy, new guide |
| Bug fix | `/fix-bug` | Fix null reference, correct calculation |
| Security fix | `/fix-bug` | Path traversal fix, input validation |
| Refactoring | `/resolve-tech-debt` | Extract service, rename variables |
| Performance improvement | `/resolve-tech-debt` | Add caching, optimize query |
| Dependency update | `/resolve-tech-debt` | Update packages, fix deprecations |
| Config/settings change | `/create-feature` | New environment variable, config option |

All workflows include: Branch → Implement → Quality Checks → E2E Verification → PR → Interactive Review → Merge

#### Skills (Quick Utilities)

Skills are simple, single-purpose commands. No git branches or PRs. Located in `~/.claude/commands/`.

| Skill | Purpose |
| :--- | :--- |
| `/start-application` | Start the full Docker stack |
| `/view-docs` | Open documentation site in browser |
| `/keybindings-help` | Customize keyboard shortcuts |
| `/compliance-check` | Run all quality checks before PR merge |

**Rule of thumb**: If it changes tracked files → workflow. If it's a helper action → skill.

> **Proactive Compliance**: Claude should automatically run `/compliance-check` before asking the user to review or merge a PR. Don't wait to be asked.

### Task Tracking

Use Claude Code's task system for tracking work items, tech debt, and multi-step implementations.

**Storage**: `~/.claude/tasks/<session-id>/*.json` (persists across sessions)

**When to use tasks**:
- Tech debt and bug tracking (with dependencies)
- Multi-step implementations
- Code review findings
- Any work that spans multiple sessions

### Editor
- **Primary Editor**: Google Antigravity IDE
- **Command**: `agy` (opens the current workspace)

**Standard: 1 Task = 1 PR**

Each task gets its own feature branch and PR. This ensures:
- Atomic, reviewable changes
- Clear commit history linked to tasks
- Easy rollback if needed

**Task → PR workflow**:
```bash
# 1. Start task
TaskUpdate taskId="1" status="in_progress"

# 2. Create feature branch
git checkout -b fix/task-1-description   # or feature/task-N-...

# 3. Make changes and commit
git add <files>
git commit -m "fix: Description (Task #1)"

# 4. Push and create PR
git push -u origin fix/task-1-description
gh pr create --title "fix: Description (Task #1)" --body "..."

# 5. Execute test plan (REQUIRED before user review)
# - Run ALL items in the PR's test plan using Docker environment
# - Document results (pass/fail) for each test item
# - If a test item CANNOT be executed (e.g., requires specific hardware,
#   user credentials, or manual UI interaction), clearly note this

# 6. Wait for CI, open PR for user review
gh pr checks <pr-number>
gh pr view <pr-number> --web
# STOP: Report PR URL, CI status, test results, and prompt user:
#   "PR ready for review: <url>
#    CI: passing/pending/failing
#    Test plan results:
#      ✅ Test 1 - passed
#      ✅ Test 2 - passed
#      ⚠️ Test 3 - could not execute (reason: requires manual UI interaction)
#    → Review in GitHub, then reply 'merge' or request changes"

# 7. After user approves: merge
gh pr merge <pr-number> --merge --delete-branch

# 8. Mark task complete
TaskUpdate taskId="1" status="completed"

# 9. Cleanup
git checkout main && git pull
git fetch --prune
```

**Branch naming**: `{type}/task-{N}-{short-description}`
- `fix/task-1-path-traversal-preview`
- `feature/task-12-api-service-layer`
- `refactor/task-6-mast-import-code`

**PR title format**: `{type}: Description (Task #N)`

**Task structure**:
```json
{
  "id": "1",
  "subject": "Brief title",
  "description": "Full details with **Location**, **Issue**, **Fix**",
  "status": "pending|in_progress|completed",
  "blocks": ["2"],
  "blockedBy": ["3"],
  "metadata": { "priority": "critical", "category": "security" }
}
```

**Current tech debt**: See `docs/tech-debt.md` for full details, run `/tasks` for status.

### Documentation Files to Update

When features are added or changed, update these files:

| Change Type | Files to Update |
|-------------|-----------------|
| New API endpoint | `docs/quick-reference.md` (API section), `docs/standards/backend-development.md` |
| New data model field | `docs/standards/database-models.md`, `docs/standards/backend-development.md` |
| New frontend feature | `docs/standards/frontend-development.md` |
| Phase completion | `docs/development-plan.md` |
| New TypeScript type | `docs/standards/frontend-development.md` |
| Tech debt / bugs | Create task with `TaskCreate`, update `docs/tech-debt.md` for critical items |
| Code review finding | Create task with dependencies, add to `docs/tech-debt.md` if significant |
| **Any feature change** | `docs/desktop-requirements.md` (keep desktop spec in sync) |

> **Desktop Requirements Sync**: The `docs/desktop-requirements.md` document captures all features as platform-agnostic requirements for a future desktop version. When adding or modifying features, update the corresponding functional requirements (FR-*) in that document to keep the desktop spec aligned with the web implementation.

## Key Files, Patterns & API Reference

See [`docs/key-files.md`](docs/key-files.md) for the full file listing (all controllers, services, models, components, types, utilities).

See [`docs/quick-reference.md`](docs/quick-reference.md) for common patterns (adding endpoints, algorithms, models), API endpoints, troubleshooting, and MAST usage tips.

**Swagger UI**: http://localhost:5001/swagger

## Capturing Ideas & Random Thoughts

The project includes a comprehensive system for capturing feature ideas and random thoughts from any device, including mobile.

**Storage**: All ideas go into [`docs/feature-ideas.md`](docs/feature-ideas.md)

### Quick Methods

**From Phone** (GitHub Mobile/Web):
1. Open GitHub app → Navigate to `docs/feature-ideas.md`
2. Tap "Edit" → Add your idea at the bottom
3. Commit directly to main (for quick notes)

**From Desktop** (Scripts):
```bash
# Quick one-liner
./scripts/quick-idea.sh "Add spectral line detection tool"

# Interactive with full details
./scripts/add-idea.sh
```

**From Claude Code**:
Simply ask: "Add this to feature ideas: [your idea]"

### Comprehensive Guide

See [`docs/idea-capture-guide.md`](docs/idea-capture-guide.md) for:
- Complete workflow examples
- Mobile app setup instructions
- Voice input tips
- Integration with development process
- Idea template and categories

**Philosophy**: Capture ideas anywhere, anytime. No friction, no barriers. Ideas in markdown become permanent context for future AI sessions.

## Cloud / Phone Sessions

This project is sometimes accessed from **cloud Claude Code sessions** (e.g., phone). These sessions have access to the full repo and CLAUDE.md context but **do not** have local skills (`/add-idea`, `/compliance-check`, etc.) or Docker.

### Critical Rule: Always Commit and Push

Cloud sessions are ephemeral — **any uncommitted changes are lost when the session ends**. After editing any file:

```bash
git add <files>
git commit -m "docs: <description>"
git checkout -b docs/<short-name>
git push -u origin docs/<short-name>
gh pr create --title "docs: <description>" --body "Docs-only update from phone"
# Then merge immediately (docs PRs don't need review):
gh pr merge --merge --delete-branch
```

> **Why a branch?** The pre-push hook blocks direct pushes to `main`. Use a quick `docs/` branch, create a PR, and merge it immediately. This takes 30 seconds and avoids the hook.

### Quick Capture Commands

**Add a tech debt item** — append to `docs/tech-debt.md` under "Remaining Tasks", using the next available task number (check "Adding New Tech Debt" section at bottom of file for current number). Format:

```markdown
### {N}. {Title}
**Priority**: {Critical|High|Medium|Low|Nice to Have}
**Location**: `{file path}`
**Category**: {Category}

**Issue**: {Description}

**Fix Approach**:
1. {Step}

---
```

**Add a feature idea** — append to `docs/feature-ideas.md` under "Submitted Ideas".

**Add a bug** — append to `docs/bugs.md`.

### What Cloud Sessions Cannot Do

- Run Docker or local services
- Execute custom skills (`/add-idea`, `/start-application`, etc.)
- Access agent worktrees (`Astronomy-agent-1`, `Astronomy-agent-2`)
- Run tests (no Docker = no test environment)

Stick to documentation edits, idea capture, and planning work.

## Known Issues / Tech Debt

See [`docs/tech-debt.md`](docs/tech-debt.md) for the authoritative list of tech debt items, security issues, and their resolution status.

**Quick stats**: 50 resolved | 31 remaining (as of 2026-02-07)

Run `/tasks` to see current status and dependencies.
