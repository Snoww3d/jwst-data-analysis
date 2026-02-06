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

## Architecture Deep Dive

> **Visual Diagrams**: See [`docs/architecture.md`](docs/architecture.md) for Mermaid diagrams of system architecture, data flows, and component hierarchies.

### Data Flow Architecture

**Local Upload Flow:**
1. **Upload**: User uploads JWST data (FITS, CSV, JSON, etc.) via React frontend
2. **Ingestion**: .NET API validates and stores metadata in MongoDB
3. **Storage**: Binary data stored (file path referenced), metadata in MongoDB document
4. **Processing**: User triggers processing → API calls Python engine → Results stored back in MongoDB
5. **Visualization**: Frontend fetches processed data and displays results

**MAST Import Flow:**
1. **Search**: User searches MAST portal via frontend (target name, coordinates, observation ID, or program ID)
2. **Query**: Backend proxies request to Python engine → astroquery.mast queries STScI archive
3. **Results**: Search results displayed in frontend table with observation details
4. **Import**: User selects observations → Backend triggers chunked download via Python engine
5. **Chunked Download**: Files downloaded in 5MB chunks with HTTP Range headers, parallel downloads (3 concurrent)
6. **Progress Tracking**: Real-time byte-level progress with speed (MB/s) and ETA displayed in UI
7. **Resume Support**: Interrupted downloads can be resumed from last byte position
8. **Record Creation**: Backend creates MongoDB records with file paths and extracted metadata
9. **Available**: Imported data appears in main dashboard with file type indicators (image vs table)

### MongoDB Document Structure

The application uses a **flexible document schema** to accommodate different JWST data types:

- **Core Document**: JwstDataModel with base fields (id, fileName, dataType, uploadDate, status)
- **Polymorphic Metadata**: Based on dataType, includes:
  - `ImageMetadata`: width, height, wavelength, filter, instrument, WCS coordinates
  - `SensorMetadata`: samplingRate, integrationTime, detectorType
  - `SpectralMetadata`: grating, wavelengthRange, spectralFeatures, signalToNoise
  - `CalibrationMetadata`: calibrationType, referenceStandards, validityPeriod
- **Processing Results**: Embedded array of results with algorithm name, parameters, and output paths
- **Versioning**: Parent-child relationships via `parentDataId` and `derivedFromId`
- **Lineage Tracking**: ProcessingLevel (L1/L2a/L2b/L3), ObservationBaseId, ExposureId for grouping related files

**Key Design**: Document model allows evolving schemas without migrations, critical for scientific data with varying metadata requirements.

### Backend Service Layer

**MongoDBService.cs** (~450 lines) acts as the **repository pattern** abstraction:

- All database operations go through this service (never direct MongoDB calls in controllers)
- Supports complex queries: filters by type, status, user, tags, date range, file size
- Aggregation pipeline for statistics and faceted search
- Bulk operations for efficiency (batch tag/status updates)
- Lineage queries: GetLineageTreeAsync, GetLineageGroupedAsync
- Async operations throughout

**Controllers**:
- **JwstDataController**: Main CRUD + search/filter/process endpoints
- **DataManagementController**: Advanced features (faceted search, export, bulk operations, statistics)
- **MastController**: MAST portal integration (search, download, import)

**Services** (all have interfaces for testability):
- **IMongoDBService / MongoDBService**: Repository pattern for all database operations
- **IMastService / MastService**: HTTP client wrapper for Python processing engine communication
- **IImportJobTracker / ImportJobTracker**: Tracks MAST import job progress and cancellation

### Frontend Component Architecture

**Component Hierarchy**:
```
App.tsx (root)
  └── JwstDataDashboard.tsx (main UI)
      ├── Search/Filter Controls
      ├── View Mode Toggle (Grid | List | Grouped | Lineage)
      ├── MAST Search Toggle Button
      ├── MastSearch.tsx (MAST portal integration)
      │   ├── Search Type Selector (target/coordinates/observation/program)
      │   ├── Search Input Fields
      │   ├── Results Table with Import Buttons
      │   └── Bulk Import Functionality
      ├── Upload Modal (TODO: implementation pending)
      ├── MosaicWizard.tsx (WCS mosaic generation)
      │   ├── Step 1: Multi-file selection (2+ FITS files)
      │   ├── Step 2: Settings + SVG footprint preview (RA/Dec coverage)
      │   └── Step 3: Generate mosaic + download (PNG/JPEG export)
      ├── Data Views:
      │   ├── Grid View (cards)
      │   ├── List View (table)
      │   ├── Grouped View (by data type)
      │   └── Lineage View (tree hierarchy by processing level)
      └── Processing Action Buttons
```

