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
  - [AnalysisController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/AnalysisController.cs) - Region statistics, source detection, FITS table data
  - [AuthController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/AuthController.cs) - Authentication endpoints
  - [JobsController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/JobsController.cs) - Unified job status, cancel, and result download
  - [DiscoveryController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/DiscoveryController.cs) - Featured targets and recipe suggestions
  - [SearchController.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Controllers/SearchController.cs) - Semantic search and re-index
- Models:
  - [JwstDataModel.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Models/JwstDataModel.cs) - Core data models
  - [DataValidationModels.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Models/DataValidationModels.cs) - DTOs and validation
  - [MastModels.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Models/MastModels.cs) - MAST request/response DTOs
- Services:
  - [MongoDBService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/MongoDBService.cs) - Database operations
  - [MastService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/MastService.cs) - MAST HTTP client
  - [CompositeService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/CompositeService.cs) - RGB composite processing
  - [MosaicService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/MosaicService.cs) - WCS mosaic processing
  - [AnalysisService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/AnalysisService.cs) - Region statistics, source detection, FITS table data
  - [ThumbnailService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/ThumbnailService.cs) - FITS thumbnail generation
  - [ThumbnailQueue.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/ThumbnailQueue.cs) - Background queue for thumbnail batches
  - [ThumbnailBackgroundService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/ThumbnailBackgroundService.cs) - BackgroundService processing queued batches
  - [CompositeQueue.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/CompositeQueue.cs) - Bounded channel queue for async composite exports
  - [CompositeBackgroundService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/CompositeBackgroundService.cs) - BackgroundService processing composite export jobs
  - [MosaicQueue.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/MosaicQueue.cs) - Bounded channel queue for async mosaic jobs (export, save-to-library, observation mosaic)
  - [MosaicBackgroundService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/MosaicBackgroundService.cs) - BackgroundService processing mosaic export, save, and observation mosaic jobs
  - [ImportJobTracker.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/ImportJobTracker.cs) - MAST import job tracking
  - [JobTracker.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/JobTracker.cs) - Unified job tracker (MongoDB + in-memory cache, SignalR push)
  - [JobProgressNotifier.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/JobProgressNotifier.cs) - SignalR progress notification
  - [JobReaperBackgroundService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/JobReaperBackgroundService.cs) - Expired job cleanup
  - [StartupReconciliationService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/StartupReconciliationService.cs) - Marks interrupted jobs as failed on restart
  - [IStorageProvider.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/Storage/IStorageProvider.cs) - Storage abstraction interface
  - [LocalStorageProvider.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/Storage/LocalStorageProvider.cs) - Local filesystem storage
  - [S3StorageProvider.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/Storage/S3StorageProvider.cs) - S3-compatible object storage (AWS SDK)
  - [StorageKeyHelper.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/Storage/StorageKeyHelper.cs) - File path to storage key conversion
  - [DiscoveryService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/DiscoveryService.cs) - Featured targets and recipe engine proxy
  - [SemanticSearchService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/SemanticSearchService.cs) - Semantic search engine proxy with MongoDB enrichment
  - [MastProxyHealthCheck.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/MastProxyHealthCheck.cs) - IHealthCheck for MAST proxy service
  - [EmbeddingQueue.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/EmbeddingQueue.cs) - Bounded channel queue for embedding jobs
  - [EmbeddingBackgroundService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/EmbeddingBackgroundService.cs) - BackgroundService for embedding jobs
  - [AuthService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/AuthService.cs) - User authentication
  - [JwtTokenService.cs](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/Services/JwtTokenService.cs) - JWT token generation/validation
