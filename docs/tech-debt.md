# Tech Debt Tracking

This document tracks tech debt items and their resolution status.

## Summary

| Status | Count |
|--------|-------|
| **Resolved** | 14 |
| **Remaining** | 22 |

## Remaining Tasks (22)

### Production Readiness - Critical (Security)

### 18. Remove Hardcoded Credentials from Repository
**Priority**: Critical (Security)
**Location**: `docker/docker-compose.yml`, `backend/JwstDataAnalysis.API/appsettings.json`

**Issue**: MongoDB credentials (`admin/password`) and connection strings are hardcoded in committed files.

**Impact**: Security vulnerability if repo goes public; credentials exposed in git history.

**Fix Approach**:
1. Create `.env.example` with placeholder values
2. Update `docker-compose.yml` to use `${MONGO_USER}`, `${MONGO_PASSWORD}` variables
3. Update `appsettings.json` to read from environment variables
4. Add `.env` to `.gitignore`
5. Audit git history for any other secrets (consider using `git-filter-repo` if needed)

---

### 19. Configure CORS for Production
**Priority**: Critical (Security)
**Location**: `backend/JwstDataAnalysis.API/Program.cs`

**Issue**: CORS currently allows all origins (`AllowAnyOrigin()`), which is insecure for production.

**Impact**: Cross-site request forgery risk; any website can make API requests.

**Fix Approach**:
1. Create environment-based CORS configuration
2. Development: Allow localhost origins
3. Production: Whitelist specific domains via environment variable
4. Add `ALLOWED_ORIGINS` to `.env.example`

---

### 20. Add Input Validation and Rate Limiting
**Priority**: Critical (Security)
**Location**: Backend API controllers

**Issue**: No rate limiting on API endpoints; limited input validation on some endpoints.

**Impact**: API vulnerable to abuse, DoS attacks, or resource exhaustion.

**Fix Approach**:
1. Add `AspNetCoreRateLimit` NuGet package
2. Configure rate limits per endpoint/IP
3. Add request size limits
4. Validate all user inputs with data annotations

---

### Production Readiness - High (Required for Public Repo)

### 21. Create Public README.md
**Priority**: High
**Location**: `/README.md` (new file)

**Issue**: `CLAUDE.md` contains internal development notes not suitable as public documentation.

**Impact**: No clear project introduction for potential users/contributors.

**Fix Approach**:
1. Create `README.md` with:
   - Project description and purpose
   - Screenshots/demo GIF
   - Features list
   - Quick start guide (Docker)
   - Technology stack
   - License badge
2. Keep `CLAUDE.md` for Claude Code context (consider renaming to `.claude/instructions.md`)

---

### 22. Add LICENSE File
**Priority**: High
**Location**: `/LICENSE` (new file)

**Issue**: No license file; unclear if code can be used/modified by others.

**Impact**: Legal ambiguity discourages contributions and use.

**Fix Approach**:
1. Choose appropriate license:
   - MIT: Permissive, simple
   - Apache 2.0: Permissive with patent protection
   - GPL-3.0: Copyleft, requires derivative works to be open source
2. Create `LICENSE` file with full license text
3. Add license badge to README

---

### 23. Add CONTRIBUTING.md and Community Files
**Priority**: High
**Location**: `/CONTRIBUTING.md`, `/CODE_OF_CONDUCT.md`, `/SECURITY.md` (new files)

**Issue**: No guidance for contributors or security reporting process.

**Impact**: Potential contributors don't know how to help; security issues may be disclosed publicly.

**Fix Approach**:
1. Create `CONTRIBUTING.md`:
   - Development setup instructions
   - Code style guidelines
   - PR process and requirements
   - Issue reporting guidelines
2. Create `CODE_OF_CONDUCT.md` (use Contributor Covenant)
3. Create `SECURITY.md`:
   - How to report vulnerabilities privately
   - Response timeline expectations
   - Supported versions

---

### 24. Add GitHub Issue and PR Templates
**Priority**: High
**Location**: `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` (new files)

**Issue**: No structured templates for issues and PRs.

**Impact**: Inconsistent issue reports; missing information in bug reports.

