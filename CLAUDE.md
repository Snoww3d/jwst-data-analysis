# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JWST Data Analysis Application - A microservices-based platform for analyzing James Webb Space Telescope data with advanced scientific computing capabilities.

**Architecture**: Frontend (React TypeScript) → Backend (.NET 10 API) → MongoDB + Processing Engine (Python FastAPI) → MAST Portal (STScI)

## Quick Start Commands

### Docker (Recommended for full stack)

```bash
# Start all services (from docker/ directory)
cd docker
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Rebuild after code changes
docker compose up -d --build
```

**Service URLs**:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5001
- Processing Engine: http://localhost:8000
- MongoDB: localhost:27017

### Backend Development (.NET 10)

```bash
# Navigate to backend
cd backend/JwstDataAnalysis.API

# Restore dependencies
dotnet restore

# Run backend (default port: 8080 or as configured)
dotnet run

# Build
dotnet build

# Clean
dotnet clean
```

**Note**: Update MongoDB connection string in `appsettings.json` if running standalone (not in Docker).

### Frontend Development (React)

```bash
# Navigate to frontend
cd frontend/jwst-frontend

# Install dependencies
npm install

# Run development server (port 3000)
npm start

# Build for production
npm run build

# Run tests
npm test

# Run tests in watch mode
npm test -- --watch
```

### Processing Engine (Python)

```bash
# Navigate to processing engine
cd processing-engine

# Create virtual environment (if not exists)
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate  # macOS/Linux
# or
.venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Run FastAPI server (port 8000)
uvicorn main:app --reload

# Run tests (when implemented)
pytest

# Run specific test file
pytest test_specific.py
```

## Architecture Deep Dive

### Microservices Communication Flow

```
User Browser
    ↓
React Frontend (port 3000)
    ↓ HTTP/REST
.NET Backend API (port 5001/8080)
    ↓ MongoDB.Driver          ↓ HTTP POST
MongoDB (port 27017)    Python Processing Engine (port 8000)
                              ↓                    ↓
                        Scientific Libraries    MAST Portal
                        (NumPy, Astropy, SciPy) (astroquery.mast)
                                                   ↓
                                            STScI Archive
                                            (JWST Data)
```

### Data Flow Architecture

**Local Upload Flow:**
1. **Upload**: User uploads JWST data (FITS, CSV, JSON, etc.) via React frontend
2. **Ingestion**: .NET API validates and stores metadata in MongoDB
3. **Storage**: Binary data stored (file path referenced), metadata in MongoDB document
4. **Processing**: User triggers processing → API calls Python engine → Results stored back in MongoDB
5. **Visualization**: Frontend fetches processed data and displays results

**MAST Import Flow:**
1. **Search**: User searches MAST portal via frontend (target name, coordinates, observation ID, or program ID)
2. **Query**: Backend proxies request to Python engine → astroquery.mast queries STScI archive
3. **Results**: Search results displayed in frontend table with observation details
4. **Import**: User selects observations → Backend triggers chunked download via Python engine
5. **Chunked Download**: Files downloaded in 5MB chunks with HTTP Range headers, parallel downloads (3 concurrent)
6. **Progress Tracking**: Real-time byte-level progress with speed (MB/s) and ETA displayed in UI
7. **Resume Support**: Interrupted downloads can be resumed from last byte position
8. **Record Creation**: Backend creates MongoDB records with file paths and extracted metadata
9. **Available**: Imported data appears in main dashboard with file type indicators (image vs table)

### MongoDB Document Structure

The application uses a **flexible document schema** to accommodate different JWST data types:

- **Core Document**: JwstDataModel with base fields (id, fileName, dataType, uploadDate, status)
- **Polymorphic Metadata**: Based on dataType, includes:
  - `ImageMetadata`: width, height, wavelength, filter, instrument, WCS coordinates
  - `SensorMetadata`: samplingRate, integrationTime, detectorType
  - `SpectralMetadata`: grating, wavelengthRange, spectralFeatures, signalToNoise
  - `CalibrationMetadata`: calibrationType, referenceStandards, validityPeriod
