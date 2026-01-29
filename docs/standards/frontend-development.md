# React Frontend Development Rules

## Architecture

- React 19 with TypeScript
- Functional components with hooks
- Modern CSS with responsive design
- Accessibility-first approach

## Key Files

- Main app: [frontend/jwst-frontend/src/App.tsx](../../frontend/jwst-frontend/src/App.tsx)
- Components:
  - [JwstDataDashboard.tsx](../../frontend/jwst-frontend/src/components/JwstDataDashboard.tsx) - Main dashboard with grid, list, grouped, and lineage views
  - [MastSearch.tsx](../../frontend/jwst-frontend/src/components/MastSearch.tsx) - MAST portal search interface with progress tracking
  - [AdvancedFitsViewer.tsx](../../frontend/jwst-frontend/src/components/AdvancedFitsViewer.tsx) - FITS image viewer with color maps
  - [ImageViewer.tsx](../../frontend/jwst-frontend/src/components/ImageViewer.tsx) - Image viewer modal wrapper
- Types:
  - [JwstDataTypes.ts](../../frontend/jwst-frontend/src/types/JwstDataTypes.ts) - Core data types, lineage types, processing levels
  - [MastTypes.ts](../../frontend/jwst-frontend/src/types/MastTypes.ts) - MAST search/import types, progress tracking
- Utilities:
  - [fitsUtils.ts](../../frontend/jwst-frontend/src/utils/fitsUtils.ts) - FITS file type detection and classification
  - [colormaps.ts](../../frontend/jwst-frontend/src/utils/colormaps.ts) - Color maps for FITS visualization
- Styles:
  - [App.css](../../frontend/jwst-frontend/src/App.css) - Global styles
  - [JwstDataDashboard.css](../../frontend/jwst-frontend/src/components/JwstDataDashboard.css) - Dashboard and lineage view styles
  - [MastSearch.css](../../frontend/jwst-frontend/src/components/MastSearch.css) - MAST search and progress styles
  - [AdvancedFitsViewer.css](../../frontend/jwst-frontend/src/components/AdvancedFitsViewer.css) - FITS viewer styles
- Package config: [frontend/jwst-frontend/package.json](../../frontend/jwst-frontend/package.json)

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
- **AdvancedFitsViewer**: FITS image viewer with:
  - Multiple color maps (grayscale, heat, cool, rainbow, viridis, magma, inferno)
  - Zoom and pan controls
  - Header metadata display
  - Graceful handling of non-image FITS files
- **ImageViewer**: Modal wrapper for FITS viewer
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

- Backend API base URL: <http://localhost:5001>
- Use fetch API for HTTP requests
- Implement proper error handling for API calls
- Use async/await for data operations

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
