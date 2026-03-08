# Key Files Reference

Quick reference for finding important files in the codebase.

## Configuration

- `backend/JwstDataAnalysis.API/appsettings.json` - Backend config, MongoDB connection
- `frontend/jwst-frontend/package.json` - Frontend dependencies
- `processing-engine/requirements.txt` - Python dependencies (processing engine)
- `processing-engine/requirements-mast.txt` - Python dependencies (MAST proxy, lightweight)
- `docker/docker-compose.yml` - Service orchestration
- `docker/docker-compose.staging.yml` - AWS staging overrides (HTTP only, port 80)
- `frontend/jwst-frontend/nginx-staging.conf` - Staging nginx config (HTTP, same-origin API proxy)
- `frontend/jwst-frontend/src/config/api.ts` - API base URL configuration

## Deployment

- `scripts/deploy-aws.sh` - EC2 provisioning (create/teardown/status)
- `scripts/server-setup.sh` - Server bootstrap (clone, .env, Docker build, health check)
- `docs/deployment.md` - Deployment guide (deploy, update, teardown, costs)

## Specifications

- `docs/plans/exploration/desktop-requirements.md` - Platform-agnostic requirements for desktop version (keep in sync with features)

## Core Backend

- `backend/JwstDataAnalysis.API/Controllers/JwstDataController.cs` - Main CRUD + search/filter/process endpoints
- `backend/JwstDataAnalysis.API/Controllers/DataManagementController.cs` - Advanced endpoints (faceted search, export, bulk operations, statistics)
- `backend/JwstDataAnalysis.API/Controllers/MastController.cs` - MAST portal integration endpoints
- `backend/JwstDataAnalysis.API/Controllers/CompositeController.cs` - RGB composite generation
- `backend/JwstDataAnalysis.API/Controllers/MosaicController.cs` - WCS mosaic generation
- `backend/JwstDataAnalysis.API/Controllers/AnalysisController.cs` - Region selection, statistics, and FITS table data
- `backend/JwstDataAnalysis.API/Controllers/AuthController.cs` - User authentication endpoints
- `backend/JwstDataAnalysis.API/Controllers/DiscoveryController.cs` - Featured targets and recipe suggestion endpoints
- `backend/JwstDataAnalysis.API/Controllers/SearchController.cs` - Semantic search and re-index endpoints
- `backend/JwstDataAnalysis.API/Services/MongoDBService.cs` - Database repository layer
- `backend/JwstDataAnalysis.API/Services/MastService.cs` - MAST HTTP client wrapper
- `backend/JwstDataAnalysis.API/Services/CompositeService.cs` - Composite processing engine proxy
- `backend/JwstDataAnalysis.API/Services/MosaicService.cs` - Mosaic processing engine proxy
- `backend/JwstDataAnalysis.API/Services/AnalysisService.cs` - Region statistics processing engine proxy
- `backend/JwstDataAnalysis.API/Services/AuthService.cs` - User authentication and registration
- `backend/JwstDataAnalysis.API/Services/JwtTokenService.cs` - JWT token generation/validation
- `backend/JwstDataAnalysis.API/Services/DiscoveryService.cs` - Featured targets loading and recipe engine proxy
- `backend/JwstDataAnalysis.API/Services/IDiscoveryService.cs` - Discovery service interface
- `backend/JwstDataAnalysis.API/Services/SemanticSearchService.cs` - Semantic search engine proxy (Python) with MongoDB enrichment
- `backend/JwstDataAnalysis.API/Services/ISemanticSearchService.cs` - Semantic search service interface
- `backend/JwstDataAnalysis.API/Services/EmbeddingQueue.cs` - Bounded channel queue for async embedding jobs
- `backend/JwstDataAnalysis.API/Services/EmbeddingBackgroundService.cs` - BackgroundService that processes queued embedding jobs
- `backend/JwstDataAnalysis.API/Services/ImportJobTracker.cs` - MAST import job tracking
- `backend/JwstDataAnalysis.API/Services/IJobTracker.cs` - Unified job tracker interface (all async operations)
- `backend/JwstDataAnalysis.API/Services/JobTracker.cs` - Unified job tracker (MongoDB-backed with in-memory cache)
- `backend/JwstDataAnalysis.API/Services/IJobProgressNotifier.cs` - SignalR job progress notification interface
- `backend/JwstDataAnalysis.API/Services/JobProgressNotifier.cs` - SignalR progress push via IHubContext
- `backend/JwstDataAnalysis.API/Services/JobReaperBackgroundService.cs` - Background cleanup of expired jobs and storage artifacts
- `backend/JwstDataAnalysis.API/Services/StartupReconciliationService.cs` - Marks interrupted jobs as failed on server start
- `backend/JwstDataAnalysis.API/Hubs/JobProgressHub.cs` - SignalR hub for real-time job progress push
- `backend/JwstDataAnalysis.API/Controllers/JobsController.cs` - Unified job status, cancel, and result endpoints
- `backend/JwstDataAnalysis.API/Models/JobStatus.cs` - Unified job status model (MongoDB document)
- `backend/JwstDataAnalysis.API/Models/JobProgressModels.cs` - SignalR progress/completion/failure DTOs
- `backend/JwstDataAnalysis.API/Services/IDataScanService.cs` - Data scan service interface
- `backend/JwstDataAnalysis.API/Services/DataScanService.cs` - Disk scan and database sync operations
- `backend/JwstDataAnalysis.API/Services/StartupScanBackgroundService.cs` - BackgroundService that performs automatic startup disk scan
- `backend/JwstDataAnalysis.API/Services/ThumbnailService.cs` - FITS thumbnail generation (calls processing engine)
- `backend/JwstDataAnalysis.API/Services/ThumbnailQueue.cs` - Channel-based background queue for thumbnail batches
- `backend/JwstDataAnalysis.API/Services/ThumbnailBackgroundService.cs` - BackgroundService that processes queued thumbnail batches
- `backend/JwstDataAnalysis.API/Services/CompositeQueue.cs` - Bounded channel queue for async composite export jobs
- `backend/JwstDataAnalysis.API/Services/CompositeBackgroundService.cs` - BackgroundService that processes queued composite export jobs
- `backend/JwstDataAnalysis.API/Services/MosaicQueue.cs` - Bounded channel queue for async mosaic jobs (export, save-to-library, observation mosaic)
- `backend/JwstDataAnalysis.API/Services/MosaicBackgroundService.cs` - BackgroundService that processes queued mosaic export, save, and observation mosaic jobs
- `backend/JwstDataAnalysis.API/Services/FileContentValidator.cs` - File upload validation
- `backend/JwstDataAnalysis.API/Services/Storage/IStorageProvider.cs` - Storage abstraction interface (with `SupportsLocalPath`)
- `backend/JwstDataAnalysis.API/Services/Storage/LocalStorageProvider.cs` - Local filesystem storage implementation
- `backend/JwstDataAnalysis.API/Services/Storage/S3StorageProvider.cs` - S3-compatible object storage implementation (AWS SDK)
- `backend/JwstDataAnalysis.API/Services/Storage/StorageKeyHelper.cs` - Shared utility for converting file paths to relative storage keys
- `backend/JwstDataAnalysis.API/Configuration/S3Settings.cs` - S3 configuration POCO (bucket, endpoint, credentials, presigned URL settings)
- `backend/JwstDataAnalysis.API/Configuration/ObservationMosaicSettings.cs` - Settings for auto-generating observation-level mosaics (enabled, file threshold)
- `backend/JwstDataAnalysis.API/Services/ProcessingEngineHealthCheck.cs` - IHealthCheck for processing engine connectivity
- `backend/JwstDataAnalysis.API/Services/MastProxyHealthCheck.cs` - IHealthCheck for MAST proxy connectivity
- `backend/JwstDataAnalysis.API/Services/SeedDataService.cs` - Database initialization
- `backend/JwstDataAnalysis.API/Models/JwstDataModel.cs` - Data models and DTOs
- `backend/JwstDataAnalysis.API/Models/MastModels.cs` - MAST request/response DTOs
- `backend/JwstDataAnalysis.API/Models/CompositeModels.cs` - Composite request/response DTOs
- `backend/JwstDataAnalysis.API/Models/MosaicModels.cs` - Mosaic request/response DTOs
- `backend/JwstDataAnalysis.API/Models/AnalysisModels.cs` - Analysis request/response DTOs
- `backend/JwstDataAnalysis.API/Models/AuthModels.cs` - Authentication DTOs (login, register, tokens)
- `backend/JwstDataAnalysis.API/Models/DiscoveryModels.cs` - Discovery request/response DTOs
- `backend/JwstDataAnalysis.API/Models/SemanticSearchModels.cs` - Semantic search DTOs and embedding job models
- `backend/JwstDataAnalysis.API/Configuration/featured-targets.json` - Curated featured targets configuration