- **Processing Results**: Embedded array of results with algorithm name, parameters, and output paths
- **Versioning**: Parent-child relationships via `parentDataId` and `derivedFromId`
- **Lineage Tracking**: ProcessingLevel (L1/L2a/L2b/L3), ObservationBaseId, ExposureId for grouping related files

**Key Design**: Document model allows evolving schemas without migrations, critical for scientific data with varying metadata requirements.

### Backend Service Layer

**MongoDBService.cs** (~450 lines) acts as the **repository pattern** abstraction:

- All database operations go through this service (never direct MongoDB calls in controllers)
- Supports complex queries: filters by type, status, user, tags, date range, file size
- Aggregation pipeline for statistics and faceted search
- Bulk operations for efficiency (batch tag/status updates)
- Lineage queries: GetLineageTreeAsync, GetLineageGroupedAsync
- Async operations throughout

**Controllers**:
- **JwstDataController**: Main CRUD + search/filter/process endpoints
- **DataManagementController**: Advanced features (faceted search, export, bulk operations, statistics)
- **MastController**: MAST portal integration (search, download, import)

**Services**:
- **MongoDBService**: Repository pattern for all database operations
- **MastService**: HTTP client wrapper for Python processing engine communication

### Frontend Component Architecture

**Component Hierarchy**:
```
App.tsx (root)
  └── JwstDataDashboard.tsx (main UI)
      ├── Search/Filter Controls
      ├── View Mode Toggle (Grid | List | Grouped | Lineage)
      ├── MAST Search Toggle Button
      ├── MastSearch.tsx (MAST portal integration)
      │   ├── Search Type Selector (target/coordinates/observation/program)
      │   ├── Search Input Fields
      │   ├── Results Table with Import Buttons
      │   └── Bulk Import Functionality
      ├── Upload Modal (TODO: implementation pending)
      ├── Data Views:
      │   ├── Grid View (cards)
      │   ├── List View (table)
      │   ├── Grouped View (by data type)
      │   └── Lineage View (tree hierarchy by processing level)
      └── Processing Action Buttons
```

**State Management**: Local component state with React hooks (useState/useEffect), no Redux/Context yet

**API Integration**:
- Centralized service layer in `src/services/`
- `apiClient.ts`: Core HTTP client with automatic error handling
- `jwstDataService.ts`: JWST data operations (CRUD, processing, archive)
- `mastService.ts`: MAST search and import operations
- `ApiError.ts`: Typed error class with status codes
- Base URL configured in `config/api.ts`

### Processing Engine Architecture

**Current State** (Phase 3 in progress):
- FastAPI application with placeholder algorithm implementations
- Three algorithm types: `basic_analysis`, `image_enhancement`, `noise_reduction`
- **MAST Integration**: Full search and download capabilities via astroquery
- **Chunked Downloads**: HTTP Range header support with resume capability
- **TODO**: Actual FITS processing, algorithm implementations

**MAST Module** (`app/mast/`):
- `mast_service.py`: MastService class wrapping astroquery.mast
- `models.py`: Pydantic request/response models
- `routes.py`: FastAPI router with search, download, and chunked download endpoints
- `chunked_downloader.py`: Async HTTP downloads with Range headers, parallel file support
- `download_state_manager.py`: JSON-based state persistence for resume capability
- `download_tracker.py`: Byte-level progress tracking with speed/ETA calculations
- Uses `astroquery==0.4.7` for MAST portal queries, `aiohttp` for async downloads

**Design Pattern**:
- Processing endpoint receives: `{ data_id, algorithm_name, parameters }`
- MAST endpoints receive: `{ target_name, radius }` or `{ ra, dec, radius }` or `{ obs_id }`
- Chunked downloads use 5MB chunks with 3 parallel file downloads
- State persisted to JSON for resume after interruption
- Fetches data from backend API (not directly from MongoDB)
- Processes using scientific libraries
- Returns results to backend for storage

## Development Workflow

### Current Phase: Phase 3 (Data Processing Engine)

