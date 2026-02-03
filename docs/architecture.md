# Architecture Documentation

This document provides visual diagrams of the JWST Data Analysis Application architecture using Mermaid. GitHub renders these diagrams natively.

## Table of Contents

- [System Overview](#system-overview)
- [Data Flows](#data-flows)
  - [Local Upload Flow](#local-upload-flow)
  - [MAST Import Flow](#mast-import-flow)
- [Data Lineage](#data-lineage)
- [Frontend Component Hierarchy](#frontend-component-hierarchy)
- [MongoDB Document Structure](#mongodb-document-structure)
- [Backend Service Layer](#backend-service-layer)

---

## System Overview

High-level view of the microservices architecture and their communication patterns.

```mermaid
flowchart TB
    subgraph Client["Client Layer"]
        Browser["User Browser"]
    end

    subgraph Frontend["Frontend (Port 3000)"]
        React["React + TypeScript\n(Vite)"]
    end

    subgraph Backend["Backend API (Port 5001)"]
        DotNet[".NET 10 API"]
        Controllers["Controllers:\n- JwstDataController\n- DataManagementController\n- MastController"]
        Services["Services:\n- MongoDBService\n- MastService"]
    end

    subgraph Processing["Processing Engine (Port 8000)"]
        FastAPI["Python FastAPI"]
        MastModule["MAST Module:\n- mast_service.py\n- chunked_downloader.py"]
        SciLibs["Scientific Libraries:\nNumPy, Astropy, SciPy"]
    end

    subgraph Storage["Data Storage"]
        MongoDB[("MongoDB\n(Port 27017)")]
        FileSystem[("File System\n/data/mast/")]
    end

    subgraph External["External Services"]
        MAST["STScI MAST Portal\n(astroquery.mast)"]
        STScI[("STScI Archive\nJWST Data")]
    end

    Browser -->|HTTP| React
    React -->|REST API| DotNet
    DotNet --> Controllers
    Controllers --> Services
    Services -->|MongoDB.Driver| MongoDB
    Services -->|HTTP POST| FastAPI
    FastAPI --> MastModule
    FastAPI --> SciLibs
    MastModule -->|astroquery| MAST
    MAST --> STScI
    FastAPI -->|Write Files| FileSystem
    DotNet -->|Read Files| FileSystem
```

---

## Data Flows

### Local Upload Flow

The flow for uploading JWST data files directly to the application.

```mermaid
sequenceDiagram
    participant User
    participant Frontend as React Frontend
    participant Backend as .NET Backend
    participant MongoDB
    participant Processing as Python Engine

    User->>Frontend: Upload FITS/CSV/JSON file
    Frontend->>Backend: POST /api/jwstdata (multipart)
    Backend->>Backend: Validate file format
    Backend->>MongoDB: Store metadata document
    Backend->>Backend: Save file to disk
    Backend-->>Frontend: Return data record ID

    Note over User,Frontend: User triggers processing

    User->>Frontend: Click "Process" button
    Frontend->>Backend: POST /api/jwstdata/{id}/process
    Backend->>Processing: POST /process {data_id, algorithm, params}
    Processing->>Processing: Load file, run algorithm
    Processing-->>Backend: Return processing results
    Backend->>MongoDB: Update record with results
    Backend-->>Frontend: Return updated record
    Frontend-->>User: Display processed data
```

### MAST Import Flow

The complete flow for searching and importing data from the MAST portal, including chunked downloads with resume capability.

```mermaid
sequenceDiagram
    participant User
    participant Frontend as React Frontend
    participant Backend as .NET Backend
    participant Processing as Python Engine
    participant MAST as STScI MAST
    participant MongoDB

    rect rgb(240, 248, 255)
        Note over User,MAST: Search Phase
        User->>Frontend: Enter search (target/coordinates/obsID)
        Frontend->>Backend: POST /api/mast/search/*
        Backend->>Processing: Forward search request
        Processing->>MAST: astroquery.mast query
        MAST-->>Processing: Return observations
        Processing-->>Backend: Return search results
        Backend-->>Frontend: Display in results table
    end

    rect rgb(255, 248, 240)
        Note over User,MongoDB: Import Phase
        User->>Frontend: Click "Import" on observation
        Frontend->>Backend: POST /api/mast/import {obsId}
        Backend->>Processing: Start chunked download

        loop Chunked Download (5MB chunks, 3 parallel files)
            Processing->>MAST: GET with Range header
            MAST-->>Processing: Return chunk
            Processing->>Processing: Write chunk, update state
        end

        Processing-->>Backend: Return file paths
        Backend->>Backend: Extract FITS metadata
        Backend->>MongoDB: Create data records
        Backend-->>Frontend: Return import result
    end

    rect rgb(240, 255, 240)
        Note over User,Processing: Progress Tracking
        loop Poll for progress
            Frontend->>Backend: GET /api/mast/import-progress/{jobId}
            Backend->>Processing: Get download state
            Processing-->>Backend: Return byte-level progress
            Backend-->>Frontend: Display speed, ETA, per-file progress
        end
    end

    rect rgb(255, 240, 245)
        Note over User,Processing: Resume (if interrupted)
        User->>Frontend: Click "Resume"
        Frontend->>Backend: POST /api/mast/import/resume/{jobId}
        Backend->>Processing: Resume from last byte position
        Processing->>Processing: Load state from JSON
        Processing->>MAST: Continue with Range header
    end
```

---

## Data Lineage

JWST data products progress through processing levels. Files are grouped by `ObservationBaseId` for lineage tracking.

```mermaid
flowchart TB
    subgraph L1["Level 1 (L1) - Raw"]
        uncal["*_uncal.fits\nUncalibrated raw data"]
    end

    subgraph L2a["Level 2a - Rate"]
        rate["*_rate.fits\nCount rate images"]
        rateints["*_rateints.fits\nRate per integration"]
    end

    subgraph L2b["Level 2b - Calibrated"]
        cal["*_cal.fits\nCalibrated images"]
        calints["*_calints.fits\nCalibrated per integration"]
        crf["*_crf.fits\nCosmic ray flagged"]
    end

    subgraph L3["Level 3 - Combined"]
        i2d["*_i2d.fits\n2D resampled/combined"]
        s2d["*_s2d.fits\n2D spectral images"]
    end

    subgraph Tables["Table Products (non-viewable)"]
        asn["*_asn.fits\nAssociation tables"]
        x1d["*_x1d.fits\n1D extracted spectra"]
        cat["*_cat.fits\nSource catalogs"]
    end

    uncal --> rate
    uncal --> rateints
    rate --> cal
    rateints --> calints
    cal --> crf
    cal --> i2d
    cal --> s2d
    cal --> x1d
    i2d --> cat
    s2d --> cat

    style L1 fill:#ffcccc
    style L2a fill:#ffeacc
    style L2b fill:#ffffcc
    style L3 fill:#ccffcc
    style Tables fill:#e0e0e0
```

### Lineage Grouping

Files are grouped by observation for lineage visualization:

```mermaid
flowchart LR
    subgraph obs1["Observation: jw02733-o001_t001_nircam"]
        direction TB
        obs1_uncal["L1: _uncal.fits"]
        obs1_rate["L2a: _rate.fits"]
        obs1_cal["L2b: _cal.fits"]
        obs1_i2d["L3: _i2d.fits"]

        obs1_uncal --> obs1_rate --> obs1_cal --> obs1_i2d
    end

    subgraph obs2["Observation: jw02733-o001_t001_miri"]
        direction TB
        obs2_uncal["L1: _uncal.fits"]
        obs2_rate["L2a: _rate.fits"]
        obs2_cal["L2b: _cal.fits"]

        obs2_uncal --> obs2_rate --> obs2_cal
    end
```

---

## Frontend Component Hierarchy

React component structure of the application.

```mermaid
flowchart TB
    subgraph App["App.tsx (Root)"]
        Dashboard["JwstDataDashboard.tsx"]
    end

    subgraph Dashboard
        direction TB
        Header["Header Section"]
        Controls["Control Bar"]
        Content["Content Area"]
    end

    subgraph Header
        Title["Title + Stats"]
        MastToggle["MAST Search Toggle"]
        RefreshBtn["Refresh Metadata Button"]
    end

    subgraph Controls
        SearchFilter["Search/Filter Controls"]
        ViewToggle["View Mode Toggle\n(Grid | List | Grouped | Lineage)"]
        UploadBtn["Upload Button"]
    end

    subgraph Content
        MastSearch["MastSearch.tsx"]
        DataViews["Data Views"]
        Modals["Modals"]
    end

    subgraph MastSearch
        SearchType["Search Type Selector\n(target/coords/obs/program)"]
        SearchInputs["Search Input Fields"]
        ResultsTable["Results Table"]
        ImportBtns["Import Buttons"]
    end

    subgraph DataViews
        GridView["Grid View (cards)"]
        ListView["List View (table)"]
        GroupedView["Grouped View (by type)"]
        LineageView["Lineage View (tree)"]
    end

    subgraph Modals
        ImageViewer["ImageViewer.tsx (FITS viewer with stretch controls, PNG export)"]
        UploadModal["Upload Modal (TODO)"]
    end

    Dashboard --> Header
    Dashboard --> Controls
    Dashboard --> Content
```

---

## MongoDB Document Structure

The flexible document schema for JWST data records.

```mermaid
classDiagram
    class JwstDataModel {
        +ObjectId id
        +string fileName
        +string filePath
        +long fileSize
        +string fileFormat
        +string dataType
        +string processingStatus
        +DateTime uploadDate
        +List~string~ tags
        +string description
        +string processingLevel
        +string observationBaseId
        +string exposureId
        +bool isViewable
        +Dictionary metadata
    }

    class ImageMetadata {
        +int width
        +int height
        +string wavelength
        +string filter
        +string instrument
        +string targetName
        +DateTime observationDate
        +double exposureTime
        +string coordinateSystem
        +WcsInfo wcs
        +int calibrationLevel
        +string proposalId
        +string proposalPi
        +string observationTitle
        +string wavelengthRange
    }

    class SensorMetadata {
        +string instrument
        +string wavelength
        +int dataPoints
        +double samplingRate
        +double integrationTime
        +string detectorType
    }

    class SpectralMetadata {
        +string grating
        +string wavelengthRange
        +List spectralFeatures
        +double signalToNoise
    }

    class ProcessingResult {
        +string algorithm
        +DateTime processedDate
        +string status
        +Dictionary parameters
        +Dictionary results
        +string outputFilePath
    }

    class WcsInfo {
        +double crval1
        +double crval2
        +double crpix1
        +double crpix2
    }

    JwstDataModel "1" *-- "0..1" ImageMetadata : imageInfo
    JwstDataModel "1" *-- "0..1" SensorMetadata : sensorInfo
    JwstDataModel "1" *-- "0..1" SpectralMetadata : spectralInfo
    JwstDataModel "1" *-- "0..*" ProcessingResult : processingResults
    ImageMetadata "1" *-- "0..1" WcsInfo : wcs

    note for JwstDataModel "dataType determines which\nmetadata type is populated:\nimage → ImageMetadata\nsensor → SensorMetadata\nspectral → SpectralMetadata"
```

---

## Backend Service Layer

The .NET backend follows the repository pattern with clear separation of concerns.

```mermaid
flowchart TB
    subgraph Controllers["Controllers Layer"]
        JwstCtrl["JwstDataController\n(CRUD, process)"]
        DataMgmtCtrl["DataManagementController\n(search, export, bulk)"]
        MastCtrl["MastController\n(search, import)"]
    end

    subgraph Services["Services Layer"]
        MongoSvc["MongoDBService\n(Repository Pattern)"]
        MastSvc["MastService\n(HTTP Client)"]
    end

    subgraph External["External"]
        MongoDB[("MongoDB")]
        ProcessingAPI["Processing Engine\n(FastAPI)"]
    end

    JwstCtrl --> MongoSvc
    JwstCtrl --> MastSvc
    DataMgmtCtrl --> MongoSvc
    MastCtrl --> MastSvc
    MastCtrl --> MongoSvc

    MongoSvc -->|MongoDB.Driver| MongoDB
    MastSvc -->|HttpClient| ProcessingAPI
```

### MongoDBService Operations

```mermaid
flowchart LR
    subgraph Queries["Query Operations"]
        GetAll["GetAllAsync()"]
        GetById["GetByIdAsync()"]
        GetByType["GetByTypeAsync()"]
        GetByStatus["GetByStatusAsync()"]
        Search["SearchAsync()"]
    end

    subgraph Mutations["Mutation Operations"]
        Create["CreateAsync()"]
        Update["UpdateAsync()"]
        Delete["DeleteAsync()"]
        BulkTags["BulkUpdateTagsAsync()"]
        BulkStatus["BulkUpdateStatusAsync()"]
    end

    subgraph Lineage["Lineage Operations"]
        GetLineage["GetLineageTreeAsync()"]
        GetGrouped["GetLineageGroupedAsync()"]
    end

    subgraph Analytics["Analytics"]
        Stats["GetStatisticsAsync()"]
        FacetSearch["FacetedSearchAsync()"]
    end
```

---

## Processing Engine Architecture

The Python FastAPI processing engine handles scientific computing and MAST integration.

```mermaid
flowchart TB
    subgraph FastAPI["FastAPI Application (main.py)"]
        Routes["API Routes"]
    end

    subgraph MastModule["app/mast/"]
        MastService["mast_service.py\nMastService class"]
        MastRoutes["routes.py\nFastAPI router"]
        MastModels["models.py\nPydantic models"]
        Downloader["chunked_downloader.py\nAsync HTTP downloads"]
        StateManager["download_state_manager.py\nJSON state persistence"]
        Tracker["download_tracker.py\nProgress tracking"]
    end

    subgraph Processing["app/processing/"]
        Analysis["analysis.py\nAlgorithms (TODO)"]
        Utils["utils.py\nFITS utilities"]
    end

    subgraph External["External"]
        Astroquery["astroquery.mast"]
        STScI["STScI Archive"]
    end

    Routes --> MastRoutes
    Routes --> Analysis
    MastRoutes --> MastService
    MastRoutes --> Downloader
    MastService --> Astroquery
    Downloader --> StateManager
    Downloader --> Tracker
    Astroquery --> STScI
    Analysis --> Utils
```

---

## Docker Compose Services

The complete application stack orchestrated via Docker Compose.

```mermaid
flowchart TB
    subgraph DockerNetwork["Docker Network: jwst-network"]
        subgraph Frontend["frontend"]
            ReactContainer["React App\nPort: 3000"]
        end

        subgraph Backend["backend"]
            DotNetContainer[".NET API\nPort: 5001"]
        end

        subgraph Processing["processing-engine"]
            PythonContainer["FastAPI\nPort: 8000"]
        end

        subgraph Database["mongodb"]
            MongoContainer["MongoDB\nPort: 27017"]
        end

        subgraph Volumes["Volumes"]
            MongoData[("mongo-data")]
            MastData[("./data/mast")]
        end
    end

    subgraph Host["Host Machine"]
        Browser["Browser\nlocalhost:3000"]
    end

    Browser --> ReactContainer
    ReactContainer --> DotNetContainer
    DotNetContainer --> PythonContainer
    DotNetContainer --> MongoContainer
    PythonContainer --> MastData
    MongoContainer --> MongoData
```

---

## See Also

- [CLAUDE.md](https://github.com/Snoww3d/jwst-data-analysis/blob/main/CLAUDE.md) - Main project documentation
- [Development Plan](development-plan.md) - Project roadmap
- [Backend Development Standards](standards/backend-development.md)
- [Frontend Development Standards](standards/frontend-development.md)
- [Database Models](standards/database-models.md)