## Core Frontend Components

- `frontend/jwst-frontend/src/App.tsx` - Root component with routing
- `frontend/jwst-frontend/src/components/layout/SharedLayout.tsx` - Persistent header + nav layout shell
- `frontend/jwst-frontend/src/pages/DiscoveryHome.tsx` - Discovery home page with featured targets grid and search
- `frontend/jwst-frontend/src/pages/TargetDetail.tsx` - Target detail with recipe suggestions and observation list
- `frontend/jwst-frontend/src/pages/GuidedCreate.tsx` - Guided 3-step creation flow (download → process → result)
- `frontend/jwst-frontend/src/pages/MyLibrary.tsx` - My Library page (wraps existing dashboard)
- `frontend/jwst-frontend/src/pages/CompositePage.tsx` - Dedicated composite creator page (full-page wizard at `/composite`)
- `frontend/jwst-frontend/src/pages/MosaicPage.tsx` - Dedicated mosaic creator page (full-page wizard at `/mosaic`)
- `frontend/jwst-frontend/src/pages/SearchPage.tsx` - Semantic search page (RAG demo at `/search`)
- `frontend/jwst-frontend/src/components/JwstDataDashboard.tsx` - Main dashboard UI
- `frontend/jwst-frontend/src/components/dashboard/FloatingAnalysisBar.tsx` - Floating bottom bar for analysis actions (visible when toolbar scrolls out of view)
- `frontend/jwst-frontend/src/components/ImageViewer.tsx` - FITS viewer with analysis tools (central hub for visualization)
- `frontend/jwst-frontend/src/components/MastSearch.tsx` - MAST portal search and import
- `frontend/jwst-frontend/src/components/MosaicWizard.tsx` - WCS mosaic wizard shell (2-step: Select Files → Preview & Export)
- `frontend/jwst-frontend/src/components/wizard/MosaicSelectStep.tsx` - Mosaic file selection with thumbnail cards, filters, target grouping
- `frontend/jwst-frontend/src/components/wizard/MosaicPreviewStep.tsx` - Mosaic preview, settings, generation, and export
- `frontend/jwst-frontend/src/components/wizard/FootprintPreview.tsx` - SVG-based WCS footprint visualization
- `frontend/jwst-frontend/src/components/CompositeWizard.tsx` - RGB composite wizard (2-step: Assign Channels → Preview & Export)
- `frontend/jwst-frontend/src/components/wizard/ChannelAssignStep.tsx` - Drag-and-drop channel assignment with FITS thumbnails
- `frontend/jwst-frontend/src/components/ImageComparisonViewer.tsx` - Image comparison (blink/side-by-side/overlay)
- `frontend/jwst-frontend/src/components/ComparisonImagePicker.tsx` - Image selection for comparison
- `frontend/jwst-frontend/src/components/WhatsNewPanel.tsx` - Browse recent MAST releases
- `frontend/jwst-frontend/src/components/UserMenu.tsx` - User authentication menu
- `frontend/jwst-frontend/src/components/ProtectedRoute.tsx` - Authentication route guard
- `frontend/jwst-frontend/src/components/AuthToast.tsx` - Authentication notifications