**Focus Areas**:
- Implement actual scientific processing algorithms
- Complete FITS file handling integration
- Replace placeholder implementations in `processing-engine/main.py`

**Completed**:
- ✅ Phase 1: Foundation & Architecture
- ✅ Phase 2: Core Infrastructure (enhanced data models, advanced API endpoints)
- ✅ MAST Portal Integration (search, download, import workflow)
- ✅ Processing Level Tracking & Lineage Visualization
- ✅ Chunked Downloads with HTTP Range headers (5MB chunks, 3 parallel files)
- ✅ Resume Capability for interrupted downloads
- ✅ Byte-level Progress Tracking (speed, ETA, per-file progress)
- ✅ FITS File Type Detection (image vs table indicators)
- ✅ FITS Viewer with graceful handling of non-image files

**Remaining Phase 3 Work**:
- [ ] Implement actual image processing algorithms
- [ ] Implement spectral analysis tools
- [ ] Processing job queue system
- [ ] Table data viewer for non-image FITS files

**See**: `docs/development-plan.md` for full 6-phase roadmap

### Verification Standards

**CRITICAL**: All implementation plans and verification steps MUST include testing using the Docker environment.
- Any feature that involves backend/frontend integration or database changes must be verified in the full Docker stack.
- "Works on my machine" (local npm/dotnet run) is insufficient for final verification.
- Always include `docker compose up -d` instructions in verification plans.

### Coding Standards

**Backend (.NET)**:
- Async/await for all database operations
- Dependency injection for services
- MongoDB.Driver for database (never direct queries)
- Nullable reference types enabled
- PascalCase for public members
- Structured logging with ILogger
- DTOs for request/response validation

**Frontend (React)**:
- TypeScript interfaces mirror backend models (keep in sync)
- Functional components with hooks
- Semantic HTML with ARIA attributes
- CSS classes (no inline styles)
- Error boundaries with try-catch
- Loading states for async operations

**Processing Engine (Python)**:
- Type hints with Pydantic models
- Async routes in FastAPI
- Astropy for FITS file handling
- NumPy for numerical operations
- pytest for testing

### Security Notes

**Development Credentials** (DO NOT use in production):
- MongoDB: username `admin`, password `password`
- CORS: Configured for localhost development (allows all origins)

**Before Production**:
- Implement authentication/authorization (Phase 2 placeholder exists)
- Use environment variables for all secrets
- Update CORS to whitelist specific origins
- Review `appsettings.json` and `docker-compose.yml` for hardcoded credentials

### Git Workflow

- **ALWAYS create a Pull Request (PR) after pushing**.
- **NEVER** push directly to `main` or stop at the `push` step.
- **ALWAYS check CI tests pass before merging** (`gh pr checks <pr-number>`).
- **ALWAYS include documentation updates in the same PR**.
- Workflow:
    1. Create feature branch (`git checkout -b feature/name`)
    2. Make changes AND update relevant documentation:
       - Update `CLAUDE.md` with new API endpoints, features, or usage patterns
       - Update `docs/development-plan.md` to mark completed items
       - Update `docs/standards/*.md` for model/API/frontend changes
    3. Commit changes (`git commit`)
    4. Push to origin (`git push ...`)
    5. **IMMEDIATELY** create PR (`gh pr create ...`)
    6. **Wait for CI to pass**: Check status with `gh pr checks <pr-number>`
    7. **STOP for user review**: Open PR in browser (`gh pr view --web`), report PR URL and CI status, wait for user approval
    8. **Only merge after user approves**: `gh pr merge <pr-number> --merge --delete-branch`
    9. After merge, cleanup branches:
       - Switch to main and pull: `git checkout main && git pull`
       - Delete local merged branches: `git branch -d branch-name`
       - Prune stale remote refs: `git fetch --prune`
- Feature branches for development
- Conventional commit messages
- Atomic, focused commits
- Current branch: `main`

### Task Tracking

Use Claude Code's task system for tracking work items, tech debt, and multi-step implementations.

**Storage**: `~/.claude/tasks/<session-id>/*.json` (persists across sessions)

