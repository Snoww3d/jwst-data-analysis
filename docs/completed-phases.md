# JWST Data Analysis Application — Completed Phases

This document archives the completed development phases (1–5) of the JWST Data Analysis Application. For the active roadmap, see [development-plan.md](development-plan.md).

---

## Phase 1: Foundation & Architecture ✅ *Completed*

### Key Components:

- [x] Data Ingestion Layer for various JWST data formats
- [x] Storage Layer with flexible MongoDB schemas
- [x] Processing Engine for scientific computations
- [x] API Gateway for orchestration
- [x] React dashboard for data visualization

### Current Status:

- [x] Project structure setup
- [x] Development plan documentation
- [x] Backend .NET project initialization
- [x] Frontend React project setup
- [x] MongoDB connection configuration
- [x] Basic API structure
- [x] Flexible data models for JWST data
- [x] CRUD operations for data management
- [x] Modern React dashboard with search and filtering
- [x] Docker configuration for all services
- [x] Python processing engine foundation
- [x] Comprehensive setup documentation

### Phase 1 Deliverables:

- [x] Complete project architecture
- [x] .NET 10 Web API with MongoDB integration
- [x] React TypeScript frontend with modern UI
- [x] Flexible data models for various JWST data types
- [x] Docker containerization for all services
- [x] Python processing engine foundation
- [x] Comprehensive documentation and setup guides

---

## Phase 2: Core Infrastructure ✅ *Complete*

### Backend Development:

- [x] Set up .NET 10 Web API project
- [x] Implement MongoDB connection and basic CRUD operations
- [x] Create flexible data models for different JWST data types
- [x] Build data ingestion pipeline for FITS files and raw sensor data
- [x] Implement authentication and authorization
- [x] Enhance data models with rich metadata (image, sensor, spectral, calibration, processing results, etc.)
- [x] Add DTOs and validation attributes for robust API requests/responses
- [x] Improve MongoDBService with advanced querying, aggregation, statistics, and bulk operations
- [x] Merge advanced endpoints into JwstDataController (search, statistics, bulk update, export)
- [x] Fix nullable reference type issues and ensure all endpoints are discoverable and functional
- [x] Robust error handling and validation
- [x] Update documentation and setup guide

### Database Design:

- [x] Design flexible document schemas for:
  - [x] Image data (metadata + binary storage)
  - [x] Raw sensor data (time series, spectral data)
  - [x] Processing results and analysis outputs
  - [x] User sessions and preferences

### Phase 2 Summary:

- Enhanced data models with comprehensive metadata
- Improved API endpoints for search, statistics, bulk operations, and export
- Robust MongoDB service with advanced querying and aggregation
- Successful testing of all new features
- Documentation updated

### Deliverables:

- [x] Functional .NET API with MongoDB integration
- [x] Data models for various JWST data types
- [x] Basic authentication system
- [x] File upload and storage capabilities
- [x] Advanced endpoints for search, statistics, bulk update, and export
- [x] Robust validation and error handling
- [x] Updated documentation

---

## Phase 3: Data Processing Engine ✅ *Complete*

### Python Microservice:

- [x] Create Python service for scientific computations
- [x] Integrate with Astropy for astronomical data processing
- [x] MAST Portal integration with astroquery

### MAST Portal Integration: ✅ *Complete*

- [x] Search MAST by target name (e.g., "NGC 3132", "Carina Nebula")
- [x] Search MAST by RA/Dec coordinates with configurable radius
- [x] Search MAST by observation ID
- [x] Search MAST by program/proposal ID
- [x] Download FITS files from MAST to local storage
- [x] Import downloaded files into MongoDB with metadata extraction
- [x] Frontend UI for MAST search and import workflow

### Processing Level Tracking: ✅ *Complete*

- [x] Parse JWST filename patterns to extract processing level (L1/L2a/L2b/L3)
- [x] Track observation base ID and exposure ID for lineage grouping
- [x] Establish parent-child relationships between processing levels
- [x] Add lineage API endpoints (`/api/jwstdata/lineage`)
- [x] Frontend lineage tree view with collapsible hierarchy
- [x] Color-coded level badges (L1:red, L2a:amber, L2b:emerald, L3:blue)
- [x] Migration endpoint to backfill existing data

### MAST Import Progress Indicator: ✅ *Complete*

- [x] Background job tracking for import operations
- [x] Real-time progress polling from frontend
- [x] Visual progress bar with stage indicators
- [x] Async download with file-by-file progress tracking

### Chunked Downloads & Resume: ✅ *Complete*

