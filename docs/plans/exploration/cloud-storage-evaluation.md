# Cloud Storage Evaluation for JWST Data Analysis

## Context

This document evaluates cloud storage options for the JWST Data Analysis platform, which currently uses local filesystem storage at `/app/data/mast/` with MongoDB for metadata. The goal is to identify the best storage backend for cloud deployment.

### Current Data Characteristics

| Property | Value |
|----------|-------|
| Primary format | FITS files (2D images, 3D cubes, multi-HDU) |
| Typical file size | 1-500 MB per FITS file |
| Access pattern | Write-once, read-many (download from MAST, then analyze) |
| Read style | Memory-mapped, HDU random access, byte-range reads |
| Write style | Chunked downloads (5 MB chunks), atomic rename on completion |
| Metadata store | MongoDB (separate from file storage) |
| Processing model | Sequential pipeline with optional intermediate results |

### JWST Data Lifecycle

```
Raw (_uncal) --> Calibrated (_rate, _cal) --> Combined (_i2d, _s2d, _x1d)
  [cold]            [warm]                       [hot]
```

Files move from frequently accessed during processing to rarely accessed once analysis is complete. This lifecycle maps naturally to tiered storage.

---

## Options Evaluated

### 1. Amazon S3

**Fit: Strong**

| Aspect | Assessment |
|--------|------------|
| Ecosystem alignment | STScI hosts JWST public data on S3 (`s3://stpubdata/`). Using S3 enables direct cloud-to-cloud access, potentially eliminating the MAST download pipeline entirely for public data. |
| Access pattern support | S3 byte-range GET requests support HDU-level random access. `astropy.io.fits` works with `fsspec`/`s3fs` for lazy access without full file downloads. |
| Tiered storage | S3 Intelligent-Tiering, Glacier, and lifecycle rules map directly to the raw-to-processed data lifecycle. |
| Cost (us-east-1) | ~$0.023/GB/month (Standard), ~$0.0125/GB/month (Infrequent Access), ~$0.004/GB/month (Glacier) |
| Python SDK | `boto3` is mature and widely used. `s3fs` provides filesystem-like interface. |
| .NET SDK | `AWSSDK.S3` — well-supported, but not as natural as Azure for .NET. |

**Key advantage**: Direct access to STScI's public JWST data on S3 without HTTP download overhead.

### 2. Azure Blob Storage

**Fit: Strong**

| Aspect | Assessment |
|--------|------------|
| Tiering | Hot/Cool/Cold/Archive tiers with automatic tiering policies. Good match for data lifecycle. |
| .NET integration | First-class SDK (`Azure.Storage.Blobs`). Natural fit for the .NET backend. |
| Access pattern support | Supports byte-range reads. `adlfs` provides fsspec-compatible interface for Python. |
| Cost (East US) | ~$0.018/GB/month (Hot), ~$0.01/GB/month (Cool), ~$0.002/GB/month (Archive) |
| Python SDK | `azure-storage-blob` + `adlfs` for fsspec integration. |
| Astronomy ecosystem | Less astronomy community adoption than S3. No direct MAST integration. |

**Key advantage**: If deploying to Azure, the .NET backend gets the most natural SDK experience and authentication story (Managed Identity).

### 3. Google Cloud Storage

**Fit: Moderate**

| Aspect | Assessment |
|--------|------------|
| Storage classes | Standard/Nearline/Coldline/Archive with lifecycle management. |
| Analytics integration | Strong BigQuery integration if metadata analytics become important. |
| Cost | ~$0.020/GB/month (Standard), ~$0.010/GB/month (Nearline) |
| Python SDK | `gcsfs` for fsspec integration. |
| Astronomy ecosystem | Least adoption in the astronomy community. No MAST S3-compatible access. |

**Key advantage**: Best option if the deployment target is GCP or if BigQuery-based metadata analytics are planned.

### 4. MinIO (S3-Compatible, Self-Hosted)

**Fit: Strong for hybrid/on-prem**

| Aspect | Assessment |
|--------|------------|
| API compatibility | Full S3 API — all S3 tooling (`boto3`, `s3fs`, `fsspec`) works without modification. |
| Deployment flexibility | Runs on-prem, in any cloud, or alongside existing Docker Compose stack. |
| Vendor lock-in | None. Can migrate to/from any S3-compatible service. |
| Cost | Infrastructure cost only (no per-GB cloud charges). |
| Overhead | You manage the infrastructure, replication, and backups. |

**Key advantage**: Preserves the local-first, privacy-conscious philosophy while providing S3 API compatibility. Good stepping stone — develop against S3 API locally, deploy to any S3-compatible service in production.

