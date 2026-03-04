# JWST Data Analysis Application — Development Roadmap

## Overview

A web-based JWST data analysis application with MAST integration, FITS visualization, RGB/multi-channel compositing, WCS mosaics, and guided discovery. Phases 1–5 are complete (see [completed-phases.md](completed-phases.md) for the full archive).

## Technology Stack

- **Frontend**: React with TypeScript
- **Backend**: .NET 10 Web API
- **Database**: MongoDB
- **Processing Engine**: Python (NumPy, SciPy, Astropy)
- **Storage**: S3-compatible (SeaweedFS local, AWS S3 production)
- **Infrastructure**: Docker multi-service compose, GitHub Actions CI

## Technical Architecture

```text
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Frontend│    │  .NET Web API   │    │ Python Processing│    │   MAST Portal   │
│                 │    │                 │    │     Engine      │    │    (STScI)      │
│ - Data Upload   │◄──►│ - Orchestration │◄──►│ - Scientific    │◄──►│ - JWST Archive  │
│ - Visualization │    │ - Authentication│    │   Computing     │    │ - FITS Files    │
│ - MAST Search   │    │ - Data Mgmt     │    │ - MAST Queries  │    │ - Observations  │
│ - Results View  │    │ - MAST Proxy    │    │ - Image Proc    │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                      │
                                ▼                      ▼
                       ┌─────────────────┐    ┌─────────────────────────┐
                       │    MongoDB      │    │  S3-Compatible Storage  │
                       │                 │    │  (SeaweedFS / AWS S3)   │
                       │ - Flexible Docs │    │                         │
                       │ - Binary Storage│    │ - MAST FITS Files       │
                       │ - Metadata      │    │ - User Uploads          │
                       └─────────────────┘    │ - Mosaics & Exports     │
                                              │ - Presigned URL Access  │
                                              └─────────────────────────┘
```

---

## Phase 6: Production Readiness

Account management, security hardening, and admin tools required before community release.

### Email & Account Management (H-series)

