# Module Dependencies

Package and module dependency structure for each service, showing how internal modules relate and which external libraries each service depends on.

> **4+1 View**: Development View

## Cross-Service Dependencies

```mermaid
flowchart TB
    subgraph Build["Build Time"]
        direction TB
        FE_Build["Frontend Build\n(Node 22 + Vite)"]
        BE_Build["Backend Build\n(.NET 10 SDK)"]
        PE_Build["Processing Engine\n(Python 3.12 + pip)"]
        MP_Build["MAST Proxy\n(Python 3.12 + pip)"]
    end

    subgraph Runtime["Runtime"]
        FE["Frontend\n(nginx)"]
        BE["Backend\n(ASP.NET)"]
        PE["Processing Engine\n(uvicorn)"]
        MP["MAST Proxy\n(uvicorn)"]
        DB["MongoDB 8.0"]
    end

    FE_Build -.->|"independent"| BE_Build
    FE_Build -.->|"independent"| PE_Build
    BE_Build -.->|"independent"| PE_Build
    PE_Build -.->|"shared requirements"| MP_Build

    FE -->|HTTP /api| BE
    BE -->|HTTP| PE
    BE -->|HTTP| MP
    BE -->|MongoDB.Driver| DB
    MP -->|astroquery| STScI["STScI MAST"]
```

**Key point**: All services build independently. No shared code or compiled artifacts between services. The only coupling is runtime HTTP API contracts.

## Backend (.NET 10)

### Internal Module Structure

```mermaid
flowchart TB
    subgraph Controllers
        AuthC["AuthController"]
        DataC["JwstDataController"]
        DMC["DataManagementController"]
        MastC["MastController"]
        DiscC["DiscoveryController"]
        CompC["CompositeController"]
        MosC["MosaicController"]
        AnaC["AnalysisController"]
        JobsC["JobsController"]
        SearchC["SearchController"]
    end

    subgraph Services
        AuthS["AuthService"]
        MongoS["MongoDBService"]
        MastS["MastService"]
        DiscS["DiscoveryService"]
        CompS["CompositeService"]
        MosS["MosaicService"]
        AnaS["AnalysisService"]
        JobT["JobTracker"]
        ImpT["ImportJobTracker"]
        ThumbS["ThumbnailService"]
        SearchS["SemanticSearchService"]
        StorS["IStorageProvider"]
    end

    subgraph BackgroundSvc["Background Services"]
        CompBG["CompositeBackgroundService"]
        MosBG["MosaicBackgroundService"]
        EmbBG["EmbeddingBackgroundService"]
        ThumbBG["ThumbnailBackgroundService"]
        Notif["JobProgressNotifier"]
    end

    subgraph Models
        JwstM["JwstDataModel"]
        UserM["UserModels"]
        JobM["JobStatus"]
        CompM["CompositeModels"]
        MosM["MosaicModels"]
        DiscM["DiscoveryModels"]
        MastM["MastModels"]
        AnaM["AnalysisModels"]
    end

    subgraph Hubs
        JPHub["JobProgressHub"]
    end

    Controllers --> Services
    Services --> Models
    BackgroundSvc --> Services
    BackgroundSvc --> JobT
    Notif --> JPHub
    MongoS --> StorS
    CompS -->|HTTP| PE["Processing Engine"]
    MosS -->|HTTP| PE
    AnaS -->|HTTP| PE
    DiscS -->|HTTP| PE
    SearchS -->|HTTP| PE
    MastS -->|HTTP| MP["MAST Proxy"]
```

### NuGet Dependencies

