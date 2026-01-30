# JWST Data Analysis Application - Development Plan

## Overview

This document outlines the comprehensive development plan for building a JWST data analysis application with advanced computer science capabilities. The project is structured in 7 phases over 14 weeks.

## Technology Stack

### **Technology Stack Selection:**

- [x] React with TypeScript for frontend
- [x] Backend: .NET 10 Web API (using C# expertise)
- [x] Database: MongoDB (document database, ideal for flexible data structures)
- [x] Data Processing: Python with scientific libraries (NumPy, SciPy, Astropy)
- [x] Containerization: Docker for consistent deployment

## Phase Breakdown

### **Phase 1: Foundation & Architecture (Weeks 1-2)** ✅ *Completed*

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

- ✅ Complete project architecture
- ✅ .NET 10 Web API with MongoDB integration
- ✅ React TypeScript frontend with modern UI
- ✅ Flexible data models for various JWST data types
- ✅ Docker containerization for all services
- ✅ Python processing engine foundation
- ✅ Comprehensive documentation and setup guides

---

### **Phase 2: Core Infrastructure (Weeks 3-4)** ✅ *Complete*

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

- ✅ Functional .NET API with MongoDB integration
- ✅ Data models for various JWST data types
- ✅ Basic authentication system
- ✅ File upload and storage capabilities
- ✅ Advanced endpoints for search, statistics, bulk update, and export
- ✅ Robust validation and error handling
- ✅ Updated documentation

---

### **Phase 3: Data Processing Engine (Weeks 5-6)** 🔄 *In Progress*

#### **Python Microservice:**

- [x] Create Python service for scientific computations
- [x] Integrate with Astropy for astronomical data processing
- [x] MAST Portal integration with astroquery
- [ ] Implement common JWST data analysis algorithms
- [ ] Build image processing capabilities (filters, transformations)
- [ ] Create spectral analysis tools

#### **Processing Capabilities:**

- [ ] Image enhancement and filtering
- [ ] Spectral data analysis
- [ ] Noise reduction algorithms
- [ ] Data calibration and normalization
- [ ] Statistical analysis tools

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

#### **Known Issues & Future Improvements:**

**Remaining Enhancements:**
- [ ] **TODO:** WebSocket support for real-time progress (replace polling)
- [ ] **TODO:** Table data viewer for non-image FITS files (binary tables, spectra)
- [ ] **TODO:** Consider using MAST's async download API for bulk operations

#### **Phase 3 Deliverables:**

- ✅ Python microservice with scientific computing capabilities
- ✅ Integration with .NET backend (HTTP client communication)
- ✅ MAST Portal search and download functionality
- ✅ Processing level tracking and lineage visualization
- ✅ Import progress indicator with real-time updates
- ✅ Chunked downloads with HTTP Range headers and resume capability
- ✅ Byte-level progress tracking with speed and ETA
- ✅ FITS file type detection and viewer improvements
- ✅ MAST metadata preservation and refresh capability
- [ ] Basic image and spectral processing algorithms
- [ ] Processing job queue system

---

### **Phase 4: FITS Viewer & Data Management Features (Weeks 7-8)** 🔄 *In Progress*

Advanced FITS visualization and data management capabilities inspired by OpenFITS and similar tools.

#### **Feature Roadmap:**

| ID | Feature | Status | Description |
|----|---------|--------|-------------|
| **A0** | Delete/Archive by Processing Level | ✅ Complete | Delete or archive files by processing level (L1/L2a/L2b/L3) within an observation |
| **A1** | Interactive Stretch/Level Controls | ✅ Complete | Real-time stretch algorithm and level adjustments in FITS viewer |
| **A2** | Histogram Display Panel | ⬜ Pending | Show image histogram with adjustable black/white points |
| **A3** | Pixel Coordinate & Value Display | ⬜ Pending | Show cursor position and pixel value on hover |
| **A4** | Export Processed Image | ⬜ Pending | Export stretched/processed image as PNG/JPEG |
| **A5** | 3D Data Cube Navigator | ⬜ Pending | Navigate through wavelength/time slices in data cubes |
| **B1** | RGB Composite Creator | ⬜ Pending | Combine multiple filters into RGB color images |
| **C1** | Smoothing/Noise Reduction | ⬜ Pending | Apply Gaussian, median, or wavelet filters |
| **C2** | Image Comparison/Blink Mode | ⬜ Pending | Compare two images side-by-side or blink between them |
| **C3** | Region Selection & Statistics | ⬜ Pending | Select regions and compute statistics (mean, std, etc.) |
| **C4** | Color Balance & Curves | ⬜ Pending | Advanced color adjustment tools |
| **D1** | Batch Processing | ⬜ Pending | Apply processing to multiple files at once |
| **D2** | Source Detection Overlay | ⬜ Pending | Detect and mark sources in images |
| **D3** | WCS Grid Overlay | ⬜ Pending | Display world coordinate system grid on images |
| **D4** | Scale Bar | ⬜ Pending | Add angular scale bar to images |
| **D5** | Annotation Tools | ⬜ Pending | Add text, arrows, circles to images |
| **D6** | AVM Metadata Embedding | ⬜ Pending | Embed Astronomy Visualization Metadata in exports |

#### **Feature Categories:**

- **A-series**: Core viewer functionality and data management
- **B-series**: Color and composite imaging
- **C-series**: Image processing and analysis
- **D-series**: Visualization enhancements and export

#### **Phase 4 Deliverables:**

- ✅ Delete/archive by processing level
- ✅ Interactive stretch and level controls
- [ ] Histogram display panel
- [ ] Pixel coordinate and value display
- [ ] Export processed images
- [ ] 3D data cube navigation

---

### **Phase 5: Frontend Development (Weeks 9-10)** 🔄 *In Progress*

#### **React Application:**

- [x] Modern, responsive dashboard design
- [ ] Interactive data visualization components
- [x] File upload interface for JWST data
- [x] Real-time processing status updates
- [ ] Results display with export capabilities

#### **Centralized API Service Layer:** ✅ *Complete*

- [x] Core HTTP client (`apiClient.ts`) with automatic JSON handling and error extraction
- [x] Custom error class (`ApiError.ts`) with status codes and type guards
- [x] JWST data service (`jwstDataService.ts`) for CRUD, processing, archive operations
- [x] MAST service (`mastService.ts`) for search, import, progress tracking, resume
- [x] Service re-exports (`index.ts`) for clean imports
- [x] Replaced 15 inline fetch() calls across 4 components
- [x] Consistent error handling across all API operations

#### **Visualization Features:**

- [ ] Interactive image viewers with zoom/pan
- [ ] Spectral data plots and charts
- [ ] 3D data visualization (if applicable)
- [ ] Comparison tools for different datasets
- [ ] Export functionality for processed results

#### **Phase 5 Deliverables:**

- ✅ Centralized API service layer with type-safe error handling
- ✅ File upload and management interface
- ✅ Real-time processing status dashboard
- [ ] Complete React frontend application
- [ ] Interactive data visualization components

---

### **Phase 6: Integration & Advanced Features (Weeks 11-12)**

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

### **Phase 7: Testing & Deployment (Weeks 13-14)**

#### **Quality Assurance:**

- [ ] Unit and integration testing
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