**When to use tasks**:
- Tech debt and bug tracking (with dependencies)
- Multi-step implementations
- Code review findings
- Any work that spans multiple sessions

**Standard: 1 Task = 1 PR**

Each task gets its own feature branch and PR. This ensures:
- Atomic, reviewable changes
- Clear commit history linked to tasks
- Easy rollback if needed

**Task → PR workflow**:
```bash
# 1. Start task
TaskUpdate taskId="1" status="in_progress"

# 2. Create feature branch
git checkout -b fix/task-1-description   # or feature/task-N-...

# 3. Make changes and commit
git add <files>
git commit -m "fix: Description (Task #1)"

# 4. Push and create PR
git push -u origin fix/task-1-description
gh pr create --title "fix: Description (Task #1)" --body "..."

# 5. Execute test plan (REQUIRED before user review)
# - Run ALL items in the PR's test plan using Docker environment
# - Document results (pass/fail) for each test item
# - If a test item CANNOT be executed (e.g., requires specific hardware,
#   user credentials, or manual UI interaction), clearly note this

# 6. Wait for CI, open PR for user review
gh pr checks <pr-number>
gh pr view <pr-number> --web
# STOP: Report PR URL, CI status, test results, and prompt user:
#   "PR ready for review: <url>
#    CI: passing/pending/failing
#    Test plan results:
#      ✅ Test 1 - passed
#      ✅ Test 2 - passed
#      ⚠️ Test 3 - could not execute (reason: requires manual UI interaction)
#    → Review in GitHub, then reply 'merge' or request changes"

# 7. After user approves: merge
gh pr merge <pr-number> --merge --delete-branch

# 8. Mark task complete
TaskUpdate taskId="1" status="completed"

# 9. Cleanup
git checkout main && git pull
git fetch --prune
```

**Branch naming**: `{type}/task-{N}-{short-description}`
- `fix/task-1-path-traversal-preview`
- `feature/task-12-api-service-layer`
- `refactor/task-6-mast-import-code`

**PR title format**: `{type}: Description (Task #N)`

**Task structure**:
```json
{
  "id": "1",
  "subject": "Brief title",
  "description": "Full details with **Location**, **Issue**, **Fix**",
  "status": "pending|in_progress|completed",
  "blocks": ["2"],
  "blockedBy": ["3"],
  "metadata": { "priority": "critical", "category": "security" }
}
```

**Current tech debt**: See `docs/tech-debt.md` for full details, run `/tasks` for status.

### Documentation Files to Update

When features are added or changed, update these files:

| Change Type | Files to Update |
|-------------|-----------------|
| New API endpoint | `CLAUDE.md` (API Quick Reference), `docs/standards/backend-development.md` |
| New data model field | `CLAUDE.md`, `docs/standards/database-models.md`, `docs/standards/backend-development.md` |
| New frontend feature | `CLAUDE.md`, `docs/standards/frontend-development.md` |
| Phase completion | `docs/development-plan.md` |
| New TypeScript type | `docs/standards/frontend-development.md` |
| Tech debt / bugs | Create task with `TaskCreate`, update `docs/tech-debt.md` for critical items |
| Code review finding | Create task with dependencies, add to `docs/tech-debt.md` if significant |

## Key Files Reference

**Configuration**:
- `backend/JwstDataAnalysis.API/appsettings.json` - Backend config, MongoDB connection
- `frontend/jwst-frontend/package.json` - Frontend dependencies
- `processing-engine/requirements.txt` - Python dependencies
- `docker/docker-compose.yml` - Service orchestration

**Core Backend**:
- `backend/JwstDataAnalysis.API/Controllers/JwstDataController.cs` - Main API endpoints
- `backend/JwstDataAnalysis.API/Controllers/DataManagementController.cs` - Advanced endpoints
- `backend/JwstDataAnalysis.API/Controllers/MastController.cs` - MAST portal endpoints
- `backend/JwstDataAnalysis.API/Services/MongoDBService.cs` - Database layer
- `backend/JwstDataAnalysis.API/Services/MastService.cs` - MAST HTTP client
- `backend/JwstDataAnalysis.API/Models/JwstDataModel.cs` - Data models and DTOs
- `backend/JwstDataAnalysis.API/Models/MastModels.cs` - MAST request/response DTOs