## Discovery Components (guided experience)

- `frontend/jwst-frontend/src/components/discovery/SearchBar.tsx` - Target search with navigation
- `frontend/jwst-frontend/src/components/discovery/TargetCard.tsx` - Featured target card with gradient and badges
- `frontend/jwst-frontend/src/components/discovery/RecipeCard.tsx` - Composite recipe suggestion card
- `frontend/jwst-frontend/src/components/discovery/ObservationList.tsx` - Collapsible MAST observation table
- `frontend/jwst-frontend/src/components/discovery/TargetCardGrid.tsx` - Responsive CSS grid layout
- `frontend/jwst-frontend/src/components/discovery/TargetCardSkeleton.tsx` - Skeleton loading placeholder
- `frontend/jwst-frontend/src/components/discovery/TargetDetailSkeleton.tsx` - Target detail skeleton loader
- `frontend/jwst-frontend/src/components/guided/DownloadStep.tsx` - Guided wizard: MAST download step
- `frontend/jwst-frontend/src/components/guided/ProcessStep.tsx` - Guided wizard: composite processing step
- `frontend/jwst-frontend/src/components/guided/ResultStep.tsx` - Guided wizard: result preview + export step

## FITS Viewer Analysis Tools (nested in ImageViewer)

- `frontend/jwst-frontend/src/components/HistogramPanel.tsx` - Log-scale histogram with draggable sliders
- `frontend/jwst-frontend/src/components/StretchControls.tsx` - Stretch algorithm selector
- `frontend/jwst-frontend/src/components/CurvesEditor.tsx` - Cubic spline tone curve adjustment
- `frontend/jwst-frontend/src/components/ExportOptionsPanel.tsx` - PNG/JPEG export dialog
- `frontend/jwst-frontend/src/components/CubeNavigator.tsx` - 3D FITS cube slice navigation
- `frontend/jwst-frontend/src/components/RegionSelector.tsx` - Rectangle/ellipse region drawing (SVG overlay)
- `frontend/jwst-frontend/src/components/RegionStatisticsPanel.tsx` - Pixel statistics display
- `frontend/jwst-frontend/src/components/AnnotationOverlay.tsx` - Text/arrow/circle annotations (SVG overlay)
- `frontend/jwst-frontend/src/components/WcsGridOverlay.tsx` - RA/Dec coordinate grid + scale bar (SVG overlay)
- `frontend/jwst-frontend/src/components/viewer/SmoothingControls.tsx` - Smoothing/noise reduction filter controls
- `frontend/jwst-frontend/src/components/viewer/SourceDetectionOverlay.tsx` - Source detection marker overlay (SVG)
- `frontend/jwst-frontend/src/components/viewer/SourceDetectionPanel.tsx` - Source detection controls and results panel
- `frontend/jwst-frontend/src/components/TableViewer.tsx` - FITS table viewer modal component
- `frontend/jwst-frontend/src/components/TableViewer.css` - Table viewer styles
- `frontend/jwst-frontend/src/components/SpectralViewer.tsx` - Spectral data viewer with Plotly.js chart
- `frontend/jwst-frontend/src/components/SpectralViewer.css` - Spectral viewer styles

