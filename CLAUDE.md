# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

JWST Data Analysis Application - A microservices-based platform for analyzing James Webb Space Telescope data with advanced scientific computing capabilities.

**Architecture**: Frontend (React TypeScript) → Backend (.NET 8 API) → MongoDB + Processing Engine (Python FastAPI) → MAST Portal (STScI)

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

### Backend Development (.NET 8)

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
4. **Import**: User selects observations → Backend triggers download via Python engine
5. **Download**: FITS files downloaded to shared volume (`/app/data/mast/{obs_id}/`)
6. **Record Creation**: Backend creates MongoDB records with file paths and extracted metadata
7. **Available**: Imported data appears in main dashboard for processing

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

**Key Design**: Document model allows evolving schemas without migrations, critical for scientific data with varying metadata requirements.

### Backend Service Layer

**MongoDBService.cs** (381 lines) acts as the **repository pattern** abstraction:

- All database operations go through this service (never direct MongoDB calls in controllers)
- Supports complex queries: filters by type, status, user, tags, date range, file size
- Aggregation pipeline for statistics and faceted search
- Bulk operations for efficiency (batch tag/status updates)
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
      ├── MAST Search Toggle Button
      ├── MastSearch.tsx (MAST portal integration)
      │   ├── Search Type Selector (target/coordinates/observation/program)
      │   ├── Search Input Fields
      │   ├── Results Table with Import Buttons
      │   └── Bulk Import Functionality
      ├── Upload Modal (TODO: implementation pending)
      ├── Data Grid (cards)
      └── Processing Action Buttons
```

**State Management**: Local component state with React hooks (useState/useEffect), no Redux/Context yet

**API Integration**:
- Direct fetch calls from components
- Base URL: http://localhost:5001
- Error handling with try-catch + user-facing messages

### Processing Engine Architecture

**Current State** (Phase 3 in progress):
- FastAPI application with placeholder algorithm implementations
- Three algorithm types: `basic_analysis`, `image_enhancement`, `noise_reduction`
- **MAST Integration**: Full search and download capabilities via astroquery
- **TODO**: Actual FITS processing, algorithm implementations

**MAST Module** (`app/mast/`):
- `mast_service.py`: MastService class wrapping astroquery.mast
- `models.py`: Pydantic request/response models
- `routes.py`: FastAPI router with search and download endpoints
- Uses `astroquery==0.4.7` for MAST portal queries

**Design Pattern**:
- Processing endpoint receives: `{ data_id, algorithm_name, parameters }`
- MAST endpoints receive: `{ target_name, radius }` or `{ ra, dec, radius }` or `{ obs_id }`
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

**Remaining Phase 3 Work**:
- [ ] Implement actual image processing algorithms
- [ ] Implement spectral analysis tools
- [ ] Processing job queue system

**See**: `docs/development-plan.md` for full 6-phase roadmap

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

- Feature branches for development
- Conventional commit messages
- Atomic, focused commits
- Current branch: `main`

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
- `processing-engine/app/processing/analysis.py` - Analysis algorithms (in progress)
- `processing-engine/app/processing/utils.py` - FITS utilities (in progress)

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

**Advanced Operations**:
- `POST /datamanagement/search` - Faceted search with statistics
- `GET /datamanagement/statistics` - Data distribution analytics
- `POST /datamanagement/export` - Export data in various formats
- `POST /datamanagement/bulk/tags` - Bulk tag updates
- `POST /datamanagement/bulk/status` - Bulk status updates

**MAST Portal Operations**:
- `POST /mast/search/target` - Search by target name (e.g., "NGC 3132", "Carina Nebula")
- `POST /mast/search/coordinates` - Search by RA/Dec coordinates with radius
- `POST /mast/search/observation` - Search by MAST observation ID
- `POST /mast/search/program` - Search by JWST program/proposal ID
- `POST /mast/products` - Get available data products for an observation
- `POST /mast/download` - Download FITS files (without creating DB records)
- `POST /mast/import` - Download and import into MongoDB

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
```