- Configuration: [backend/JwstDataAnalysis.API/appsettings.json](https://github.com/Snoww3d/jwst-data-analysis/blob/main/backend/JwstDataAnalysis.API/appsettings.json)
  - `MastProxy:BaseUrl` — URL for the dedicated MAST proxy service (falls back to `ProcessingEngine:BaseUrl`)

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
- GET /api/jwstdata/lineage - Get all lineage groups
- GET /api/jwstdata/lineage/{observationBaseId} - Get lineage for observation
- POST /api/jwstdata/migrate/processing-levels - Backfill processing levels
- POST /api/jwstdata/check-availability - Check if observations have existing data (AllowAnonymous)
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
- POST /api/mast/import - Download and import into MongoDB (supports `downloadSource`: "auto", "s3", "http")
- GET /api/mast/import-progress/{jobId} - Get import progress
- POST /api/mast/import/resume/{jobId} - Resume paused import
- POST /api/mast/import/cancel/{jobId} - Cancel active import
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

- POST /api/composite/generate-nchannel - Generate N-channel composite with color mapping (1–N filters mapped to RGB via hue or explicit RGB weights)
- POST /api/composite/export-nchannel - Async N-channel composite export via job queue (requires auth, returns 202 with jobId, track via SignalR/polling, download via `/api/jobs/{jobId}/result`)
- WCS alignment: channels are reprojected to a common celestial grid before RGB stacking
- Per-channel controls: stretch, blackPoint, whitePoint, gamma, asinhA, curve, weight (0.0–2.0 intensity multiplier)
- N-channel adds: color (hue 0-360°, explicit RGB weights, or `luminance: true` for LRGB), label, wavelength_um
- Luminance channel: at most one per composite; contributes detail (lightness) via HSL blending instead of color
- Optional global controls: overall.stretch, overall.blackPoint, overall.whitePoint, overall.gamma, overall.asinhA
- Access model: anonymous users can only use public data; authenticated users can use own/public/shared; admins can use all

### MosaicController (`/api/mosaic`)

- POST /api/mosaic/generate - Generate WCS-aligned mosaic from 2+ source data IDs (png/jpeg/fits)
- POST /api/mosaic/generate-and-save - Generate native FITS mosaic server-side and persist as a new data record
- POST /api/mosaic/export - Async mosaic image export via job queue (requires auth, returns 202 with jobId, track via SignalR/polling, download via `/api/jobs/{jobId}/result`)
- POST /api/mosaic/save - Async mosaic FITS save-to-library via job queue (requires auth, returns 202 with jobId, creates new data record)
- POST /api/mosaic/footprint - Compute WCS footprint polygons for selected source files
- Large-output pattern: use `export` or `save` for mosaics that would be too large for browser download/upload roundtrips
- FITS mosaic metadata: `/mosaic/generate` FITS responses include provenance in primary headers plus a `SRCMETA` extension containing source FITS header cards

### JobsController (`/api/jobs`)

- GET /api/jobs - List jobs for current user (query: `status`, `type`)
- GET /api/jobs/{jobId} - Get job status (ownership enforced)
- POST /api/jobs/{jobId}/cancel - Cancel a job (ownership enforced)
- GET /api/jobs/{jobId}/result - Stream blob result or return data ID (extends TTL on access)

### DiscoveryController (`/api/discovery`)

- GET /api/discovery/featured - Get curated featured targets list (12 targets with metadata, instruments, composite potential)
- POST /api/discovery/suggest-recipes - Generate ranked composite recipe suggestions for a set of observations (proxies to Python recipe engine)

### SearchController (`/api/search`)

- GET /api/search/semantic?q=...&topK=20&minScore=0.3 - Natural language search over FITS metadata (anonymous, results access-controlled)
- POST /api/search/reindex - Trigger full semantic re-index (admin only, returns 202 + jobId)
- GET /api/search/index-status - Semantic index health (total indexed, model loaded)

### AnalysisController (`/api/analysis`)

- POST /api/analysis/region-statistics - Compute statistics for rectangle/ellipse regions (mean, median, std, min, max, sum, pixel count)
- POST /api/analysis/detect-sources - Detect astronomical sources in a FITS image (returns list of sources with coordinates, flux, sharpness, roundness)
  - Parameters: `thresholdSigma` (1-50, default 5), `fwhm` (0.5-20, default 3), `method` (auto/daofind/iraf/segmentation), `npixels`, `deblend`
- GET /api/analysis/table-info?dataId= - Get table HDU metadata for a FITS file
- GET /api/analysis/table-data?dataId=&hduIndex=&page=&pageSize=&sortColumn=&sortDirection=&search= - Get paginated table data from a FITS binary table HDU
- GET /api/analysis/spectral-data?dataId=&hduIndex=1 - Get spectral column arrays (wavelength, flux, error) for chart rendering

### Viewer Smoothing Parameters

The following query parameters are available on both `GET /api/jwstdata/{id}/preview` and `GET /api/jwstdata/{id}/histogram`:
- `smoothMethod`: Filter method — `gaussian`, `median`, `box`, `astropy_gaussian`, `astropy_box`, or `""` (disabled, default)
- `smoothSigma`: Gaussian sigma (0.1-10.0, default 1.0) — used for gaussian/astropy_gaussian methods
- `smoothSize`: Kernel size (1-25, odd only, default 3) — used for median/box/astropy_box methods

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
- JWT Bearer authentication is implemented (AuthService + JwtTokenService)
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