**Core Frontend**:
- `frontend/jwst-frontend/src/App.tsx` - Root component with data fetching
- `frontend/jwst-frontend/src/components/JwstDataDashboard.tsx` - Main dashboard UI
- `frontend/jwst-frontend/src/components/MastSearch.tsx` - MAST search component
- `frontend/jwst-frontend/src/types/JwstDataTypes.ts` - TypeScript type definitions
- `frontend/jwst-frontend/src/types/MastTypes.ts` - MAST TypeScript types

**Processing**:
- `processing-engine/main.py` - FastAPI application entry point
- `processing-engine/app/mast/mast_service.py` - MAST API wrapper (astroquery)
- `processing-engine/app/mast/routes.py` - MAST FastAPI routes
- `processing-engine/app/mast/models.py` - MAST Pydantic models
- `processing-engine/app/mast/chunked_downloader.py` - Async chunked download with HTTP Range
- `processing-engine/app/mast/download_state_manager.py` - State persistence for resume
- `processing-engine/app/mast/download_tracker.py` - Byte-level progress tracking
- `processing-engine/app/processing/analysis.py` - Analysis algorithms (in progress)
- `processing-engine/app/processing/utils.py` - FITS utilities (in progress)

**Frontend Services**:
- `frontend/jwst-frontend/src/services/apiClient.ts` - Core HTTP client
- `frontend/jwst-frontend/src/services/ApiError.ts` - Custom error class
- `frontend/jwst-frontend/src/services/jwstDataService.ts` - JWST data operations
- `frontend/jwst-frontend/src/services/mastService.ts` - MAST operations
- `frontend/jwst-frontend/src/services/index.ts` - Service re-exports

**Frontend Utilities**:
- `frontend/jwst-frontend/src/utils/fitsUtils.ts` - FITS file type detection and classification
- `frontend/jwst-frontend/src/utils/colormaps.ts` - Color maps for FITS visualization
- `frontend/jwst-frontend/src/components/AdvancedFitsViewer.tsx` - FITS image viewer
- `frontend/jwst-frontend/src/components/ImageViewer.tsx` - Image viewer modal wrapper

## Common Patterns

### Adding a New API Endpoint

1. Add method to `MongoDBService.cs` if database operation needed
2. Add controller action in appropriate controller (JwstDataController or DataManagementController)
3. Use async/await pattern
4. Return appropriate HTTP status codes (200, 201, 404, 500)
5. Add error handling with try-catch
6. Update Swagger documentation (automatic via annotations)

### Adding Processing Algorithm

1. Define algorithm in `processing-engine/main.py` algorithms dict
2. Implement processing function (accept data, parameters, return results)
3. Update frontend `JwstDataDashboard.tsx` with new action button
4. Add algorithm name to type definitions if needed

### Updating Data Models

1. Modify `JwstDataModel.cs` in backend
2. Mirror changes in `frontend/jwst-frontend/src/types/JwstDataTypes.ts`
3. Update MongoDB queries in `MongoDBService.cs` if new fields need indexing/filtering
4. No migration needed (MongoDB schema-less)

## API Endpoints Quick Reference

**Base URL**: http://localhost:5001/api

**Main Data Operations**:
- `GET /jwstdata` - List all data (with optional query params)
- `GET /jwstdata/{id}` - Get specific item
- `GET /jwstdata/type/{dataType}` - Filter by type (image, sensor, spectral, metadata, calibration)
- `GET /jwstdata/status/{status}` - Filter by processing status
- `POST /jwstdata` - Create new data entry
- `PUT /jwstdata/{id}` - Update existing data
- `DELETE /jwstdata/{id}` - Delete data
- `POST /jwstdata/{id}/process` - Trigger processing

**Lineage Operations**:
- `GET /jwstdata/lineage` - Get all lineage groups (grouped by observation)
- `GET /jwstdata/lineage/{observationBaseId}` - Get lineage for specific observation
- `POST /jwstdata/migrate/processing-levels` - Backfill processing levels for existing data