| Package | Version | Purpose | Category |
|---------|---------|---------|----------|
| `MongoDB.Driver` | 3.7.1 | Database access | Data |
| `AWSSDK.S3` | 4.x | S3-compatible storage | Data |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | 10.0.5 | JWT authentication | Security |
| `BCrypt.Net-Next` | 4.1.0 | Password hashing | Security |
| `Microsoft.Extensions.Http.Resilience` | 10.4.0 | Polly retry/circuit-breaker | Resilience |
| `AspNetCoreRateLimit` | 5.0.0 | Per-IP rate limiting | Security |
| `Swashbuckle.AspNetCore` | 10.1.5 | Swagger/OpenAPI docs | Dev tooling |
| `Microsoft.AspNetCore.OpenApi` | 10.0.5 | OpenAPI metadata | Dev tooling |

### Test Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `xunit` | 2.9.3 | Test framework |
| `Moq` | 4.20.72 | Mocking |
| `FluentAssertions` | 8.8.0 | Assertion library |
| `coverlet.msbuild` | 6.0.4 | Code coverage (40% threshold) |
| `Microsoft.NET.Test.Sdk` | 17.14.1 | Test runner |

## Frontend (React + TypeScript)

### Internal Module Structure

```mermaid
flowchart TB
    subgraph Pages["Pages (Routes)"]
        Home["Home"]
        Disc["Discovery"]
        Guided["GuidedCreate"]
        Comp["Composite"]
        Mos["Mosaic"]
        Lib["Library"]
        Ana["Analysis"]
        Login["Login/Register"]
    end

    subgraph Components["Shared Components"]
        Header["Header"]
        Cards["TargetCards"]
        Viewer["ImageViewer"]
        JobPanel["JobPanel"]
    end

    subgraph Services["API Services"]
        ApiClient["apiClient\n(fetch wrapper)"]
        AuthSvc["AuthService"]
        DiscSvc["DiscoveryService"]
        CompSvc["CompositeService"]
        MosSvc["MosaicService"]
        AnaSvc["AnalysisService"]
        MastSvc["MastService"]
        JobsSvc["JobsService"]
        SignalRSvc["SignalRService"]
    end

    subgraph Context["React Context"]
        AuthCtx["AuthContext\n(JWT state)"]
    end

    subgraph Types["Type Definitions"]
        JwstT["JwstDataTypes"]
        CompT["CompositeTypes"]
        MosT["MosaicTypes"]
        DiscT["DiscoveryTypes"]
        MastT["MastTypes"]
        JobT["JobTypes"]
        AuthT["AuthTypes"]
        AnaT["AnalysisTypes"]
    end

    Pages --> Components
    Pages --> Services
    Pages --> Context
    Services --> ApiClient
    Services --> Types
    SignalRSvc -->|WebSocket| Backend["Backend SignalR Hub"]
    ApiClient -->|HTTP| Backend2["Backend REST API"]
```

### npm Dependencies

| Package | Version | Purpose | Category |
|---------|---------|---------|----------|
| `react` | ^19.1.0 | UI framework | Core |
| `react-dom` | ^19.1.0 | DOM rendering | Core |
| `react-router-dom` | ^7.13.1 | Client routing | Core |
| `@microsoft/signalr` | ^10.0.0 | Real-time updates | Communication |
| `react-plotly.js` | ^2.6.0 | Scientific charts | Visualization |
| `plotly.js-basic-dist-min` | ^3.4.0 | Chart engine | Visualization |
| `fitsjs` | ^0.6.6 | FITS file parsing | Astronomy |
| `sonner` | ^2.0.7 | Toast notifications | UI |

### Dev/Build Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `vite` | ^8.0.0 | Build tool |
| `@vitejs/plugin-react` | ^6.0.1 | React HMR |
| `typescript` | ^5.9.3 | Type checking |
| `vitest` | ^4.0.18 | Unit testing |
| `@testing-library/react` | latest | Component testing |
| `@playwright/test` | ^1.58.2 | E2E testing |
| `eslint` | ^10.1.0 | Linting |
| `prettier` | ^3.4.2 | Formatting |

## Processing Engine (Python 3.12)

### Internal Module Structure

