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
  - [MastSearch.tsx](../../frontend/jwst-frontend/src/components/MastSearch.tsx) - MAST portal search interface
- Types:
  - [JwstDataTypes.ts](../../frontend/jwst-frontend/src/types/JwstDataTypes.ts) - Core data types, lineage types, processing levels
  - [MastTypes.ts](../../frontend/jwst-frontend/src/types/MastTypes.ts) - MAST search/import types
- Styles:
  - [App.css](../../frontend/jwst-frontend/src/App.css) - Global styles
  - [JwstDataDashboard.css](../../frontend/jwst-frontend/src/components/JwstDataDashboard.css) - Dashboard and lineage view styles
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
- **MastSearch**: MAST portal integration with search by target, coordinates, observation, or program
- **Types**:
  - JwstDataModel, ImageMetadata, SensorMetadata, ProcessingResult
  - LineageResponse, LineageFileInfo
  - ProcessingLevels, ProcessingLevelLabels, ProcessingLevelColors
  - MastSearchResult, MastImportResponse

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
