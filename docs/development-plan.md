# JWST Data Analysis Application - Development Plan

## Overview

This document outlines the comprehensive development plan for building a JWST data analysis application with advanced scientific computing capabilities. The project is structured in 7 phases.

## Technology Stack

### **Technology Stack Selection:**

- [x] React with TypeScript for frontend
- [x] Backend: .NET 10 Web API (using C# expertise)
- [x] Database: MongoDB (document database, ideal for flexible data structures)
- [x] Data Processing: Python with scientific libraries (NumPy, SciPy, Astropy)
- [x] Containerization: Docker for consistent deployment

## Phase Breakdown

### **Phase 1: Foundation & Architecture** ✅ *Completed*

#### **Key Components:**

- [x] Data Ingestion Layer for various JWST data formats
- [x] Storage Layer with flexible MongoDB schemas
- [x] Processing Engine for scientific computations
- [x] API Gateway for orchestration
- [x] React dashboard for data visualization

#### **Current Status:**

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

#### **Phase 1 Deliverables:**

- [x] Complete project architecture
- [x] .NET 10 Web API with MongoDB integration
- [x] React TypeScript frontend with modern UI
- [x] Flexible data models for various JWST data types
- [x] Docker containerization for all services
- [x] Python processing engine foundation
- [x] Comprehensive documentation and setup guides

---

### **Phase 2: Core Infrastructure** ✅ *Complete*

#### **Backend Development:**

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

#### **Database Design:**

- [x] Design flexible document schemas for:
  - [x] Image data (metadata + binary storage)
  - [x] Raw sensor data (time series, spectral data)
  - [x] Processing results and analysis outputs
  - [x] User sessions and preferences

#### **Phase 2 Summary:**

- Enhanced data models with comprehensive metadata
- Improved API endpoints for search, statistics, bulk operations, and export
- Robust MongoDB service with advanced querying and aggregation
- Successful testing of all new features
- Documentation updated

#### **Deliverables:**

- [x] Functional .NET API with MongoDB integration
- [x] Data models for various JWST data types
- [x] Basic authentication system
- [x] File upload and storage capabilities
- [x] Advanced endpoints for search, statistics, bulk update, and export
- [x] Robust validation and error handling
- [x] Updated documentation

---

### **Phase 3: Data Processing Engine** ✅ *Complete*

#### **Python Microservice:**

- [x] Create Python service for scientific computations
- [x] Integrate with Astropy for astronomical data processing
- [x] MAST Portal integration with astroquery

#### **MAST Portal Integration:** ✅ *Complete*

- [x] Search MAST by target name (e.g., "NGC 3132", "Carina Nebula")
- [x] Search MAST by RA/Dec coordinates with configurable radius
- [x] Search MAST by observation ID
- [x] Search MAST by program/proposal ID
- [x] Download FITS files from MAST to local storage
- [x] Import downloaded files into MongoDB with metadata extraction
- [x] Frontend UI for MAST search and import workflow

#### **Processing Level Tracking:** ✅ *Complete*

- [x] Parse JWST filename patterns to extract processing level (L1/L2a/L2b/L3)
- [x] Track observation base ID and exposure ID for lineage grouping
- [x] Establish parent-child relationships between processing levels
- [x] Add lineage API endpoints (`/api/jwstdata/lineage`)
- [x] Frontend lineage tree view with collapsible hierarchy
- [x] Color-coded level badges (L1:red, L2a:amber, L2b:emerald, L3:blue)
- [x] Migration endpoint to backfill existing data

#### **MAST Import Progress Indicator:** ✅ *Complete*

- [x] Background job tracking for import operations
- [x] Real-time progress polling from frontend
- [x] Visual progress bar with stage indicators
- [x] Async download with file-by-file progress tracking

#### **Chunked Downloads & Resume:** ✅ *Complete*

- [x] HTTP Range header support for chunked downloads (5MB chunks)
- [x] Parallel file downloads using asyncio (3 concurrent files)
- [x] Byte-level progress tracking with speed (MB/s) and ETA
- [x] State persistence for resume capability (JSON state files)
- [x] Resume interrupted downloads from last byte position
- [x] Import-from-existing endpoint for recovering completed downloads
- [x] Frontend progress UI with per-file progress bars

#### **FITS File Type Detection:** ✅ *Complete*

- [x] Classify FITS files by filename suffix (image vs table)
- [x] Visual type badges in file listings (🖼️ image, 📊 table)
- [x] Disable View button for non-viewable table files
- [x] Graceful error handling for non-image FITS files in viewer

#### **MAST Metadata Preservation:** ✅ *Complete*

- [x] Preserve ALL MAST fields (~30+) with `mast_` prefix in Metadata dictionary
- [x] Enhanced ImageMetadata with proposal info, calibration level, wavelength range
- [x] Robust observation date extraction with fallbacks (t_min → t_max → t_obs_release)
- [x] Refresh metadata endpoint for single observation
- [x] Bulk refresh metadata endpoint for all MAST imports
- [x] Frontend "Refresh Metadata" button in dashboard
- [x] JsonElement to basic type conversion for MongoDB serialization

#### **Phase 3 Deliverables:**

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

### **Phase 4: Frontend & FITS Viewer Features** 🔄 *In Progress*

Complete React frontend application with advanced FITS visualization capabilities inspired by OpenFITS and similar tools.

#### **React Application:**

- [x] Modern, responsive dashboard design
- [x] File upload interface for JWST data
- [x] Real-time processing status updates
- [x] Interactive data visualization components
- [x] Results display with export capabilities

#### **Centralized API Service Layer:** ✅ *Complete*

- [x] Core HTTP client (`apiClient.ts`) with automatic JSON handling and error extraction
- [x] Custom error class (`ApiError.ts`) with status codes and type guards
- [x] JWST data service (`jwstDataService.ts`) for CRUD, processing, archive operations
- [x] MAST service (`mastService.ts`) for search, import, progress tracking, resume
- [x] Service re-exports (`index.ts`) for clean imports
- [x] Replaced 15 inline fetch() calls across 4 components
- [x] Consistent error handling across all API operations

#### **Core Viewer Features (A-series):**

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

#### **Color & Composite (B-series):**

##### **B1: RGB Composite Creator (Epic)** - Wizard-based workflow for creating false-color composites

| Task | Description | Blocked By | Status |
|------|-------------|------------|--------|
| B1.1 | Composite generation backend (processing engine + API endpoint) | — | [x] |
| B1.2 | Reusable Wizard/Stepper UI component | — | [x] |
| B1.3 | Observation selection step (card grid with thumbnails) | B1.2 | [x] |
| B1.4 | Channel assignment step with auto-suggest (wavelength sorting) | B1.3 | [x] |
| B1.5 | Preview and export step (generate composite, download PNG/JPEG) | B1.1, B1.4 | [x] |
| B1.6 | Per-channel adjustment controls (enhancement - stretch/levels per channel) | B1.5 | [x] |

**Architecture Decision**: Wizard flow chosen over simple modal for better UX, guided experience, and reusability of stepper component for future multi-step workflows (batch export, guided import, etc.)

##### **B2: WCS Mosaic Generator (Epic)** - Combine multiple observations into seamless large-area images

| Task | Description | Blocked By | Status |
|------|-------------|------------|--------|
| B2.1 | Add `reproject` dependency and mosaic engine (processing engine) | — | [x] |
| B2.2 | Mosaic API endpoints (MosaicController, MosaicService) | B2.1 | [x] |
| B2.3 | Footprint preview endpoint (show combined coverage before generation) | B2.1 | [x] |
| B2.4 | MosaicDialog component with multi-file selection | B2.2 | [x] |
| B2.5 | Footprint preview visualization in dialog | B2.3, B2.4 | [x] |
| B2.6 | Mosaic result display and export | B2.4 | [x] |

**Key Difference from RGB Composite**: RGB composite stacks 3 images as R/G/B color channels (same sky field, different filters). Mosaic spatially combines N images from different sky positions using WCS reprojection to create larger coverage area.

**Detailed Plan**: See `/Users/shanon/.claude/plans/stateful-frolicking-valley.md`

#### **Image Analysis (C-series):**

- [x] C2: Region selection and statistics (mean, median, std, min, max, sum, pixel count)
- [x] C3: Image comparison/blink mode (toggle, side-by-side, opacity overlay)
- [x] C4: Color balance and curves adjustment

*Note: C1 (Smoothing/Noise Reduction) moved to Phase 5 (requires backend algorithms)*

#### **Visualization & Export (D-series):**

- [x] D3: WCS grid overlay *(PR #180)*
- [x] D4: Scale bar *(PR #183)*
- [x] D5: Annotation tools (text, arrows, circles) *(PR #181)*
- [x] D6: AVM metadata embedding on export *(PR #208)*

*Note: D1 (Batch Processing), D2 (Source Detection) moved to Phase 5 (require backend algorithms)*

#### **Phase 4 Deliverables:**

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

## Workflow-Fix Roadmap (Priority Additions)

These are the top 3 additions that most compress the distance to DS9/Jdaviz-level workflows and unblock “real” research use-cases.

1. **Job Queue + WebSocket Progress (Move Up)**  
   Reliable, resumable long-running processing for mosaics, composites, and batch exports. This removes fragile polling flows and enables large program-scale runs.

2. **FITS Table + Spectral Viewer (New Epic)**  
   Interactive table viewer for non-image FITS products plus spectrum plotting for MOS/IFU. This closes the biggest gap vs. Jdaviz for spectroscopy-heavy workflows.

3. **Publication-Ready Visualization + Shareable State**  
   WCS grid, scale bar, annotations, and AVM embedding, plus permalinkable viewer state. This replaces the common “export to DS9/Aladin” step.

**Recommended Placement**
1. Move the “Processing job queue system” and “WebSocket support” from Phase 5 into late Phase 4.
2. Add a new Phase 5 epic: “FITS Table + Spectral Viewer” (UI + processing support).
3. Move D3/D4/D5/D6 into Phase 5 and add permalinkable view state to Phase 5.

---

### **Phase 5: Scientific Processing Algorithms**

Backend processing capabilities for scientific image analysis.

#### **Image Processing:**

- [ ] Image enhancement and filtering
- [ ] Noise reduction algorithms (Gaussian, median, wavelet)
- [ ] Data calibration and normalization
- [ ] Statistical analysis tools

#### **Spectral Analysis:**

- [ ] Spectral data analysis tools
- [ ] Line fitting and measurement
- [ ] Continuum subtraction

#### **Advanced Processing:**

- [ ] Source detection algorithms
- [ ] Photometry tools
- [ ] Astrometry refinement

#### **Infrastructure:**

- [ ] Processing job queue system
- [ ] WebSocket support for real-time progress (replace polling)
- [ ] Table data viewer for non-image FITS files

#### **Viewer Features (require these algorithms):**

- [ ] C1: Smoothing/noise reduction (Gaussian, median, wavelet filters)
- [ ] D1: Batch processing (apply to multiple files)
- [ ] D2: Source detection overlay

#### **Phase 5 Deliverables:**

- [ ] Image processing algorithms (filters, enhancement)
- [ ] Spectral analysis tools
- [ ] Source detection and photometry
- [ ] Processing job queue with progress tracking
- [ ] C1, D1, D2 features integrated into viewer

---

### **Phase 6: Integration & Advanced Features**

#### **System Integration:**

- [ ] Connect all microservices
- [ ] Implement real-time communication
- [ ] Add caching layer for performance
- [ ] Create comprehensive error handling
- [ ] Build monitoring and logging

#### **Advanced Features:**

- [ ] Batch processing capabilities
- [ ] Custom algorithm development interface
- [ ] Data sharing and collaboration tools
- [ ] Automated data validation
- [ ] Performance optimization

#### **Phase 6 Deliverables:**

- Fully integrated system
- Advanced processing features
- Performance optimizations
- Comprehensive error handling

---

### **Phase 7: Testing & Deployment**

#### **Quality Assurance:**

- [x] Backend unit testing (116 tests passing, PR #93)
- [ ] Frontend unit testing (Jest/React Testing Library)
- [ ] Processing Engine testing (pytest)
- [ ] Performance testing with large datasets
- [ ] User acceptance testing
- [ ] Security testing and validation

#### **Deployment:**

- [ ] Docker containerization
- [ ] CI/CD pipeline setup
- [ ] Production environment configuration
- [ ] Monitoring and alerting setup

#### **Phase 7 Deliverables:**

- Production-ready application
- Comprehensive test suite
- Deployment automation
- Monitoring and alerting

---

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
                       ┌─────────────────┐    ┌─────────────────┐
                       │    MongoDB      │    │  Local Storage  │
                       │                 │    │   /app/data     │
                       │ - Flexible Docs │    │                 │
                       │ - Binary Storage│    │ - Downloaded    │
                       │ - Metadata      │    │   FITS Files    │
                       └─────────────────┘    └─────────────────┘
```

### MAST Integration Data Flow

```text
1. User searches MAST via Frontend
         ↓
2. Request goes to .NET Backend (/api/mast/search/*)
         ↓
3. Backend forwards to Python Processing Engine (/mast/search/*)
         ↓
4. Processing Engine queries MAST via astroquery.mast
         ↓
5. Results returned through chain to Frontend
         ↓
6. User selects observations to import
         ↓
7. Backend starts chunked download job via Processing Engine
         ↓
8. Processing Engine downloads files using HTTP Range headers (5MB chunks)
   - 3 parallel file downloads
   - State persisted for resume capability
   - Progress reported back to Backend
         ↓
9. Frontend polls for byte-level progress (speed, ETA, per-file status)
         ↓
10. Files saved to shared volume (/app/data/mast/{obs_id}/)
         ↓
11. Backend creates MongoDB records with file paths and metadata
         ↓
12. Data appears in dashboard with file type indicators (image vs table)
```

### Resume Flow (for interrupted downloads)

```text
1. User clicks "Resume Download" on failed import
         ↓
2. Backend calls Processing Engine resume endpoint
         ↓
3. Processing Engine loads state from JSON file
         ↓
4. Download continues from last successful byte position
         ↓
5. If state file missing but files exist:
   - Backend calls import-from-existing endpoint
   - Records created from already-downloaded files
```