## Frontend Type Definitions

- `frontend/jwst-frontend/src/types/JwstDataTypes.ts` - Core JWST data types
- `frontend/jwst-frontend/src/types/MastTypes.ts` - MAST search and import types
- `frontend/jwst-frontend/src/types/MosaicTypes.ts` - Mosaic generation types
- `frontend/jwst-frontend/src/types/StretchTypes.ts` - Shared stretch types (StretchMethod, STRETCH_OPTIONS, BaseStretchParams, DEFAULT_STRETCH_PARAMS)
- `frontend/jwst-frontend/src/types/CompositeTypes.ts` - RGB composite types (extends BaseStretchParams, composite presets)
- `frontend/jwst-frontend/src/types/AnalysisTypes.ts` - Region selection and statistics types
- `frontend/jwst-frontend/src/types/AnnotationTypes.ts` - Annotation overlay types
- `frontend/jwst-frontend/src/types/CurvesTypes.ts` - Tone curve types
- `frontend/jwst-frontend/src/types/AuthTypes.ts` - Authentication types
- `frontend/jwst-frontend/src/types/JobTypes.ts` - Job progress and completion types (SignalR)
- `frontend/jwst-frontend/src/types/DiscoveryTypes.ts` - Discovery and recipe suggestion types
- `frontend/jwst-frontend/src/types/SearchTypes.ts` - Semantic search response types

## Processing Engine