**Advanced Operations**:
- `POST /datamanagement/search` - Faceted search with statistics
- `GET /datamanagement/statistics` - Data distribution analytics
- `POST /datamanagement/export` - Export data in various formats
- `POST /datamanagement/bulk/tags` - Bulk tag updates
- `POST /datamanagement/bulk/status` - Bulk status updates

**MAST Portal Operations**:
- `POST /mast/whats-new` - Browse recently released JWST observations (default: 7 days)
- `POST /mast/search/target` - Search by target name (e.g., "NGC 3132", "Carina Nebula")
- `POST /mast/search/coordinates` - Search by RA/Dec coordinates with radius
- `POST /mast/search/observation` - Search by MAST observation ID
- `POST /mast/search/program` - Search by JWST program/proposal ID
- `POST /mast/products` - Get available data products for an observation
- `POST /mast/download` - Download FITS files (without creating DB records)
- `POST /mast/import` - Download and import into MongoDB (with chunked downloads)
- `GET /mast/import-progress/{jobId}` - Get import job progress (byte-level)
- `POST /mast/import/resume/{jobId}` - Resume a paused/failed import
- `GET /mast/import/resumable` - List all resumable download jobs
- `POST /mast/import/from-existing/{obsId}` - Import from already-downloaded files
- `GET /mast/import/check-files/{obsId}` - Check if downloaded files exist
- `POST /mast/refresh-metadata/{obsId}` - Re-fetch and update metadata for a single observation
- `POST /mast/refresh-metadata-all` - Re-fetch and update metadata for all MAST imports

**Swagger UI**: http://localhost:5001/swagger

## Troubleshooting

**MongoDB Connection Issues**:
- Ensure MongoDB is running (Docker: `docker compose ps`)
- Check connection string in `appsettings.json` matches your setup
- Default: `mongodb://admin:password@localhost:27017`

**Frontend Can't Reach Backend**:
- Verify backend is running on expected port
- Check CORS configuration in `Program.cs`
- Confirm `REACT_APP_API_URL` environment variable

**Processing Engine Not Working**:
- Virtual environment activated?
- All dependencies installed? (`pip install -r requirements.txt`)
- Check Python version (requires 3.9+)
- Note: Many algorithms are TODO/stubs in Phase 3

**Docker Issues**:
- Rebuild images: `docker compose up -d --build`
- Check logs: `docker compose logs -f [service-name]`
- Reset volumes: `docker compose down -v` (WARNING: deletes data)

**MAST Search Issues**:
- Ensure processing engine is running: `docker compose logs processing-engine`
- Check internet connectivity (MAST requires external access)
- Target name searches are case-insensitive but must match MAST naming
- If JSON serialization errors occur, NaN values from MAST are being handled
- Large downloads may timeout; increase `HttpClient.Timeout` if needed
- Downloaded files stored in `data/mast/{obs_id}/` directory

## Using MAST Search

### From the Frontend

1. Click "Search MAST" button in the dashboard header
2. Select search type:
   - **Target Name**: Enter astronomical object name (e.g., "NGC 3132", "Carina Nebula")
   - **Coordinates**: Enter RA/Dec in degrees with search radius
   - **Observation ID**: Enter MAST observation ID (e.g., "jw02733-o001_t001_nircam_clear-f090w")
   - **Program ID**: Enter JWST program number (e.g., "2733")
3. Click "Search MAST" to query the archive
4. Review results in the table (shows target, instrument, filter, exposure time)
5. Click "Import" on individual observations or select multiple and use "Import Selected"
6. Imported files appear in the main data dashboard

### Example API Calls

