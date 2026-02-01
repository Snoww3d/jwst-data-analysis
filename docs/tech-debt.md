# Tech Debt Tracking

This document tracks tech debt items and their resolution status.

## Summary

| Status | Count |
|--------|-------|
| **Resolved** | 28 |
| **Remaining** | 10 |

## Remaining Tasks (10)

### Production Readiness - Medium (Code Quality/CI)

### 27. Add Test Coverage ✅ (Partial)
**Priority**: Medium
**Location**: All projects
**Status**: Backend tests implemented (PR pending), frontend/processing TBD

**Completed**:
- ✅ Backend xUnit test project with 54 passing tests (model validation, constants)
- ✅ Test fixtures for sample data generation
- ✅ CI integration (`dotnet test` in build pipeline)
- ✅ Specification tests documenting expected behavior (skipped until DI refactor)

**Remaining Work**:
1. Refactor `MongoDBService` for DI (see Task #38)
2. Frontend: Add Jest/React Testing Library tests for components
3. Processing Engine: Add pytest tests for MAST service, algorithms
4. Set coverage thresholds in CI

**Notes**: 63 controller/service tests are skipped with documented reason - they require `MongoDBService` to be refactored to support dependency injection (see Task #38). These tests serve as specification/documentation until then.

---

### 38. Refactor MongoDBService for Dependency Injection
**Priority**: Medium
**Location**: `backend/JwstDataAnalysis.API/Services/MongoDBService.cs`

**Issue**: MongoDBService directly creates MongoDB connections internally, making it impossible to mock for unit tests. The service has 45+ async methods that cannot be properly tested.

**Impact**: 63 unit tests are skipped because they cannot mock the database layer. This limits test coverage and makes refactoring risky.

**Fix Approach**:
1. Extract `IMongoDBService` interface with all public methods
2. Refactor constructor to accept `IMongoCollection<JwstDataModel>` via DI
3. Register interface in `Program.cs` DI container
4. Update all controller constructors to use `IMongoDBService`
5. Enable the 63 skipped tests with proper mocks

**Blocked By**: None
**Blocks**: Full test coverage for Task #27

---

### Production Readiness - Nice to Have (Polish)

### 30. Add Application Logging and Monitoring Hooks
**Priority**: Nice to Have
**Location**: Backend, Processing Engine

**Issue**: ~~Basic console logging only; no structured logging for production.~~ (Partially addressed: LoggerMessage source generators implemented in PR #83 with event IDs for filtering/monitoring)

**Impact**: Difficult to debug production issues; no metrics collection.

**Remaining Work**:
1. Add Serilog to .NET backend with JSON output (optional - LoggerMessage already provides structured logging)
2. Add structured logging to Python with `structlog`
3. ~~Add health check endpoints (`/health`, `/ready`)~~ (Processing engine has `/health`)
4. Document integration with common monitoring tools (Prometheus, Grafana)

---

### 31. Add Docker Image Publishing
**Priority**: Nice to Have
**Location**: `.github/workflows/` (new workflow)

**Issue**: Docker images not published to a registry.

**Impact**: Users must build images locally; no versioned releases.

**Fix Approach**:
1. Create GitHub Actions workflow for image publishing
2. Publish to GitHub Container Registry (ghcr.io)
3. Tag images with version numbers and `latest`
4. Add installation instructions for pre-built images

---

### 32. Create Release Process and Changelog
**Priority**: Nice to Have
**Location**: `/CHANGELOG.md`, `.github/workflows/release.yml`

**Issue**: No formal release process or version history.

**Impact**: Users don't know what changed between versions.

**Fix Approach**:
1. Create `CHANGELOG.md` following Keep a Changelog format
2. Set up semantic versioning
3. Create release workflow that:
   - Creates GitHub release
   - Builds and tags Docker images
   - Generates release notes from commits

---

### 33. Add API Documentation (OpenAPI/Swagger)
**Priority**: Nice to Have
**Location**: Backend API

**Issue**: Swagger UI exists but lacks descriptions; no standalone API docs.

**Impact**: API consumers lack clear documentation.

**Fix Approach**:
1. Add XML documentation comments to all controllers
2. Configure Swagger to include XML docs
3. Export OpenAPI spec to `docs/api/openapi.json`
4. Consider hosting API docs on GitHub Pages

---

### 34. Add Demo Mode / Sample Data
**Priority**: Nice to Have
**Location**: New seeding scripts

**Issue**: New users start with empty database; must import from MAST to see functionality.

**Impact**: Higher barrier to trying the application.

**Fix Approach**:
1. Create sample FITS files (or document how to obtain them)
2. Add database seeding script with sample records
3. Add `--demo` flag to Docker setup
4. Include sample visualizations in README

---

### 36. Add Browser/Environment Compatibility Documentation
**Priority**: Nice to Have
**Location**: `README.md`, `docs/`

**Issue**: No documentation of supported browsers, Node versions, .NET versions, etc.

**Impact**: Users may encounter issues with unsupported environments.

**Fix Approach**:
1. Document minimum versions:
   - Node.js version
   - .NET version
   - Python version
   - Docker version
   - Supported browsers
2. Add version badges to README
3. Add version checks to CI pipeline

---

### Existing Tech Debt

### 13. Proper Job Queue for Background Tasks
**Priority**: Nice to Have
**Location**: `backend/JwstDataAnalysis.API/Controllers/MastController.cs`

**Issue**: Long-running import tasks run in-process without proper queue management.

**Impact**: Server restart loses in-progress jobs; no retry mechanism; limited scalability.

**Fix Approach**: Implement background job processing:
- Option A: Use Hangfire for .NET background jobs
- Option B: Use a message queue (RabbitMQ, Redis) with worker processes
- Option C: Use .NET `IHostedService` with persistent state

---

### 14. FITS TypeScript Interfaces
**Priority**: Nice to Have
**Location**: `frontend/jwst-frontend/src/types/`

**Issue**: FITS-related data structures lack proper TypeScript interfaces.

**Impact**: No type safety for FITS metadata; IDE can't provide autocomplete.

**Fix Approach**: Create dedicated FITS types in `src/types/FitsTypes.ts`

---

### 17. Stretched Histogram Panel Drag UX
**Priority**: Nice to Have
**Location**: `frontend/jwst-frontend/src/components/ImageViewer.tsx`

**Issue**: The stretched histogram panel's drag behavior doesn't match user expectations. Users expect to drag markers TO a visual position, but the current implementation treats drag distance as "how much to add" scaled by range.

**Current Behavior**:
- Markers always at edges (0 and 1) on stretched panel
- Formula: `newBlack = originalBlack + range × position × sensitivity`
- 0.2x sensitivity helps but doesn't fully solve the UX mismatch

**Impact**: Fine-tuning black/white points on the stretched panel is unintuitive. Users overshoot or undershoot desired values.

**Fix Approach Options**:
1. **Snap-to-data feature**: Button that auto-detects where histogram data starts
2. **Direct position mapping**: Show actual positions within current range (zoomed view)
3. **Visual feedback**: Show ghost marker at target position while dragging
4. **Adaptive sensitivity**: Sensitivity proportional to current range
5. **Click-to-set**: Click anywhere on histogram to set that value

**Related**: PR #50

---

## Resolved Tasks (25)

| Task | Description | PR |
|------|-------------|-----|
| #1 | Path Traversal in Preview Endpoint | PR #26 |
| #2 | Memory Exhaustion in File Download | PR #27 |
| #3 | Regex Injection in MongoDB Search | PR #28 |
| #4 | Path Traversal in Export Endpoint | PR #29 |
| #5 | N+1 Query in Export Endpoint | PR #30 |
| #6 | Duplicated Import Code in MastController | PR #31 |
| #7 | Missing Frontend TypeScript Types | PR #32 |
| #8 | Hardcoded API URLs in Frontend | PR #33 |
| #9 | Statistics Query Loads All Documents | PR #34 |
| #10 | Missing MongoDB Indexes | PR #35 |
| #11 | File Extension Validation Bypass | PR #36 |
| #12 | Centralized API Service Layer | PR #37 |
| #15 | Download Job Cleanup Timer | PR #46 |
| #16 | Missing Magma/Inferno Colormaps | PR #45 |
| #18 | Remove Hardcoded Credentials | (previously completed) |
| #19 | Configure CORS for Production | PR #78 |
| #20 | Add Rate Limiting | PR #79 |
| #21 | Create Public README.md | (previously completed) |
| #22 | Add LICENSE File | (previously completed) |
| #23 | Add CONTRIBUTING.md and Community Files | (previously completed) |
| #24 | Add GitHub Issue and PR Templates | PR #80 |
| #25 | Separate Dev/Prod Docker Configs | PR #81 |
| #26 | Add GitHub Actions CI/CD Pipeline | (previously completed) |
| #29 | Enable Dependabot | (previously completed) |
| #35 | Review and Clean Git History | (gitleaks scan: clean) |
| #28 | Add Linting and Formatting Configurations | PR #83 |
| #27 | Add Test Coverage (Backend Phase) | PR pending |
| #39 | Implement Playwright E2E Testing | PR #85 |

### 37. Re-enable CodeQL Security Analysis
**Priority**: Medium (before public release)
**Location**: `.github/workflows/security.yml`

**Issue**: CodeQL security analysis disabled because GitHub Advanced Security is only free for public repos.

**Impact**: No automated security vulnerability scanning until repo is public.

**Fix Approach**:
1. Before making repo public, re-enable the workflow triggers
2. Change `on: workflow_dispatch` back to `on: push/pull_request/schedule`
3. Verify CodeQL passes on all languages (csharp, javascript-typescript, python)
4. Address any security findings before public release

---

## Adding New Tech Debt

1. Add to this file under "Remaining Tasks"
2. Assign next task number (currently: #39)
3. Include: Priority, Location, Issue, Impact, Fix Approach

---

### Agentic Capabilities - High Impact


### 40. Configure Structured Logging (JSON)
**Priority**: Medium
**Location**: `backend/JwstDataAnalysis.API` and `processing-engine/`

**Issue**: Plain-text console logs are difficult for agents to parse programmatically.
**Impact**: Agents struggle to identify specific error causes during `docker compose up` failures.
**Fix Approach**:
1. Add Serilog to .NET backend with CompactJsonFormatter
2. Configure `structlog` for Python processing engine
3. Ensure all containers emit JSON logs in non-development environments

### 41. Set up MCP Servers
**Priority**: Nice to Have
**Location**: Local Development Environment

**Issue**: Agents are limited to file editing tasks and lack direct system access.
**Impact**: Agents cannot inspect database state or GitHub PR status directly.
**Fix Approach**:
1. Add `mongodb-mcp-server` configuration for direct DB inspection
2. Add `github-mcp-server` for issue/PR management
3. Document usage in `CLAUDE.md`

### 42. Configure Husky Git Hooks
**Priority**: Low
**Location**: Root directory

**Issue**: No guardrails to prevent agents (or humans) from committing broken code.
**Impact**: Higher risk of breaking the build.
**Fix Approach**:
1. Install Husky
2. Add `pre-push` hook to run linting and subset of tests