**State Management**: Local component state with React hooks (useState/useEffect), no Redux/Context yet

**API Integration**:
- Centralized service layer in `src/services/`
- `apiClient.ts`: Core HTTP client with automatic error handling
- `jwstDataService.ts`: JWST data operations (CRUD, processing, archive)
- `mastService.ts`: MAST search and import operations
- `ApiError.ts`: Typed error class with status codes
- Base URL configured in `config/api.ts`

### Processing Engine Architecture

**Current State** (Phase 3 in progress):
- FastAPI application with placeholder algorithm implementations
- Three algorithm types: `basic_analysis`, `image_enhancement`, `noise_reduction`
- **MAST Integration**: Full search and download capabilities via astroquery
- **Chunked Downloads**: HTTP Range header support with resume capability
- **TODO**: Actual FITS processing, algorithm implementations

**MAST Module** (`app/mast/`):
- `mast_service.py`: MastService class wrapping astroquery.mast
- `models.py`: Pydantic request/response models
- `routes.py`: FastAPI router with search, download, and chunked download endpoints
- `chunked_downloader.py`: Async HTTP downloads with Range headers, parallel file support
- `download_state_manager.py`: JSON-based state persistence for resume capability
- `download_tracker.py`: Byte-level progress tracking with speed/ETA calculations
- Uses `astroquery==0.4.7` for MAST portal queries, `aiohttp` for async downloads

