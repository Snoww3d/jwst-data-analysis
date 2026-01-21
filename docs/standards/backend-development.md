# .NET Backend Development Rules

## Architecture

- Use .NET 10 Web API with MongoDB integration
- Follow RESTful API design principles
- Implement proper error handling and logging
- Use dependency injection for services

## Key Files

- Main API project: [backend/JwstDataAnalysis.API/](../../backend/JwstDataAnalysis.API/)
- Controllers:
  - [JwstDataController.cs](../../backend/JwstDataAnalysis.API/Controllers/JwstDataController.cs) - Main CRUD + lineage endpoints
  - [DataManagementController.cs](../../backend/JwstDataAnalysis.API/Controllers/DataManagementController.cs) - Advanced operations
  - [MastController.cs](../../backend/JwstDataAnalysis.API/Controllers/MastController.cs) - MAST portal integration
- Models:
  - [JwstDataModel.cs](../../backend/JwstDataAnalysis.API/Models/JwstDataModel.cs) - Core data models
  - [DataValidationModels.cs](../../backend/JwstDataAnalysis.API/Models/DataValidationModels.cs) - DTOs and validation
  - [MastModels.cs](../../backend/JwstDataAnalysis.API/Models/MastModels.cs) - MAST request/response DTOs
- Services:
  - [MongoDBService.cs](../../backend/JwstDataAnalysis.API/Services/MongoDBService.cs) - Database operations
  - [MastService.cs](../../backend/JwstDataAnalysis.API/Services/MastService.cs) - MAST HTTP client
- Configuration: [backend/JwstDataAnalysis.API/appsettings.json](../../backend/JwstDataAnalysis.API/appsettings.json)

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

### MastController (`/api/mast`)

- POST /api/mast/search/target - Search by target name
- POST /api/mast/search/coordinates - Search by RA/Dec
- POST /api/mast/search/observation - Search by observation ID
- POST /api/mast/search/program - Search by program ID
- POST /api/mast/products - Get data products for observation
- POST /api/mast/download - Download FITS files
- POST /api/mast/import - Download and import into MongoDB

### DataManagementController (`/api/datamanagement`)

- POST /api/datamanagement/search - Faceted search
- GET /api/datamanagement/statistics - Data distribution stats
- POST /api/datamanagement/export - Export data
- POST /api/datamanagement/bulk/tags - Bulk tag updates
- POST /api/datamanagement/bulk/status - Bulk status updates

## Data Models

- JwstDataModel: Main data entity with flexible metadata
  - ProcessingLevel: JWST pipeline stage (L1, L2a, L2b, L3)
  - ObservationBaseId: Groups related files by observation
  - ExposureId: Finer-grained lineage tracking
- ImageMetadata: For image-specific data
- SensorMetadata: For sensor/spectral data
- SpectralMetadata: For spectral analysis data
- CalibrationMetadata: For calibration files
- ProcessingResult: For processing outcomes
- LineageResponse/LineageFileInfo: DTOs for lineage queries

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