- [x] HTTP Range header support for chunked downloads (5MB chunks)
- [x] Parallel file downloads using asyncio (3 concurrent files)
- [x] Byte-level progress tracking with speed (MB/s) and ETA
- [x] State persistence for resume capability (JSON state files)
- [x] Resume interrupted downloads from last byte position
- [x] Import-from-existing endpoint for recovering completed downloads
- [x] Frontend progress UI with per-file progress bars

### FITS File Type Detection: ✅ *Complete*

- [x] Classify FITS files by filename suffix (image vs table)
- [x] Visual type badges in file listings (🖼️ image, 📊 table)
- [x] Disable View button for non-viewable table files
- [x] Graceful error handling for non-image FITS files in viewer

### MAST Metadata Preservation: ✅ *Complete*

- [x] Preserve ALL MAST fields (~30+) with `mast_` prefix in Metadata dictionary
- [x] Enhanced ImageMetadata with proposal info, calibration level, wavelength range
- [x] Robust observation date extraction with fallbacks (t_min → t_max → t_obs_release)
- [x] Refresh metadata endpoint for single observation
- [x] Bulk refresh metadata endpoint for all MAST imports
- [x] Frontend "Refresh Metadata" button in dashboard
- [x] JsonElement to basic type conversion for MongoDB serialization

### Phase 3 Deliverables:

- [x] Python microservice with scientific computing capabilities
- [x] Integration with .NET backend (HTTP client communication)
- [x] MAST Portal search and download functionality
- [x] Processing level tracking and lineage visualization
- [x] Import progress indicator with real-time updates
- [x] Chunked downloads with HTTP Range headers and resume capability
- [x] Byte-level progress tracking with speed and ETA
- [x] FITS file type detection and viewer improvements
- [x] MAST metadata preservation and refresh capability

---

## Phase 4: Frontend & FITS Viewer Features ✅ *Complete*

Complete React frontend application with advanced FITS visualization capabilities inspired by OpenFITS and similar tools.

### React Application:

- [x] Modern, responsive dashboard design
- [x] File upload interface for JWST data
- [x] Real-time processing status updates
- [x] Interactive data visualization components
- [x] Results display with export capabilities

### Centralized API Service Layer: ✅ *Complete*

- [x] Core HTTP client (`apiClient.ts`) with automatic JSON handling and error extraction
- [x] Custom error class (`ApiError.ts`) with status codes and type guards
- [x] JWST data service (`jwstDataService.ts`) for CRUD, processing, archive operations
- [x] MAST service (`mastService.ts`) for search, import, progress tracking, resume
- [x] Service re-exports (`index.ts`) for clean imports
- [x] Replaced 15 inline fetch() calls across 4 components
- [x] Consistent error handling across all API operations

### Core Viewer Features (A-series):

- [x] A0: Delete/archive by processing level (L1/L2a/L2b/L3)
- [x] A1: Interactive stretch and level controls
- [x] A2: Histogram display panel with adjustable black/white points
- [x] A3: Pixel coordinate and value display on hover
- [x] A4: Export processed image as PNG/JPEG
  - [x] Format selection (PNG lossless, JPEG with quality control)
  - [x] Resolution presets (1200px, 2048px, 4096px, custom 10-8000px)
  - [x] JPEG quality slider (1-100%)
  - [x] Export options popover UI
  - [x] Input validation (backend + processing engine)
  - [x] E2E tests for export workflow
- [x] A5: 3D data cube navigator for wavelength/time slices

### Color & Composite (B-series):

#### B1: RGB Composite Creator (Epic) — Wizard-based workflow for creating false-color composites

| Task   | Description                                                                | Blocked By   | Status   |
| ------ | -------------------------------------------------------------------------- | ------------ | -------- |
| B1.1   | Composite generation backend (processing engine + API endpoint)            | —            | [x]      |
| B1.2   | Reusable Wizard/Stepper UI component                                       | —            | [x]      |
| B1.3   | Observation selection step (card grid with thumbnails)                     | B1.2         | [x]      |
| B1.4   | Channel assignment step with auto-suggest (wavelength sorting)             | B1.3         | [x]      |
| B1.5   | Preview and export step (generate composite, download PNG/JPEG)            | B1.1, B1.4   | [x]      |
| B1.6   | Per-channel adjustment controls (enhancement - stretch/levels per channel) | B1.5         | [x]      |
| B1.7   | UI refresh: merge to 2-step wizard with drag-and-drop + thumbnails        | B1.6         | [x]      |
| B1.8   | Per-channel weight sliders (0–200% intensity balance)                      | B1.7         | [x]      |