**Fix Approach**:
1. Create `.github/ISSUE_TEMPLATE/bug_report.md`
2. Create `.github/ISSUE_TEMPLATE/feature_request.md`
3. Create `.github/PULL_REQUEST_TEMPLATE.md` with checklist
4. Create `.github/ISSUE_TEMPLATE/config.yml` for template chooser

---

### 25. Separate Development and Production Docker Configurations
**Priority**: High
**Location**: `docker/`

**Issue**: Single `docker-compose.yml` used for both dev and production.

**Impact**: Development conveniences (exposed ports, debug flags) may leak to production.

**Fix Approach**:
1. Create `docker-compose.yml` (base configuration)
2. Create `docker-compose.override.yml` (dev defaults, auto-loaded)
3. Create `docker-compose.prod.yml` (production overrides)
4. Document usage: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up`

---

### Production Readiness - Medium (Code Quality/CI)

### 26. Add GitHub Actions CI/CD Pipeline
**Priority**: Medium
**Location**: `.github/workflows/` (new directory)

**Issue**: No automated testing or build verification on PRs.

**Impact**: Broken code can be merged; no consistent quality gate.

**Fix Approach**:
1. Create `.github/workflows/ci.yml`:
   - Build .NET backend
   - Build React frontend
   - Run tests (when added)
   - Build Docker images
2. Create `.github/workflows/security.yml`:
   - Dependabot alerts
   - CodeQL analysis
3. Add status badges to README

---

### 27. Add Test Coverage
**Priority**: Medium
**Location**: All projects

**Issue**: Minimal/no automated tests across the stack.

**Impact**: Regressions go undetected; refactoring is risky.

**Fix Approach**:
1. Backend: Add xUnit tests for `MongoDBService`, controllers
2. Frontend: Add Jest/React Testing Library tests for components
3. Processing Engine: Add pytest tests for MAST service, algorithms
4. Set coverage thresholds in CI

---

### 28. Add Linting and Formatting Configurations
**Priority**: Medium
**Location**: Root directory

**Issue**: No enforced code style; inconsistent formatting.

**Impact**: Code style varies; harder to review PRs.

**Fix Approach**:
1. Add `.editorconfig` for universal settings
2. Add `.eslintrc.json` and `.prettierrc` for frontend
3. Add `ruff.toml` for Python linting
4. Add `.NET analyzers` configuration
5. Add pre-commit hooks via `husky` (frontend) or `pre-commit` (Python)

---

### 29. Enable Dependabot for Dependency Updates
**Priority**: Medium
**Location**: `.github/dependabot.yml` (new file)

**Issue**: No automated dependency update process.

**Impact**: Dependencies become outdated; security vulnerabilities accumulate.

**Fix Approach**:
1. Create `.github/dependabot.yml` with:
   - npm updates for frontend
   - NuGet updates for backend
   - pip updates for processing engine
   - Docker base image updates
2. Configure update frequency (weekly recommended)

---

### Production Readiness - Nice to Have (Polish)

### 30. Add Application Logging and Monitoring Hooks
**Priority**: Nice to Have
**Location**: Backend, Processing Engine

**Issue**: Basic console logging only; no structured logging for production.

**Impact**: Difficult to debug production issues; no metrics collection.

**Fix Approach**:
1. Add Serilog to .NET backend with JSON output
2. Add structured logging to Python with `structlog`
3. Add health check endpoints (`/health`, `/ready`)
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

### 35. Review and Clean Git History
**Priority**: Nice to Have (but do before making public)
**Location**: Git repository

**Issue**: Git history may contain sensitive information, large files, or messy commits.

**Impact**: Security risk; large repo size; unprofessional appearance.

**Fix Approach**:
1. Use `git log -p` to review for secrets
2. Use `trufflehog` or `gitleaks` to scan for credentials
3. If secrets found, use `git-filter-repo` to remove them
4. Consider squashing early development commits (optional)
5. Ensure `.gitignore` covers all sensitive/generated files

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

## Resolved Tasks (14)

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

## Adding New Tech Debt

1. Add to this file under "Remaining Tasks"
2. Assign next task number (currently: #37)
3. Include: Priority, Location, Issue, Impact, Fix Approach
