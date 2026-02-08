# React Frontend Development Rules

## Architecture

- React 19 with TypeScript
- Functional components with hooks
- Modern CSS with responsive design
- Accessibility-first approach

## Key Files

- Main app: [frontend/jwst-frontend/src/App.tsx](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/App.tsx)
- Components:
  - [JwstDataDashboard.tsx](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/components/JwstDataDashboard.tsx) - Main dashboard with grid, list, grouped, and lineage views
  - [MastSearch.tsx](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/components/MastSearch.tsx) - MAST portal search interface with progress tracking
  - [ImageViewer.tsx](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/components/ImageViewer.tsx) - FITS image viewer with color maps, stretch controls, and PNG export
- Types:
  - [JwstDataTypes.ts](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/types/JwstDataTypes.ts) - Core data types, lineage types, processing levels
  - [MastTypes.ts](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/types/MastTypes.ts) - MAST search/import types, progress tracking
- Utilities:
  - [fitsUtils.ts](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/utils/fitsUtils.ts) - FITS file type detection and classification
  - [colormaps.ts](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/utils/colormaps.ts) - Color maps for FITS visualization
- Services:
  - [apiClient.ts](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/services/apiClient.ts) - Core HTTP client with error handling
  - [ApiError.ts](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/services/ApiError.ts) - Custom error class for API errors
  - [jwstDataService.ts](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/services/jwstDataService.ts) - JWST data CRUD operations
  - [mastService.ts](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/services/mastService.ts) - MAST search and import operations
  - [index.ts](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/services/index.ts) - Service re-exports
- Styles:
  - [App.css](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/App.css) - Global styles
  - [JwstDataDashboard.css](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/components/JwstDataDashboard.css) - Dashboard and lineage view styles
  - [MastSearch.css](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/components/MastSearch.css) - MAST search and progress styles
  - [FitsViewer.css](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/components/FitsViewer.css) - FITS viewer styles
  - [ImageViewer.css](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/src/components/ImageViewer.css) - Image viewer modal styles
- Package config: [frontend/jwst-frontend/package.json](https://github.com/Snoww3d/jwst-data-analysis/blob/main/frontend/jwst-frontend/package.json)

## Coding Standards

- Use TypeScript interfaces for all data models
- Implement proper error handling and loading states
- Use semantic HTML with proper accessibility attributes
- Follow React best practices (hooks, functional components)
- Use CSS classes for styling (no inline styles)
- Implement responsive design for mobile compatibility

## Component Structure

- **App**: Root component with data fetching and error handling
- **JwstDataDashboard**: Main dashboard with multiple view modes:
  - Grid view: Card-based display
  - List view: Compact table format
  - Grouped view: By data type
  - Lineage view: Tree hierarchy showing processing levels (L1→L2a→L2b→L3)
  - FITS type badges: Visual indicators for image vs table files
  - Refresh Metadata button: Re-fetch MAST metadata for all imports
- **MastSearch**: MAST portal integration with:
  - Search by target, coordinates, observation, or program
  - Bulk import with progress tracking
  - Byte-level progress display (speed, ETA, per-file status)
  - Resume capability for interrupted downloads
- **ImageViewer**: FITS image viewer with:
  - Multiple color maps (grayscale, hot, cool, rainbow, viridis, plasma, magma, inferno)
  - Stretch controls (linear, log, sqrt, asinh, zscale) with histogram visualization
  - Zoom and pan controls
  - Pixel coordinate display with WCS conversion
  - PNG export with current visualization settings
  - Header metadata display in sidebar
  - Graceful handling of non-image FITS files
- **CompositeWizard**: RGB composite workflow with:
  - Per-channel image assignment and independent stretch/levels/curve controls
  - WCS-aware channel alignment for accurate RGB registration
  - Live composite preview during channel tuning
  - Final export step with overall image-viewer-style stretch/levels controls applied post-stack
- **Types**:
  - JwstDataModel, ImageMetadata, SensorMetadata, ProcessingResult
  - LineageResponse, LineageFileInfo
  - ProcessingLevels, ProcessingLevelLabels, ProcessingLevelColors
  - MastSearchResult, MastImportResponse, ImportJobStatus
  - FileProgressInfo, ResumableJobSummary, MetadataRefreshResponse
  - ImageMetadata now includes: wavelengthRange, calibrationLevel, proposalId, proposalPi, observationTitle
- **Utilities**:
  - getFitsFileInfo(): Classify FITS files by suffix (image vs table)
  - isFitsViewable(): Check if FITS file is viewable
  - calculateZScale(): Optimal display limits for FITS data
  - getColorMap(): Color map lookup tables

## API Integration

- Backend API base URL: <http://localhost:5001> (configured in `config/api.ts`)
- **Use service layer for all API calls** (never use fetch directly in components)
- Services provide:
  - Consistent error handling via `ApiError` class
  - Automatic JSON parsing and error extraction
  - TypeScript typing for request/response
  - Clean separation of concerns

### Service Layer Usage

```typescript
// Import services
import { jwstDataService, mastService, ApiError } from '../services';

// Fetch data
const data = await jwstDataService.getAll(includeArchived);

// Handle errors
try {
  await mastService.startImport({ obsId });
} catch (err) {
  if (ApiError.isApiError(err)) {
    console.error(`API Error ${err.status}: ${err.message}`);
  }
}
```

### Available Services

**jwstDataService:**
- `getAll(includeArchived?)` - Fetch all data records
- `upload(file, dataType, description?, tags?)` - Upload a file
- `process(dataId, algorithm, parameters?)` - Trigger processing
- `archive(dataId)` / `unarchive(dataId)` - Archive operations
- `getDeletePreview(obsId)` / `deleteObservation(obsId)` - Delete operations
- `scanAndImportMastFiles()` - Bulk import from disk

**mastService:**
- `searchByTarget(params, signal?)` - Search by target name
- `searchByCoordinates(params, signal?)` - Search by RA/Dec
- `searchByObservation(params, signal?)` - Search by obs ID
- `searchByProgram(params, signal?)` - Search by program ID
- `startImport(params)` - Start import job
- `getImportProgress(jobId)` - Poll progress
- `cancelImport(jobId)` - Cancel job
- `resumeImport(jobId)` - Resume failed job
- `importFromExisting(obsId)` - Import from downloaded files
- `refreshMetadataAll()` - Refresh all MAST metadata

**compositeService:**
- `generatePreview(red, green, blue, size, overall?)` - Generate preview image
- `exportComposite(red, green, blue, format, quality, width, height, overall?)` - Export final composite

## UI/UX Guidelines

- Current theme: "Sunset Galaxy" gradient background
- Use consistent spacing and typography
- Implement loading spinners for async operations
- Provide clear error messages and retry options
- Use status indicators for processing states
- Implement search and filtering functionality

## Accessibility

- Use proper ARIA labels and roles
- Implement keyboard navigation
- Provide alt text for images
- Use semantic HTML elements
- Ensure sufficient color contrast