**Architecture Decision**: Wizard flow chosen over simple modal for better UX, guided experience, and reusability of stepper component for future multi-step workflows (batch export, guided import, etc.)

**UI Refresh (B1.7–B1.8)**: Consolidated original 3-step wizard into 2 steps — Step 1: Assign Channels (drag-and-drop with FITS thumbnails, target-scoped auto-sort) → Step 2: Preview & Export (per-channel stretch controls, weight sliders, channel swap, live preview, export). Added per-channel weight multiplier across the full stack (frontend → C# backend → Python processing engine).

#### B2: WCS Mosaic Generator (Epic) — Combine multiple observations into seamless large-area images

| Task   | Description                                                           | Blocked By   | Status   |
| ------ | --------------------------------------------------------------------- | ------------ | -------- |
| B2.1   | Add `reproject` dependency and mosaic engine (processing engine)      | —            | [x]      |
| B2.2   | Mosaic API endpoints (MosaicController, MosaicService)                | B2.1         | [x]      |
| B2.3   | Footprint preview endpoint (show combined coverage before generation) | B2.1         | [x]      |
| B2.4   | MosaicDialog component with multi-file selection                      | B2.2         | [x]      |
| B2.5   | Footprint preview visualization in dialog                             | B2.3, B2.4   | [x]      |
| B2.6   | Mosaic result display and export                                      | B2.4         | [x]      |
| B2.7   | Mosaic wizard UI refresh: 2-step flow, thumbnail cards, reusable WizardStepper | B2.6 | [x]      |

**Key Difference from RGB Composite**: RGB composite stacks 3 images as R/G/B color channels (same sky field, different filters). Mosaic spatially combines N images from different sky positions using WCS reprojection to create larger coverage area.

#### B3: Multi-Channel Composite (4+ filters) — Extend RGB composite to support N-channel color mapping

NASA's published JWST composites typically use 4–6 filters mapped to distinct color channels (e.g., Southern Ring Nebula MIRI uses F770W→Blue, F1130W→Cyan, F1280W→Green, F1800W→Red). The current wizard only supports 3 channels (R/G/B), which limits how closely users can recreate reference images.

| Task   | Description                                                                        | Blocked By   | Status   |
| ------ | ---------------------------------------------------------------------------------- | ------------ | -------- |
| B3.1   | N-channel color mapping engine (processing engine — map N filters to RGB via hue)  | —            | [x]      |
| B3.2   | Backend API support for N-channel composite requests                               | B3.1         | [x]      |
| B3.3   | Wizard UI: dynamic channel list with color picker / wavelength-to-hue auto-assign  | B3.2         | [x]      |
| B3.4   | Luminance channel support (L in LRGB — broadband or combined for detail)           | B3.1         | [x]      |
| B3.5   | Preset color mappings for common JWST filter sets (NIRCam, MIRI)                   | B3.3         | [x]      |
| B3.6   | Remove deprecated `/composite/generate` endpoint and frontend references           | B3.3         | [x]      |

**Motivation**: Professional tools like PixInsight and SAOImageDS9 support arbitrary filter-to-hue mapping. JWST programs routinely observe in 4–8 filters per target. Limiting to 3 channels forces users to either drop filters or awkwardly combine filters into a single channel.

**Related**: Issue #357 (refine default stretch/background neutralization)

### Data Acquisition (F-series):

#### F1: S3 Direct Access for FITS Downloads — Use `s3://stpubdata/jwst/public/` for faster data access

STScI mirrors the full JWST public archive on AWS S3 (`s3://stpubdata/jwst/public/`). Downloading via S3 is significantly faster than HTTP from MAST (no rate limiting, AWS-native throughput, supports multipart downloads). The bucket is public — no authentication required, only a `--no-sign-request` flag.

| Task   | Description                                                                     | Blocked By   | Status   |
| ------ | ------------------------------------------------------------------------------- | ------------ | -------- |
| F1.1   | S3 client integration in processing engine (boto3, anonymous access)            | —            | [x]      |
| F1.2   | S3 path resolution via MAST `get_cloud_uris()` API (PR #396)                   | F1.1         | [x]      |
| F1.3   | Download engine: S3 multipart download with progress tracking                   | F1.1         | [x]      |
| F1.4   | Backend API to select download source (S3 preferred, HTTP fallback)             | F1.2, F1.3   | [x]      |
| F1.5   | Frontend: download source indicator and preference setting                      | F1.4         | [x]      |

#### F2: Storage Abstraction Layer — Decouple file storage from local filesystem

The application currently reads/writes all data to a shared `/app/data/` Docker volume. Before migrating to S3, introduce a storage abstraction so providers can be swapped via config. This is the foundation for F3.

| Task   | Description                                                                     | Blocked By   | Status   |
| ------ | ------------------------------------------------------------------------------- | ------------ | -------- |
| F2.1   | `IStorageProvider` interface in backend (.NET): Write, ReadStream, Exists, Delete, GetPresignedUrl, List | —            | [x]      |
| F2.2   | `LocalStorageProvider` implementation (wraps current `/app/data/` filesystem)    | F2.1         | [x]      |
| F2.3   | Python `StorageProvider` ABC with `read_to_temp()`, `write_from_path()`, `write_from_bytes()`, `presigned_url()` | —            | [x]      |
| F2.4   | `LocalStorage` Python implementation (current filesystem behavior)              | F2.3         | [x]      |
| F2.5   | MongoDB migration — normalize `FilePath` values to storage keys (strip `/app/data/` prefix) | F2.2         | [x]      |
| F2.6   | Environment switch: `STORAGE_PROVIDER=local|s3` with DI registration           | F2.2, F2.4   | [x]      |

#### F3: S3 Storage for Application Data — Migrate MAST downloads, uploads, and outputs to S3

Replace the shared Docker volume with S3 for all application data. Bucket structure: `jwst-data-{env}/mast/{obs_id}/{file}.fits`, `uploads/{user_id}/{uuid}.fits`, `mosaic/{uuid}_i2d.fits`, `exports/{export_id}.json`.

| Task   | Description                                                                     | Blocked By   | Status   |
| ------ | ------------------------------------------------------------------------------- | ------------ | -------- |
| F3.1   | `S3StorageProvider` implementation (backend .NET, AWS SDK)                      | F2.1, F2.2   | [x]      |
| F3.2   | `S3Storage` implementation (processing engine Python, boto3)                    | F2.3, F2.4   | [x]      |
| F3.3   | MAST downloads to S3 — stream via S3 multipart upload, LRU temp cache for processing | F3.1, F3.2   | [x]      |
| F3.4   | User uploads to S3 — stream multipart form data to `uploads/{userId}/{guid}{ext}` | F3.1         | [x]      |
| F3.5   | Generated outputs to S3 — mosaic/composite results to `mosaic/` and `exports/` prefixes | F3.2         | [x]      |
| F3.6   | Presigned URLs for file downloads (15-min expiry, skip proxying through backend) | F3.1         | [x]      |
| F3.7   | S3 Intelligent-Tiering lifecycle policy on `mast/` prefix *(manual script)*      | F3.1         | [x]      |
| F3.8   | Local dev parity — SeaweedFS in docker-compose.yml (s3 profile)                 | F3.1         | [x]      |

### Image Analysis (C-series):

- [x] C2: Region selection and statistics (mean, median, std, min, max, sum, pixel count)
- [x] C3: Image comparison/blink mode (toggle, side-by-side, opacity overlay)
- [x] C4: Color balance and curves adjustment

*Note: C1 (Smoothing/Noise Reduction) moved to Phase 8 (requires backend endpoint wiring)*

### Visualization & Export (D-series):

- [x] D3: WCS grid overlay *(PR #180)*
- [x] D4: Scale bar *(PR #183)*
- [x] D5: Annotation tools (text, arrows, circles) *(PR #181)*
- [x] D6: AVM metadata embedding on export *(PR #208)*

*Note: D1 (Batch Processing) moved to Phase 8*

### Dashboard & UX (E-series):

- [x] E1: Search by target name in top search bar (filter local observations by `targetName`)
- [x] E2: Automatic FITS thumbnail generation for dashboard cards

### Reliability & UX Polish (G-series):

- [x] G1: Auto-recovery startup scan & data visibility model *(PR #385)*
- [x] G2: MAST error propagation — show actual errors, not generic 503 *(PR #395)*
- [x] G3: S3 cloud URI resolution via MAST API *(PR #396)*
- [x] G4: Docker healthcheck probe for processing engine *(PR #382)* — other services use `service_started` dependency
- [x] G5: Smart mosaic pre-selection with target priority & warnings *(PR #387)*
- [x] G6: Floating analysis bar & unified file selection *(PR #386)*
- [x] G7: Dynamic file size warnings on mosaic cards *(PR #388)*
- [x] G8: E2E tests for MAST download workflow *(PR #380)*

### Design System Polish (P-series):

Token-based design system established in P14–P16. This series audits adoption and closes remaining gaps.

#### P17: Design Token Audit & Migration — Audit all CSS against system.md, fix violations

| Task   | Description                                                                     | Status   |
| ------ | ------------------------------------------------------------------------------- | -------- |
| P17.1  | Add foundation tokens (overlay, shadow-xl, text-3xl) to index.css               | [x]      |
| P17.2  | Spacing violations — 14 hardcoded values → nearest --space-* token              | [x]      |
| P17.3  | Radius violations — 12 hardcoded values → nearest --radius-* token              | [x]      |
| P17.4  | Typography violations — 97 hardcoded font-sizes → --text-* tokens               | [x]      |
| P17.5  | Shadow violations — 5 simple migrations + 3 modal shadows → tokens              | [x]      |
| P17.6  | Color/overlay violations — ~25 rgba backgrounds → --overlay-* tokens            | [x]      |

#### P18: Button Standardization — Shared base class + variant system

| Task   | Description                                                                     | Status   |
| ------ | ------------------------------------------------------------------------------- | -------- |
| P18.1  | Add --text-inverse token, replace hardcoded `white` across 18 files             | [x]      |
| P18.2  | Deduplicate .btn-action into index.css, remove from component files             | [x]      |
| P18.3  | Deduplicate .btn-export into index.css, keep component-specific overrides       | [x]      |

#### P19: Button Base Class (.btn-base) — Requires JSX changes across 25+ components

| Task   | Description                                                                     | Status   |
| ------ | ------------------------------------------------------------------------------- | -------- |
| P19.1  | Define .btn-base shared class (padding, radius, font-size, cursor, transition)  | [x]      |
| P19.2  | Add .btn-base className to all button components (~25 files)                    | [x]      |
| P19.3  | Consolidate padding to 3 tiers (compact, standard, large) via modifiers         | [x]      |
| P19.4  | Enforce min-height standard (38px regular, 36px icon-only)                      | [x]      |
| P19.5  | Standardize 30px icon buttons to shared class (#609)                            | [x]      |

*Note: P19.6 (micro buttons) moved to Phase 8 — tracked as #610*

### Phase 4 Deliverables:

- [x] Centralized API service layer with type-safe error handling
- [x] File upload and management interface
- [x] Real-time processing status dashboard
- [x] Delete/archive by processing level
- [x] Interactive stretch and level controls
- [x] Complete React frontend application
- [x] Interactive data visualization components
- [x] Histogram display panel
- [x] Pixel coordinate and value display
- [x] Export processed images (PNG/JPEG with quality/resolution presets)
- [x] 3D data cube navigation (slice navigation with playback)

---

## Phase 5: Scientific Processing & Infrastructure ✅ *Complete*

Backend processing capabilities, infrastructure improvements, and remaining viewer features.

### Tier 1 — Core Science Features:

- [x] FITS table viewer for non-image FITS products (binary tables, catalog data)
- [x] Spectral data visualization (1D spectrum plotting for MOS/IFU)
- [x] Job queue + WebSocket progress (replace polling, enable large operations)
  - [x] SignalR hub, unified job tracker, queue pattern infrastructure
  - [x] MAST import progress via SignalR (Phase 3)
  - [x] Async composite export via job queue + SignalR (Phase 4)
  - [x] Async mosaic export via job queue + SignalR (Phase 5)
  - [x] Async mosaic save-to-library via job queue + SignalR (Phase 5)
  - [x] Large mosaic generation resilience — cap preview resolution to 2048px (configurable via `Mosaic:MaxPreviewDimension`) with structured timing logs for evidence-based monitoring

*Note: Permalinkable viewer state moved to Phase 8*

### Guided Discovery Experience (v1 UX pivot):

Transforms the app from tool-first to content-first. Full design in `docs/plans/design/guided-discovery-experience.md`.

- [x] Phase A — React Router + layout shell (routes: `/`, `/library`, `/target/:name`, `/create`; move dashboard to My Library)
- [x] Phase B — Suggestion engine + chromatic ordering (Python recipe endpoint, featured targets config, color mapping fix)
- [x] Phase C — New frontend pages (discovery home, target detail, guided creation flow)
- [x] Phase D — Polish (loading skeletons, error states, end-to-end verification of featured targets)

### Tier 2 — Image Processing:

- [x] D2: Source detection overlay

*Note: C1 (Smoothing) and D1 (Batch processing) moved to Phase 8*

### Phase 5 Deliverables:

- [x] FITS table viewer
- [x] Spectral viewer
- [x] Job queue with WebSocket progress (SignalR hub, unified tracker, MAST import, composite export, mosaic export/save)
- [x] Guided Discovery Experience (v1 UX pivot — discovery home, target detail, guided creation, chromatic ordering)
- [x] D2: Source detection overlay