```bash
# Search by target name
curl -X POST http://localhost:5001/api/mast/search/target \
  -H "Content-Type: application/json" \
  -d '{"targetName": "NGC 3132", "radius": 0.1}'

# Search by coordinates
curl -X POST http://localhost:5001/api/mast/search/coordinates \
  -H "Content-Type: application/json" \
  -d '{"ra": 151.755, "dec": -40.437, "radius": 0.1}'

# Import observation
curl -X POST http://localhost:5001/api/mast/import \
  -H "Content-Type: application/json" \
  -d '{"obsId": "jw02733-o001_t001_nircam_clear-f090w", "productType": "SCIENCE"}'

# Check import progress
curl http://localhost:5001/api/mast/import-progress/{jobId}

# Resume failed import
curl -X POST http://localhost:5001/api/mast/import/resume/{jobId}

# Import from existing files (if download completed but timed out)
curl -X POST http://localhost:5001/api/mast/import/from-existing/{obsId}

# Refresh metadata for a single observation (re-fetch from MAST)
curl -X POST http://localhost:5001/api/mast/refresh-metadata/{obsId}

# Refresh metadata for ALL MAST imports (useful after updates)
curl -X POST http://localhost:5001/api/mast/refresh-metadata-all
```

### MAST Metadata Preservation

When importing observations from MAST, all metadata fields (~30+) are preserved with `mast_` prefix in the record's `metadata` dictionary. Key fields include:

**Stored in ImageInfo** (typed fields):
- `observationDate` - Converted from MJD (t_min) with fallback to t_max, t_obs_release
- `targetName`, `instrument`, `filter`, `exposureTime`
- `calibrationLevel` - MAST calib_level (0-4)
- `proposalId`, `proposalPi`, `observationTitle`
- `wavelengthRange` - e.g., "INFRARED", "OPTICAL"
- `wcs` - World coordinate system (CRVAL1, CRVAL2)

**Stored in Metadata** (all MAST fields with `mast_` prefix):
- `mast_obs_id`, `mast_target_name`, `mast_instrument_name`
- `mast_t_min`, `mast_t_max`, `mast_t_exptime`
- `mast_proposal_id`, `mast_proposal_pi`, `mast_obs_title`
- `mast_s_ra`, `mast_s_dec`, `mast_s_region`
- `mast_dataURL`, `mast_jpegURL`
- And many more...

**Refresh Metadata Button**: Click "Refresh Metadata" in the dashboard to re-fetch metadata from MAST for all existing imports. This is useful after updates that add new metadata fields.

### FITS File Types

The dashboard displays file type indicators to show which files are viewable:

**Viewable Image Files** (🖼️ blue badge):
- `*_uncal.fits` - Uncalibrated raw data
- `*_rate.fits` / `*_rateints.fits` - Count rate images
- `*_cal.fits` / `*_calints.fits` - Calibrated images
- `*_i2d.fits` - 2D resampled/combined images
- `*_s2d.fits` - 2D spectral images
- `*_crf.fits` - Cosmic ray flagged images

**Non-Viewable Table Files** (📊 amber badge):
- `*_asn.fits` - Association tables
- `*_x1d.fits` / `*_x1dints.fits` - 1D extracted spectra
- `*_cat.fits` - Source catalogs
- `*_pool.fits` - Association pools

The View button is disabled for table files to prevent errors.

## Known Issues / Tech Debt

**Tracked via**: Claude Code task system (persisted across sessions)
**Full details**: `docs/tech-debt.md`

### Critical (Security/Performance) - Tasks #1-4
- Path traversal in preview endpoint (`processing-engine/main.py:167`)
- Memory exhaustion in file download (`JwstDataController.cs:111`)
- Regex injection in MongoDB search (`MongoDBService.cs:76`)
- Path traversal in export endpoint (`DataManagementController.cs:225`)

### Recommended - Tasks #5-11
- N+1 query in export endpoint
- Duplicated import code in MastController
- Missing frontend TypeScript types
- Hardcoded API URLs in frontend
- Statistics query loads all docs into memory
- Missing MongoDB indexes
- File extension validation bypass

### Nice to Have - Tasks #12-16
- Centralized API service layer (#12 blocked by #8)
- Proper job queue (#13 blocked by #6)
- FITS TypeScript interfaces (#14 blocked by #7)
- Download job cleanup timer
- Missing magma/inferno colormaps

Run `/tasks` to see current status and dependencies.
