# Processing Engine Architecture

The Python FastAPI processing engine handles scientific computing and MAST integration.

## Module Routing

FastAPI routes dispatch to domain-specific modules.

```mermaid
flowchart LR
    subgraph FastAPI["FastAPI Application"]
        Routes["API Routes\n(main.py)"]
    end

    MastRoutes["app/mast/\nroutes.py"]
    CompositeRoutes["app/composite/\nroutes.py"]
    MosaicRoutes["app/mosaic/\nroutes.py"]
    AnalysisRoutes["app/analysis/\nroutes.py"]
    DiscoveryRoutes["app/discovery/\nroutes.py"]

    Routes --> MastRoutes
    Routes --> CompositeRoutes
    Routes --> MosaicRoutes
    Routes --> AnalysisRoutes
    Routes --> DiscoveryRoutes
```

## MAST Module

MAST search and data download with chunked/S3 download support.

```mermaid
flowchart LR
    MastRoutes["routes.py"]

    subgraph Services["Services"]
        MastService["mast_service.py\nMastService class"]
        Downloader["chunked_downloader.py\nAsync HTTP downloads"]
        S3Down["s3_downloader.py\nS3 multipart downloads"]
    end

    subgraph State["State Management"]
        StateManager["download_state_manager.py\nJSON state persistence"]
        Tracker["download_tracker.py\nProgress tracking"]
        MastModels["models.py\nPydantic models"]
    end

    subgraph External["External"]
        Astroquery["astroquery.mast"]
        STScI["STScI Archive"]
    end

    MastRoutes --> MastService
    MastRoutes --> Downloader
    MastRoutes --> S3Down
    MastService --> Astroquery
    Astroquery --> STScI
    Downloader --> StateManager
    Downloader --> Tracker
    S3Down --> Tracker
```

## Scientific Modules

Composite, mosaic, analysis, and discovery modules with their dependencies.

```mermaid
flowchart LR
    subgraph Composite["app/composite/"]
        CompositeRoutes["routes.py\nN-channel composite"]
        ColorMapping["color_mapping.py\nHue/RGB mapping"]
    end

    subgraph Mosaic["app/mosaic/"]
        MosaicRoutes["routes.py\nWCS mosaic"]
        MosaicEngine["mosaic_engine.py\nReproject logic"]
    end

    subgraph Analysis["app/analysis/"]
        AnalysisRoutes["routes.py\nRegion stats, detection,\ntables, spectral"]
    end

    subgraph Discovery["app/discovery/"]
        DiscoveryRoutes["routes.py\nRecipe suggestions"]
        RecipeEngine["recipe_engine.py\nFilter grouping, scoring"]
    end

    subgraph Processing["app/processing/ (shared)"]
        Enhancement["enhancement.py\nasinh, log, sqrt, zscale,\nhisteq, power stretch"]
        Detection["detection.py\nDAOFind, IRAF, segmentation"]
        Filters["filters.py\nGaussian, median, box"]
        Background["background.py\nSky background estimation"]
        Statistics["statistics.py\nHistogram, percentiles"]
        Pipeline["pipeline.py\nOrchestration"]
        AVM["avm.py\nVisualization Metadata"]
        Utils["utils.py\nFITS I/O"]
    end

    CompositeRoutes --> ColorMapping
    CompositeRoutes --> Enhancement
    MosaicRoutes --> MosaicEngine
    AnalysisRoutes --> Detection
    AnalysisRoutes --> Statistics
    DiscoveryRoutes --> RecipeEngine
```

## Storage Layer

All modules share a common storage abstraction with LRU caching.

```mermaid
flowchart LR
    CompositeRoutes["Composite"]
    MosaicRoutes["Mosaic"]
    AnalysisRoutes["Analysis"]
    MastRoutes["MAST"]

    subgraph StorageModule["app/storage/"]
        StorageFactory["factory.py\nProvider selection"]
        StorageABC["provider.py\nStorageProvider ABC"]
        LocalStore["local_storage.py"]
        S3Store["s3_storage.py"]
        TempCache["temp_cache.py\nLRU cache"]
        Helpers["helpers.py\nPath resolution"]
    end

    CompositeRoutes --> StorageFactory
    MosaicRoutes --> StorageFactory
    AnalysisRoutes --> StorageFactory
    MastRoutes --> StorageFactory

    StorageFactory --> StorageABC
    StorageABC --> LocalStore
    StorageABC --> S3Store
    LocalStore --> TempCache
    S3Store --> TempCache
```

---

[Back to Architecture Overview](index.md)
