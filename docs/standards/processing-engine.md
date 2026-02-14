# Processing Engine Standards

## Overview

The processing engine is a Python FastAPI service responsible for scientific computations, MAST Portal integration, and FITS file handling.

## Architecture

```text
processing-engine/
├── main.py                      # FastAPI application entry point
├── requirements.txt             # Python dependencies
└── app/
    ├── mast/                    # MAST Portal integration
    │   ├── mast_service.py      # astroquery.mast wrapper
    │   ├── routes.py            # FastAPI endpoints
    │   ├── models.py            # Pydantic models
    │   ├── chunked_downloader.py    # HTTP Range download support
    │   ├── download_state_manager.py # Resume state persistence
    │   └── download_tracker.py      # Progress tracking
    └── processing/              # Scientific algorithms
        ├── analysis.py          # Analysis algorithms
        └── utils.py             # FITS utilities
```text

## Key Files

| File                                 | Purpose                                               |
| ------------------------------------ | ----------------------------------------------------- |
| `main.py`                            | FastAPI application entry, algorithm registration     |
| `app/mast/mast_service.py`           | MastService class wrapping astroquery.mast            |
| `app/mast/routes.py`                 | MAST search, download, and chunked download endpoints |
| `app/mast/chunked_downloader.py`     | Async HTTP downloads with Range headers               |
| `app/mast/download_state_manager.py` | JSON state files for resume capability                |
| `app/mast/download_tracker.py`       | Byte-level progress tracking                          |

## MAST Module

### Search Endpoints

- `POST /mast/search/target` - Search by astronomical target name
- `POST /mast/search/coordinates` - Search by RA/Dec coordinates
- `POST /mast/search/observation` - Search by observation ID
- `POST /mast/search/program` - Search by program ID

### Download Endpoints

- `POST /mast/download/start` - Start async download job
- `POST /mast/download/start-chunked` - Start chunked download with progress
- `GET /mast/download/progress/{job_id}` - Get download progress
- `POST /mast/download/resume/{job_id}` - Resume interrupted download
- `POST /mast/download/pause/{job_id}` - Pause active download
- `GET /mast/download/resumable` - List resumable jobs

### Chunked Download Features

- **HTTP Range Headers**: Downloads in 5MB chunks for reliability
- **Parallel Downloads**: 3 concurrent file downloads using asyncio
- **Progress Tracking**: Byte-level progress with speed (B/s) and ETA
- **State Persistence**: JSON files in `/app/data/mast/.download_state/`
- **Resume Capability**: Continue from last successful byte position
- **Retry Logic**: Exponential backoff (3 retries, 1s base delay)

### Configuration

```python
CHUNK_SIZE = 5 * 1024 * 1024      # 5MB chunks
MAX_CONCURRENT_FILES = 3          # Parallel file downloads
MAX_RETRIES = 3                   # Retry failed chunks
RETRY_BASE_DELAY = 1.0            # Exponential backoff base
STATE_RETENTION_DAYS = 7          # Auto-cleanup old state
```text

## Coding Standards

### Style Guide

- Follow PEP 8 style guide
- Use type hints for all functions
- Document complex algorithms with docstrings
- Use Pydantic models for request/response validation

### Async Patterns

```python
# Use async for I/O operations
async def download_file(url: str, path: str) -> None:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            # Process response...

# Use asyncio.gather for parallel operations
results = await asyncio.gather(
    download_file(url1, path1),
    download_file(url2, path2),
    download_file(url3, path3),
)
```text

### Error Handling

```python
# Use specific exception types
class DownloadError(Exception):
    pass

class ResumeError(Exception):
    pass

# Handle errors gracefully
try:
    await download_with_retry(url, path)
except aiohttp.ClientError as e:
    logger.error(f"Download failed: {e}")
    raise DownloadError(f"Failed to download {url}")
```text

### Progress Reporting

```python
# Report progress via callback
def progress_callback(
    downloaded_bytes: int,
    total_bytes: int,
    speed_bytes_per_sec: float,
    eta_seconds: Optional[float]
) -> None:
    percent = (downloaded_bytes / total_bytes) * 100
    logger.info(f"Progress: {percent:.1f}% at {speed_bytes_per_sec/1e6:.2f} MB/s")
```text

## Dependencies

Key packages in `requirements.txt`:

```text
fastapi>=0.100.0          # Web framework
uvicorn>=0.24.0           # ASGI server
astroquery>=0.4.7         # MAST Portal queries
astropy>=5.3              # FITS file handling
numpy>=1.24.0             # Numerical operations
scipy>=1.11.0             # Scientific computing
aiohttp>=3.9.0            # Async HTTP client
aiofiles>=23.2.0          # Async file operations
pydantic>=2.0.0           # Data validation
```text

## Testing

```bash
# Run tests
pytest

# Run with coverage
pytest --cov=app

# Run specific test file
pytest tests/test_mast.py
```text

## Docker

The processing engine runs in Docker with shared volumes:

```yaml
processing-engine:
  build: ../processing-engine
  volumes:
    - ../data:/app/data        # Shared data directory
  environment:
    - PYTHONUNBUFFERED=1
  ports:
    - "8000:8000"
```

Downloaded FITS files are stored in `/app/data/mast/{obs_id}/`.
