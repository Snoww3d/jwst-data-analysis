# Tech Debt Tracking

This document tracks tech debt items and their resolution status.

## Summary

| Status | Count |
|--------|-------|
| **Resolved** | 46 |
| **Remaining** | 34 |

> **Code Style Suppressions (2026-02-03)**: Added 11 tech debt items (#77-#87) for StyleCop/CodeAnalysis rule suppressions in `.editorconfig`. These are lower priority but tracked for future cleanup.

> **Security Audit (2026-02-02)**: Comprehensive audit identified 18 new security issues across all layers. See "Security Tech Debt" section below.

## Remaining Tasks (34)

---

## Security Tech Debt (Audit 2026-02-02)

A comprehensive security audit identified the following vulnerabilities across all application layers.

### Critical Priority - Immediate Action Required

### ~~50. Exposed MongoDB Password in Repository~~ ✅ FALSE POSITIVE
**Status**: Verified false positive - no exposure occurred
**Investigation**:
- `.env` was never committed to git (verified via `git log -p -- docker/.env`)
- `.env` is properly gitignored
- Gitleaks scan: 0 leaks found (200 commits)
- `docker-compose.yml` uses env var substitution with safe default

---

### ~~51. Path Traversal via obsId Parameter~~ ✅ RESOLVED (PR #108)
**Status**: Fixed in PR #108
**Fix**: Added `IsValidJwstObservationId()` regex validation and `IsPathWithinDownloadDirectory()` defense-in-depth. Also added `IMastService` and `IImportJobTracker` interfaces for testability.

---

### ~~52. SSRF Risk in MAST URL Construction~~ ✅ RESOLVED (PR #110)
**Status**: Fixed in PR #110
**Fix**: Added `_is_valid_mast_uri()` regex validation and `_build_mast_download_url()` with URL encoding. Invalid URIs are rejected and logged. Also added 38 security tests.

---

### ~~53. Path Traversal in Chunked Downloader Filename~~ ✅ RESOLVED (PR #112)
**Status**: Fixed in PR #112
**Fix**: Added `_sanitize_filename()` to extract basename and validate against safe pattern. Added `_is_path_within_directory()` defense-in-depth check. Files with invalid filenames are skipped and logged. Added 23 security tests.

---

### ~~54. Missing HTTPS/TLS Enforcement~~ ✅ RESOLVED (PR #113)
**Status**: Fixed in PR #113
**Fix**: Added production-ready TLS support:
- nginx TLS termination with `nginx-ssl.conf` (TLS 1.2/1.3, modern ciphers, OCSP stapling)
- Backend ForwardedHeaders middleware for X-Forwarded-* support
- Production HSTS headers and HTTPS redirect
- Security headers in both dev/prod nginx configs (X-Content-Type-Options, X-Frame-Options, CSP)
- Separate `docker-compose.prod.yml` overlay for TLS certificate mounting
- Updated `.env.example` with TLS deployment instructions

---

### High Priority - Address This Week

### ~~55. Missing Authentication on All API Endpoints~~ ✅ RESOLVED (PR #117)
**Status**: Fixed in PR #117
**Fix**: Implemented JWT Bearer authentication with:
- User registration and login endpoints
- Access and refresh token flow
- `[Authorize]` on all controller classes
- `[AllowAnonymous]` on GET endpoints (temporary until frontend auth UI - Task #72)
- Role-based access control (Admin/User roles)

---

### ~~56. Unbounded Memory Allocation in FITS Processing~~ ✅ RESOLVED (PR #124)
**Status**: Fixed in PR #124
**Fix**: Added two-layer validation to prevent memory exhaustion:
- `validate_fits_file_size()`: Rejects files > 2GB (configurable via `MAX_FITS_FILE_SIZE_MB`)
- `validate_fits_array_size()`: Rejects arrays > 100M pixels (configurable via `MAX_FITS_ARRAY_ELEMENTS`)
- Returns HTTP 413 Payload Too Large with descriptive error messages
- Validation occurs BEFORE loading data into memory
- Applied to `/preview`, `/histogram`, and `/pixeldata` endpoints

---

### ~~57. Missing Input Validation on Numeric Parameters~~ ✅ RESOLVED
**Status**: Fixed
**Fix**: Added comprehensive input validation to all 4 endpoint locations:
- Backend `GetPreview`: stretch/cmap whitelist, blackPoint/whitePoint/asinhA range checks
- Backend `GetHistogram`: bins (1-10000), gamma (0.1-5.0), stretch whitelist, blackPoint/whitePoint/asinhA range checks
- Python `generate_preview`: stretch/cmap whitelist, black_point/white_point/asinh_a range; removed silent fallbacks
- Python `get_histogram`: bins, gamma, stretch, black_point/white_point/asinh_a validation; removed silent fallbacks
- Added 13 backend test methods and 26 Python test cases

---

### ~~73. Anonymous Users Can Access All Non-Archived Data~~ ✅ RESOLVED (PR #TBD)
**Status**: Fixed
**Fix**: Anonymous `GET /api/jwstdata` now calls `GetPublicDataAsync()` instead of `GetAsync()`, returning only public data. Anonymous `GET /api/jwstdata/{id}` checks `IsPublic` and returns 404 for private items.

---

### ~~74. Anonymous Download and Query Endpoints Leak Private Data~~ ✅ RESOLVED (PR #TBD)
**Status**: Fixed
**Fix**: All `[AllowAnonymous]` single-item endpoints (preview, histogram, pixeldata, cubeinfo, file, processing-results) now check `IsDataAccessible()` — anonymous users get 404 for private items, authenticated non-owners get 403. All list/filter endpoints (type, status, tags, format, validated, lineage) now apply `FilterAccessibleData()` — anonymous users see only public data, authenticated users see own + public + shared data.

---

### ~~75. Missing Access Filtering on User-Scoped Queries~~ ✅ RESOLVED (PR #TBD)
**Status**: Fixed
**Fix**: `GetByUserId` now restricts non-admin users to querying only their own data (returns 403 otherwise). Search endpoints in both `JwstDataController` and `DataManagementController` post-filter results to accessible data. `GetArchivedData`, `GetValidatedData`, `GetByFileFormat`, and `ExportData` in `DataManagementController` now apply access filtering. Added `IsDataAccessible()` and `FilterAccessibleData()` helper methods to both controllers.

---

### 76. Refresh Tokens Stored in Plaintext
**Priority**: MEDIUM
**Location**: `backend/JwstDataAnalysis.API/Models/UserModels.cs:31-53`
**Category**: Token Security
**Source**: Code review finding (2026-02-03) - Finding 1

**Issue**: Refresh tokens are stored in raw form. A database leak would allow direct replay.

**Fix Approach**:
1. Hash refresh tokens (e.g., SHA-256) before storage
2. Compare hashes on refresh
3. Rotate refresh tokens on every use
4. Consider additional metadata (user agent, IP) for revocation checks

---

### ~~58. Docker Containers Run as Root~~ ✅ RESOLVED
**Status**: Fixed
**Fix**: Added non-root `USER` directives to all 4 Dockerfiles:
- **Backend** (`backend/JwstDataAnalysis.API/Dockerfile`): Created `appuser:appgroup` (UID/GID 1001), `/app/data` writable for MAST downloads/uploads
- **Processing Engine** (`processing-engine/Dockerfile`): Created `appuser:appgroup` (UID/GID 1001), `/app/data/mast` and `/app` writable for processing
- **Frontend Production** (`frontend/jwst-frontend/Dockerfile`): Created `appuser:appgroup` (UID/GID 1001) on Alpine nginx, writable `/var/cache/nginx`, `/var/log/nginx`, `/var/run/nginx.pid`
- **Frontend Dev** (`frontend/jwst-frontend/Dockerfile.dev`): Created `appuser:appgroup` (UID/GID 1001) on Alpine node, `/app` writable for hot reload
- All build steps (apt-get, pip, npm) run as root before `USER` directive
- Consistent UID/GID 1001 across all containers

---

### ~~59. MongoDB Port Exposed to Host Network~~ ✅ RESOLVED
**Priority**: HIGH
**Location**: `docker/docker-compose.override.yml`, `docker/docker-compose.yml`, `docker/docker-compose.agent.yml`
**Category**: Network Exposure
**Resolution**: All service ports bound to `127.0.0.1` (localhost only) across base, dev override, and agent overlay compose files. Prevents network-accessible services.

---

### ~~60. Unsafe URL Construction in Frontend~~ -> Moved to `docs/bugs.md`

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

### 62. Unspecified Docker Image Versions
**Priority**: HIGH
**Location**: `docker/docker-compose.yml:7`
**Category**: Supply Chain Security

**Issue**: Using `mongo:latest` and unversioned third-party images.

**Impact**: Non-reproducible builds, unknown security state, potential supply chain attacks.

**Fix Approach**:
1. Pin all images to specific versions: `mongo:7.0.4`
2. Use digests for critical images: `mongo@sha256:...`
3. Document image update process

---

### Medium Priority - Address This Sprint

### ~~63. Missing Security Headers in nginx~~ ✅ RESOLVED (PR #113)
**Status**: Fixed in PR #113 (along with Task #54)
**Fix**: Added security headers to both dev and prod nginx configs:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- Production also includes: `Strict-Transport-Security` (HSTS) and `Content-Security-Policy`

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

### ~~65. Information Disclosure in Error Messages~~ -> Moved to `docs/bugs.md`

---

### ~~66. Race Condition in Download Resume~~ -> Moved to `docs/bugs.md`

---

### 67. Missing CSRF Protection
**Priority**: MEDIUM
**Location**: `frontend/jwst-frontend/src/services/apiClient.ts`
**Category**: CSRF

**Issue**: No CSRF tokens in POST/DELETE requests.

**Fix Approach**:
1. Backend: Implement SameSite cookie attribute
2. Backend: Require CSRF tokens for state-changing operations
3. Frontend: Include X-CSRF-Token header

---

### Low Priority - Nice to Have

### 68. Overly Permissive TypeScript Types
**Priority**: LOW
**Location**: `frontend/jwst-frontend/src/types/JwstDataTypes.ts:7, 59`
**Category**: Type Safety

**Issue**: Using `Record<string, any>` for metadata lacks type safety.

**Fix Approach**: Create strict interfaces for known metadata fields.

---

## Desktop Application Specification

### 69. Expand Desktop Requirements to Implementation-Ready Specification
**Priority**: Nice to Have (Strategic)
**Location**: `docs/desktop-requirements.md`
**Category**: Documentation / Future Platform
**Estimated Effort**: 2-3 weeks documentation work

**Issue**: The current `docs/desktop-requirements.md` provides a solid foundation but lacks the extreme detail needed for a near-one-shot implementation of the desktop application. A developer (human or AI) should be able to build the entire Tauri desktop app from the specification alone.

**Impact**: Without exhaustive detail, desktop implementation will require extensive back-and-forth clarification, increasing development time and risk of divergence from the web version.

**Expansion Required**:

#### A. Complete API Contract Specification
- [ ] **A1**: Document every API endpoint with full request/response schemas
- [ ] **A2**: Include all HTTP status codes and error response formats
- [ ] **A3**: Specify authentication flow details (JWT structure, refresh logic)
- [ ] **A4**: Document rate limiting behavior and retry strategies
- [ ] **A5**: Include WebSocket/SSE event schemas for real-time updates
- [ ] **A6**: Specify pagination, filtering, and sorting parameters for all list endpoints

#### B. Complete UI Component Specifications
- [ ] **B1**: Detailed wireframes for every screen state (loading, error, empty, populated)
- [ ] **B2**: Exact pixel dimensions, spacing, and layout grid specifications
- [ ] **B3**: Color palette with exact hex values and semantic color names
- [ ] **B4**: Typography specifications (font families, sizes, weights, line heights)
- [ ] **B5**: Icon specifications (names, sizes, when to use each)
- [ ] **B6**: Animation and transition specifications (duration, easing, triggers)
- [ ] **B7**: Responsive breakpoints and behavior at each breakpoint
- [ ] **B8**: Accessibility specifications (ARIA labels, keyboard navigation, screen reader behavior)

#### C. State Management Specification
- [ ] **C1**: Complete state tree structure with TypeScript interfaces
- [ ] **C2**: State mutation rules (what can change, when, and how)
- [ ] **C3**: State persistence rules (what survives restart, where stored)
- [ ] **C4**: Derived state calculations (computed values, selectors)
- [ ] **C5**: State synchronization rules between UI and backend

#### D. File System & Storage Specification
- [ ] **D1**: Exact directory structure with all paths
- [ ] **D2**: File naming conventions for all file types
- [ ] **D3**: Database schema with all tables, columns, types, constraints
- [ ] **D4**: Index specifications for query optimization
- [ ] **D5**: Migration strategy from web MongoDB to desktop SQLite/LiteDB
- [ ] **D6**: Cache invalidation rules and TTLs
- [ ] **D7**: Temporary file lifecycle (when created, when cleaned up)

#### E. FITS Processing Specification
- [ ] **E1**: Exact algorithm implementations for each stretch function (with formulas)
- [ ] **E2**: Color map definitions with exact RGB values at each point
- [ ] **E3**: Histogram calculation algorithm (bin sizing, normalization)
- [ ] **E4**: Image downsampling algorithm for previews
- [ ] **E5**: Memory management strategy for large files
- [ ] **E6**: WCS coordinate transformation formulas
- [ ] **E7**: Multi-extension FITS handling rules

#### F. MAST Integration Specification
- [ ] **F1**: Complete astroquery API documentation (all methods, parameters, returns)
- [ ] **F2**: MAST field mappings (API field → internal field → display label)
- [ ] **F3**: Download state machine (all states, transitions, triggers)
- [ ] **F4**: Retry logic with exact backoff calculations
- [ ] **F5**: Resume protocol (byte range headers, validation, corruption detection)
- [ ] **F6**: Rate limiting handling (when to back off, how long)

#### G. Error Handling Specification
- [ ] **G1**: Complete error taxonomy (error codes, messages, user actions)
- [ ] **G2**: Error recovery procedures for each error type
- [ ] **G3**: Logging specifications (what to log, at what level, format)
- [ ] **G4**: Crash recovery procedures (state restoration, data integrity)
- [ ] **G5**: Offline mode behavior (what works, what doesn't, how to indicate)

#### H. Testing Specification
- [ ] **H1**: Test case catalog for all features (inputs, expected outputs)
- [ ] **H2**: Edge cases and boundary conditions to test
- [ ] **H3**: Performance benchmarks (operations per second, memory limits)
- [ ] **H4**: Sample test data files with expected results

#### I. Build & Distribution Specification
- [ ] **I1**: Complete Cargo.toml and package.json dependencies with exact versions
- [ ] **I2**: Tauri configuration with all options documented
- [ ] **I3**: Code signing requirements for each platform
- [ ] **I4**: Auto-update implementation details
- [ ] **I5**: Installer customization (icons, splash screens, license dialogs)

#### J. Sidecar Process Specification
- [ ] **J1**: Process lifecycle management (spawn, health check, restart, terminate)
- [ ] **J2**: IPC protocol details (port selection, message format, timeouts)
- [ ] **J3**: Resource limits (memory, CPU, handles)
- [ ] **J4**: Graceful shutdown sequence

**Deliverable Format**:
The expanded specification should be structured as multiple markdown files:
```
docs/desktop-spec/
├── README.md                 # Overview and navigation
├── 01-api-contracts.md       # Section A
├── 02-ui-components.md       # Section B
├── 03-state-management.md    # Section C
├── 04-storage.md             # Section D
├── 05-fits-processing.md     # Section E
├── 06-mast-integration.md    # Section F
├── 07-error-handling.md      # Section G
├── 08-testing.md             # Section H
├── 09-build-distribution.md  # Section I
├── 10-sidecar-processes.md   # Section J
├── appendix-a-schemas.md     # JSON schemas for all data structures
├── appendix-b-test-data.md   # Sample data and expected results
└── appendix-c-code-samples.md # Reference implementations
```

**Success Criteria**: A developer should be able to:
1. Build the complete desktop app without asking clarifying questions
2. Achieve feature parity with web version
3. Pass all specified test cases
4. Match UI specifications within 5% tolerance

---

## Previously Resolved Security Issues (Reference)

These security issues were addressed in earlier PRs but may warrant re-review given new audit findings:

| Task | Description | PR | Status |
|------|-------------|-----|--------|
| #1 | Path Traversal in Preview Endpoint | PR #26 | Resolved - different location than #51 |
| #3 | Regex Injection in MongoDB Search | PR #28 | Resolved - verify fix complete |
| #4 | Path Traversal in Export Endpoint | PR #29 | Resolved - different location than #51 |
| #19 | Configure CORS for Production | PR #78 | Resolved - may need header restrictions |

---

### Production Readiness - Medium (Code Quality/CI)

### 27. Add Test Coverage ✅ (Partial)
**Priority**: Medium
**Location**: All projects
**Status**: Backend tests complete (116 passing), frontend/processing TBD

**Completed**:
- ✅ Backend xUnit test project with 116 passing tests
- ✅ MongoDBService DI refactor complete (Task #38, PR #93)
- ✅ All 63 controller/service tests now enabled and passing
- ✅ Test fixtures for sample data generation
- ✅ CI integration (`dotnet test` in build pipeline)

**Remaining Work**:
1. ~~Refactor `MongoDBService` for DI~~ ✅ Complete (PR #93)
2. Frontend: Add Jest/React Testing Library tests for components
3. Processing Engine: Add pytest tests for MAST service, algorithms
4. Set coverage thresholds in CI

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

### 44. Add JWST GWCS Support for WCS Coordinates
**Priority**: Nice to Have
**Location**: `processing-engine/`

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
| #17 | Stretched Histogram Panel Drag UX | PR #86 |
| #38 | Refactor MongoDBService for Dependency Injection | PR #93 |
| #45 | Add Mandatory Documentation Updates to Workflows | Direct commit |
| #47 | Fix GetSearchCountAsync Incomplete Filter Logic | PR #95 |
| #50 | Exposed MongoDB Password (FALSE POSITIVE) | Verified no exposure |
| #51 | Path Traversal via obsId Parameter | PR #108 |
| #52 | SSRF Risk in MAST URL Construction | PR #110 |
| #53 | Path Traversal in Chunked Downloader | PR #112 |
| #54 | Missing HTTPS/TLS Enforcement | PR #113 |
| #55 | Missing Authentication on All API Endpoints | PR #117 |
| #58 | Docker Containers Run as Root | PR #TBD |
| #63 | Missing Security Headers in nginx | PR #113 |

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

### 48. Enable GitHub Branch Protection on Main
**Priority**: Medium (when repo becomes public)
**Location**: GitHub repository settings

**Issue**: Branch protection rules require GitHub Pro for private repos. Currently using local pre-push hook as workaround.

**Impact**: Direct pushes to main bypass CI and user review. Local hook can be bypassed with `--no-verify` or fresh clones without running setup script.

**Current Mitigations**:
- Pre-push hook (`.githooks/pre-push`) blocks local pushes to main
- Setup script (`scripts/setup-hooks.sh`) installs hooks
- Warning boxes in workflow files
- Enhanced PR template with reminders

**Fix Approach** (when repo is public):
1. Enable branch protection on `main` via GitHub Settings > Branches
2. Configure rules:
   - Require pull request before merging
   - Require status checks to pass (Lint, build-and-test, Docker Build)
   - Optionally: Require review approval
3. Test that direct pushes are rejected server-side
4. Update CLAUDE.md to note server-side protection is active

---

### 72. Frontend Authentication UI
**Priority**: High
**Location**: `frontend/jwst-frontend/src/`
**Category**: Security / User Experience

**Issue**: JWT authentication is implemented on the backend, but the frontend has no login UI. Currently, GET endpoints allow anonymous access as a workaround.

**Impact**:
- Users cannot log in via the web interface
- Write operations (upload, delete, process) fail with 401
- No user-specific features (ownership, sharing) available

**Fix Approach**:
1. Create `AuthContext` for global auth state management
2. Create `LoginPage` and `RegisterPage` components
3. Create `authService.ts` for login/register/refresh API calls
4. Store JWT in localStorage/sessionStorage
5. Add `Authorization: Bearer` header to all API requests via axios interceptor
6. Add `ProtectedRoute` component for authenticated-only pages
7. Add user menu with logout in header
8. Remove `[AllowAnonymous]` from read endpoints once complete

**Files to Create**:
- `src/contexts/AuthContext.tsx`
- `src/pages/LoginPage.tsx`
- `src/pages/RegisterPage.tsx`
- `src/services/authService.ts`
- `src/components/ProtectedRoute.tsx`
- `src/components/UserMenu.tsx`

**Files to Modify**:
- `src/App.tsx` - Add AuthProvider, routes
- `src/services/apiClient.ts` - Add auth header interceptor
- `backend/.../JwstDataController.cs` - Remove [AllowAnonymous] from GET endpoints

---

### 70. Streamline Documentation-Only PR Workflow
**Priority**: Medium
**Location**: `.github/workflows/`, `.github/PULL_REQUEST_TEMPLATE/`
**Category**: Developer Experience / CI Optimization

**Issue**: Documentation-only PRs run the full CI pipeline (frontend lint, backend lint, Python lint, Docker build) even though code hasn't changed. This wastes CI minutes and slows down simple doc updates.

**Impact**:
- Unnecessary CI time for docs changes
- Slower feedback loop for documentation work
- Same heavyweight process for a typo fix as a major feature

**Implementation Options**:

#### Option A: Path-Based CI (Recommended)
Skip code linting when only docs/markdown files change:
```yaml
# .github/workflows/lint.yml
jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      code_changed: ${{ steps.changes.outputs.code_changed }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Check for code changes
        id: changes
        run: |
          if git diff --name-only origin/main...HEAD | grep -qvE '^(docs/|\.agent/|.*\.md$)'; then
            echo "code_changed=true" >> $GITHUB_OUTPUT
          else
            echo "code_changed=false" >> $GITHUB_OUTPUT
          fi

  frontend-lint:
    needs: detect-changes
    if: needs.detect-changes.outputs.code_changed == 'true'
    # ... existing job

  backend-lint:
    needs: detect-changes
    if: needs.detect-changes.outputs.code_changed == 'true'
    # ... existing job
```

**Effort**: Medium | **Benefit**: Automatic, most robust

#### Option B: Docs PR Template
Create a dedicated template for documentation PRs:
```markdown
<!-- .github/PULL_REQUEST_TEMPLATE/docs.md -->
## 📝 Documentation Update

**Files changed:**
-

**Summary:**
-

**Checklist:**
- [ ] Spelling/grammar checked
- [ ] Links verified
- [ ] Formatting correct

---
_Docs-only PR - use `gh pr create -t "docs: ..." --template docs.md`_
```

**Effort**: Low | **Benefit**: Cleaner PR descriptions, clear intent

#### Option C: Auto-Merge for Docs PRs
Automatically merge docs-only PRs after basic validation:
```yaml
# .github/workflows/docs-auto-merge.yml
name: Auto-merge docs PRs
on:
  pull_request:
    paths:
      - 'docs/**'
      - '**.md'
      - '.agent/**'
    paths-ignore:
      - 'CLAUDE.md'  # Exclude critical config

jobs:
  auto-merge:
    if: |
      github.event.pull_request.user.login == 'authorized-user' &&
      startsWith(github.event.pull_request.title, 'docs:')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Enable auto-merge
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Effort**: Medium | **Benefit**: Fastest for trusted docs changes

#### Option D: Title Prefix Convention
Simple convention-based skip using PR title:
```yaml
# In existing lint.yml jobs
- name: Check if docs-only
  id: docs-check
  run: |
    if [[ "${{ github.event.pull_request.title }}" == docs:* ]]; then
      echo "skip=true" >> $GITHUB_OUTPUT
    fi

- name: Run lint
  if: steps.docs-check.outputs.skip != 'true'
  run: npm run lint
```

**Effort**: Low | **Benefit**: Quick win, minimal changes

**Recommended Approach**: Implement Options A + B together:
- Path-based CI handles detection automatically
- Docs template provides cleaner PR structure
- Consider Option C later for fully trusted automation

---

### 71. Split Large Documentation Files to Reduce Context Window Usage
**Priority**: Nice to Have (only if becomes a real problem)
**Location**: `docs/tech-debt.md`, `docs/desktop-requirements.md`, `docs/development-plan.md`
**Category**: Developer Experience / Context Optimization

**Issue**: Large markdown documentation files could theoretically consume significant context window space when read by AI assistants.

**Current State** (as of 2025-02):
- `tech-debt.md`: ~800 lines
- `desktop-requirements.md`: ~1000 lines
- `development-plan.md`: ~400 lines
- Total: ~3000 lines ≈ 10-15K tokens (~5-7% of 200K context)

**Assessment**: **NOT currently a problem.** Claude's context window is large, docs are read selectively, and automatic summarization handles long conversations.

**When to Revisit**:
- If responses degrade noticeably during doc-heavy sessions
- If doc count grows significantly (20+ large files)
- If same docs are being re-read repeatedly in single sessions

**Potential Solutions** (if needed):
1. **Split files**: Break into focused sub-files (e.g., `tech-debt-security.md`, `tech-debt-resolved.md`)
2. **Summary + detail**: Short summary in main file, details in linked files
3. **Archive resolved**: Move completed items to archive files
4. **Index pattern**: Single index file pointing to topic-specific docs

**Do Not Implement** unless actual context issues are observed.

---

## Code Style Analyzer Suppressions (Tech Debt)

The following StyleCop and CodeAnalysis rules are suppressed in `backend/.editorconfig`. Each suppression should be tracked and eventually resolved to maintain code quality standards.

### 77. SA1202 - Public Members Before Private Members
**Priority**: Medium
**Location**: `backend/.editorconfig`, affects `MongoDBService.cs`, `MastController.cs`, `JwstDataController.cs`, `DataManagementController.cs`
**Category**: Code Organization

**Issue**: Public members should come before private members in class declarations. Currently suppressed because large controller/service files organize methods by functionality rather than visibility.

**Impact**: Reduced code consistency; developers must search through files to find public API surface.

**Fix Approach**:
1. Reorder methods in `MongoDBService.cs` (~700 lines) - move all public methods before private
2. Reorder methods in `MastController.cs` (~1500 lines)
3. Reorder methods in `JwstDataController.cs` (~1700 lines)
4. Reorder methods in `DataManagementController.cs` (~740 lines)
5. Remove suppression from `.editorconfig`

**Estimated Effort**: 4-6 hours (careful refactoring to avoid breaking changes)

---

### 78. SA1204 - Static Members Before Non-Static Members
**Priority**: Medium
**Location**: `backend/.editorconfig`, affects `MastController.cs`, `JwstDataController.cs`, `DataManagementController.cs`
**Category**: Code Organization

**Issue**: Static members should appear before non-static members. Currently suppressed because static helper methods are placed near the instance methods that use them.

**Impact**: Inconsistent code organization; harder to identify class-level vs instance-level members.

**Fix Approach**:
1. Move all private static methods before private instance methods in affected controllers
2. Remove suppression from `.editorconfig`

**Estimated Effort**: 2-3 hours

---

### 79. SA1402 - File May Only Contain Single Type
**Priority**: Low
**Location**: `backend/.editorconfig`, affects `Models/*.cs` files
**Category**: File Organization

**Issue**: Each file should contain only one type. Currently suppressed to allow grouping related DTOs together (e.g., `MastModels.cs` contains multiple request/response DTOs).

**Impact**: Large model files; potentially harder to navigate.

**Fix Approach**:
1. Split `MastModels.cs` into separate files per DTO class
2. Split `CompositeModels.cs` into separate files
3. Split `UserModels.cs` if needed
4. Remove suppression from `.editorconfig`

**Estimated Effort**: 2-3 hours

---

### 80. SA1649 - File Name Should Match First Type Name
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: File Naming
**Depends On**: Task #79 (SA1402)

**Issue**: File name should match the first type declared in the file. This is related to SA1402 - once files contain single types, names will naturally match.

**Fix Approach**: Resolve Task #79 first, then remove this suppression.

**Estimated Effort**: Included in Task #79

---

### 81. CA1805 - Don't Initialize to Default Value
**Priority**: Low
**Location**: `backend/.editorconfig`, affects all model classes
**Category**: Code Style

**Issue**: Rule suggests not initializing fields to their default values (e.g., `= false`, `= 0`, `= null`). Currently suppressed because explicit initialization improves readability and intent.

**Impact**: Minor - explicit initialization is arguably better for documentation purposes.

**Fix Approach**:
1. Discuss team preference: implicit vs explicit defaults
2. If keeping explicit: document as intentional style choice, keep suppression
3. If removing: update all model classes to remove redundant initializers

**Estimated Effort**: 1-2 hours if removing initializers

---

### 82. SA1316 - Tuple Element Names Should Use Correct Casing
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Naming Convention

**Issue**: Tuple element names should use PascalCase (e.g., `(string Name, int Count)` not `(string name, int count)`).

**Impact**: Minor style inconsistency in tuple declarations.

**Fix Approach**:
1. Search for tuple declarations with lowercase names
2. Update to PascalCase
3. Remove suppression from `.editorconfig`

**Estimated Effort**: 30 minutes

---

### 83. SA1500 - Braces Should Not Share Line
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Formatting

**Issue**: Opening braces for multi-line statements should be on their own line. Currently suppressed for flexibility in formatting.

**Impact**: Minor formatting inconsistency.

**Fix Approach**:
1. Run `dotnet format` with updated .editorconfig
2. Review and adjust any problematic auto-fixes
3. Remove suppression from `.editorconfig`

**Estimated Effort**: 30 minutes

---

### 84. SA1117 - Parameters on Same or Separate Lines
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Formatting

**Issue**: Parameters should either all be on the same line, or each on a separate line. Currently suppressed for formatting flexibility.

**Impact**: Minor formatting inconsistency in method signatures.

**Fix Approach**:
1. Review method signatures with mixed parameter placement
2. Standardize formatting
3. Remove suppression from `.editorconfig`

**Estimated Effort**: 1 hour

---

### 85. SA1116 - Split Parameters Should Start After Declaration
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Formatting

**Issue**: When splitting parameters across lines, first parameter should be on new line after method name.

**Impact**: Minor formatting inconsistency.

**Fix Approach**:
1. Review and fix method signatures
2. Remove suppression from `.editorconfig`

**Estimated Effort**: 30 minutes

---

### 86. SA1113 - Comma on Same Line as Previous Parameter
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Formatting

**Issue**: When parameters span multiple lines, comma should be on same line as preceding parameter.

**Impact**: Minor formatting inconsistency.

**Fix Approach**:
1. Review multi-line parameter lists
2. Move commas to end of lines where needed
3. Remove suppression from `.editorconfig`

**Estimated Effort**: 30 minutes

---

### 87. SA1001 - Commas Should Be Spaced Correctly
**Priority**: Low
**Location**: `backend/.editorconfig`
**Category**: Formatting

**Issue**: Commas should be followed by a space and not preceded by a space.

**Impact**: Minor formatting inconsistency.

**Fix Approach**:
1. Run `dotnet format`
2. Review any remaining issues
3. Remove suppression from `.editorconfig`

**Estimated Effort**: 15 minutes

---

### 88. Token Refresh Failure Logs User Out Instead of Retrying
**Priority**: HIGH
**Location**: `frontend/jwst-frontend/src/context/AuthContext.tsx:152-169`, `frontend/jwst-frontend/src/services/apiClient.ts:163-188`
**Category**: Auth / UX

**Issue**: When the scheduled token refresh (fires 60s before expiry) fails for any reason (network blip, backend restart), `refreshAuth()` catches the error and calls `clearState()` which immediately logs the user out. This is particularly disruptive during long-running operations like MAST bulk downloads, where the 15-minute access token expires mid-operation.

**Impact**: Users get kicked to the login page during bulk MAST imports. Download state is preserved for resume, but the UX is jarring.

**Fix Approach**:
1. Add retry logic (2-3 attempts with backoff) before calling `clearState()`
2. Consider extending access token lifetime for long-running operations
3. Show a toast/warning instead of silently logging out on refresh failure
4. Ensure the 401 retry in `apiClient` also retries the refresh before giving up

**Estimated Effort**: 1-2 hours

---

### 89. Incomplete Downloads Panel UX Improvements
**Priority**: LOW
**Location**: `frontend/jwst-frontend/src/components/MastSearch.tsx:929-965`
**Category**: UX

**Issue**: Several UX issues with the "Incomplete Downloads" panel in MAST Search:
1. Panel is always expanded when there are resumable jobs — should be collapsible and default to collapsed
2. Downloads are not sorted by recency — most recent should appear at the top
3. No way to dismiss/remove an incomplete download. If removing, should prompt whether to also delete any partially downloaded files that completed successfully

**Fix Approach**:
1. Add `resumableCollapsed` state (default `true`) with toggle button/chevron on header
2. Sort `resumableJobs` by timestamp descending before rendering
3. Add a remove/dismiss button per row. On click, show confirmation dialog: if some files were already downloaded, ask whether to keep or delete them. Call backend endpoint to clean up download state (and optionally delete files)

**Estimated Effort**: 1-2 hours

---

### 90. Disable Seed Users in Production
**Priority**: MEDIUM
**Location**: `backend/JwstDataAnalysis.API/Services/SeedDataService.cs`, `appsettings.json`
**Category**: Security

**Issue**: The `SeedDataService` creates default users on every startup if they don't exist. This is useful for development and testing (fresh databases always have a working admin), but must be disabled before any production deployment to prevent unauthorized default accounts.

**Fix Approach**:
1. Add `"Seeding": { "Enabled": false }` to `appsettings.Production.json`
2. Check `Enabled` flag in `SeedDataService.SeedUsersAsync()` before creating users
3. Log a warning if seeding is enabled in non-Development environments

**Estimated Effort**: 30 minutes

---

### 91. Incomplete Downloads Panel Not Visible After Cancel
**Priority**: LOW
**Location**: `frontend/jwst-frontend/src/components/MastSearch.tsx`
**Category**: UX Bug

**Issue**: After cancelling an active download, the Incomplete Downloads panel doesn't appear until the user hides and re-shows the MAST Search panel. The `resumableJobs` state is only fetched on component mount (`useEffect`), so a newly-cancelled download doesn't trigger a refresh.

**Fix Approach**: After a cancel completes, re-fetch the resumable jobs list (`/mast/download/resumable`) to refresh the panel immediately.

**Estimated Effort**: 15 minutes

---

## Adding New Tech Debt

1. Add to this file under "Remaining Tasks"
2. Assign next task number (currently: #92)
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

### 43. Generate and Host OpenAPI Spec
**Priority**: Medium
**Location**: `docs/api/openapi.json`

**Issue**: The API Spec link in the documentation is broken (404) because the `openapi.json` file has not been generated or exported from the backend.
**Impact**: Developers and agents cannot easily reference the API contracts.
**Fix Approach**:
1. Export the OpenAPI/Swagger JSON from the running .NET backend.
2. Save it to `docs/api/openapi.json`.
3. Uncomment the API Spec link in `mkdocs.yml`.

---

### 46. Review Emoji Usage in Workflow Files
**Priority**: Nice to Have
**Location**: `.agent/workflows/*.md`

**Issue**: Emojis (🛑, ⚠️, 📚) were added to workflow files in PR #94 as visual markers for critical steps. However, the project guidelines state "avoid emojis unless explicitly requested."

**Discussion Points**:
1. Are emojis appropriate in internal workflow files (not user-facing code)?
2. Do they serve a legitimate purpose as visual "stop signs" to prevent skipping steps?
3. Should we use text markers instead (`[STOP]`, `[REQUIRED]`, `[CRITICAL]`)?
4. Should we update CLAUDE.md to clarify emoji policy for different file types?

**Options**:
- A: Remove all emojis, use text markers
- B: Keep emojis in workflows only (internal tooling exception)
- C: Selective use (keep 🛑 for critical stops, remove decorative ones)

**Decision**: TBD

---

### 49. Revisit Export Filename Pattern
**Priority**: Low (Nice to Have)
**Location**: `frontend/jwst-frontend/src/components/ImageViewer.tsx`

**Issue**: The PNG export filename pattern (`{obs_id}_{instrument}_{filter}_{timestamp}.png`) was chosen for initial implementation but may benefit from refinement.

**Discussion Points**:
1. Should the colormap/stretch settings be included in the filename or metadata?
2. Would users prefer a customizable filename input field?
3. Should we embed EXIF/PNG metadata with the visualization settings used?
4. Consider adding export presets (e.g., "for publication", "quick share")

**Current Implementation**: Observation ID + timestamp for uniqueness.

**Decision**: TBD - gather user feedback after initial implementation
