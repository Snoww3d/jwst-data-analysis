# Tech Debt Tracking

This document tracks tech debt items and their resolution status.

## Summary

| Status | Count |
|--------|-------|
| **Resolved** | 54 |
| **Moved to bugs.md** | 3 |
| **Remaining** | 38 |

> **Code Style Suppressions (2026-02-03)**: Items #77-#87 track StyleCop/CodeAnalysis rule suppressions in `.editorconfig`. Lower priority but tracked for future cleanup.

> **Security Audit (2026-02-02)**: Comprehensive audit identified 18 security issues (#50-#67). Most critical/high items now resolved.

---

## Remaining Tasks (38)

### 13. Proper Job Queue for Background Tasks
**Priority**: Nice to Have
**Location**: `backend/JwstDataAnalysis.API/Controllers/MastController.cs`
**Category**: Architecture

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
**Category**: Type Safety

**Issue**: FITS-related data structures lack proper TypeScript interfaces.

**Impact**: No type safety for FITS metadata; IDE can't provide autocomplete.

**Fix Approach**: Create dedicated FITS types in `src/types/FitsTypes.ts`

---

### 27. Add Test Coverage (Partial)
**Priority**: Medium
**Location**: All projects
**Status**: Backend tests complete (116 passing), frontend/processing TBD

**Completed**:
- Backend xUnit test project with 116 passing tests
- MongoDBService DI refactor complete (Task #38, PR #93)
- All 63 controller/service tests now enabled and passing
- Test fixtures for sample data generation
- CI integration (`dotnet test` in build pipeline)

**Remaining Work**:
1. Frontend: Add Jest/React Testing Library tests for components
2. Processing Engine: Add pytest tests for MAST service, algorithms
3. Set coverage thresholds in CI

---

### 30. Add Application Logging and Monitoring Hooks
**Priority**: Nice to Have
**Location**: Backend, Processing Engine
**Category**: Observability

**Issue**: Basic console logging only; no structured logging for production. (Partially addressed: LoggerMessage source generators implemented in PR #83 with event IDs for filtering/monitoring)

**Impact**: Difficult to debug production issues; no metrics collection.

**Remaining Work**:
1. Add Serilog to .NET backend with JSON output (optional - LoggerMessage already provides structured logging)
2. Add structured logging to Python with `structlog`
3. Document integration with common monitoring tools (Prometheus, Grafana)

---

### 31. Add Docker Image Publishing
**Priority**: Nice to Have
**Location**: `.github/workflows/` (new workflow)
**Category**: CI/CD

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
**Category**: CI/CD

**Issue**: No formal release process or version history.

**Impact**: Users don't know what changed between versions.

**Fix Approach**:
1. Create `CHANGELOG.md` following Keep a Changelog format
2. Set up semantic versioning
3. Create release workflow that creates GitHub release, builds/tags Docker images, generates release notes

---

### 33. Add API Documentation (OpenAPI/Swagger)
**Priority**: Nice to Have
**Location**: Backend API
**Category**: Documentation

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
**Category**: Onboarding

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
**Category**: Documentation

**Issue**: No documentation of supported browsers, Node versions, .NET versions, etc.

**Impact**: Users may encounter issues with unsupported environments.

**Fix Approach**:
1. Document minimum versions (Node.js, .NET, Python, Docker, supported browsers)
2. Add version badges to README
3. Add version checks to CI pipeline

---

### 37. Re-enable CodeQL Security Analysis
**Priority**: Medium (before public release)
**Location**: `.github/workflows/security.yml`
**Category**: Security / CI

**Issue**: CodeQL security analysis disabled because GitHub Advanced Security is only free for public repos.

**Impact**: No automated security vulnerability scanning until repo is public.

**Fix Approach**:
1. Before making repo public, re-enable the workflow triggers
2. Change `on: workflow_dispatch` back to `on: push/pull_request/schedule`
3. Verify CodeQL passes on all languages (csharp, javascript-typescript, python)
4. Address any security findings before public release

---

### 40. Configure Structured Logging (JSON)
**Priority**: Medium
**Location**: `backend/JwstDataAnalysis.API` and `processing-engine/`
**Category**: Observability / Agentic

**Issue**: Plain-text console logs are difficult for agents to parse programmatically.

**Impact**: Agents struggle to identify specific error causes during `docker compose up` failures.

**Fix Approach**:
1. Add Serilog to .NET backend with CompactJsonFormatter
2. Configure `structlog` for Python processing engine
3. Ensure all containers emit JSON logs in non-development environments

---

### 41. Set up MCP Servers
**Priority**: Nice to Have
**Location**: Local Development Environment
**Category**: Agentic

**Issue**: Agents are limited to file editing tasks and lack direct system access.

**Impact**: Agents cannot inspect database state or GitHub PR status directly.

**Fix Approach**:
1. Add `mongodb-mcp-server` configuration for direct DB inspection
2. Add `github-mcp-server` for issue/PR management
3. Document usage in `AGENTS.md`

---

### 42. Configure Husky Git Hooks
**Priority**: Low
**Location**: Root directory
**Category**: CI / Agentic

**Issue**: No guardrails to prevent agents (or humans) from committing broken code.

**Impact**: Higher risk of breaking the build.

**Fix Approach**:
1. Install Husky
2. Add `pre-push` hook to run linting and subset of tests

---

### 43. Generate and Host OpenAPI Spec
**Priority**: Medium
**Location**: `docs/api/openapi.json`
**Category**: Documentation / Agentic

**Issue**: The API Spec link in the documentation is broken (404) because the `openapi.json` file has not been generated or exported from the backend.

**Impact**: Developers and agents cannot easily reference the API contracts.

**Fix Approach**:
1. Export the OpenAPI/Swagger JSON from the running .NET backend
2. Save it to `docs/api/openapi.json`
3. Uncomment the API Spec link in `mkdocs.yml`

---

### 44. Add JWST GWCS Support for WCS Coordinates
**Priority**: Nice to Have
**Location**: `processing-engine/`
**Category**: FITS Processing

**Issue**: JWST files store WCS in ASDF format using GWCS (Generalized World Coordinate System), not standard FITS WCS headers. The current `/pixeldata` endpoint looks for traditional WCS keywords (`CRPIX1`, `CRVAL1`, etc.) which are not present in JWST files.

**Impact**: RA/Dec sky coordinates are not displayed in the FITS viewer status bar for JWST observations. Pixel coordinates and values work correctly.

**Fix Approach**:
1. Add `gwcs` and `asdf` packages to `requirements.txt`
2. Update `/pixeldata` endpoint to extract WCS from ASDF extension
3. Use `gwcs` to read the WCS model from JWST files
4. Convert GWCS to simplified WCS params for frontend consumption
5. Test with real JWST observations

**Notes**: Standard FITS files with traditional WCS headers will continue to work. This adds support specifically for JWST's GWCS format.

---

### ~~46. Review Emoji Usage in Workflow Files~~ — CLOSED
**Status**: Moot — workflow files were removed. No longer applicable.

---

### 48. Enable GitHub Branch Protection on Main
**Priority**: Medium (when repo becomes public)
**Location**: GitHub repository settings
**Category**: Security / CI

**Issue**: Branch protection rules require GitHub Pro for private repos. Currently using local pre-push hook as workaround.

**Impact**: Direct pushes to main bypass CI and user review. Local hook can be bypassed with `--no-verify` or fresh clones without running setup script.

**Current Mitigations**:
- Pre-push hook (`.githooks/pre-push`) blocks local pushes to main
- Setup script (`scripts/setup-hooks.sh`) installs hooks
- Warning boxes in workflow files
- Enhanced PR template with reminders

**Fix Approach** (when repo is public):
1. Enable branch protection on `main` via GitHub Settings > Branches
2. Configure rules: require PR, require status checks, optionally require review approval
3. Test that direct pushes are rejected server-side
4. Update `AGENTS.md` to note server-side protection is active

---

### 49. Revisit Export Filename Pattern
**Priority**: Low (Nice to Have)
**Location**: `frontend/jwst-frontend/src/components/ImageViewer.tsx`
**Category**: UX

**Issue**: The PNG export filename pattern (`{obs_id}_{instrument}_{filter}_{timestamp}.png`) was chosen for initial implementation but may benefit from refinement.

**Discussion Points**:
1. Should the colormap/stretch settings be included in the filename or metadata?
2. Would users prefer a customizable filename input field?
3. Should we embed EXIF/PNG metadata with the visualization settings used?
4. Consider adding export presets (e.g., "for publication", "quick share")

**Decision**: TBD - gather user feedback after initial implementation

---

### 61. Environment Variables with Credentials
**Priority**: HIGH
**Location**: `docker/docker-compose.yml:26-28, 43-46`
**Category**: Secret Management

**Issue**: Database credentials passed as environment variables, visible in `docker inspect`.

**Fix Approach**:
1. Use Docker secrets for production
2. Use env_file with gitignored file
3. Consider HashiCorp Vault for secret management

---

### 64. No Network Isolation Between Services
**Priority**: MEDIUM
**Location**: `docker/docker-compose.yml`
**Category**: Network Segmentation

**Issue**: All services on same Docker network - no defense in depth.

**Fix Approach**:
1. Create separate networks: frontend-network, backend-network, data-network
2. MongoDB only accessible from backend
3. Frontend only talks to backend

---

### 67. Missing CSRF Protection
**Priority**: MEDIUM
**Location**: `frontend/jwst-frontend/src/services/apiClient.ts`
**Category**: Security

**Issue**: No CSRF tokens in POST/DELETE requests.

**Fix Approach**:
1. Backend: Implement SameSite cookie attribute
2. Backend: Require CSRF tokens for state-changing operations
3. Frontend: Include X-CSRF-Token header

---

### 68. Overly Permissive TypeScript Types
**Priority**: LOW
**Location**: `frontend/jwst-frontend/src/types/JwstDataTypes.ts:7, 59`
**Category**: Type Safety

**Issue**: Using `Record<string, any>` for metadata lacks type safety.

**Fix Approach**: Create strict interfaces for known metadata fields.

---

### 69. Expand Desktop Requirements to Implementation-Ready Specification
**Priority**: Nice to Have (Strategic)
**Location**: `docs/desktop-requirements.md`
**Category**: Documentation / Future Platform
**Estimated Effort**: 2-3 weeks documentation work

**Issue**: The current `docs/desktop-requirements.md` provides a solid foundation but lacks the extreme detail needed for a near-one-shot implementation of the desktop application.

**Impact**: Without exhaustive detail, desktop implementation will require extensive back-and-forth clarification.

**Expansion Required**:
- A. Complete API Contract Specification (A1-A6)
- B. Complete UI Component Specifications (B1-B8)
- C. State Management Specification (C1-C5)
- D. File System & Storage Specification (D1-D7)
- E. FITS Processing Specification (E1-E7)
- F. MAST Integration Specification (F1-F6)
- G. Error Handling Specification (G1-G5)
- H. Testing Specification (H1-H4)
- I. Build & Distribution Specification (I1-I5)
- J. Sidecar Process Specification (J1-J4)

**Deliverable**: Multiple markdown files under `docs/desktop-spec/`

**Success Criteria**: A developer should be able to build the complete desktop app without asking clarifying questions, achieve feature parity with web version, and pass all specified test cases.

---

### 70. Streamline Documentation-Only PR Workflow
**Priority**: Medium
**Location**: `.github/workflows/`, `.github/PULL_REQUEST_TEMPLATE/`
**Category**: Developer Experience / CI Optimization

**Issue**: Documentation-only PRs run the full CI pipeline even though code hasn't changed. Wastes CI minutes and slows down simple doc updates.

**Recommended Approach**: Implement path-based CI (skip code linting when only docs/markdown change) + docs PR template:
- Add `detect-changes` job to lint workflow that checks if only `docs/`, `.agent/`, or `*.md` files changed
- Skip `frontend-lint`, `backend-lint`, `python-lint` jobs when `code_changed == false`
- Create `docs.md` PR template for cleaner doc-only PRs

---

### 71. Split Large Documentation Files to Reduce Context Window Usage
**Priority**: Nice to Have (only if becomes a real problem)
**Location**: `docs/tech-debt.md`, `docs/desktop-requirements.md`, `docs/development-plan.md`
**Category**: Developer Experience / Context Optimization

**Issue**: Large markdown documentation files could theoretically consume significant context window space when read by AI assistants.

**Current State**: ~3000 lines total across main docs (~5-7% of 200K context). **NOT currently a problem.**

**When to Revisit**: If responses degrade noticeably during doc-heavy sessions, if doc count grows significantly, or if same docs are re-read repeatedly.

**Do Not Implement** unless actual context issues are observed.

---

### 76. Refresh Tokens Stored in Plaintext
**Priority**: MEDIUM
**Location**: `backend/JwstDataAnalysis.API/Models/UserModels.cs:31-53`
**Category**: Token Security

**Issue**: Refresh tokens are stored in raw form. A database leak would allow direct replay.

**Fix Approach**:
1. Hash refresh tokens (e.g., SHA-256) before storage
2. Compare hashes on refresh
3. Rotate refresh tokens on every use
4. Consider additional metadata (user agent, IP) for revocation checks

---

---

### 79. SA1402 - File May Only Contain Single Type
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: File Organization

**Issue**: Each file should contain only one type. Suppressed to allow grouping related DTOs together (e.g., `MastModels.cs` contains multiple request/response DTOs).

**Fix Approach**: Split `MastModels.cs`, `CompositeModels.cs`, `UserModels.cs` into separate files per class. Remove suppression.

**Estimated Effort**: 2-3 hours

---

### 80. SA1649 - File Name Should Match First Type Name
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: File Naming
**Depends On**: Task #79 (SA1402)

**Issue**: File name should match the first type declared. Related to SA1402 - once files contain single types, names will naturally match.

**Fix Approach**: Resolve Task #79 first, then remove this suppression.

---

### 81. CA1805 - Don't Initialize to Default Value
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Code Style

**Issue**: Rule suggests not initializing fields to default values (e.g., `= false`, `= 0`). Suppressed because explicit initialization improves readability and intent.

**Fix Approach**: Discuss preference: implicit vs explicit defaults. If keeping explicit, document as intentional style choice and keep suppression. If removing, update all model classes.

**Estimated Effort**: 1-2 hours if removing initializers

---

### 82. SA1316 - Tuple Element Names Should Use Correct Casing
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Naming Convention

**Issue**: Tuple element names should use PascalCase.

**Fix Approach**: Update tuple declarations to PascalCase, remove suppression.

**Estimated Effort**: 30 minutes

---

### 83. SA1500 - Braces Should Not Share Line
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Formatting

**Issue**: Opening braces for multi-line statements should be on their own line.

**Fix Approach**: Run `dotnet format`, review fixes, remove suppression.

**Estimated Effort**: 30 minutes

---

### 84. SA1117 - Parameters on Same or Separate Lines
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Formatting

**Issue**: Parameters should either all be on the same line, or each on a separate line.

**Fix Approach**: Standardize method signatures, remove suppression.

**Estimated Effort**: 1 hour

---

### 85. SA1116 - Split Parameters Should Start After Declaration
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Formatting

**Issue**: When splitting parameters across lines, first parameter should be on new line after method name.

**Fix Approach**: Fix method signatures, remove suppression.

**Estimated Effort**: 30 minutes

---

### 86. SA1113 - Comma on Same Line as Previous Parameter
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Formatting

**Issue**: When parameters span multiple lines, comma should be on same line as preceding parameter.

**Fix Approach**: Move commas to end of lines where needed, remove suppression.

**Estimated Effort**: 30 minutes

---

### 87. SA1001 - Commas Should Be Spaced Correctly
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Formatting

**Issue**: Commas should be followed by a space and not preceded by a space.

**Fix Approach**: Run `dotnet format`, remove suppression.

**Estimated Effort**: 15 minutes

---

### 89. Incomplete Downloads Panel UX Improvements
**Priority**: LOW
**Location**: `frontend/jwst-frontend/src/components/MastSearch.tsx:929-965`
**Category**: UX

**Issue**: Several UX issues with the "Incomplete Downloads" panel in MAST Search:
1. Panel is always expanded when there are resumable jobs — should be collapsible and default to collapsed
2. Downloads are not sorted by recency — most recent should appear at the top
3. No way to dismiss/remove an incomplete download

**Fix Approach**:
1. Add `resumableCollapsed` state (default `true`) with toggle button/chevron on header
2. Sort `resumableJobs` by timestamp descending before rendering
3. Add remove/dismiss button per row with confirmation dialog for partially downloaded files

**Estimated Effort**: 1-2 hours

---

### 93. Require PR Approving Reviews on Branch Protection
**Priority**: Low
**Location**: GitHub repository settings (branch protection rules)
**Category**: Process

**Issue**: Branch protection on `main` currently requires CI checks to pass but does not require approving reviews (set to 0). This is fine while there is a single maintainer, but should be increased to 1+ when contributors join the project.

**Fix Approach**:
1. Once the project has additional contributors, update branch protection via GitHub Settings or API
2. Set `required_approving_review_count` to 1
3. Consider enabling `dismiss_stale_reviews` and `require_code_owner_reviews`

**Estimated Effort**: 5 minutes

---

### 95. E2E Export Tests Skipped — No Seed Data in CI
**Priority**: HIGH
**Location**: `frontend/jwst-frontend/e2e/export.spec.ts`
**Category**: Testing / CI

**Issue**: All 9 export e2e tests are skipped in CI because the `openImageViewer()` helper navigates to `/`, finds no viewable data cards, and skips. Two problems contribute:
1. **No authentication** — the helper navigates to `/` without auth, so it lands on `/login` instead of the dashboard
2. **No seed data** — even with auth, the CI database has no FITS files, so there's nothing to view or export

**Impact**: Export functionality (PNG/JPEG export panel, format selection, resolution presets, quality slider, download triggers) has zero e2e coverage in CI. Regressions in this feature area would go undetected.

**Fix Approach**:
1. Add authentication to `openImageViewer()` (register temp user, same pattern as auth/smoke tests)
2. Create a CI seed script that loads a small sample FITS file into MongoDB + data directory before tests run
3. Alternatively, add a lightweight fixture FITS file to the repo (small enough to commit, ~100KB) and a seeding step in the e2e CI job
4. Ensure the seed data has at least one viewable image so the export panel can be opened

**Estimated Effort**: 3-4 hours

---

### 96. Optimize CodeQL CI with Path Filtering and Caching
**Priority**: Medium
**Location**: `.github/workflows/security.yml`
**Category**: CI / Performance

**Issue**: CodeQL runs all 3 language analyses (C#, JS/TS, Python) on every PR regardless of which files changed. The C# analysis is the bottleneck at ~2 minutes due to `dotnet build` via Autobuild. On a frontend-only PR, C# analysis runs unnecessarily.

**Impact**: Every PR waits ~2 minutes for C# CodeQL even when no C# files changed. Wastes CI minutes and slows feedback loop.

**Fix Approach** (3 improvements, in order of impact):
1. **Path filtering per language** — Replace matrix strategy with 3 separate jobs. Use `dorny/paths-filter` to detect which paths changed. Only run C# CodeQL when `backend/**` changes, JS/TS when `frontend/**` changes, Python when `processing-engine/**` changes. Weekly schedule and `workflow_dispatch` always run all languages.
2. **NuGet caching** — Add `actions/cache` for `~/.nuget/packages` (same pattern as `ci.yml` backend-test job). Saves ~20s of package restore.
3. **Explicit build instead of Autobuild** — Replace `github/codeql-action/autobuild` with `dotnet build backend/JwstDataAnalysis.API` to skip building the test project. CodeQL only needs production code.

**Estimated Effort**: 1 hour

---

## Resolved Tasks (53)

### Quick Reference

| # | Description | PR | Notes |
|---|-------------|-----|-------|
| 1 | Path Traversal in Preview Endpoint | PR #26 | |
| 2 | Memory Exhaustion in File Download | PR #27 | |
| 3 | Regex Injection in MongoDB Search | PR #28 | |
| 4 | Path Traversal in Export Endpoint | PR #29 | |
| 5 | N+1 Query in Export Endpoint | PR #30 | |
| 6 | Duplicated Import Code in MastController | PR #31 | |
| 7 | Missing Frontend TypeScript Types | PR #32 | |
| 8 | Hardcoded API URLs in Frontend | PR #33 | |
| 9 | Statistics Query Loads All Documents | PR #34 | |
| 10 | Missing MongoDB Indexes | PR #35 | |
| 11 | File Extension Validation Bypass | PR #36 | |
| 12 | Centralized API Service Layer | PR #37 | |
| 15 | Download Job Cleanup Timer | PR #46 | |
| 16 | Missing Magma/Inferno Colormaps | PR #45 | |
| 17 | Stretched Histogram Panel Drag UX | PR #86 | |
| 18 | Remove Hardcoded Credentials | Previously completed | |
| 19 | Configure CORS for Production | PR #78 | |
| 20 | Add Rate Limiting | PR #79 | |
| 21 | Create Public README.md | Previously completed | |
| 22 | Add LICENSE File | Previously completed | |
| 23 | Add CONTRIBUTING.md and Community Files | Previously completed | |
| 24 | Add GitHub Issue and PR Templates | PR #80 | |
| 25 | Separate Dev/Prod Docker Configs | PR #81 | |
| 26 | Add GitHub Actions CI/CD Pipeline | Previously completed | |
| 28 | Add Linting and Formatting Configurations | PR #83 | |
| 29 | Enable Dependabot | Previously completed | |
| 35 | Review and Clean Git History | Gitleaks scan: clean | |
| 38 | Refactor MongoDBService for Dependency Injection | PR #93 | |
| 39 | Implement Playwright E2E Testing | PR #85 | |
| 45 | Add Mandatory Documentation Updates to Workflows | Direct commit | |
| 47 | Fix GetSearchCountAsync Incomplete Filter Logic | PR #95 | |
| 50 | Exposed MongoDB Password in Repository | Verified | FALSE POSITIVE - never committed |
| 51 | Path Traversal via obsId Parameter | PR #108 | Added regex validation + defense-in-depth |
| 52 | SSRF Risk in MAST URL Construction | PR #110 | Added URI validation + 38 security tests |
| 53 | Path Traversal in Chunked Downloader Filename | PR #112 | Added filename sanitization + 23 security tests |
| 54 | Missing HTTPS/TLS Enforcement | PR #113 | nginx TLS termination, security headers |
| 55 | Missing Authentication on All API Endpoints | PR #117 | JWT Bearer auth with role-based access |
| 56 | Unbounded Memory Allocation in FITS Processing | PR #124 | Two-layer validation, HTTP 413 responses |
| 57 | Missing Input Validation on Numeric Parameters | Resolved | Whitelist + range checks on all endpoints |
| 58 | Docker Containers Run as Root | Resolved | Non-root USER in all 4 Dockerfiles |
| 59 | MongoDB Port Exposed to Host Network | Resolved | All ports bound to 127.0.0.1 |
| 62 | Unspecified Docker Image Versions | Resolved | All images pinned to specific versions |
| 63 | Missing Security Headers in nginx | PR #113 | Fixed alongside Task #54 |
| 72 | Frontend Authentication UI | PR #131 | AuthContext, login/register, JWT, ProtectedRoute |
| 73 | Anonymous Users Can Access All Non-Archived Data | Resolved | Public-only access for anonymous users |
| 74 | Anonymous Download/Query Endpoints Leak Private Data | Resolved | IsDataAccessible + FilterAccessibleData checks |
| 75 | Missing Access Filtering on User-Scoped Queries | Resolved | Owner restriction + post-filtering on all endpoints |
| 88 | Token Refresh Failure Logs User Out Instead of Retrying | PR #171 | Retry with backoff (3 attempts) |
| 90 | Disable Seed Users in Production | PR #176 | SeedDataService with SeedingSettings config |
| 91 | Incomplete Downloads Panel Not Visible After Cancel | PR #176 | refreshResumableJobs() on modal close |
| 92 | Mosaic Wizard Export Button Cut Off | PR #176 | Merged duplicate CSS rules |
| 77 | SA1202 - Public Members Before Private Members | PR #209 | Reordered all backend files |
| 78 | SA1204 - Static Members Before Non-Static Members | PR #209 | Reordered all backend files |
| 94 | Fix E2E CI Job Docker Stack Permissions | PR #236 | mkdir + chmod data dir, include override compose |

### Moved to bugs.md

| # | Description |
|---|-------------|
| 60 | Unsafe URL Construction in Frontend |
| 65 | Information Disclosure in Error Messages |
| 66 | Race Condition in Download Resume |

### Previously Resolved Security Issues (Cross-Reference)

These early security issues were addressed in earlier PRs but may warrant re-review given later audit findings:

| # | Description | PR | Notes |
|---|-------------|-----|-------|
| 1 | Path Traversal in Preview Endpoint | PR #26 | Different location than #51 |
| 3 | Regex Injection in MongoDB Search | PR #28 | Verify fix complete |
| 4 | Path Traversal in Export Endpoint | PR #29 | Different location than #51 |
| 19 | Configure CORS for Production | PR #78 | May need header restrictions |

---

## Adding New Tech Debt

1. Add to this file under "Remaining Tasks" in numerical order
2. Assign next task number (currently: **#97**)
3. Include: Priority, Location, Category, Issue, Impact, Fix Approach
