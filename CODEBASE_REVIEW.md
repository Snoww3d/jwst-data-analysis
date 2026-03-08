# JWST Data Analysis - Deep Codebase Review

**Date**: 2026-03-08
**Scope**: Full-stack review covering all 818 files across Python backend, React frontend, .NET API gateway, and infrastructure.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Critical Issues](#critical-issues)
4. [Backend: Processing Engine (Python/FastAPI)](#backend-processing-engine)
5. [Frontend (React/TypeScript)](#frontend)
6. [API Gateway (.NET/C#)](#api-gateway)
7. [Infrastructure & CI/CD](#infrastructure--cicd)
8. [Security Assessment](#security-assessment)
9. [Testing Assessment](#testing-assessment)
10. [Recommended Action Plan](#recommended-action-plan)

---

## Executive Summary

| Layer | Grade | Production Ready? |
|-------|-------|-------------------|
| Processing Engine (Python) | **B+** | Yes, with fixes |
| Frontend (React/TS) | **B** | Yes, with fixes |
| API Gateway (.NET) | **C+** | **No** - security blockers |
| Infrastructure/CI | **B** | Yes, with hardening |

**Total issues found**: 67
- Critical: 11
- High: 15
- Medium: 23
- Low: 18

The codebase demonstrates strong fundamentals - clean modular architecture, good separation of concerns, and solid testing discipline. However, there are **security blockers in the .NET gateway** (hardcoded secrets, path traversal), **performance risks in the Python backend** (blocking I/O in async handlers), and **maintainability debt in the frontend** (oversized components with 50+ state variables).

---

## Architecture Overview

```
                    ┌─────────────────────┐
                    │   React Frontend    │
                    │  (Vite + TypeScript) │
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │   Nginx Reverse     │
                    │   Proxy (SSL/WS)    │
                    └──┬──────────────┬───┘
                       │              │
              ┌────────▼─────┐  ┌────▼──────────────┐
              │  .NET API    │  │ Processing Engine  │
              │  Gateway     │  │ (FastAPI/Python)   │
              │  (C# 10.0)  │  │                    │
              └──┬───────┬──┘  └────┬───────────────┘
                 │       │          │
          ┌──────▼──┐ ┌──▼────┐ ┌──▼─────┐
          │ MongoDB │ │ S3/   │ │ MAST   │
          │         │ │ Local │ │ Archive │
          └─────────┘ └───────┘ └────────┘
```

**Stack**: React 19 + Vite | ASP.NET Core 10 | FastAPI + astropy | MongoDB 8 | SeaweedFS/S3 | Nginx

---

## Critical Issues

### CRIT-1: Hardcoded JWT Secret in .NET Gateway
- **File**: `backend/JwstDataAnalysis.API/appsettings.json:10`
- **Risk**: Complete authentication bypass if deployed with defaults
- **Fix**: Require secret via environment variable, fail on startup if missing

### CRIT-2: Blocking I/O in Async Handlers (Python)
- **File**: `processing-engine/app/analysis/routes.py:242, 395, 662`
- **Risk**: `fits.open()` blocks the async event loop, causing request queuing under load
- **Fix**: Wrap with `asyncio.to_thread(fits.open, ...)`

### CRIT-3: Mutable Module-Level State Without Locks (Python)
- **File**: `processing-engine/app/mast/routes.py:60-65`
- **Risk**: `_active_downloaders`, `_speed_trackers`, `_resuming_jobs` are shared dicts with no synchronization
- **Fix**: Add `asyncio.Lock` guards

### CRIT-4: Path Traversal in .NET File Storage
- **File**: `backend/.../LocalStorageProvider.cs:118-119`
- **Risk**: Insufficient path validation allows directory escape on Windows
- **Fix**: Use `Path.GetFullPath()` and verify prefix match against storage root

### CRIT-5: S3StorageProvider Registered as Singleton with IDisposable
- **File**: `backend/.../S3StorageProvider.cs:20`
- **Risk**: Resource leak - S3 client connections never disposed
- **Fix**: Use factory pattern or `IDisposable`-aware DI registration

### CRIT-6: Hardcoded Seed Passwords
- **File**: `backend/.../SeedDataService.cs:44-54`
- **Risk**: Default admin password `"Admin123!"` in source code
- **Fix**: Remove seed data service or require configuration

### CRIT-7: CancellationTokenSource Leaks
- **File**: `backend/.../ImportJobTracker.cs:40-42`
- **Risk**: Unmanaged CTS instances never disposed, causing memory growth
- **Fix**: Track and dispose CTS after job completion

### CRIT-8: PR Workflow Uses `pull_request_target`
- **File**: `.github/workflows/pr-standards.yml:4`
- **Risk**: Fork PRs can access repository secrets
- **Fix**: Switch to `pull_request` trigger or add explicit permission restrictions

### CRIT-9: Exception Details Exposed to Clients (Python)
- **Files**: `processing-engine/app/mast/routes.py:171, 211, 243, 275`
- **Risk**: `str(e)` in HTTPException detail leaks internal paths, stack traces
- **Fix**: Return generic error messages; log details server-side

### CRIT-10: No `ConfigureAwait(false)` in Entire .NET Codebase
- **Files**: All 131 C# files
- **Risk**: Thread pool starvation under load due to synchronization context capture
- **Fix**: Add `ConfigureAwait(false)` to all awaited calls in non-UI code

### CRIT-11: Weak Password Validation
- **File**: `backend/.../AuthModels.cs:37`
- **Risk**: Only length check, no complexity requirements (uppercase, digits, symbols)
- **Fix**: Add proper password complexity rules

---

## Backend: Processing Engine

**Files**: 84 Python files | ~22,450 lines | FastAPI

### Strengths
- Clean modular separation: `processing/`, `storage/`, `mast/`, `composite/`, `mosaic/`, `discovery/`, `semantic/`, `analysis/`
- Excellent security: path traversal protection in `helpers.py:45`, SSRF prevention in `mast_service.py:87-134`
- Strong storage abstraction: transparent local/S3 switching via provider pattern
- 30 test files with parametrized edge cases
- Comprehensive SSRF test suite (`test_mast_service_security.py`: 73 tests)
- Atomic file writes with temp files (`download_state_manager.py:138-141`)

### Issues

#### Code Quality
| Issue | File | Severity |
|-------|------|----------|
| **Monolithic main.py** (1,005 lines) - all endpoint logic in one file | `main.py` | High |
| **Massive code duplication**: FITS processing logic repeated across preview, histogram, thumbnail | `main.py:337-521` vs `599-742` | High |
| **Filename sanitization duplicated** | `chunked_downloader.py:84-117` + `s3_downloader.py:41-53` | Medium |
| Missing type hints on 8+ function signatures | `main.py:45, 117, 162` | Medium |
| `generate_preview` function exceeds 300 lines | `main.py:224` | Medium |
| `generate_nchannel_composite` function 180 lines | `composite/routes.py:373` | Medium |

#### Performance
| Issue | File | Severity |
|-------|------|----------|
| Histogram loads full image then subsamples (should use memmap) | `main.py:649-656` | Medium |
| Cache cleanup sorts entire dict on every search - O(n log n) | `mast/routes.py:106-112` | Medium |
| `scipy.ndimage.zoom()` instead of faster PIL resize | `composite/routes.py` | Low |
| FAISS index rebuild O(n) for file_id removal | `embedding_service.py:188-223` | Low |

#### Error Handling
| Issue | File | Severity |
|-------|------|----------|
| Silent index reset on load failure | `embedding_service.py:79-82` | Medium |
| Background estimation can hang indefinitely (no timeout) | `analysis/routes.py:290-299` | High |
| Fallback to linear stretch hides real errors | `main.py:193-195` | Low |

#### Dependencies
| Issue | Severity |
|-------|----------|
| `sentence-transformers >=3.0.0,<6.0.0` - overly wide range allows breaking changes | Medium |
| No rate limiting library for MAST endpoints (recommend `slowapi`) | Medium |

---

## Frontend

**Files**: 113 TSX + 91 TS + 59 CSS | React 19 + Vite + TypeScript

### Strengths
- Strict TypeScript configuration with `noUnusedLocals`/`noUnusedParameters`
- No `dangerouslySetInnerHTML` or `eval()` usage
- Clean directory structure: pages, components, services, types, hooks, utils, context
- Good resource cleanup: Blob URL revocation, AbortController patterns, event listener cleanup
- Comprehensive keyboard shortcuts in ImageViewer
- Well-decomposed wizard step components and discovery components

### Issues

#### Architecture (Critical)
| Issue | File | Severity |
|-------|------|----------|
| **ImageViewer.tsx: 1,796 lines with 54 useState variables** | `src/components/ImageViewer.tsx` | Critical |
| **JwstDataDashboard.tsx: 700 lines with 33 state variables** | `src/components/JwstDataDashboard.tsx` | High |
| **MastSearch.tsx: 1,548 lines** | `src/components/MastSearch.tsx` | High |
| State updates during render (anti-pattern) | `ImageViewer.tsx:422-438, 513-551` | High |
| No code splitting/lazy loading for page routes | App-wide | High |

#### Security
| Issue | File | Severity |
|-------|------|----------|
| JWT tokens stored in localStorage (XSS-accessible) | `ImageViewer.tsx:462`, `apiClient.ts` | High |
| Direct `fetch()` calls bypass centralized apiClient | `ImageViewer.tsx`, `ImageComparisonViewer.tsx` | Medium |
| Hardcoded API fallback `localhost:5001` could leak to prod | `config/api.ts` | Medium |

#### Quality
| Issue | File | Severity |
|-------|------|----------|
| Console.error/warn in production code (7+ instances) | `ImageViewer.tsx:567,590,632` | Medium |
| Missing `aria-label` on icon buttons throughout UI | Multiple files | Medium |
| Missing `aria-live` regions for status updates | Multiple files | Medium |
| No request deduplication for rapid histogram fetches | `ImageViewer.tsx` | Low |
| No bundle size monitoring | Build config | Low |

#### Testing
| Issue | Severity |
|-------|----------|
| 71 test files but tests are shallow (render-only checks) | High |
| Heavy child component mocking reduces test value | Medium |
| No meaningful E2E tests for core flows | High |

---

## API Gateway

**Files**: 131 C# files | ASP.NET Core 10.0 | MongoDB + SignalR

### Strengths
- Clear Controllers -> Services -> Models architecture
- Proper dependency injection throughout
- Async/await used correctly (minus ConfigureAwait)
- Interface-driven design enables testability
- Configuration-driven with appsettings + environment variables
- Storage abstraction supports local and S3 backends
- 37 test files covering main components

### Issues

#### Security (Critical)
| Issue | File | Severity |
|-------|------|----------|
| Hardcoded JWT secret | `appsettings.json:10` | Critical |
| Weak password validation (length only) | `AuthModels.cs:37` | Critical |
| Hardcoded seed passwords | `SeedDataService.cs:44-54` | Critical |
| S3 credentials in config file | `S3Settings.cs:27-32` | Critical |
| No security headers middleware | `Program.cs` | High |
| Missing CSRF protection | App-wide | High |
| Path traversal vulnerability | `LocalStorageProvider.cs:118-119` | Critical |
| No rate limiting on auth endpoints | `AuthController.cs` | High |
| AllowAnonymous on search enables DoS | `MastController.cs:65` | Medium |

#### Code Quality
| Issue | File | Severity |
|-------|------|----------|
| Zero `ConfigureAwait(false)` across 131 files | All files | Critical |
| S3StorageProvider: Singleton IDisposable leak | `S3StorageProvider.cs:20` | Critical |
| CancellationTokenSource never disposed | `ImportJobTracker.cs:40-42` | High |
| Broad `catch (Exception)` everywhere | Multiple controllers | High |
| Race conditions in JobTracker cache/DB sync | `JobTracker.cs:73-99` | Medium |
| Async void fire-and-forget patterns | `ImportJobTracker.cs:47-54` | Medium |
| No ProblemDetails RFC 7807 compliance | All error responses | Medium |
| No API versioning | `Program.cs:183` | Medium |

#### Architecture
| Issue | File | Severity |
|-------|------|----------|
| No startup configuration validation | `Program.cs` | High |
| Hardcoded defaults (`localhost:8000`, `/app/data`) | `Program.cs` | Medium |
| Missing file size enforcement despite 100MB config | `JwstDataController.cs:888` | High |
| No input validation on composite parameters | `CompositeController.cs:44-100` | Medium |
| Inconsistent error response formats | Multiple controllers | Medium |

---

## Infrastructure & CI/CD

### Strengths
- Well-structured parallel CI jobs (frontend, backend, Python, Docker)
- Efficient caching strategies (NuGet, npm, pip)
- Code coverage enforcement at 20% threshold
- Weekly security scanning with CodeQL
- Comprehensive dependabot coverage across all ecosystems
- Production nginx with TLS 1.2/1.3, OCSP stapling, HSTS
- Multi-stage Docker builds with non-root users
- Well-documented `.env.example` with 95 lines of guidance

### Issues

#### Security
| Issue | File | Severity |
|-------|------|----------|
| PR workflow uses `pull_request_target` (exposes secrets to forks) | `.github/workflows/pr-standards.yml:4` | Critical |
| Nginx CSP allows `unsafe-inline` | `nginx-ssl.conf:68` | High |
| No secret scanning (gitleaks/truffleHog) in CI or pre-commit | Missing | High |
| SeaweedFS uses `latest` image tag | `docker-compose.yml` | Medium |

#### Operations
| Issue | File | Severity |
|-------|------|----------|
| No resource limits on Docker containers (CPU/memory) | `docker-compose.yml` | High |
| No backend service health check | `docker-compose.yml:48-52` | High |
| Missing gzip compression in all nginx configs | `nginx.conf`, `nginx-ssl.conf` | Medium |
| Missing cache-control headers for static assets | `nginx.conf` | Medium |
| No `.gitattributes` for line ending normalization | Missing | Low |
| Pre-commit ESLint/Prettier use `language: system` (not portable) | `.pre-commit-config.yaml:22-40` | Medium |
| Dotnet-format disabled in pre-commit | `.pre-commit-config.yaml:61-70` | Low |
| `agent-stack.sh` uses `lsof` (not portable) | `scripts/agent-stack.sh:118` | Low |

---

## Security Assessment

### Well-Implemented
- SSRF prevention with regex validation in MAST service
- Path traversal protection in Python storage helpers
- JWT authentication with refresh tokens
- Non-root Docker containers
- Dependabot automated dependency updates
- Production TLS with modern cipher suites

### Gaps Requiring Immediate Attention

| # | Issue | Layer | Severity |
|---|-------|-------|----------|
| 1 | Hardcoded JWT secret in .NET config | Gateway | **Critical** |
| 2 | Path traversal in .NET LocalStorageProvider | Gateway | **Critical** |
| 3 | Hardcoded seed passwords in source | Gateway | **Critical** |
| 4 | `pull_request_target` workflow trigger | CI/CD | **Critical** |
| 5 | JWT tokens in localStorage | Frontend | **High** |
| 6 | No security headers in .NET | Gateway | **High** |
| 7 | CSP allows `unsafe-inline` | Nginx | **High** |
| 8 | No secret scanning in pipeline | CI/CD | **High** |
| 9 | Error details leaked to clients | Python | **High** |
| 10 | No rate limiting on auth endpoints | Gateway | **High** |

---

## Testing Assessment

| Layer | Test Files | Coverage | Quality |
|-------|-----------|----------|---------|
| Python | 30 files | Good | Strong security tests, good parametrization |
| Frontend | 71 files | Moderate | Shallow - mostly render checks |
| .NET | 37 files | ~28% by file | No integration or E2E tests |

### Key Gaps
- No async timeout tests in Python
- No memory leak tests for large FITS file handling
- Frontend tests mock too aggressively, reducing value
- No .NET integration tests against real MongoDB
- No cross-layer E2E tests (frontend -> gateway -> engine)
- No load/stress testing infrastructure

---

## Recommended Action Plan

### Phase 1: Security Blockers (Week 1)
1. **Remove hardcoded JWT secret** - require via environment variable, crash on startup if missing
2. **Fix path traversal** in `LocalStorageProvider.cs` - use `Path.GetFullPath()` validation
3. **Remove seed passwords** from source code
4. **Switch PR workflow** from `pull_request_target` to `pull_request`
5. **Add security headers middleware** to .NET gateway (X-Content-Type-Options, X-Frame-Options, CSP)
6. **Move JWT tokens** from localStorage to httpOnly cookies (or add strict CSP)

### Phase 2: Stability Fixes (Week 2)
7. **Wrap `fits.open()` with `asyncio.to_thread()`** in analysis routes
8. **Add locks** to module-level mutable state in `mast/routes.py`
9. **Fix S3StorageProvider** disposal pattern (factory or scoped lifetime)
10. **Add `ConfigureAwait(false)`** throughout .NET codebase
11. **Add resource limits** to Docker containers
12. **Add backend health check** to docker-compose
13. **Stop exposing `str(e)`** in Python HTTPException details

### Phase 3: Code Quality (Weeks 3-4)
14. **Decompose ImageViewer.tsx** into 5-6 focused components with custom hooks
15. **Split main.py** into separate route modules (thumbnail, preview, histogram, etc.)
16. **Consolidate FITS processing** duplication (stretch, subsample, format)
17. **Add React.lazy()** for page routes with Suspense boundaries
18. **Replace broad `catch (Exception)`** with specific exception types in .NET
19. **Add startup configuration validation** in .NET Program.cs
20. **Consolidate all API calls** through centralized apiClient in frontend

### Phase 4: Testing & Observability (Weeks 5-6)
21. **Rewrite frontend tests** to focus on behavior, not implementation
22. **Add .NET integration tests** with test containers
23. **Add async timeout tests** for Python long-running operations
24. **Add secret scanning** (gitleaks) to pre-commit and CI
25. **Add gzip compression** and cache-control headers to nginx
26. **Implement error tracking** service to replace console.error statements
27. **Add API versioning** to .NET gateway

### Phase 5: Hardening (Ongoing)
28. Add rate limiting to MAST and auth endpoints
29. Implement proper LRU caching to replace manual cache management
30. Add bundle size monitoring for frontend
31. Add accessibility labels (aria-label, aria-live) throughout UI
32. Pin SeaweedFS to specific version
33. Add `.gitattributes` for cross-platform line endings
34. Tighten CSP to remove `unsafe-inline`

---

## File Heat Map

Files sorted by issue density (most issues first):

| File | Issues | Most Severe |
|------|--------|-------------|
| `backend/.../Program.cs` | 6 | Critical |
| `processing-engine/main.py` | 8 | High |
| `frontend/.../ImageViewer.tsx` | 7 | Critical |
| `backend/.../LocalStorageProvider.cs` | 3 | Critical |
| `processing-engine/app/mast/routes.py` | 6 | Critical |
| `processing-engine/app/analysis/routes.py` | 3 | Critical |
| `backend/.../ImportJobTracker.cs` | 4 | High |
| `docker/docker-compose.yml` | 5 | High |
| `.github/workflows/pr-standards.yml` | 2 | Critical |
| `frontend/.../JwstDataDashboard.tsx` | 3 | High |
| `backend/.../AuthModels.cs` | 2 | Critical |
| `backend/.../SeedDataService.cs` | 2 | Critical |
| `processing-engine/app/composite/routes.py` | 4 | Medium |
| `frontend/.../config/api.ts` | 2 | Medium |
| `frontend/jwst-frontend/nginx-ssl.conf` | 3 | High |

---

*This review covers the complete codebase as of 2026-03-08. Issues are prioritized by security impact and production readiness.*
