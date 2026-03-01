# Frontend Architecture

## Route Structure

React Router-based SPA with public and protected routes.

```mermaid
flowchart TB
    subgraph Router["BrowserRouter (App.tsx)"]
        direction TB

        subgraph Public["Public Routes (no auth)"]
            Login["/login → LoginPage"]
            Register["/register → RegisterPage"]
        end

        subgraph SharedLayout["SharedLayout (header + nav + UserMenu)"]
            subgraph Discovery["Discovery Routes (anonymous OK)"]
                Home["/ → DiscoveryHome"]
                Target["/target/:name → TargetDetail"]
                Create["/create → GuidedCreate"]
            end

            subgraph Protected["ProtectedRoute (auth required)"]
                Library["/library → MyLibrary"]
                Composite["/composite → CompositePage"]
                Mosaic["/mosaic → MosaicPage"]
            end
        end
    end

    Home -->|click target| Target
    Target -->|click recipe| Create
    Create -->|composite done| Composite
    Library -->|select files| Mosaic
```

## Component Hierarchy

Key component trees for major features.

```mermaid
flowchart TB
    subgraph DiscoveryPages["Discovery Pages"]
        DHome["DiscoveryHome"]
        DHome --> SearchBar["SearchBar"]
        DHome --> TargetGrid["TargetCardGrid"]
        TargetGrid --> TargetCard["TargetCard"]

        TDetail["TargetDetail"]
        TDetail --> RecipeCards["RecipeCard (per recipe)"]
        TDetail --> ObsList["ObservationList"]
        TDetail --> TDSkeleton["TargetDetailSkeleton"]
    end

    subgraph GuidedFlow["GuidedCreate (3-step wizard)"]
        GC["GuidedCreate"]
        GC --> Stepper["WizardStepper"]
        GC --> DLStep["DownloadStep\n(MAST import progress)"]
        GC --> ProcStep["ProcessStep\n(composite generation)"]
        GC --> ResStep["ResultStep\n(preview + adjustments)"]
    end

    subgraph LibraryPage["MyLibrary"]
        ML["MyLibrary"]
        ML --> Dashboard["JwstDataDashboard"]
        Dashboard --> DToolbar["DashboardToolbar"]
        Dashboard --> Views["Grid | List | Grouped | Lineage"]
        Dashboard --> DataCard["DataCard"]
        Dashboard --> MastSearch["MastSearch"]
        Dashboard --> FloatingBar["FloatingAnalysisBar"]
    end

    subgraph Wizards["Composite & Mosaic Wizards"]
        CP["CompositePage"]
        CP --> ChanAssign["ChannelAssignStep"]
        ChanAssign --> ChanCard["ChannelCard"]
        CP --> CompPreview["CompositePreviewStep"]

        MP["MosaicPage"]
        MP --> MosSelect["MosaicSelectStep"]
        MP --> MosPreview["MosaicPreviewStep"]
        MosPreview --> Footprint["FootprintPreview"]
    end

    subgraph Viewer["FITS Viewer & Analysis"]
        IV["ImageViewer"]
        IV --> StretchCtrl["StretchControls"]
        IV --> Histogram["HistogramPanel"]
        IV --> WcsGrid["WcsGridOverlay"]
        IV --> Annotations["AnnotationOverlay"]
        IV --> SrcDetect["SourceDetectionPanel"]
        IV --> SrcOverlay["SourceDetectionOverlay"]
        IV --> RegionStats["RegionStatisticsPanel"]
        IV --> RegionSel["RegionSelector"]
        IV --> Curves["CurvesEditor"]
        IV --> Smoothing["SmoothingControls"]
        IV --> CubeNav["CubeNavigator"]

        Compare["ImageComparisonViewer\n(blink/side-by-side/overlay)"]

        Spectral["SpectralViewer\n(1D spectrum chart)"]
        Table["TableViewer\n(binary table HDUs)"]
    end
```

---

[Back to Architecture Overview](index.md)
