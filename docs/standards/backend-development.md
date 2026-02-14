# .NET Backend Development Rules

## Architecture

- Use .NET 10 Web API with MongoDB integration
- Follow RESTful API design principles
- Implement proper error handling and logging
- Use dependency injection for services

## Key Files

- Main API project: [backend/JwstDataAnalysis.API/](https://github.com/Snoww3d/jwst-data-analysis/tree/main/backend/JwstDataAnalysis.API)
- Controllers:
  - [JwstDataController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/JwstDataController.cs) - Main CRUD + lineage + viewer + thumbnail endpoints
  - [DataManagementController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/DataManagementController.cs) - Faceted search, export, bulk operations
  - [MastController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/MastController.cs) - MAST search, import, metadata refresh
  - [CompositeController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/CompositeController.cs) - RGB composite generation
  - [MosaicController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/MosaicController.cs) - WCS mosaic generation
  - [AnalysisController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/AnalysisController.cs) - Region statistics
  - [AuthController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/AuthController.cs) - Authentication endpoints
- Models:
  - [JwstDataModel.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Models/JwstDataModel.cs) - Core data models
  - [DataValidationModels.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Models/DataValidationModels.cs) - DTOs and validation
  - [MastModels.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Models/MastModels.cs) - MAST request/response DTOs
- Services:
  - [MongoDBService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/MongoDBService.cs) - Database operations
  - [MastService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/MastService.cs) - MAST HTTP client
  - [CompositeService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/CompositeService.cs) - RGB composite processing
  - [MosaicService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/MosaicService.cs) - WCS mosaic processing
  - [AnalysisService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/AnalysisService.cs) - Region statistics
  - [ThumbnailService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/ThumbnailService.cs) - FITS thumbnail generation
  - [ThumbnailQueue.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/ThumbnailQueue.cs) - Background queue for thumbnail batches
  - [ThumbnailBackgroundService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/ThumbnailBackgroundService.cs) - BackgroundService processing queued batches
  - [ImportJobTracker.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/ImportJobTracker.cs) - MAST import job tracking
  - [AuthService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/AuthService.cs) - User authentication
  - [JwtTokenService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/JwtTokenService.cs) - JWT token generation/validation
- Configuration: [backend/JwstDataAnalysis.API/appsettings.json](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/appsettings.json)

## Coding Standards

- Use async/await for all database operations
- Implement proper validation using DataAnnotations
- Use structured logging with ILogger
- Follow C# naming conventions (PascalCase for public members)
- Use MongoDB.Driver for database operations
- Implement proper CORS configuration for frontend integration

## API Endpoints

### JwstDataController (`/api/jwstdata`)

- GET /api/jwstdata - Get all data
- GET /api/jwstdata/{id} - Get by ID
- GET /api/jwstdata/type/{dataType} - Filter by type
- GET /api/jwstdata/status/{status} - Filter by status
- GET /api/jwstdata/search/{searchTerm} - Search data
- POST /api/jwstdata - Create new data
- PUT /api/jwstdata/{id} - Update data
- DELETE /api/jwstdata/{id} - Delete data
- POST /api/jwstdata/{id}/process - Process data
- GET /api/jwstdata/lineage - Get all lineage groups
- GET /api/jwstdata/lineage/{observationBaseId} - Get lineage for observation
- POST /api/jwstdata/migrate/processing-levels - Backfill processing levels
- POST /api/jwstdata/thumbnails/generate - Queue thumbnail generation for all viewable records without thumbnails
- GET /api/jwstdata/{id}/thumbnail - Get thumbnail image for a record

### MastController (`/api/mast`)

**Search:**
- POST /api/mast/search/target - Search by target name
- POST /api/mast/search/coordinates - Search by RA/Dec
- POST /api/mast/search/observation - Search by observation ID
- POST /api/mast/search/program - Search by program ID
- POST /api/mast/products - Get data products for observation

**Import:**
- POST /api/mast/download - Download FITS files (no DB records)
- POST /api/mast/import - Download and import into MongoDB
- GET /api/mast/import-progress/{jobId} - Get import progress
- POST /api/mast/import/resume/{jobId} - Resume paused import
- GET /api/mast/import/resumable - List resumable jobs
- POST /api/mast/import/from-existing/{obsId} - Import from downloaded files
- GET /api/mast/import/check-files/{obsId} - Check if files exist

**Metadata Management:**
- POST /api/mast/refresh-metadata/{obsId} - Re-fetch metadata for observation
- POST /api/mast/refresh-metadata-all - Re-fetch metadata for all imports

### DataManagementController (`/api/datamanagement`)

- POST /api/datamanagement/search - Faceted search
- GET /api/datamanagement/statistics - Data distribution stats
- POST /api/datamanagement/export - Export data
- POST /api/datamanagement/bulk/tags - Bulk tag updates
- POST /api/datamanagement/bulk/status - Bulk status updates

### CompositeController (`/api/composite`)

- POST /api/composite/generate - Generate RGB composite from 3 source data IDs
- WCS alignment: channels are reprojected to a common celestial grid before RGB stacking
- Per-channel controls: stretch, blackPoint, whitePoint, gamma, asinhA, curve, weight (0.0–2.0 intensity multiplier)
- Optional global controls: overall.stretch, overall.blackPoint, overall.whitePoint, overall.gamma, overall.asinhA
- Access model: anonymous users can only use public data; authenticated users can use own/public/shared; admins can use all

### MosaicController (`/api/mosaic`)

- POST /api/mosaic/generate - Generate WCS-aligned mosaic from 2+ source data IDs (png/jpeg/fits)
- POST /api/mosaic/generate-and-save - Generate native FITS mosaic server-side and persist as a new data record
- POST /api/mosaic/footprint - Compute WCS footprint polygons for selected source files
- Large-output pattern: use `generate-and-save` for mosaics that would be too large for browser download/upload roundtrips
- FITS mosaic metadata: `/mosaic/generate` FITS responses include provenance in primary headers plus a `SRCMETA` extension containing source FITS header cards

## Data Models

- **JwstDataModel**: Main data entity with flexible metadata
  - `ProcessingLevel`: JWST pipeline stage (L1, L2a, L2b, L3)
  - `ObservationBaseId`: Groups related files by observation
  - `ExposureId`: Finer-grained lineage tracking
  - `Metadata`: Dictionary storing all MAST fields with `mast_` prefix
  - `IsViewable`: true for images, false for tables/catalogs

- **ImageMetadata**: For image-specific data
  - Core: `targetName`, `instrument`, `filter`, `exposureTime`, `observationDate`
  - MAST fields: `wavelengthRange`, `calibrationLevel`, `proposalId`, `proposalPi`, `observationTitle`
  - WCS: `coordinateSystem`, `wcs` (CRVAL1, CRVAL2)

- **SensorMetadata**: For sensor/spectral data
- **SpectralMetadata**: For spectral analysis data
- **CalibrationMetadata**: For calibration files
- **ProcessingResult**: For processing outcomes
- **LineageResponse/LineageFileInfo**: DTOs for lineage queries
- **MetadataRefreshResponse**: Response for metadata refresh operations

## Security Notes

- Current MongoDB credentials are for development only
- Implement proper authentication in Phase 2
- Use environment variables for sensitive configuration

## Git Workflow

- **ALWAYS create a Pull Request (PR) after pushing**
- **NEVER push directly to `main`**
- Workflow:
  1. Create feature branch (`git checkout -b feature/name`)
  2. Commit changes (`git commit`)
  3. Push to origin (`git push`)
  4. **IMMEDIATELY** create PR (`gh pr create`)
- Use conventional commit messages
- Atomic, focused commits