### 5. Direct MAST Cloud Access (S3 Public Buckets)

**Fit: Complementary**

| Aspect | Assessment |
|--------|------------|
| Approach | Read JWST data directly from STScI's S3 buckets instead of downloading. |
| Implementation | `astroquery` supports cloud access via `enable_cloud_dataset()`. |
| Latency | Higher per-read latency vs. local, but eliminates download wait entirely. |
| Cost | Free egress from same-region S3 (us-east-1). |
| Limitation | Read-only. Still need separate storage for processed outputs. |

**Key advantage**: Eliminates the download pipeline for public JWST data. Best used alongside one of the above options for storing processed results.

---

## Recommendation

### Primary: S3 or S3-Compatible Storage

S3 is the recommended storage backend for three reasons:

1. **Astronomy ecosystem convergence** — STScI serves JWST data from S3. Using S3 enables direct cloud-to-cloud reads, potentially bypassing the chunked download system entirely for public observations.

2. **Access pattern alignment** — The write-once, read-many pattern with large binary files is the exact use case object storage is designed for. Byte-range GET requests address the HDU random-access requirement.

3. **Tiered storage for data lifecycle** — Raw FITS files (`_uncal`) are rarely accessed after calibration. Lifecycle policies can automatically transition them to cheaper tiers without application changes.

### Implementation Strategy

#### Phase 1: Abstract file access with `fsspec`

Add a storage abstraction using `fsspec`, which provides a unified filesystem interface across local, S3, Azure, and GCP backends. This avoids hard-coding any provider.

```python
# requirements.txt additions
fsspec>=2024.0.0
s3fs>=2024.0.0        # for S3/MinIO
# adlfs>=2024.0.0     # for Azure (if needed)

# Usage - same code works for local and cloud
import fsspec

fs = fsspec.filesystem('s3', anon=False)  # or 'file' for local
with fs.open('bucket/path/to/file.fits', 'rb') as f:
    hdul = fits.open(f)
```

#### Phase 2: Configure storage backend via environment

```env
# .env
STORAGE_BACKEND=s3              # or "local", "azure", "gcs"
STORAGE_BUCKET=jwst-analysis
STORAGE_PREFIX=data/mast
AWS_REGION=us-east-1

# For MinIO (local development)
STORAGE_BACKEND=s3
S3_ENDPOINT_URL=http://minio:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
```

#### Phase 3: Enable direct MAST cloud access

```python
from astroquery.mast import Observations
Observations.enable_cloud_dataset()
# Downloads now pull from S3 instead of MAST HTTP when available
```

#### Phase 4: Add lifecycle policies

```json
{
  "Rules": [
    {
      "ID": "archive-raw-data",
      "Filter": { "Prefix": "data/mast/", "Tag": { "Key": "processing_level", "Value": "raw" } },
      "Transitions": [
        { "Days": 30, "StorageClass": "STANDARD_IA" },
        { "Days": 90, "StorageClass": "GLACIER" }
      ]
    }
  ]
}
```

### If deploying to Azure specifically

Replace S3 with Azure Blob Storage. The `fsspec` + `adlfs` approach keeps the Python code identical. The .NET backend benefits from `Azure.Storage.Blobs` SDK and Managed Identity authentication.

---

## Cost Estimates (100 GB of FITS data)

| Provider | Hot | Warm | Cold | Egress (10 GB/month) |
|----------|-----|------|------|----------------------|
| S3 | $2.30/mo | $1.25/mo | $0.40/mo | $0.90/mo |
| Azure Blob | $1.80/mo | $1.00/mo | $0.20/mo | $0.87/mo |
| GCS | $2.00/mo | $1.00/mo | $0.40/mo | $1.20/mo |
| MinIO | Infra only | — | — | — |

At typical research volumes (100 GB - 1 TB), cloud storage costs are negligible compared to compute costs for image processing.

---

## Decision Matrix

| Criterion | Weight | S3 | Azure Blob | GCS | MinIO |
|-----------|--------|----|-----------:|-----|-------|
| JWST ecosystem fit | High | 5 | 3 | 2 | 4 |
| fsspec/Python support | High | 5 | 4 | 4 | 5 |
| .NET SDK quality | Medium | 4 | 5 | 3 | 4 |
| Tiered storage | Medium | 5 | 5 | 4 | 2 |
| Vendor independence | Medium | 3 | 3 | 3 | 5 |
| Operational simplicity | Medium | 5 | 4 | 4 | 2 |
| Cost efficiency | Low | 4 | 4 | 4 | 5 |
| **Weighted total** | | **4.4** | **3.9** | **3.3** | **3.7** |

Scores: 1 (poor) to 5 (excellent).
