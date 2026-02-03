# Tech Debt Tracking

This document tracks tech debt items and their resolution status.

## Summary

| Status | Count |
|--------|-------|
| **Resolved** | 38 |
| **Remaining** | 25 |

> **Security Audit (2026-02-02)**: Comprehensive audit identified 18 new security issues across all layers. See "Security Tech Debt" section below.

## Remaining Tasks (30)

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

### 55. Missing Authentication on All API Endpoints
**Priority**: HIGH
**Location**: All controllers in `backend/JwstDataAnalysis.API/Controllers/`
**Category**: Access Control

**Issue**: No `[Authorize]` attributes on any endpoints. All API operations are publicly accessible.

**Impact**: Unauthorized users can create, modify, delete data, trigger expensive MAST downloads.

**Fix Approach**:
1. Implement JWT authentication
2. Add `[Authorize]` to all controller classes
3. Use `[AllowAnonymous]` only for explicitly public endpoints
4. Implement role-based access control (RBAC)

---

### 56. Unbounded Memory Allocation in FITS Processing
**Priority**: HIGH
**Location**: `processing-engine/main.py:283-319, 441-468, 592-620`
**Category**: Denial of Service

**Issue**: FITS files are loaded entirely into memory without size checks:
```python
data = hdu.data.astype(np.float64)  # Full allocation
```

**Attack Vector**: Upload/request large FITS file → OutOfMemory → service crash.

**Fix Approach**:
1. Add file size limit check before loading (e.g., 5GB max)
2. Add array element count limit (e.g., 100M elements)
3. Return 413 Payload Too Large for oversized files
4. Consider streaming/chunked processing for large files

---

### 57. Missing Input Validation on Numeric Parameters
**Priority**: HIGH
**Location**: `processing-engine/main.py:249-257` and `backend/JwstDataAnalysis.API/Controllers/JwstDataController.cs:85-96`
**Category**: Input Validation / DoS

**Issue**: Preview endpoint parameters lack range validation:
- `width`, `height`: No maximum (could request 999999x999999 image)
- `gamma`: No minimum (gamma=0 causes division by zero)
- `blackPoint`, `whitePoint`: No bounds checking

**Fix Approach**:
1. Backend: Add `[Range]` attributes to parameters
2. Python: Use FastAPI `Query()` with `ge`/`le` constraints
3. Set reasonable limits: width/height 10-8000, gamma 0.1-5.0

---

### 58. Docker Containers Run as Root
**Priority**: HIGH
**Location**: All Dockerfiles (`backend/`, `processing-engine/`, `frontend/`)
**Category**: Container Security

**Issue**: No `USER` directive - containers run as root (UID 0).

**Impact**: Container escape easier, can modify system files, access host resources.

**Fix Approach**:
```dockerfile
RUN useradd -m -u 1000 appuser
# ... build steps ...
USER appuser
```

---

### 59. MongoDB Port Exposed to Host Network
**Priority**: HIGH
**Location**: `docker/docker-compose.override.yml:6-7`
**Category**: Network Exposure

**Issue**: Development override exposes MongoDB on port 27017 to the host machine.

**Impact**: Anyone on the network can connect to MongoDB if auth fails or credentials are weak.

**Fix Approach**:
1. Remove port mapping from override (use Docker networking)
2. If port needed, bind to localhost only: `127.0.0.1:27017:27017`
3. Enable MongoDB TLS for any non-local scenarios

---

### 60. Unsafe URL Construction in Frontend
**Priority**: HIGH
**Location**: `frontend/jwst-frontend/src/components/ImageViewer.tsx:597`
**Category**: Open Redirect

**Issue**: Direct URL concatenation without validation:
```typescript
window.open(`${API_BASE_URL}/api/jwstdata/${dataId}/file`, '_blank')
```

**Attack Vector**: Malicious `dataId` containing URL could redirect users.

**Fix Approach**:
1. Validate `dataId` format (alphanumeric/UUID only)
2. Use URL constructor to properly build and validate URLs
3. Whitelist allowed domains

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

### 65. Information Disclosure in Error Messages
**Priority**: MEDIUM
**Location**: `backend/JwstDataAnalysis.API/Controllers/JwstDataController.cs:140-142, 238-240`
**Category**: Error Handling

**Issue**: Error messages expose internal processing engine responses and file paths.

**Fix Approach**:
1. Log detailed errors server-side
2. Return generic error messages to clients
3. Use correlation IDs for debugging

---

### 66. Race Condition in Download Resume
**Priority**: MEDIUM
**Location**: `processing-engine/app/mast/routes.py:422-439`
**Category**: Concurrency

**Issue**: No check for duplicate resume requests - two clients could resume same job simultaneously.

**Fix Approach**:
1. Track in-progress resumes in a set with async lock
2. Return 409 Conflict if job already being resumed
3. Clean up tracking on completion/failure

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

## Adding New Tech Debt

1. Add to this file under "Remaining Tasks"
2. Assign next task number (currently: #73)
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

