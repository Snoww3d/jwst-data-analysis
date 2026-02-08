# JWST Data Analysis Desktop Application

## Requirements & Architecture Specification

**Version:** 1.0.0
**Status:** Draft
**Purpose:** Platform-agnostic requirements for building a desktop application for JWST data analysis

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [User Personas](#3-user-personas)
4. [Functional Requirements](#4-functional-requirements)
5. [Data Models](#5-data-models)
6. [User Interface Requirements](#6-user-interface-requirements)
7. [External Integrations](#7-external-integrations)
8. [Performance Requirements](#8-performance-requirements)
9. [Security Requirements](#9-security-requirements)
10. [Technology Recommendations](#10-technology-recommendations)

---

## 1. Executive Summary

### 1.1 Purpose

A desktop application for astronomers and researchers to browse, import, analyze, and visualize James Webb Space Telescope (JWST) data. The application provides seamless integration with NASA's MAST (Mikulski Archive for Space Telescopes) portal and local scientific processing capabilities.

### 1.2 Key Capabilities

| Capability | Description |
|------------|-------------|
| **MAST Integration** | Search and import JWST observations directly from STScI archive |
| **Data Management** | Organize, tag, and track JWST datasets with full metadata |
| **FITS Visualization** | View FITS images with scientific color maps and stretch functions |
| **Processing Pipeline** | Apply analysis algorithms with lineage tracking |
| **Offline Operation** | Full functionality without internet (except MAST searches) |

### 1.3 Target Platforms

- macOS (Apple Silicon and Intel)
- Windows 10/11 (64-bit)
- Linux (Ubuntu 20.04+, Fedora 36+)

---

## 2. Goals & Non-Goals

### 2.1 Goals

1. **Single-installer deployment** - User downloads one file, runs installer, application works
2. **No external dependencies** - No Docker, no database servers, no Python installation required
3. **Native experience** - System file dialogs, drag-drop, keyboard shortcuts, menu bar integration
4. **Offline-first** - All features work offline except MAST portal queries
5. **Data portability** - Easy export/import of entire workspace including settings
6. **Scientific accuracy** - Proper FITS handling with WCS support, accurate color mapping

### 2.2 Non-Goals

1. **Multi-user collaboration** - This is a single-user desktop application
2. **Cloud storage** - Data stored locally only (user can sync via their own cloud drive)
3. **Real-time telescope control** - Read-only archive access
4. **Publication-ready plots** - Focus on exploration, not final publication graphics
5. **Mobile support** - Desktop only (macOS, Windows, Linux)

---

## 3. User Personas

### 3.1 Research Astronomer

**Background:** PhD-level researcher analyzing JWST data for publications
**Technical Level:** Comfortable with FITS files, Python, command line
**Needs:**
- Quick import of specific observations by ID
- Batch processing of multiple files
- Export processed data for use in other tools (DS9, Python scripts)
- Accurate WCS coordinate display

### 3.2 Graduate Student

**Background:** Learning astronomical data analysis
**Technical Level:** Some programming experience, new to FITS format
**Needs:**
- Easy browsing of available JWST data
- Visual exploration before committing to downloads
- Clear organization of imported datasets
- Guided processing workflows

### 3.3 Citizen Scientist / Enthusiast

**Background:** Hobbyist interested in space imagery
**Technical Level:** Basic computer skills, no programming
**Needs:**
- Simple search by object name ("Carina Nebula")
- One-click import of interesting observations
- Attractive visualizations with preset color maps
- Easy export to shareable image formats (PNG, JPEG)

---

## 4. Functional Requirements

### 4.1 Data Import

#### FR-4.1.1 Local File Import

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1.1.1 | Import FITS files via native file dialog | Must |
| FR-4.1.1.2 | Import FITS files via drag-and-drop onto application window | Must |
| FR-4.1.1.3 | Support batch import of multiple files simultaneously | Must |
| FR-4.1.1.4 | Automatically extract and store FITS header metadata | Must |
| FR-4.1.1.5 | Detect and classify file type (image vs table) from FITS structure | Must |
| FR-4.1.1.6 | Support compressed FITS files (.fits.gz, .fits.fz) | Should |
| FR-4.1.1.7 | Validate FITS file integrity before import | Should |
| FR-4.1.1.8 | Import CSV and JSON data files | Could |

**Supported FITS Types:**

| File Pattern | Type | Viewable | Description |
|--------------|------|----------|-------------|
| `*_uncal.fits` | Image | Yes | Uncalibrated raw data |
| `*_rate.fits` | Image | Yes | Count rate image |
| `*_rateints.fits` | Image | Yes | Count rate per integration |
| `*_cal.fits` | Image | Yes | Calibrated image |
| `*_calints.fits` | Image | Yes | Calibrated per integration |
| `*_i2d.fits` | Image | Yes | 2D resampled/combined |
| `*_s2d.fits` | Image | Yes | 2D spectral image |
| `*_crf.fits` | Image | Yes | Cosmic ray flagged |
| `*_asn.fits` | Table | No | Association table |
| `*_x1d.fits` | Table | No | 1D extracted spectrum |
| `*_cat.fits` | Table | No | Source catalog |
| `*_pool.fits` | Table | No | Association pool |

#### FR-4.1.2 MAST Portal Import

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1.2.1 | Search MAST by astronomical target name | Must |
| FR-4.1.2.2 | Search MAST by RA/Dec coordinates with radius | Must |
| FR-4.1.2.3 | Search MAST by observation ID | Must |
| FR-4.1.2.4 | Search MAST by program/proposal ID | Must |
| FR-4.1.2.5 | Browse recently released JWST observations | Should |
| FR-4.1.2.6 | Display search results in sortable table | Must |
| FR-4.1.2.7 | Show observation preview thumbnail when available | Should |
| FR-4.1.2.8 | Import single observation with one click | Must |
| FR-4.1.2.9 | Bulk import multiple selected observations | Must |
| FR-4.1.2.10 | Download files in chunks with resume capability | Must |
| FR-4.1.2.11 | Show real-time download progress (bytes, speed, ETA) | Must |
| FR-4.1.2.12 | Support parallel downloads (configurable, default 3) | Should |
| FR-4.1.2.13 | Persist download state to allow resume after app restart | Must |
| FR-4.1.2.14 | Filter search results by instrument | Should |
| FR-4.1.2.15 | Filter search results by calibration level | Should |

**MAST Search Response Fields to Capture:**

```
obs_id              - Unique observation identifier
target_name         - Astronomical target name
s_ra, s_dec         - Coordinates (degrees)
instrument_name     - JWST instrument (NIRCam, MIRI, NIRSpec, NIRISS, FGS)
filters             - Filter/grating used
t_exptime           - Exposure time (seconds)
t_min, t_max        - Observation start/end (MJD)
calib_level         - Calibration level (0-4)
proposal_id         - Program number
proposal_pi         - Principal investigator
obs_title           - Observation title
dataproduct_type    - Type (image, spectrum, etc.)
obs_collection      - Collection (JWST)
wavelength_region   - Wavelength band
dataURL             - Download URL
jpegURL             - Preview image URL
```

#### FR-4.1.3 Download Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1.3.1 | Queue downloads and process sequentially or in parallel | Must |
| FR-4.1.3.2 | Pause individual or all downloads | Must |
| FR-4.1.3.3 | Resume paused or failed downloads from last byte | Must |
| FR-4.1.3.4 | Cancel downloads with cleanup of partial files | Must |
| FR-4.1.3.5 | Retry failed downloads with exponential backoff | Should |
| FR-4.1.3.6 | Show download queue with status for each file | Must |
| FR-4.1.3.7 | Configurable download chunk size (default 5MB) | Could |
| FR-4.1.3.8 | Bandwidth throttling option | Could |

---

### 4.2 Data Management

#### FR-4.2.1 Data Organization

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.2.1.1 | Store all imported data in local embedded database | Must |
| FR-4.2.1.2 | Assign unique identifier to each data record | Must |
| FR-4.2.1.3 | Track file path, size, and checksum for each file | Must |
| FR-4.2.1.4 | Support user-defined tags on data records | Must |
| FR-4.2.1.5 | Track processing status (raw, processing, processed, failed, archived) | Must |
| FR-4.2.1.6 | Store complete FITS header as searchable metadata | Must |
| FR-4.2.1.7 | Track data lineage (parent-child relationships) | Must |
| FR-4.2.1.8 | Support soft delete with recovery option | Should |
| FR-4.2.1.9 | Permanent delete with file cleanup | Must |

#### FR-4.2.2 Search and Filter

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.2.2.1 | Full-text search across file names and metadata | Must |
| FR-4.2.2.2 | Filter by data type (image, spectral, calibration, etc.) | Must |
| FR-4.2.2.3 | Filter by processing status | Must |
| FR-4.2.2.4 | Filter by instrument | Must |
| FR-4.2.2.5 | Filter by date range (observation date or import date) | Must |
| FR-4.2.2.6 | Filter by tags | Must |
| FR-4.2.2.7 | Filter by file size range | Should |
| FR-4.2.2.8 | Filter by calibration/processing level | Should |
| FR-4.2.2.9 | Save and recall filter presets | Could |
| FR-4.2.2.10 | Sort results by any column | Must |

#### FR-4.2.3 Bulk Operations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.2.3.1 | Select multiple records with shift-click and cmd/ctrl-click | Must |
| FR-4.2.3.2 | Select all visible records | Must |
| FR-4.2.3.3 | Bulk add tags to selected records | Must |
| FR-4.2.3.4 | Bulk remove tags from selected records | Must |
| FR-4.2.3.5 | Bulk update status of selected records | Must |
| FR-4.2.3.6 | Bulk delete selected records | Must |
| FR-4.2.3.7 | Bulk export selected records | Should |
| FR-4.2.3.8 | Bulk trigger processing on selected records | Should |

#### FR-4.2.4 Data Lineage

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.2.4.1 | Track processing level for each record (L1, L2a, L2b, L3) | Must |
| FR-4.2.4.2 | Link derived data to source data (parent-child) | Must |
| FR-4.2.4.3 | Group related files by observation base ID | Must |
| FR-4.2.4.4 | Display lineage as interactive tree visualization | Should |
| FR-4.2.4.5 | Navigate from child to parent and vice versa | Must |
| FR-4.2.4.6 | Track processing parameters used to create derived data | Should |

**Processing Levels:**

| Level | Name | Description |
|-------|------|-------------|
| L1 | Raw | Uncalibrated data directly from instrument |
| L2a | Partially Calibrated | Basic calibrations applied |
| L2b | Fully Calibrated | All calibrations applied |
| L3 | Combined/Derived | Mosaics, combined exposures, extracted products |

---

### 4.3 Visualization

#### FR-4.3.1 FITS Image Viewer

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.3.1.1 | Display 2D FITS image data | Must |
| FR-4.3.1.2 | Support multiple color maps (grayscale, viridis, plasma, inferno, magma, turbo, hot, cool, rainbow, cubehelix) | Must |
| FR-4.3.1.3 | Apply stretch functions (linear, log, sqrt, asinh, power) | Must |
| FR-4.3.1.4 | Adjustable stretch parameters (min, max, gamma) | Must |
| FR-4.3.1.5 | Interactive histogram with draggable range selectors | Must |
| FR-4.3.1.6 | Auto-scale option (percentile-based) | Must |
| FR-4.3.1.7 | Zoom in/out with mouse wheel | Must |
| FR-4.3.1.8 | Pan image with click-and-drag | Must |
| FR-4.3.1.9 | Fit to window option | Must |
| FR-4.3.1.10 | Display pixel value and coordinates on hover | Must |
| FR-4.3.1.11 | Display WCS coordinates (RA/Dec) on hover when available | Should |
| FR-4.3.1.12 | Support multi-extension FITS (select extension) | Should |
| FR-4.3.1.13 | Support data cubes (select slice) | Could |
| FR-4.3.1.14 | Side-by-side comparison of two images | Could |
| FR-4.3.1.15 | Blink comparison (toggle between images) | Could |
| FR-4.3.1.16 | RGB composite wizard with per-channel and global stretch/levels controls | Should |

**Color Maps:**

| Name | Description | Use Case |
|------|-------------|----------|
| Grayscale | Black to white | General purpose |
| Viridis | Blue-green-yellow | Perceptually uniform, colorblind-friendly |
| Plasma | Blue-pink-yellow | High contrast |
| Inferno | Black-red-yellow-white | Heat map style |
| Magma | Black-purple-orange-white | Similar to inferno |
| Turbo | Rainbow (improved) | Maximum contrast |
| Hot | Black-red-yellow-white | Thermal imaging |
| Cool | Cyan-magenta | Complementary to hot |
| Rainbow | Full spectrum | Legacy, not recommended |
| Cubehelix | Spiral through color space | Prints well in grayscale |

**Stretch Functions:**

| Function | Formula | Use Case |
|----------|---------|----------|
| Linear | `y = x` | Even distribution |
| Log | `y = log(ax + 1) / log(a + 1)` | High dynamic range |
| Sqrt | `y = sqrt(x)` | Moderate enhancement |
| Asinh | `y = asinh(ax) / asinh(a)` | Very high dynamic range |
| Power | `y = x^gamma` | Adjustable contrast |

#### FR-4.3.2 Histogram Display

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.3.2.1 | Display pixel value distribution histogram | Must |
| FR-4.3.2.2 | Logarithmic y-axis option | Should |
| FR-4.3.2.3 | Show current stretch range as overlay | Must |
| FR-4.3.2.4 | Drag handles to adjust stretch range | Must |
| FR-4.3.2.5 | Show statistics (min, max, mean, median, std dev) | Should |
| FR-4.3.2.6 | Exclude NaN/Inf values from histogram | Must |

#### FR-4.3.3 Export

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.3.3.1 | Export current view as PNG | Must |
| FR-4.3.3.2 | Export current view as JPEG | Should |
| FR-4.3.3.3 | Configurable export resolution | Should |
| FR-4.3.3.4 | Option to include color bar in export | Could |
| FR-4.3.3.5 | Option to include coordinate grid in export | Could |
| FR-4.3.3.6 | Copy current view to clipboard | Should |

---

### 4.4 Processing

#### FR-4.4.1 Algorithm Execution

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.4.1.1 | Execute processing algorithms on selected data | Must |
| FR-4.4.1.2 | Configure algorithm parameters before execution | Must |
| FR-4.4.1.3 | Show processing progress with cancel option | Must |
| FR-4.4.1.4 | Store processing results as new data records | Must |
| FR-4.4.1.5 | Link results to source data (lineage) | Must |
| FR-4.4.1.6 | Record algorithm name and parameters in result metadata | Must |
| FR-4.4.1.7 | Queue multiple processing jobs | Should |
| FR-4.4.1.8 | Background processing with notification on completion | Should |

#### FR-4.4.2 Built-in Algorithms

| ID | Algorithm | Description | Priority |
|----|-----------|-------------|----------|
| FR-4.4.2.1 | Basic Analysis | Statistics, histogram, percentiles | Must |
| FR-4.4.2.2 | Image Enhancement | Contrast adjustment, sharpening | Should |
| FR-4.4.2.3 | Noise Reduction | Smoothing, median filter, sigma clipping | Should |
| FR-4.4.2.4 | Background Subtraction | Remove sky background | Should |
| FR-4.4.2.5 | Source Detection | Find and catalog point sources | Could |
| FR-4.4.2.6 | Aperture Photometry | Measure source brightness | Could |
| FR-4.4.2.7 | WCS Mosaic / Image Stacking | Combine 2+ FITS images via WCS reprojection with footprint preview | Could |
| FR-4.4.2.8 | Cosmic Ray Removal | Identify and mask cosmic rays | Could |

**Algorithm Parameter Schema Example (Basic Analysis):**

```json
{
  "algorithm": "basic_analysis",
  "parameters": {
    "compute_histogram": true,
    "histogram_bins": 256,
    "compute_percentiles": true,
    "percentiles": [1, 5, 16, 50, 84, 95, 99],
    "mask_nan": true
  }
}
```

**Processing Result Schema Example:**

```json
{
  "algorithm": "basic_analysis",
  "execution_time_ms": 245,
  "results": {
    "min": -0.0023,
    "max": 1247.5,
    "mean": 12.34,
    "median": 8.21,
    "std_dev": 45.67,
    "percentiles": {
      "1": 0.12,
      "5": 0.89,
      "50": 8.21,
      "95": 67.4,
      "99": 234.5
    },
    "histogram": {
      "bins": [0, 5, 10, ...],
      "counts": [1234, 5678, ...]
    }
  }
}
```

---

### 4.5 Data Export

#### FR-4.5.1 File Export

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.5.1.1 | Export original FITS file | Must |
| FR-4.5.1.2 | Export metadata as JSON | Must |
| FR-4.5.1.3 | Export metadata as CSV | Should |
| FR-4.5.1.4 | Export processing results as JSON | Should |
| FR-4.5.1.5 | Batch export multiple records to folder | Should |
| FR-4.5.1.6 | Export with folder structure by observation | Could |

#### FR-4.5.2 Workspace Export

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.5.2.1 | Export entire workspace (database + files) as archive | Should |
| FR-4.5.2.2 | Import workspace archive | Should |
| FR-4.5.2.3 | Merge imported workspace with existing data | Could |

---

## 5. Data Models

### 5.1 Core Data Record

```typescript
interface JwstDataRecord {
  // Identity
  id: string;                    // UUID
  fileName: string;              // Original file name
  filePath: string;              // Local storage path
  fileSize: number;              // Bytes
  checksum: string;              // SHA-256 hash

  // Classification
  dataType: DataType;            // image, spectral, calibration, etc.
  fileCategory: FileCategory;    // viewable_image, table, unknown
  processingLevel: ProcessingLevel; // L1, L2a, L2b, L3

  // Status
  status: ProcessingStatus;      // raw, processing, processed, failed, archived
  importSource: ImportSource;    // local, mast

  // Timestamps
  importedAt: DateTime;          // When imported into application
  observationDate?: DateTime;    // When observation was taken (from FITS/MAST)
  lastModified: DateTime;        // Last record modification

  // Organization
  tags: string[];                // User-defined tags
  notes?: string;                // User notes

  // Lineage
  parentId?: string;             // Source data record (if derived)
  observationBaseId?: string;    // Groups related files
  exposureId?: string;           // Specific exposure identifier

  // Metadata (flexible, source-dependent)
  imageInfo?: ImageMetadata;
  spectralInfo?: SpectralMetadata;
  mastMetadata?: Record<string, any>;  // Raw MAST fields with mast_ prefix
  fitsHeaders?: Record<string, any>;   // Raw FITS headers

  // Processing
  processingResults: ProcessingResult[];
}

enum DataType {
  Image = "image",
  Spectral = "spectral",
  Calibration = "calibration",
  Sensor = "sensor",
  Metadata = "metadata"
}

enum FileCategory {
  ViewableImage = "viewable_image",
  Table = "table",
  Unknown = "unknown"
}

enum ProcessingLevel {
  L1 = "L1",      // Raw
  L2a = "L2a",    // Partially calibrated
  L2b = "L2b",    // Fully calibrated
  L3 = "L3"       // Combined/derived
}

enum ProcessingStatus {
  Raw = "raw",
  Processing = "processing",
  Processed = "processed",
  Failed = "failed",
  Archived = "archived"
}

enum ImportSource {
  Local = "local",
  Mast = "mast"
}
```

### 5.2 Image Metadata

```typescript
interface ImageMetadata {
  // Dimensions
  width: number;
  height: number;
  bitDepth?: number;
  numExtensions?: number;

  // Observation
  instrument?: string;           // NIRCam, MIRI, NIRSpec, NIRISS, FGS
  filter?: string;               // F090W, F200W, etc.
  exposureTime?: number;         // Seconds
  wavelengthRange?: string;      // INFRARED, OPTICAL, UV

  // Target
  targetName?: string;
  proposalId?: string;
  proposalPi?: string;
  observationTitle?: string;

  // Coordinates (WCS)
  wcs?: {
    crval1: number;              // Reference RA
    crval2: number;              // Reference Dec
    crpix1: number;              // Reference pixel X
    crpix2: number;              // Reference pixel Y
    cdelt1?: number;             // Pixel scale X
    cdelt2?: number;             // Pixel scale Y
    ctype1?: string;             // Coordinate type X
    ctype2?: string;             // Coordinate type Y
  };

  // Calibration
  calibrationLevel?: number;     // 0-4 from MAST
}
```

### 5.3 Spectral Metadata

```typescript
interface SpectralMetadata {
  grating?: string;
  wavelengthMin?: number;        // Angstroms
  wavelengthMax?: number;        // Angstroms
  spectralResolution?: number;   // R = λ/Δλ
  signalToNoise?: number;
}
```

### 5.4 Processing Result

```typescript
interface ProcessingResult {
  id: string;                    // UUID
  algorithmName: string;
  parameters: Record<string, any>;
  executedAt: DateTime;
  executionTimeMs: number;
  status: "success" | "failed";
  errorMessage?: string;
  outputs: Record<string, any>;  // Algorithm-specific results
  outputFiles?: string[];        // Paths to generated files
}
```

### 5.5 Download Job

```typescript
interface DownloadJob {
  id: string;                    // UUID
  obsId: string;                 // MAST observation ID
  status: DownloadStatus;
  createdAt: DateTime;
  startedAt?: DateTime;
  completedAt?: DateTime;

  // Progress
  totalBytes: number;
  downloadedBytes: number;
  currentSpeed?: number;         // Bytes per second
  estimatedTimeRemaining?: number; // Seconds

  // Files
  files: DownloadFile[];

  // Resume support
  canResume: boolean;
  lastResumePoint?: number;      // Byte offset
}

interface DownloadFile {
  url: string;
  localPath: string;
  fileName: string;
  size: number;
  downloaded: number;
  status: "pending" | "downloading" | "completed" | "failed";
  errorMessage?: string;
}

enum DownloadStatus {
  Queued = "queued",
  Downloading = "downloading",
  Paused = "paused",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled"
}
```

---

## 6. User Interface Requirements

### 6.1 Main Window Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Menu Bar                                                           │
├─────────────────────────────────────────────────────────────────────┤
│  Toolbar: [Import ▾] [MAST Search] [Process ▾] | Search: [______]   │
├──────────────────────────────────────┬──────────────────────────────┤
│                                      │                              │
│  Sidebar                             │  Main Content Area           │
│  ┌────────────────────────────────┐  │                              │
│  │ Filters                        │  │  [Grid] [List] [Lineage]     │
│  │  ☑ Images                      │  │                              │
│  │  ☑ Spectra                     │  │  ┌─────┐ ┌─────┐ ┌─────┐    │
│  │  ☐ Calibration                 │  │  │     │ │     │ │     │    │
│  │                                │  │  │ IMG │ │ IMG │ │ IMG │    │
│  │ Status                         │  │  │     │ │     │ │     │    │
│  │  ○ All                         │  │  └─────┘ └─────┘ └─────┘    │
│  │  ○ Raw                         │  │                              │
│  │  ○ Processed                   │  │  ┌─────┐ ┌─────┐ ┌─────┐    │
│  │                                │  │  │     │ │     │ │     │    │
│  │ Tags                           │  │  │ IMG │ │ IMG │ │ IMG │    │
│  │  [NGC 3132] [NIRCam] [+]       │  │  │     │ │     │ │     │    │
│  │                                │  │  └─────┘ └─────┘ └─────┘    │
│  │ Date Range                     │  │                              │
│  │  [2024-01-01] - [2024-12-31]   │  │                              │
│  └────────────────────────────────┘  │                              │
│                                      │                              │
├──────────────────────────────────────┴──────────────────────────────┤
│  Status Bar: 42 items | 3 selected | 2.4 GB total                   │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 MAST Search Panel

```
┌─────────────────────────────────────────────────────────────────────┐
│  MAST Search                                                   [×]  │
├─────────────────────────────────────────────────────────────────────┤
│  Search Type: (•) Target  ( ) Coordinates  ( ) Obs ID  ( ) Program  │
│                                                                     │
│  Target Name: [Carina Nebula          ] Radius: [0.1] arcmin        │
│                                                                     │
│  [Search MAST]                                                      │
├─────────────────────────────────────────────────────────────────────┤
│  Results (47 observations)                      [Import Selected]   │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ ☐ │ Target      │ Instrument │ Filter │ Exp(s) │ Date    │ Act ││
│  ├───┼─────────────┼────────────┼────────┼────────┼─────────┼─────┤│
│  │ ☑ │ Carina Neb. │ NIRCam     │ F090W  │ 120.0  │ 2022-06 │ [⬇] ││
│  │ ☑ │ Carina Neb. │ NIRCam     │ F200W  │ 120.0  │ 2022-06 │ [⬇] ││
│  │ ☐ │ Carina Neb. │ MIRI       │ F770W  │ 240.0  │ 2022-06 │ [⬇] ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 Image Viewer

```
┌─────────────────────────────────────────────────────────────────────┐
│  Image Viewer - jw02733_nircam_f090w_i2d.fits                  [×]  │
├─────────────────────────────────────────────────────────────────────┤
│  Color Map: [Viridis ▾]  Stretch: [Asinh ▾]  [Auto Scale]  [Export] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│     ┌───────────────────────────────────────────────────────┐       │
│     │                                                       │       │
│     │                                                       │       │
│     │                    FITS IMAGE                         │       │
│     │                                                       │       │
│     │                                                       │       │
│     │                                                       │       │
│     └───────────────────────────────────────────────────────┘       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁  Histogram                                 │    │
│  │ [|←──────────────────────────────────────────────────→|]   │    │
│  │ Min: 0.12         Max: 234.5         Gamma: 1.0            │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Pixel: (1024, 768)  Value: 45.67  RA: 10h 43m 12.5s  Dec: -59° 32' │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.4 View Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| Grid | Card-based thumbnail grid | Visual browsing |
| List | Table with sortable columns | Detailed comparison |
| Lineage | Tree hierarchy by processing level | Track data provenance |

### 6.5 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + O` | Open file import dialog |
| `Cmd/Ctrl + F` | Focus search box |
| `Cmd/Ctrl + M` | Open MAST search |
| `Cmd/Ctrl + A` | Select all visible items |
| `Cmd/Ctrl + E` | Export selected |
| `Delete` | Delete selected (with confirmation) |
| `Space` | Quick preview selected item |
| `Enter` | Open selected item in viewer |
| `1` | Switch to Grid view |
| `2` | Switch to List view |
| `3` | Switch to Lineage view |
| `+` / `-` | Zoom in/out (in viewer) |
| `0` | Fit to window (in viewer) |

---

## 7. External Integrations

### 7.1 MAST Portal (STScI)

**Service:** Mikulski Archive for Space Telescopes
**Protocol:** HTTP REST API via astroquery
**Authentication:** None required for public data
**Rate Limits:** Be respectful, no explicit limits documented

**Endpoints Used:**

| Operation | Method | Purpose |
|-----------|--------|---------|
| Query observations | astroquery.mast.Observations | Search by various criteria |
| Get products | astroquery.mast.Observations.get_product_list | List available files |
| Download files | HTTP GET with Range headers | Chunked file download |

**Error Handling:**
- Network timeouts: Retry with exponential backoff (3 attempts)
- 429 Too Many Requests: Back off and retry
- 5xx Server errors: Retry with backoff
- Invalid responses: Log and show user-friendly error

### 7.2 File System

**Data Storage Location:**
- macOS: `~/Library/Application Support/JWST-Analyzer/`
- Windows: `%APPDATA%\JWST-Analyzer\`
- Linux: `~/.local/share/jwst-analyzer/`

**Directory Structure:**
```
JWST-Analyzer/
├── database.db              # SQLite database
├── config.json              # User preferences
├── data/                    # Imported FITS files
│   ├── local/               # Locally imported files
│   │   └── {id}/            # By record ID
│   │       └── file.fits
│   └── mast/                # MAST downloads
│       └── {obs_id}/        # By observation ID
│           ├── file1.fits
│           └── file2.fits
├── cache/                   # Temporary files
│   ├── previews/            # Generated preview images
│   └── downloads/           # Partial downloads
└── logs/                    # Application logs
```

---

## 8. Performance Requirements

### 8.1 Responsiveness

| Operation | Target | Maximum |
|-----------|--------|---------|
| Application launch | < 2s | 5s |
| Open existing database | < 1s | 3s |
| Display data list (1000 items) | < 500ms | 1s |
| Search/filter results | < 200ms | 500ms |
| Open image viewer | < 1s | 3s |
| Render FITS preview (4K image) | < 2s | 5s |
| Apply color map change | < 100ms | 300ms |
| Apply stretch change | < 100ms | 300ms |

### 8.2 Scalability

| Metric | Supported | Tested |
|--------|-----------|--------|
| Total records in database | 10,000+ | 50,000 |
| Single FITS file size | 2 GB | 4 GB |
| Total storage | Limited by disk | - |
| Concurrent downloads | 3 (configurable) | 5 |
| Processing queue depth | 100 | 100 |

### 8.3 Memory Usage

| Scenario | Target | Maximum |
|----------|--------|---------|
| Idle (list view) | < 200 MB | 500 MB |
| Viewing single image | < 500 MB | 1 GB |
| Processing large file | < 2 GB | 4 GB |

---

## 9. Security Requirements

### 9.1 Data Protection

| ID | Requirement | Priority |
|----|-------------|----------|
| SR-9.1.1 | All data stored locally, no cloud transmission | Must |
| SR-9.1.2 | No telemetry or usage tracking | Must |
| SR-9.1.3 | No authentication required (local app) | Must |
| SR-9.1.4 | File checksums to verify integrity | Should |

### 9.2 Network Security

| ID | Requirement | Priority |
|----|-------------|----------|
| SR-9.2.1 | HTTPS only for MAST connections | Must |
| SR-9.2.2 | Certificate validation for all connections | Must |
| SR-9.2.3 | No execution of remote code | Must |
| SR-9.2.4 | Sanitize all file paths to prevent traversal | Must |

### 9.3 Input Validation

| ID | Requirement | Priority |
|----|-------------|----------|
| SR-9.3.1 | Validate FITS file headers before parsing | Must |
| SR-9.3.2 | Sanitize search inputs before MAST queries | Must |
| SR-9.3.3 | Validate all user inputs | Must |
| SR-9.3.4 | Handle malformed data gracefully | Must |

---

## 10. Technology Recommendations

### 10.1 Recommended Stack (Tauri + Sidecar)

This approach maximizes code reuse and minimizes rewrite effort.

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Shell** | Tauri 2.0 | Native installers, small bundle, secure |
| **Frontend** | React + TypeScript | Reuse existing code |
| **Build** | Vite | Already in use |
| **Backend** | .NET 8+ (sidecar) | Reuse existing API code |
| **Processing** | Python (sidecar) | Reuse existing engine |
| **Database** | SQLite + LiteDB | Embedded, no server |
| **FITS** | astropy (Python) | Industry standard |

**Bundle Size Estimate:** ~250 MB

### 10.2 Alternative: Full Rust Rewrite

Higher effort but smaller bundle and single process.

| Layer | Technology |
|-------|------------|
| Shell + Backend | Tauri 2.0 (Rust) |
| Frontend | React + TypeScript |
| Database | SQLite (rusqlite) |
| FITS | fitsio-rs or cfitsio bindings |
| MAST | reqwest + custom client |

**Bundle Size Estimate:** ~80 MB

### 10.3 Alternative: Electron

Proven approach, larger bundle.

| Layer | Technology |
|-------|------------|
| Shell | Electron |
| Frontend | React + TypeScript |
| Backend | Node.js or .NET sidecar |
| Database | SQLite (better-sqlite3) |

**Bundle Size Estimate:** ~180 MB

### 10.4 Database Migration

**From MongoDB to SQLite/LiteDB:**

Key schema changes:
1. Flatten nested metadata into columns or JSON fields
2. Add explicit foreign keys for relationships
3. Create indexes for common queries

**LiteDB (Recommended for .NET):**
- Document database like MongoDB
- Minimal schema changes required
- Single file storage
- LINQ query support

```csharp
// MongoDB
_collection.Find(x => x.DataType == "image").ToList();

// LiteDB (almost identical)
_collection.Find(x => x.DataType == "image").ToList();
```

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **FITS** | Flexible Image Transport System - standard astronomical data format |
| **MAST** | Mikulski Archive for Space Telescopes (STScI) |
| **STScI** | Space Telescope Science Institute |
| **WCS** | World Coordinate System - maps pixels to sky coordinates |
| **MJD** | Modified Julian Date - astronomical time format |
| **Calibration Level** | Processing stage (0=raw to 4=science-ready) |
| **NIRCam** | Near Infrared Camera (JWST instrument) |
| **MIRI** | Mid-Infrared Instrument (JWST instrument) |
| **NIRSpec** | Near Infrared Spectrograph (JWST instrument) |
| **NIRISS** | Near Infrared Imager and Slitless Spectrograph |

---

## Appendix B: File Format Reference

### FITS Header Keywords

| Keyword | Description | Example |
|---------|-------------|---------|
| SIMPLE | Conforms to FITS standard | T |
| BITPIX | Bits per pixel | -32 (32-bit float) |
| NAXIS | Number of axes | 2 |
| NAXIS1 | Width in pixels | 2048 |
| NAXIS2 | Height in pixels | 2048 |
| TELESCOP | Telescope name | JWST |
| INSTRUME | Instrument name | NIRCAM |
| FILTER | Filter used | F200W |
| EXPTIME | Exposure time (s) | 120.0 |
| DATE-OBS | Observation date | 2022-06-12T15:30:00 |
| CRVAL1 | RA at reference pixel | 161.2650 |
| CRVAL2 | Dec at reference pixel | -59.5483 |

---

---

## Keeping This Document In Sync

This document is a **living specification** that stays synchronized with the web application implementation. It is integrated into the project's workflow system.

### When to Update

This document should be updated whenever:

| Change Type | Action Required |
|-------------|-----------------|
| New feature added | Add new FR-* requirement(s) in appropriate section |
| Feature behavior changed | Update existing FR-* requirement(s) |
| New data model field | Update Section 5 (Data Models) |
| New API endpoint | Consider if it implies new functionality to document |
| Bug fix changes behavior | Update FR-* if documented behavior was incorrect |
| UI change | Update Section 6 (UI Requirements) |

### How to Update

1. **Find the relevant section** - Requirements are organized by functional area (Import, Management, Visualization, etc.)

2. **Use consistent ID format**:
   - `FR-X.Y.Z` for functional requirements (e.g., `FR-4.1.2.15`)
   - Increment the last number for new requirements in a section

3. **Include priority**: `Must` | `Should` | `Could`

4. **Keep descriptions platform-agnostic** - Describe *what* not *how*. Avoid web-specific terms like "HTTP endpoint" or "React component".

### Example Update

If adding a new "batch rename" feature to the web app:

```markdown
<!-- Add to Section 4.2.3 Bulk Operations -->

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.2.3.9 | Batch rename files with pattern matching | Could |
```

### Workflow Integration

This document should be reviewed in every PR that changes product behavior:

- Feature changes: add/update FR-* requirements as needed
- Bug fixes: update FR-* wording when behavior changes
- Refactors: verify existing FR-* requirements still describe actual behavior

See `AGENTS.md` for shared workflow policy (branch + PR for all changes).

### Validation

Before major releases or when starting desktop development, validate this document against the actual web implementation by reviewing:

1. User-facing API behavior in `docs/quick-reference.md` has corresponding FR-* requirements
2. All UI components match Section 6 layouts
3. Data models in Section 5 match TypeScript types and C# models

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-02-03 | Claude | Initial requirements document - captured from existing web implementation |