| Issue | Description |
|-------|-------------|
| [#640](https://github.com/Snoww3d/jwst-data-analysis/issues/640) | **H1: Email Infrastructure** — AWS SES integration, email templates, sender config |
| [#641](https://github.com/Snoww3d/jwst-data-analysis/issues/641) | **H2: Email Verification** — Token generation, verify/resend endpoints, registration gate |
| [#642](https://github.com/Snoww3d/jwst-data-analysis/issues/642) | **H3: Password Reset** — Forgot/reset password endpoints and frontend pages |
| [#643](https://github.com/Snoww3d/jwst-data-analysis/issues/643) | **H4: Admin Account Management** — Admin invite, magic link, user list, role mgmt, registration mode |

### Security Hardening

| Issue | Description |
|-------|-------------|
| [#452](https://github.com/Snoww3d/jwst-data-analysis/issues/452) | JWT secret has insecure placeholder default |
| [#453](https://github.com/Snoww3d/jwst-data-analysis/issues/453) | Open proxy trust enables rate limit bypass |
| [#454](https://github.com/Snoww3d/jwst-data-analysis/issues/454) | Seeded credentials in code can run outside dev |
| [#455](https://github.com/Snoww3d/jwst-data-analysis/issues/455) | Records default to public visibility |
| [#456](https://github.com/Snoww3d/jwst-data-analysis/issues/456) | Tokens stored in localStorage (XSS risk) |
| [#457](https://github.com/Snoww3d/jwst-data-analysis/issues/457) | CSP allows unsafe-inline and unsafe-eval |
| [#458](https://github.com/Snoww3d/jwst-data-analysis/issues/458) | Auth debug logs persisted client-side |
| [#459](https://github.com/Snoww3d/jwst-data-analysis/issues/459) | Internal exception details returned to clients |
| [#460](https://github.com/Snoww3d/jwst-data-analysis/issues/460) | Public data responses expose owner UserId |
| [#461](https://github.com/Snoww3d/jwst-data-analysis/issues/461) | Frontend dev dependency audit (18 high vulns) |

### Admin Dashboard

| Issue | Description |
|-------|-------------|
| [#647](https://github.com/Snoww3d/jwst-data-analysis/issues/647) | **Admin Dashboard** — User management, processing limits, system health, data management, usage analytics, config management |

### Infrastructure

| Issue | Description |
|-------|-------------|
| [#650](https://github.com/Snoww3d/jwst-data-analysis/issues/650) | Production environment configuration |
| [#651](https://github.com/Snoww3d/jwst-data-analysis/issues/651) | Docker network isolation between services |
| [#652](https://github.com/Snoww3d/jwst-data-analysis/issues/652) | Review deploy workflow for production |

---

## Phase 7: Observability & Monitoring

OpenTelemetry instrumentation and AWS CloudWatch integration. Direct export (no OTel Collector). Vendor-neutral SDK layer — swapping to Grafana/Datadog requires only exporter config changes.

| Issue | Description |
|-------|-------------|
| [#644](https://github.com/Snoww3d/jwst-data-analysis/issues/644) | **O1: .NET Backend Instrumentation** — OTel SDK, auto HTTP traces, MongoDB instrumentation, custom spans/metrics |
| [#645](https://github.com/Snoww3d/jwst-data-analysis/issues/645) | **O2: Python Processing Engine Instrumentation** — OTel SDK, FastAPI traces, custom spans |
| [#646](https://github.com/Snoww3d/jwst-data-analysis/issues/646) | **O3: AWS Export & Dashboards** — CloudWatch Logs, X-Ray traces, dashboards, basic alarms |

---

## Phase 8: Polish & Community Release

Remaining features, tech debt, CI improvements, and release process.

### Remaining Features

| Issue | Description |
|-------|-------------|
| [#610](https://github.com/Snoww3d/jwst-data-analysis/issues/610) | P19.6: Standardize micro buttons (18×18, 28×28) |
| [#357](https://github.com/Snoww3d/jwst-data-analysis/issues/357) | Refine RGB composite default stretch |
| [#253](https://github.com/Snoww3d/jwst-data-analysis/issues/253) | Add demo mode / sample data |
| [#638](https://github.com/Snoww3d/jwst-data-analysis/issues/638) | Persistent download/import history in MongoDB |
| [#639](https://github.com/Snoww3d/jwst-data-analysis/issues/639) | Periodic cleanup task for download state files |
| [#635](https://github.com/Snoww3d/jwst-data-analysis/issues/635) | Automate Slack image downloads for devblog |
| [#648](https://github.com/Snoww3d/jwst-data-analysis/issues/648) | Permalinkable viewer state (shareable URLs) |
| [#649](https://github.com/Snoww3d/jwst-data-analysis/issues/649) | Performance testing with large datasets |
| —     | C1: Smoothing/noise reduction (Gaussian, median, wavelet) |
| —     | D1: Batch processing (apply operations to multiple files) |
| —     | Spectral analysis (line fitting, continuum subtraction) |
| —     | Photometry tools |
| —     | Astrometry refinement |
| —     | F4: Tiered storage — EBS hot cache + S3 backing store (F4.1–F4.4) |

### Tech Debt

| Issue | Description |
|-------|-------------|
| [#256](https://github.com/Snoww3d/jwst-data-analysis/issues/256) | Configure structured logging (JSON) |
| [#259](https://github.com/Snoww3d/jwst-data-analysis/issues/259) | Generate and host OpenAPI spec |
| [#261](https://github.com/Snoww3d/jwst-data-analysis/issues/261) | Split large documentation files |
| [#285](https://github.com/Snoww3d/jwst-data-analysis/issues/285) | Streamline docs-only PR workflow |
| [#303](https://github.com/Snoww3d/jwst-data-analysis/issues/303) | Extract shared MapToDataResponse helpers |
| [#571](https://github.com/Snoww3d/jwst-data-analysis/issues/571) | Deduplicate IsDataAccessible |
| [#254](https://github.com/Snoww3d/jwst-data-analysis/issues/254) | Browser/environment compatibility docs |

### CI/CD

| Issue | Description |
|-------|-------------|
| [#425](https://github.com/Snoww3d/jwst-data-analysis/issues/425) | Add retry logic for Docker image pulls in E2E CI |
| [#372](https://github.com/Snoww3d/jwst-data-analysis/issues/372) | Add WCS-enabled FITS fixture for E2E |
| [#258](https://github.com/Snoww3d/jwst-data-analysis/issues/258) | Configure Husky git hooks |

---

## Progress Summary

| Phase | Focus | Status |
|-------|-------|--------|
| 1 | Foundation & Architecture | ✅ Complete |
| 2 | Core Infrastructure | ✅ Complete |
| 3 | Data Processing Engine | ✅ Complete |
| 4 | Frontend & FITS Viewer | ✅ Complete |
| 5 | Scientific Processing | ✅ Complete |
| 6 | Production Readiness | 🔄 Next |
| 7 | Observability & Monitoring | ⬚ Planned |
| 8 | Polish & Community Release | ⬚ Planned |
