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

## Phase 5b: UI/UX Polish & Compositing Quality

Visual polish, accessibility fixes, and compositing quality improvements needed before community release. Identified via comprehensive UI/UX audit (2026-03-06).

### Accessibility (HIGH)

| Issue | Description |
|-------|-------------|
| [#665](https://github.com/Snoww3d/jwst-data-analysis/issues/665) | Add focus-visible states to all interactive elements |
| [#666](https://github.com/Snoww3d/jwst-data-analysis/issues/666) | Standardize disabled state styling across components |
| [#667](https://github.com/Snoww3d/jwst-data-analysis/issues/667) | Instrument badge contrast failures (WCAG AA) |
| [#676](https://github.com/Snoww3d/jwst-data-analysis/issues/676) | Add focus-visible states to cards for keyboard users |

### UX & Interaction (HIGH/MEDIUM)

| Issue | Description |
|-------|-------------|
| [#668](https://github.com/Snoww3d/jwst-data-analysis/issues/668) | Replace all alert() calls with toast notifications |
| [#670](https://github.com/Snoww3d/jwst-data-analysis/issues/670) | Add empty state for dashboard card list |
| [#671](https://github.com/Snoww3d/jwst-data-analysis/issues/671) | Improve navigation wayfinding (active state, page titles) |
| [#673](https://github.com/Snoww3d/jwst-data-analysis/issues/673) | Composite/mosaic ready state too subtle |
| [#679](https://github.com/Snoww3d/jwst-data-analysis/issues/679) | Improve archive action feedback |

### Design System & Visual Consistency (MEDIUM/LOW)

| Issue | Description |
|-------|-------------|
| [#669](https://github.com/Snoww3d/jwst-data-analysis/issues/669) | Standardize button variants into clear hierarchy |
| [#672](https://github.com/Snoww3d/jwst-data-analysis/issues/672) | Improve spacing in toolbar and card headers |
| [#674](https://github.com/Snoww3d/jwst-data-analysis/issues/674) | Migrate hardcoded colors to design tokens |
| [#675](https://github.com/Snoww3d/jwst-data-analysis/issues/675) | Inconsistent badge/status border treatment |
| [#677](https://github.com/Snoww3d/jwst-data-analysis/issues/677) | UserMenu dropdown blends into dark background |
| [#678](https://github.com/Snoww3d/jwst-data-analysis/issues/678) | WizardStepper mobile spacing |

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
| [#741](https://github.com/Snoww3d/jwst-data-analysis/issues/741) | Add security headers middleware to .NET gateway |
| [#742](https://github.com/Snoww3d/jwst-data-analysis/issues/742) | Add secret scanning (gitleaks) to CI and pre-commit |

### Performance & Stability

| Issue | Description |
|-------|-------------|
| [#740](https://github.com/Snoww3d/jwst-data-analysis/issues/740) | Blocking `fits.open()` in async Python handlers starves event loop |
| [#751](https://github.com/Snoww3d/jwst-data-analysis/issues/751) | Background estimation in analysis route has no timeout |

### Compositing Quality

| Issue | Description | Status |
|-------|-------------|--------|
| [#680](https://github.com/Snoww3d/jwst-data-analysis/issues/680) | **Spike**: Research compositing pipeline to match NASA press image quality | Done (see `docs/plans/compositing-quality-spike.md`) |
| [#687](https://github.com/Snoww3d/jwst-data-analysis/issues/687) | Optimize composite stretch defaults and add NASA-style presets | Done (#689) |
| [#690](https://github.com/Snoww3d/jwst-data-analysis/issues/690) | Extract shared stretch types from composite and mosaic wizards | Done (#692) |
| [#683](https://github.com/Snoww3d/jwst-data-analysis/issues/683) | Expose unsharp masking in composite pipeline | Open |
| [#684](https://github.com/Snoww3d/jwst-data-analysis/issues/684) | Add saturation and vibrancy controls | Open |
| [#685](https://github.com/Snoww3d/jwst-data-analysis/issues/685) | Add noise reduction pre-composite step | Open |
| [#688](https://github.com/Snoww3d/jwst-data-analysis/issues/688) | Smart auto-stretch based on histogram analysis | Open |
| [#686](https://github.com/Snoww3d/jwst-data-analysis/issues/686) | Multi-scale processing / star separation | Open (Phase 6+) |
| [#691](https://github.com/Snoww3d/jwst-data-analysis/issues/691) | Add stretch presets to mosaic wizard | Open (deferred, low priority) |
| [#731](https://github.com/Snoww3d/jwst-data-analysis/issues/731) | Background job queue dashboard | Open |

---

## Phase 6: Production Readiness

Account management and admin tools required before community release.

### Email & Account Management (H-series)

| Issue | Description |
|-------|-------------|
| [#640](https://github.com/Snoww3d/jwst-data-analysis/issues/640) | **H1: Email Infrastructure** — AWS SES integration, email templates, sender config |
| [#641](https://github.com/Snoww3d/jwst-data-analysis/issues/641) | **H2: Email Verification** — Token generation, verify/resend endpoints, registration gate |
| [#642](https://github.com/Snoww3d/jwst-data-analysis/issues/642) | **H3: Password Reset** — Forgot/reset password endpoints and frontend pages |
| [#643](https://github.com/Snoww3d/jwst-data-analysis/issues/643) | **H4: Admin Account Management** — Admin invite, magic link, user list, role mgmt, registration mode |

### Admin Dashboard

| Issue | Description |
|-------|-------------|
| [#647](https://github.com/Snoww3d/jwst-data-analysis/issues/647) | **Admin Dashboard** — User management, processing limits, system health, data management, usage analytics, config management |

### Security Hardening

| Issue | Description |
|-------|-------------|
| [#743](https://github.com/Snoww3d/jwst-data-analysis/issues/743) | Add rate limiting to auth endpoints |
| [#744](https://github.com/Snoww3d/jwst-data-analysis/issues/744) | Add password complexity requirements |
| [#746](https://github.com/Snoww3d/jwst-data-analysis/issues/746) | Add startup configuration validation in .NET gateway |

### Infrastructure

| Issue | Description |
|-------|-------------|
| [#650](https://github.com/Snoww3d/jwst-data-analysis/issues/650) | Production environment configuration |
| [#651](https://github.com/Snoww3d/jwst-data-analysis/issues/651) | Docker network isolation between services |
| [#652](https://github.com/Snoww3d/jwst-data-analysis/issues/652) | Review deploy workflow for production |
| [#745](https://github.com/Snoww3d/jwst-data-analysis/issues/745) | Add Docker container resource limits (CPU/memory) |

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
| [#253](https://github.com/Snoww3d/jwst-data-analysis/issues/253) | Add demo mode / sample data |
| [#638](https://github.com/Snoww3d/jwst-data-analysis/issues/638) | Persistent download/import history in MongoDB |
| [#639](https://github.com/Snoww3d/jwst-data-analysis/issues/639) | Periodic cleanup task for download state files |
| [#635](https://github.com/Snoww3d/jwst-data-analysis/issues/635) | Automate Slack image downloads for devblog |
| [#696](https://github.com/Snoww3d/jwst-data-analysis/issues/696) | FITS Semantic Search — Python embedding service (Phase 1) |
| [#697](https://github.com/Snoww3d/jwst-data-analysis/issues/697) | FITS Semantic Search — .NET orchestration layer (Phase 2) |
| [#698](https://github.com/Snoww3d/jwst-data-analysis/issues/698) | FITS Semantic Search — Frontend UI (Phase 3) |
| [#700](https://github.com/Snoww3d/jwst-data-analysis/issues/700) | Optimize N+1 MongoDB queries in SemanticSearchService |
| [#701](https://github.com/Snoww3d/jwst-data-analysis/issues/701) | Register auto-embed jobs with JobTracker for observability |
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
| [#747](https://github.com/Snoww3d/jwst-data-analysis/issues/747) | Decompose oversized React components (ImageViewer, MastSearch) |
| [#748](https://github.com/Snoww3d/jwst-data-analysis/issues/748) | Split monolithic main.py into route modules |
| [#749](https://github.com/Snoww3d/jwst-data-analysis/issues/749) | Replace broad catch(Exception) with specific types in .NET |
| ~~[#750](https://github.com/Snoww3d/jwst-data-analysis/issues/750)~~ | ~~Add code splitting with React.lazy for page routes~~ — Done |

### CI/CD

| Issue | Description |
|-------|-------------|
| [#425](https://github.com/Snoww3d/jwst-data-analysis/issues/425) | Add retry logic for Docker image pulls in E2E CI |
| [#372](https://github.com/Snoww3d/jwst-data-analysis/issues/372) | Add WCS-enabled FITS fixture for E2E |
| [#258](https://github.com/Snoww3d/jwst-data-analysis/issues/258) | Configure Husky git hooks |

---

## Community Edition — "JWST Wallpapers"

Self-contained app in the `community/` monorepo subdirectory — the version that actually ships to real users. Same core value (browse JWST data, composite beautiful images, download wallpapers) on a stack that costs ~$0/month to run indefinitely.

**Goal**: "Let people make cool wallpapers and pictures from real JWST data."

**Location**: `community/` directory in this monorepo. Independently buildable and deployable — never imports from `frontend/`, `backend/`, or `processing/`. Vercel/Cloudflare deploy from the subdirectory. Shares the issue tracker and git history but nothing else.

**Relationship to the main app**: This repo's main stack is the production-grade, portfolio-worthy architecture. The community edition is the **launch vehicle** — cheap enough to keep running without traction, simple enough to ship fast. If it gets real interest/community, that's the signal to invest in scaling up (either migrate to the full stack or bring features over).

**Timing**: Can start after the 5b compositing quality items land (stretch presets, auto-stretch, saturation controls) — those algorithms directly benefit the community edition. Independent of phases 6-8 (production hardening, observability, polish are for the main app only).

### Key Decisions to Brainstorm

- Stack: Next.js (App Router) + Python serverless function vs. full client-side processing (WASM?)
- Hosting: Vercel/Cloudflare Pages (free tier) vs. self-hosted
- Data: Hit MAST API directly from client vs. lightweight proxy
- Processing: Server-side Python (Lambda/Cloud Function) vs. client-side (astropy-lite, Sharp, Canvas API)
- Persistence: None (stateless) vs. LocalStorage vs. lightweight DB (SQLite/Turso)
- Auth: None (public tool) vs. optional social login for saving galleries
- Scope: What features from the main app carry over vs. what gets cut

### Candidate Feature Set

- [ ] Browse/search JWST observations (MAST search, curated popular targets)
- [ ] Preview observation thumbnails
- [ ] Select filters → auto-composite RGB image
- [ ] Adjust stretch, curves, color balance
- [ ] Download as wallpaper (common resolutions: 4K, ultrawide, phone)
- [ ] Share link to a composed image
- [ ] Gallery of community-created wallpapers (stretch goal)

### What Gets Cut (vs. Main App)

- No user accounts / auth (or optional-only)
- No file upload / local FITS support
- No job queue / real-time progress (just a loading state)
- No MongoDB / persistent storage backend
- No Docker multi-service architecture
- No WCS/mosaics/spectral analysis (scientific features)
- No admin panel, no observability stack

### Monorepo Rules

- `community/` is **fully self-contained** — own `package.json`, own build, own deploy config
- **Never** import from `frontend/`, `backend/`, or `processing/`
- Own CI job with path filter (`community/**`)
- If Vercel build succeeds from `community/` alone, the boundary is intact
- Shared processing algorithms get **copied, not imported** (a few hundred lines, not worth the coupling)

### Status

⬚ Planned — start after 5b compositing quality items land

---

## Progress Summary

| Phase | Focus | Status | Notes |
| ------- | ------- | -------- | ------- |
| 1 | Foundation & Architecture | ✅ Complete | |
| 2 | Core Infrastructure | ✅ Complete | |
| 3 | Data Processing Engine | ✅ Complete | |
| 4 | Frontend & FITS Viewer | ✅ Complete | |
| 5 | Scientific Processing | ✅ Complete | |
| 5b | UI/UX Polish & Compositing | 🔄 Next | Compositing quality items first |
| CE | Community Edition ("JWST Wallpapers") | ⬚ Planned | After 5b compositing; `community/` dir |
| 6 | Production Readiness | ⬚ Planned | Main app only |
| 7 | Observability & Monitoring | ⬚ Planned | Main app only |
| 8 | Polish & Community Release | ⬚ Planned | Main app only |
