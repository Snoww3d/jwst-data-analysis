---

# Database and Data Models Rules

## Architecture

- MongoDB document database for flexible data storage
- Flexible schemas for various JWST data types
- Support for metadata and processing results
- Proper indexing for performance

## Data Models

### JwstDataModel (Main Entity)
Primary document model for all JWST data records.

**Core Fields:**
- `id`: MongoDB ObjectId
- `fileName`, `filePath`, `fileSize`, `fileFormat`
- `dataType`: image, sensor, spectral, metadata, calibration, raw
- `processingStatus`: pending, processing, completed, failed
- `uploadDate`, `tags`, `description`

**Lineage Fields:**
- `processingLevel`: L1, L2a, L2b, L3, unknown
- `observationBaseId`: Groups related files (e.g., "jw02733-o001_t001_nircam")
- `exposureId`: Fine-grained lineage tracking
- `parentId`, `derivedFrom`: Parent-child relationships

**Access Control Fields:**
- `userId`: Owner of the record (null for MAST scan imports)
- `isPublic`: true for MAST-imported data, false for user uploads (controls anonymous visibility)

**MAST Import Fields:**
- `metadata`: Dictionary with `mast_*` prefixed fields from MAST
- `isViewable`: true for image files, false for tables/catalogs

**Storage Fields:**
- `filePath`: Relative storage key (e.g., `mast/{obs_id}/file.fits`), not an absolute filesystem path. Resolved at runtime by the active storage provider (local or S3).

### ImageMetadata
Image-specific metadata attached to JwstDataModel.

**Astronomical Fields:**
- `targetName`: Object name (e.g., "NGC-3132")
- `instrument`, `filter`, `exposureTime`
- `observationDate`: Converted from MAST MJD format
- `coordinateSystem`, `wcs`: World coordinate system

**MAST-Specific Fields:**
- `wavelengthRange`: "INFRARED", "OPTICAL", "UV"
- `calibrationLevel`: MAST calib_level (0-4)
- `proposalId`, `proposalPi`: JWST program info
- `observationTitle`: Program title

### SensorMetadata
- `instrument`, `wavelength`, `dataPoints`
- `samplingRate`, `integrationTime`, `detectorType`

### ProcessingResult
- `algorithm`, `processedDate`, `status`
- `parameters`, `results`, `outputFilePath`

## MongoDB Configuration

- Connection string: mongodb://admin:password@mongodb:27017
- Database name: jwst_data_analysis
- Collection: jwst_data

## Data Types Supported

- image: Astronomical images (FITS, JPG, PNG, TIFF)
- sensor: Raw sensor data
- spectral: Spectral analysis data
- metadata: Descriptive information

## Schema Design

- Use flexible document structure for metadata
- Implement proper validation
- Support for file paths and processing status
- Include user and timestamp information

## Performance Considerations

- Implement proper indexing for search operations
- Use efficient queries for large datasets
- Consider data archiving strategies
- Implement proper error handling for database operations

## Security

- Current credentials are development-only
- Implement proper access control in production
- Use connection string encryption
- Implement proper backup strategies
 