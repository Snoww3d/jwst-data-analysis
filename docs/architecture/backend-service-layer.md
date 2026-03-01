# Backend Service Layer

The .NET backend follows the repository pattern with clear separation of concerns.

## Request Flow

Controllers receive HTTP requests and delegate to domain services.

```mermaid
flowchart LR
    subgraph Controllers["Controllers"]
        JwstCtrl["JwstDataController\n(CRUD, viewer, thumbnails,\ncheck-availability)"]
        DataMgmtCtrl["DataManagementController\n(search, export, bulk, scan)"]
        MastCtrl["MastController\n(search, import, metadata)"]
        CompositeCtrl["CompositeController\n(N-channel composites)"]
        MosaicCtrl["MosaicController\n(WCS mosaics)"]
        AnalysisCtrl["AnalysisController\n(statistics, detection,\ntables, spectral)"]
        AuthCtrl["AuthController\n(register, login, refresh)"]
        JobsCtrl["JobsController\n(status, cancel, result)"]
        DiscoveryCtrl["DiscoveryController\n(featured targets, recipes)"]
    end

    subgraph Services["Services"]
        MongoSvc["MongoDBService\n(Repository Pattern)"]
        MastSvc["MastService"]
        CompositeSvc["CompositeService"]
        MosaicSvc["MosaicService"]
        AnalysisSvc["AnalysisService"]
        DiscoverySvc["DiscoveryService"]
        AuthSvc["AuthService"]
        JwtSvc["JwtTokenService"]
        ImportTracker["ImportJobTracker"]
        UnifiedTracker["JobTracker"]
        DataScanSvc["DataScanService"]
    end

    JwstCtrl --> MongoSvc
    DataMgmtCtrl --> MongoSvc
    DataMgmtCtrl --> DataScanSvc
    MastCtrl --> MastSvc
    MastCtrl --> MongoSvc
    MastCtrl --> ImportTracker
    CompositeCtrl --> CompositeSvc
    MosaicCtrl --> MosaicSvc
    AnalysisCtrl --> AnalysisSvc
    AuthCtrl --> AuthSvc
    AuthSvc --> JwtSvc
    DiscoveryCtrl --> DiscoverySvc
    JobsCtrl --> UnifiedTracker
```

## Background Processing

Async job queues process composites, mosaics, and thumbnails via bounded channels.

```mermaid
flowchart LR
    subgraph Queues["Job Queues"]
        CompositeQ["CompositeQueue\n(Bounded, cap=10)"]
        MosaicQ["MosaicQueue\n(Bounded, cap=10)"]
        ThumbnailQ["ThumbnailQueue\n(Unbounded)"]
    end

    subgraph Workers["Background Services"]
        CompositeBg["CompositeBackgroundService"]
        MosaicBg["MosaicBackgroundService"]
        ThumbnailBg["ThumbnailBackgroundService"]
    end

    subgraph Startup["Startup Services"]
        StartupScanBg["StartupScanBackgroundService"]
        ReconcileBg["StartupReconciliationService"]
        ReaperBg["JobReaperBackgroundService"]
    end

    subgraph DomainSvc["Domain Services"]
        CompositeSvc["CompositeService"]
        MosaicSvc["MosaicService"]
        ThumbnailSvc["ThumbnailService"]
        DataScanSvc["DataScanService"]
    end

    CompositeBg -->|dequeue| CompositeQ
    CompositeBg --> CompositeSvc
    MosaicBg -->|dequeue| MosaicQ
    MosaicBg --> MosaicSvc
    ThumbnailBg -->|dequeue| ThumbnailQ
    ThumbnailBg --> ThumbnailSvc

    StartupScanBg --> DataScanSvc
    DataScanSvc --> ThumbnailQ
```

## External Dependencies

Services communicate with MongoDB and the Python processing engine.

```mermaid
flowchart LR
    subgraph Services["Services"]
        MongoSvc["MongoDBService"]
        MastSvc["MastService"]
        CompositeSvc["CompositeService"]
        MosaicSvc["MosaicService"]
        AnalysisSvc["AnalysisService"]
        DiscoverySvc["DiscoveryService"]
        ThumbnailSvc["ThumbnailService"]
        UnifiedTracker["JobTracker"]
    end

    subgraph RealTime["Real-Time Push"]
        Notifier["JobProgressNotifier"]
        SignalRHub["JobProgressHub\n(SignalR WebSocket)"]
    end

    subgraph Storage["Storage"]
        StorageProvider["IStorageProvider"]
    end

    MongoDB[("MongoDB")]
    ProcessingAPI["Processing Engine\n(FastAPI)"]

    MongoSvc -->|MongoDB.Driver| MongoDB
    UnifiedTracker -->|MongoDB.Driver| MongoDB
    UnifiedTracker --> Notifier
    Notifier --> SignalRHub

    MastSvc -->|HttpClient| ProcessingAPI
    CompositeSvc -->|HttpClient| ProcessingAPI
    MosaicSvc -->|HttpClient| ProcessingAPI
    AnalysisSvc -->|HttpClient| ProcessingAPI
    DiscoverySvc -->|HttpClient| ProcessingAPI
    ThumbnailSvc -->|HttpClient| ProcessingAPI
```

---

[Back to Architecture Overview](index.md)
