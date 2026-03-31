# Domain Model

Conceptual entity-relationship model for the JWST Data Analysis Application. This diagram shows the core domain objects, their key attributes, and how they relate to each other.

> **4+1 View**: Logical View

## Entity Relationship Diagram

```mermaid
erDiagram
    User {
        ObjectId Id PK
        string Username UK
        string Email UK
        string Role "Admin | User"
        string DisplayName
        string Organization
        bool IsActive
        DateTime CreatedAt
        DateTime LastLoginAt
    }

    JwstData {
        ObjectId Id PK
        string FileName
        string DataType "image | spectral | calibration | ..."
        string FileFormat "fits | csv | json | hdf5"
        string ProcessingStatus "pending | processing | completed | failed"
        string ProcessingLevel "L1 | L2a | L2b | L3"
        string FilePath "S3 or local storage key"
        long FileSize
        string UserId FK
        bool IsPublic
        bool IsViewable
        string ObservationBaseId "groups related files"
        string ExposureId "fine-grained lineage"
        string ParentId FK
        list DerivedFrom "source data IDs"
        list Tags
    }

    ImageMetadata {
        string TargetName
        string Instrument
        string Filter
        double Wavelength
        int Width
        int Height
        string WCS "World Coordinate System"
        int CalibrationLevel
        string ProposalId
    }

    ProcessingResult {
        string Id PK
        string Algorithm
        string Status "success | failed | partial"
        DateTime ProcessedDate
        dict Parameters
        dict Results
        string OutputFilePath
        double ProcessingTime
    }

    JobStatus {
        string JobId PK
        string JobType "import | composite | mosaic"
        string State "queued | running | completed | failed | cancelled"
        string OwnerUserId FK
        int ProgressPercent
        string Stage
        string ResultKind "blob | data_id"
        string ResultStorageKey
        string ResultDataId FK
        DateTime CreatedAt
        DateTime ExpiresAt
    }

    FeaturedTarget {
        string Name
        string CatalogId
        string Category "nebula | galaxy | planetary | cluster"
        string Description
        list Instruments
        int FilterCount
        string CompositePotential "great | good | limited"
    }

    CompositeRecipe {
        string Name
        int Rank
        list Filters
        dict ColorMapping "filter to hex color"
        bool RequiresMosaic
        int EstimatedTimeSeconds
        string Tag "e.g. NASA-style"
    }

    CompositeRequest {
        list Channels "NChannelConfigDto[]"
        string OutputFormat "png | jpeg"
        int Width
        int Height
        bool BackgroundNeutralization
        double RotationDegrees
    }

    ChannelConfig {
        list DataIds FK
        string Stretch "zscale | asinh | log | sqrt | ..."
        double BlackPoint
        double WhitePoint
        double Gamma
        string Curve "linear | s_curve | ..."
        double Weight
        double Hue
        string Label
    }

    MosaicRequest {
        list Files "MosaicFileConfigDto[]"
        string OutputFormat "png | jpeg | fits"
        string CombineMethod "mean | sum | first | last | min | max"
        int Width
        int Height
    }

    MosaicFileConfig {
        string DataId FK
        string Stretch
        double BlackPoint
        double WhitePoint
    }

    MastObservation {
        string ObsId
        string TargetName
        double RA
        double Dec
        string Instrument
        string Filters
        int CalibLevel
        string DataProductType "image | spectrum"
        double ExposureTime
    }

    %% Relationships
    User ||--o{ JwstData : "owns"
    User ||--o{ JobStatus : "initiates"
    JwstData ||--o| ImageMetadata : "has (embedded)"
    JwstData ||--o{ ProcessingResult : "has (embedded)"
    JwstData ||--o| JwstData : "parentId → derived from"
    JobStatus |o--o| JwstData : "resultDataId → produces"
    FeaturedTarget ||--o{ CompositeRecipe : "suggests"
    CompositeRequest ||--|{ ChannelConfig : "contains"
    ChannelConfig }o--o{ JwstData : "references via dataIds"
    MosaicRequest ||--|{ MosaicFileConfig : "contains"
    MosaicFileConfig }o--|| JwstData : "references via dataId"
    MastObservation }o--o{ JwstData : "imported as"
```

## Domain Concepts

### Data Lifecycle

JWST data flows through a well-defined pipeline, modeled by the `ProcessingLevel` field:

| Level | Description | FITS Suffix | Example |
|-------|-------------|-------------|---------|
| **L1** | Raw detector readout | `_uncal` | Uncalibrated frames |
| **L2a** | Count rate images | `_rate`, `_rateints` | Detector-level calibration |
| **L2b** | Calibrated exposures | `_cal`, `_crf` | Fully calibrated single exposures |
| **L3** | Combined/mosaicked products | `_i2d`, `_s2d`, `_x1d` | Science-ready composites |

Files are grouped by `ObservationBaseId` (e.g., `jw02733-o001_t001_nircam`) and linked via `ParentId` / `DerivedFrom` for full lineage tracking.

### Observation Grouping

```
Observation (ObservationBaseId)
├── L1: jw02733001001_02101_00001_nrca1_uncal.fits
├── L2a: jw02733001001_02101_00001_nrca1_rate.fits
├── L2b: jw02733001001_02101_00001_nrca1_cal.fits
└── L3: jw02733-o001_t001_nircam_clear-f200w_i2d.fits
```

### Access Control Model

- **MAST imports** are always `IsPublic = true` (public archive data)
- **User uploads** default to private (`IsPublic = false`)
- `SharedWith` list enables selective sharing by user ID
- Admin role has full access to all records

### Job Lifecycle

Jobs progress through a state machine tracked by `JobStatus`:

```
queued → running → completed
                 → failed
         ↓
       cancelled (via CancelRequested flag)
```

Results are stored as either:
- **blob**: Binary file in S3/local storage (`ResultStorageKey` + `ResultContentType`)
- **data_id**: Reference to a new `JwstData` document (`ResultDataId`)

### Discovery & Recipes

The discovery flow connects external MAST data to the compositing workflow:

1. **FeaturedTarget** — curated list of photogenic JWST targets
2. **CompositeRecipe** — filter combinations ranked by visual quality
3. User selects a recipe → system resolves MAST observations → imports data → creates composite

---

## MongoDB Collections

| Collection | Document Type | Indexes |
|------------|--------------|---------|
| `jwst_data` | JwstData + embedded metadata | userId, observationBaseId, processingLevel, tags, uploadDate |
| `users` | User | username (unique), email (unique) |
| `jobs` | JobStatus | ownerUserId, state, createdAt |

---

[Back to Architecture Overview](index.md)