- `processing-engine/main.py` - FastAPI application entry point (image processing: composites, mosaics, analysis)
- `processing-engine/main_mast.py` - FastAPI entry point for MAST proxy service (search, download)
- `processing-engine/Dockerfile.mast` - Lightweight Docker image for MAST proxy service
- `processing-engine/app/mast/mast_service.py` - MAST API wrapper (astroquery)
- `processing-engine/app/mast/routes.py` - MAST FastAPI routes
- `processing-engine/app/mast/models.py` - MAST Pydantic models
- `processing-engine/app/mast/chunked_downloader.py` - Async chunked download with HTTP Range
- `processing-engine/app/mast/s3_client.py` - Anonymous S3 client for STScI public bucket
- `processing-engine/app/mast/s3_resolver.py` - Resolve MAST products to S3 key paths
- `processing-engine/app/mast/s3_downloader.py` - S3 multipart download engine with progress
- `processing-engine/app/mast/download_state_manager.py` - State persistence for resume
- `processing-engine/app/mast/download_tracker.py` - Byte-level progress tracking
- `processing-engine/app/composite/routes.py` - RGB and N-channel composite FastAPI routes
- `processing-engine/app/composite/models.py` - Composite Pydantic models (RGB + N-channel)
- `processing-engine/app/composite/color_mapping.py` - N-channel color mapping engine (hue→RGB, wavelength→hue, channel combination)
- `processing-engine/app/mosaic/routes.py` - WCS mosaic FastAPI routes
- `processing-engine/app/mosaic/models.py` - Mosaic Pydantic models
- `processing-engine/app/mosaic/mosaic_engine.py` - Core WCS reprojection logic (reproject library)
- `processing-engine/app/analysis/routes.py` - Region statistics computation (rectangle/ellipse masks)
- `processing-engine/app/analysis/models.py` - Analysis Pydantic models
- `processing-engine/app/storage/provider.py` - Storage abstraction ABC
- `processing-engine/app/storage/local_storage.py` - Local filesystem storage implementation
- `processing-engine/app/storage/s3_storage.py` - S3-compatible storage implementation (boto3)
- `processing-engine/app/storage/temp_cache.py` - LRU temp file cache for S3 downloads (2GB default)
- `processing-engine/app/storage/factory.py` - Storage provider factory (singleton, supports `local` and `s3`)
- `processing-engine/app/storage/helpers.py` - Shared helpers (`resolve_fits_path`, `validate_fits_file_size`) for route handlers
- `processing-engine/app/discovery/recipe_engine.py` - Composite recipe suggestion engine (chromatic ordering, filter classification)
- `processing-engine/app/discovery/routes.py` - Discovery FastAPI routes (POST /discovery/suggest-recipes)
- `processing-engine/app/discovery/models.py` - Discovery Pydantic models
- `processing-engine/app/semantic/routes.py` - Semantic search FastAPI routes (embed, search, index-status)
- `processing-engine/app/semantic/embedding_service.py` - ONNX embedding model + FAISS vector store
- `processing-engine/app/semantic/text_builder.py` - FITS metadata to natural language text transformation
- `processing-engine/app/semantic/models.py` - Semantic search Pydantic models
- `processing-engine/app/diagnostics.py` - Memory monitoring utilities (RSS logging with flush for OOM debugging)
- `processing-engine/app/processing/analysis.py` - Analysis algorithms (in progress)
- `processing-engine/app/processing/utils.py` - FITS utilities (in progress)

## Frontend Services

- `frontend/jwst-frontend/src/services/apiClient.ts` - Core HTTP client with automatic error handling
- `frontend/jwst-frontend/src/services/ApiError.ts` - Custom error class with status codes
- `frontend/jwst-frontend/src/services/jwstDataService.ts` - JWST data CRUD and processing operations
- `frontend/jwst-frontend/src/services/mastService.ts` - MAST search and import operations
- `frontend/jwst-frontend/src/services/compositeService.ts` - RGB composite generation
- `frontend/jwst-frontend/src/services/mosaicService.ts` - WCS mosaic generation and footprint
- `frontend/jwst-frontend/src/services/analysisService.ts` - Region statistics computation
- `frontend/jwst-frontend/src/services/authService.ts` - User authentication (login, register, token refresh)
- `frontend/jwst-frontend/src/services/healthService.ts` - Backend and processing engine health checks
- `frontend/jwst-frontend/src/services/discoveryService.ts` - Featured targets and recipe suggestion API
- `frontend/jwst-frontend/src/services/semanticSearchService.ts` - Semantic search API client
- `frontend/jwst-frontend/src/services/signalRService.ts` - SignalR connection manager with auto-reconnect
- `frontend/jwst-frontend/src/services/index.ts` - Service re-exports

## Frontend Utilities

- `frontend/jwst-frontend/src/utils/fitsUtils.ts` - FITS file type detection, classification, and spectral file identification (`isSpectralFile`)
- `frontend/jwst-frontend/src/utils/colormaps.ts` - Color maps for FITS visualization (inferno, magma, viridis, plasma, grayscale, hot, cool, rainbow)
- `frontend/jwst-frontend/src/utils/wcsGridUtils.ts` - WCS coordinate conversion and grid computation
- `frontend/jwst-frontend/src/utils/curvesUtils.ts` - Cubic spline interpolation and lookup table generation
- `frontend/jwst-frontend/src/utils/cubeUtils.ts` - 3D FITS cube utilities (slice formatting, playback speed)
- `frontend/jwst-frontend/src/utils/coordinateUtils.ts` - Pixel-to-WCS conversion, coordinate formatting, cursor info
- `frontend/jwst-frontend/src/utils/wavelengthUtils.ts` - Wavelength conversion utilities
- `frontend/jwst-frontend/src/utils/filterPresets.ts` - Curated JWST filter presets for composite wizard
- `frontend/jwst-frontend/src/utils/validationUtils.ts` - Input validation (MongoDB ObjectId, etc.)