**Design Pattern**:
- Processing endpoint receives: `{ data_id, algorithm_name, parameters }`
- MAST endpoints receive: `{ target_name, radius }` or `{ ra, dec, radius }` or `{ obs_id }`
- Chunked downloads use 5MB chunks with 3 parallel file downloads
- State persisted to JSON for resume after interruption
- Fetches data from backend API (not directly from MongoDB)
- Processes using scientific libraries
- Returns results to backend for storage

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
- Implement authentication/authorization (Phase 2 placeholder exists)
- Update CORS to whitelist specific origins (Task #19)
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
- Current branch: `main`

### 10. Agentic Workflows & Skills

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
- **[Tech Debt #17: Histogram Range View](file:///Users/shanon/.claude/plans/zesty-dreaming-rocket.md)** - Plan for improving histogram visualization
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
| New API endpoint | `CLAUDE.md` (API Quick Reference), `docs/standards/backend-development.md` |
| New data model field | `CLAUDE.md`, `docs/standards/database-models.md`, `docs/standards/backend-development.md` |
| New frontend feature | `CLAUDE.md`, `docs/standards/frontend-development.md` |
| Phase completion | `docs/development-plan.md` |
| New TypeScript type | `docs/standards/frontend-development.md` |
| Tech debt / bugs | Create task with `TaskCreate`, update `docs/tech-debt.md` for critical items |
| Code review finding | Create task with dependencies, add to `docs/tech-debt.md` if significant |
| **Any feature change** | `docs/desktop-requirements.md` (keep desktop spec in sync) |

> **Desktop Requirements Sync**: The `docs/desktop-requirements.md` document captures all features as platform-agnostic requirements for a future desktop version. When adding or modifying features, update the corresponding functional requirements (FR-*) in that document to keep the desktop spec aligned with the web implementation.

## Key Files Reference

**Configuration**:
- `backend/JwstDataAnalysis.API/appsettings.json` - Backend config, MongoDB connection
- `frontend/jwst-frontend/package.json` - Frontend dependencies
- `processing-engine/requirements.txt` - Python dependencies
- `docker/docker-compose.yml` - Service orchestration

**Specifications**:
- `docs/desktop-requirements.md` - Platform-agnostic requirements for desktop version (keep in sync with features)

**Core Backend**:
- `backend/JwstDataAnalysis.API/Controllers/JwstDataController.cs` - Main API endpoints
- `backend/JwstDataAnalysis.API/Controllers/DataManagementController.cs` - Advanced endpoints
- `backend/JwstDataAnalysis.API/Controllers/MastController.cs` - MAST portal endpoints
- `backend/JwstDataAnalysis.API/Controllers/CompositeController.cs` - RGB composite generation
- `backend/JwstDataAnalysis.API/Services/MongoDBService.cs` - Database layer
- `backend/JwstDataAnalysis.API/Services/MastService.cs` - MAST HTTP client
- `backend/JwstDataAnalysis.API/Services/CompositeService.cs` - Composite image generation
- `backend/JwstDataAnalysis.API/Models/JwstDataModel.cs` - Data models and DTOs
- `backend/JwstDataAnalysis.API/Models/MastModels.cs` - MAST request/response DTOs
- `backend/JwstDataAnalysis.API/Models/CompositeModels.cs` - Composite request/response DTOs
- `backend/JwstDataAnalysis.API/Controllers/MosaicController.cs` - WCS mosaic generation
- `backend/JwstDataAnalysis.API/Services/MosaicService.cs` - Mosaic/footprint processing engine proxy
- `backend/JwstDataAnalysis.API/Models/MosaicModels.cs` - Mosaic request/response DTOs

**Core Frontend**:
- `frontend/jwst-frontend/src/App.tsx` - Root component with data fetching
- `frontend/jwst-frontend/src/components/JwstDataDashboard.tsx` - Main dashboard UI
- `frontend/jwst-frontend/src/components/MastSearch.tsx` - MAST search component
- `frontend/jwst-frontend/src/types/JwstDataTypes.ts` - TypeScript type definitions
- `frontend/jwst-frontend/src/types/MastTypes.ts` - MAST TypeScript types
- `frontend/jwst-frontend/src/components/MosaicWizard.tsx` - WCS mosaic wizard component
- `frontend/jwst-frontend/src/types/MosaicTypes.ts` - Mosaic TypeScript types

**Processing**:
- `processing-engine/main.py` - FastAPI application entry point
- `processing-engine/app/mast/mast_service.py` - MAST API wrapper (astroquery)
- `processing-engine/app/mast/routes.py` - MAST FastAPI routes
- `processing-engine/app/mast/models.py` - MAST Pydantic models
- `processing-engine/app/mast/chunked_downloader.py` - Async chunked download with HTTP Range
- `processing-engine/app/mast/download_state_manager.py` - State persistence for resume
- `processing-engine/app/mast/download_tracker.py` - Byte-level progress tracking
- `processing-engine/app/composite/routes.py` - RGB composite FastAPI routes
- `processing-engine/app/composite/models.py` - Composite Pydantic models
- `processing-engine/app/mosaic/routes.py` - WCS mosaic FastAPI routes
- `processing-engine/app/mosaic/models.py` - Mosaic Pydantic models
- `processing-engine/app/mosaic/mosaic_engine.py` - Core WCS reprojection logic (reproject library)
- `processing-engine/app/processing/analysis.py` - Analysis algorithms (in progress)
- `processing-engine/app/processing/utils.py` - FITS utilities (in progress)

**Frontend Services**:
- `frontend/jwst-frontend/src/services/apiClient.ts` - Core HTTP client
- `frontend/jwst-frontend/src/services/ApiError.ts` - Custom error class
- `frontend/jwst-frontend/src/services/jwstDataService.ts` - JWST data operations
- `frontend/jwst-frontend/src/services/mastService.ts` - MAST operations
- `frontend/jwst-frontend/src/services/index.ts` - Service re-exports

**Frontend Utilities**:
- `frontend/jwst-frontend/src/utils/fitsUtils.ts` - FITS file type detection and classification
- `frontend/jwst-frontend/src/utils/colormaps.ts` - Color maps for FITS visualization
- `frontend/jwst-frontend/src/components/ImageViewer.tsx` - FITS image viewer with color maps, stretch controls, and PNG export

## Common Patterns

### Adding a New API Endpoint

1. Add method to `MongoDBService.cs` if database operation needed
2. Add controller action in appropriate controller (JwstDataController or DataManagementController)
3. Use async/await pattern
4. Return appropriate HTTP status codes (200, 201, 404, 500)
5. Add error handling with try-catch
6. Update Swagger documentation (automatic via annotations)

### Adding Processing Algorithm

1. Define algorithm in `processing-engine/main.py` algorithms dict
2. Implement processing function (accept data, parameters, return results)
3. Update frontend `JwstDataDashboard.tsx` with new action button
4. Add algorithm name to type definitions if needed

### Updating Data Models

1. Modify `JwstDataModel.cs` in backend
2. Mirror changes in `frontend/jwst-frontend/src/types/JwstDataTypes.ts`
3. Update MongoDB queries in `MongoDBService.cs` if new fields need indexing/filtering
4. No migration needed (MongoDB schema-less)

## API Endpoints Quick Reference

**Base URL**: http://localhost:5001/api | **Swagger UI**: http://localhost:5001/swagger

**Authentication** (JWT Bearer):
- `POST /auth/register` - Create new account (returns tokens)
- `POST /auth/login` - Login with username/password (returns tokens)
- `POST /auth/refresh` - Refresh access token using refresh token
- `POST /auth/logout` - Revoke refresh token (requires auth)
- `GET /auth/me` - Get current user info (requires auth)

> **Note**: GET allows anonymous access. POST/PUT/DELETE require `Authorization: Bearer <token>` header.

**Main Data Operations**:
- `GET /jwstdata` - List all | `GET /jwstdata/{id}` - Get one | `POST /jwstdata` - Create
- `PUT /jwstdata/{id}` - Update | `DELETE /jwstdata/{id}` - Delete | `POST /jwstdata/{id}/process` - Process
- `GET /jwstdata/type/{dataType}` - Filter by type | `GET /jwstdata/status/{status}` - Filter by status

**Viewer Operations** (FITS preview):
- `GET /jwstdata/{id}/preview` - Generate preview image
  - `cmap`: inferno, magma, viridis, plasma, grayscale, hot, cool, rainbow
  - `stretch`: zscale, asinh, log, sqrt, power, histeq, linear
  - `width`, `height`: 10-8000 (default 1000) | `gamma`: 0.1-5.0 | `format`: png/jpeg
- `GET /jwstdata/{id}/histogram` - Histogram data | `/pixeldata` - Pixel array | `/cubeinfo` - 3D cube metadata | `/file` - Download FITS

**Other Endpoints** (see Swagger for details):
- **Lineage**: `GET /jwstdata/lineage` - Groups by observation
- **Data Management**: `/datamanagement/search`, `/statistics`, `/export`, `/bulk/tags`, `/bulk/status`
- **Composite**: `POST /composite/generate` - RGB from 3 FITS files
- **Mosaic**: `POST /mosaic/generate` - WCS-aware mosaic from 2+ FITS files, `POST /mosaic/footprint` - WCS footprint polygons
- **MAST Search**: `/mast/search/target`, `/coordinates`, `/observation`, `/program`
- **MAST Import**: `/mast/import`, `/import-progress/{jobId}`, `/import/resume/{jobId}`, `/refresh-metadata`

## Troubleshooting

**MongoDB Connection Issues**:
- Ensure MongoDB is running (Docker: `docker compose ps`)
- Check connection string in `appsettings.json` matches your setup
- Default: `mongodb://admin:password@localhost:27017`

**Frontend Can't Reach Backend**:
- Verify backend is running on expected port
- Check CORS configuration in `Program.cs`
- Confirm `VITE_API_URL` environment variable

**Processing Engine Not Working**:
- Virtual environment activated?
- All dependencies installed? (`pip install -r requirements.txt`)
- Check Python version (requires 3.9+)
- Note: Many algorithms are TODO/stubs in Phase 3

**Docker Issues**:
- Rebuild images: `docker compose up -d --build`
- Check logs: `docker compose logs -f [service-name]`
- Reset volumes: `docker compose down -v` (WARNING: deletes data)

**MAST Search Issues**:
- Ensure processing engine is running: `docker compose logs processing-engine`
- Check internet connectivity (MAST requires external access)
- Target name searches are case-insensitive but must match MAST naming
- If JSON serialization errors occur, NaN values from MAST are being handled
- Large downloads may timeout; increase `HttpClient.Timeout` if needed
- Downloaded files stored in `data/mast/{obs_id}/` directory

## Using MAST Search

See [`docs/mast-usage.md`](docs/mast-usage.md) for detailed API examples, metadata field mappings, and FITS file type reference.

**Quick Start**: Click "Search MAST" in dashboard → Select search type (target/coordinates/observation/program) → Search → Import selected observations.

**FITS File Types**: Image files (`*_cal`, `*_i2d`, `*_rate`) are viewable; table files (`*_asn`, `*_x1d`, `*_cat`) show data badge only.

## Known Issues / Tech Debt

See [`docs/tech-debt.md`](docs/tech-debt.md) for the authoritative list of tech debt items, security issues, and their resolution status.

**Quick stats**: 41 resolved | 40 remaining (as of 2026-02-05)

Run `/tasks` to see current status and dependencies.