```mermaid
flowchart TB
    subgraph Routers["FastAPI Routers"]
        CompR["/composite"]
        MosR["/mosaic"]
        AnaR["/analysis"]
        DiscR["/discovery"]
        SemR["/semantic"]
    end

    subgraph Core["Core Modules"]
        FitsUtil["fits_utils\n(FITS I/O, validation)"]
        Storage["storage_provider\n(S3/local abstraction)"]
        Config["config\n(env vars, limits)"]
    end

    subgraph Processing["Processing Modules"]
        CompP["composite_processor\n(N-channel RGB)"]
        MosP["mosaic_processor\n(WCS reprojection)"]
        AnaP["analysis_processor\n(statistics, detection)"]
        DiscP["discovery_processor\n(recipe engine)"]
        SemP["semantic_processor\n(FAISS embeddings)"]
    end

    Routers --> Processing
    Processing --> Core
    Processing --> SciLibs["Scientific Libraries"]

    subgraph SciLibs["Scientific Libraries"]
        NP["NumPy"]
        AP["Astropy"]
        SP["SciPy"]
        RP["reproject"]
        PU["photutils"]
        SK["scikit-image"]
        PIL["Pillow"]
        ST["sentence-transformers"]
        FAISS["faiss-cpu"]
    end
```

### pip Dependencies

| Package | Version | Purpose | Category |
|---------|---------|---------|----------|
| `fastapi` | 0.135.1 | Web framework | Core |
| `uvicorn` | 0.42.0 | ASGI server | Core |
| `pydantic` | 2.12.5 | Data validation | Core |
| `numpy` | 2.2.6 | Array operations | Scientific |
| `scipy` | 1.15.3 | Scientific computing | Scientific |
| `astropy` | 6.1.7 | Astronomy toolkit (FITS, WCS) | Astronomy |
| `astroquery` | 0.4.11 | MAST API client | Astronomy |
| `photutils` | >=1.10.0 | Source detection | Astronomy |
| `reproject` | >=0.13.0 | WCS reprojection | Astronomy |
| `scikit-image` | >=0.22.0 | Image processing | Image |
| `pillow` | 12.1.1 | Image I/O | Image |
| `matplotlib` | 3.10.8 | Colormaps, plotting | Visualization |
| `pandas` | 2.3.3 | Table data handling | Data |
| `sentence-transformers` | >=3.0.0,<6.0.0 | Text embeddings | ML |
| `onnxruntime` | >=1.18.0,<2.0.0 | Model inference | ML |
| `faiss-cpu` | >=1.9.0,<2.0.0 | Vector similarity search | ML |
| `boto3` | >=1.34.0 | AWS S3 client | Storage |
| `aiohttp` | 3.13.3 | Async HTTP | I/O |
| `aiofiles` | 25.1.0 | Async file I/O | I/O |

### MAST Proxy (Subset)

The MAST Proxy uses `requirements-mast.txt` — a subset of the main requirements focused on I/O:
- `fastapi`, `uvicorn`, `pydantic` (web framework)
- `astroquery`, `astropy` (MAST queries)
- `aiohttp`, `aiofiles`, `boto3` (downloads)
- No scientific computing libraries (numpy, scipy, etc. not needed)

## Dependency Weight Analysis

| Service | Runtime Deps | Docker Image Size (approx) | Heaviest Dependencies |
|---------|-------------|---------------------------|----------------------|
| Frontend | 8 runtime | ~50 MB (nginx + static) | plotly.js (~3 MB), react |
| Backend | 8 NuGet | ~200 MB (ASP.NET runtime) | MongoDB.Driver, AWSSDK.S3 |
| Processing Engine | 20+ pip | ~2 GB (scientific stack) | sentence-transformers, PyTorch/ONNX, astropy |
| MAST Proxy | 8 pip | ~500 MB (astroquery) | astroquery, astropy |

The Processing Engine is by far the heaviest due to ML model dependencies (sentence-transformers + ONNX runtime).

---

[Back to Architecture Overview](index.md)
