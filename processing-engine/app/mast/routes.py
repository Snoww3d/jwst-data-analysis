"""
FastAPI routes for MAST portal integration.
Includes chunked download support with progress tracking and resume capability.
"""

import asyncio
import logging
import os
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException

from .chunked_downloader import ChunkedDownloader, DownloadJobState, SpeedTracker
from .download_state_manager import DownloadStateManager
from .download_tracker import DownloadStage, FileProgress, download_tracker
from .mast_service import MastService
from .models import (
    ChunkedDownloadProgressResponse,
    ChunkedDownloadRequest,
    FileProgressResponse,
    MastCoordinateSearchRequest,
    MastDataProductsRequest,
    MastDataProductsResponse,
    MastDownloadRequest,
    MastDownloadResponse,
    MastObservationSearchRequest,
    MastProgramSearchRequest,
    MastRecentReleasesRequest,
    MastSearchResponse,
    MastTargetSearchRequest,
    PauseResumeResponse,
    ResumableJobsResponse,
    ResumableJobSummary,
    S3DownloadRequest,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mast", tags=["MAST"])

# Initialize service with configurable download directory
download_dir = os.environ.get("MAST_DOWNLOAD_DIR", os.path.join(os.getcwd(), "data", "mast"))
mast_service = MastService(download_dir=download_dir)

# Initialize state manager for resume capability
state_manager = DownloadStateManager(download_dir)

# Track active chunked downloaders by job_id
_active_downloaders: dict[str, ChunkedDownloader] = {}
_speed_trackers: dict[str, SpeedTracker] = {}

# Guard against concurrent resume requests for the same job
_resuming_jobs: set[str] = set()
_resume_lock = asyncio.Lock()

# Configurable timeout for MAST searches (default 2 minutes)
MAST_SEARCH_TIMEOUT = int(os.environ.get("MAST_SEARCH_TIMEOUT", "120"))

# Simple in-memory cache for recent releases (5 minute TTL)
_recent_releases_cache: dict[str, tuple[float, dict]] = {}
RECENT_RELEASES_CACHE_TTL = 300  # 5 minutes in seconds


def _get_cache_key(days_back: int, instrument: str | None, limit: int, offset: int) -> str:
    """Generate a cache key for recent releases requests."""
    return f"{days_back}:{instrument or 'all'}:{limit}:{offset}"


def _get_from_cache(cache_key: str) -> dict | None:
    """Get cached response if still valid."""
    if cache_key in _recent_releases_cache:
        cached_time, cached_data = _recent_releases_cache[cache_key]
        if time.time() - cached_time < RECENT_RELEASES_CACHE_TTL:
            return cached_data
        else:
            # Expired, remove from cache
            del _recent_releases_cache[cache_key]
    return None


def _set_cache(cache_key: str, data: dict) -> None:
    """Store response in cache."""
    _recent_releases_cache[cache_key] = (time.time(), data)
    # Clean up old cache entries (keep cache size reasonable)
    if len(_recent_releases_cache) > 100:
        # Remove oldest entries
        sorted_keys = sorted(
            _recent_releases_cache.keys(), key=lambda k: _recent_releases_cache[k][0]
        )
        for old_key in sorted_keys[:50]:
            del _recent_releases_cache[old_key]


@router.post("/search/target", response_model=MastSearchResponse)
async def search_by_target(request: MastTargetSearchRequest):
    """Search MAST by target name (e.g., 'NGC 1234', 'Carina Nebula')."""
    try:
        # Run synchronous MAST call in thread pool with timeout
        results = await asyncio.wait_for(
            asyncio.to_thread(
                mast_service.search_by_target,
                target_name=request.target_name,
                radius=request.radius,
                _filters=request.filters,
                calib_level=request.calib_level,
            ),
            timeout=MAST_SEARCH_TIMEOUT,
        )
        return MastSearchResponse(
            search_type="target",
            query_params={
                "target_name": request.target_name,
                "radius": request.radius,
                "calib_level": request.calib_level,
            },
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat(),
        )
    except asyncio.TimeoutError:
        logger.error(
            f"Target search timed out after {MAST_SEARCH_TIMEOUT}s for: {request.target_name}"
        )
        raise HTTPException(
            status_code=504,
            detail=f"MAST search timed out after {MAST_SEARCH_TIMEOUT} seconds. Try a smaller search radius or more specific target name.",
        ) from None
    except Exception as e:
        logger.error(f"Target search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/search/coordinates", response_model=MastSearchResponse)
async def search_by_coordinates(request: MastCoordinateSearchRequest):
    """Search MAST by RA/Dec coordinates."""
    try:
        # Run synchronous MAST call in thread pool with timeout
        results = await asyncio.wait_for(
            asyncio.to_thread(
                mast_service.search_by_coordinates,
                ra=request.ra,
                dec=request.dec,
                radius=request.radius,
                calib_level=request.calib_level,
            ),
            timeout=MAST_SEARCH_TIMEOUT,
        )
        return MastSearchResponse(
            search_type="coordinates",
            query_params={
                "ra": request.ra,
                "dec": request.dec,
                "radius": request.radius,
                "calib_level": request.calib_level,
            },
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat(),
        )
    except asyncio.TimeoutError:
        logger.error(
            f"Coordinate search timed out after {MAST_SEARCH_TIMEOUT}s for RA={request.ra}, Dec={request.dec}"
        )
        raise HTTPException(
            status_code=504,
            detail=f"MAST search timed out after {MAST_SEARCH_TIMEOUT} seconds. Try a smaller search radius.",
        ) from None
    except Exception as e:
        logger.error(f"Coordinate search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/search/observation", response_model=MastSearchResponse)
async def search_by_observation_id(request: MastObservationSearchRequest):
    """Search MAST by observation ID."""
    try:
        # Run synchronous MAST call in thread pool with timeout
        results = await asyncio.wait_for(
            asyncio.to_thread(
                mast_service.search_by_observation_id,
                obs_id=request.obs_id,
                calib_level=request.calib_level,
            ),
            timeout=MAST_SEARCH_TIMEOUT,
        )
        return MastSearchResponse(
            search_type="observation_id",
            query_params={"obs_id": request.obs_id, "calib_level": request.calib_level},
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat(),
        )
    except asyncio.TimeoutError:
        logger.error(
            f"Observation ID search timed out after {MAST_SEARCH_TIMEOUT}s for: {request.obs_id}"
        )
        raise HTTPException(
            status_code=504, detail=f"MAST search timed out after {MAST_SEARCH_TIMEOUT} seconds."
        ) from None
    except Exception as e:
        logger.error(f"Observation ID search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/search/program", response_model=MastSearchResponse)
async def search_by_program_id(request: MastProgramSearchRequest):
    """Search MAST by program/proposal ID."""
    try:
        # Run synchronous MAST call in thread pool with timeout
        results = await asyncio.wait_for(
            asyncio.to_thread(
                mast_service.search_by_program_id,
                program_id=request.program_id,
                calib_level=request.calib_level,
            ),
            timeout=MAST_SEARCH_TIMEOUT,
        )
        return MastSearchResponse(
            search_type="program_id",
            query_params={"program_id": request.program_id, "calib_level": request.calib_level},
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat(),
        )
    except asyncio.TimeoutError:
        logger.error(
            f"Program ID search timed out after {MAST_SEARCH_TIMEOUT}s for: {request.program_id}"
        )
        raise HTTPException(
            status_code=504, detail=f"MAST search timed out after {MAST_SEARCH_TIMEOUT} seconds."
        ) from None
    except Exception as e:
        logger.error(f"Program ID search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/search/recent", response_model=MastSearchResponse)
async def search_recent_releases(request: MastRecentReleasesRequest):
    """
    Search MAST for JWST observations recently released to the public.
    Results are cached for 5 minutes to reduce load on MAST API.
    """
    try:
        # Check cache first
        cache_key = _get_cache_key(
            request.days_back, request.instrument, request.limit, request.offset
        )
        cached = _get_from_cache(cache_key)
        if cached:
            logger.info(f"Returning cached recent releases for key: {cache_key}")
            return MastSearchResponse(**cached)

        # Run synchronous MAST call in thread pool with timeout
        results = await asyncio.wait_for(
            asyncio.to_thread(
                mast_service.search_recent_releases,
                days_back=request.days_back,
                instrument=request.instrument,
                limit=request.limit,
                offset=request.offset,
            ),
            timeout=MAST_SEARCH_TIMEOUT,
        )

        response_data = {
            "search_type": "recent_releases",
            "query_params": {
                "days_back": request.days_back,
                "instrument": request.instrument,
                "limit": request.limit,
                "offset": request.offset,
            },
            "results": results,
            "result_count": len(results),
            "timestamp": datetime.utcnow().isoformat(),
        }

        # Cache the response
        _set_cache(cache_key, response_data)

        return MastSearchResponse(**response_data)
    except asyncio.TimeoutError:
        logger.error(f"Recent releases search timed out after {MAST_SEARCH_TIMEOUT}s")
        raise HTTPException(
            status_code=504, detail=f"MAST search timed out after {MAST_SEARCH_TIMEOUT} seconds."
        ) from None
    except Exception as e:
        logger.error(f"Recent releases search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/products", response_model=MastDataProductsResponse)
async def get_data_products(request: MastDataProductsRequest):
    """Get available data products for an observation."""
    try:
        # Run synchronous MAST call in thread pool with timeout
        products = await asyncio.wait_for(
            asyncio.to_thread(mast_service.get_data_products, obs_id=request.obs_id),
            timeout=MAST_SEARCH_TIMEOUT,
        )
        return MastDataProductsResponse(
            obs_id=request.obs_id, products=products, product_count=len(products)
        )
    except asyncio.TimeoutError:
        logger.error(f"Get products timed out after {MAST_SEARCH_TIMEOUT}s for: {request.obs_id}")
        raise HTTPException(
            status_code=504, detail=f"Request timed out after {MAST_SEARCH_TIMEOUT} seconds."
        ) from None
    except Exception as e:
        logger.error(f"Get products failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


# Longer timeout for downloads (default 10 minutes)
MAST_DOWNLOAD_TIMEOUT = int(os.environ.get("MAST_DOWNLOAD_TIMEOUT", "600"))


@router.post("/download", response_model=MastDownloadResponse)
async def download_observation(request: MastDownloadRequest):
    """Download FITS files for an observation."""
    try:
        # Run synchronous MAST download in thread pool with longer timeout
        if request.product_id:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    mast_service.download_product,
                    product_id=request.product_id,
                    obs_id=request.obs_id,
                ),
                timeout=MAST_DOWNLOAD_TIMEOUT,
            )
        else:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    mast_service.download_observation,
                    obs_id=request.obs_id,
                    product_type=request.product_type,
                ),
                timeout=MAST_DOWNLOAD_TIMEOUT,
            )

        return MastDownloadResponse(
            status=result.get("status", "unknown"),
            obs_id=request.obs_id,
            files=result.get("files", []),
            file_count=len(result.get("files", [])),
            download_dir=result.get("download_dir"),
            error=result.get("error"),
            timestamp=result.get("timestamp", datetime.utcnow().isoformat()),
        )
    except asyncio.TimeoutError:
        logger.error(f"Download timed out after {MAST_DOWNLOAD_TIMEOUT}s for: {request.obs_id}")
        raise HTTPException(
            status_code=504,
            detail=f"Download timed out after {MAST_DOWNLOAD_TIMEOUT} seconds. The files may be very large.",
        ) from None
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


# === Async Download Endpoints ===


@router.post("/download/start")
async def start_async_download(request: MastDownloadRequest):
    """
    Start an asynchronous download job. Returns immediately with a job ID.
    Use /download/progress/{job_id} to check status.
    """
    job_id = download_tracker.create_job(request.obs_id)

    # Start download in background
    asyncio.create_task(
        _run_download_job(job_id, request.obs_id, request.product_type or "SCIENCE")
    )

    return {"job_id": job_id, "obs_id": request.obs_id, "message": "Download started"}


@router.get("/download/progress/{job_id}")
async def get_download_progress(job_id: str):
    """Get the progress of an async download job."""
    job = download_tracker.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job.to_dict()


async def _run_download_job(job_id: str, obs_id: str, product_type: str):
    """Background task to run the download with progress updates."""
    try:
        download_tracker.update_stage(
            job_id, DownloadStage.FETCHING_PRODUCTS, "Fetching product list from MAST..."
        )

        # Get product count first (run in thread to not block)
        product_count = await asyncio.to_thread(
            mast_service.get_product_count, obs_id, product_type
        )

        if product_count == 0:
            download_tracker.update_stage(job_id, DownloadStage.COMPLETE, "No files to download")
            download_tracker.complete_job(job_id, "")
            return

        download_tracker.set_total_files(job_id, product_count)
        download_tracker.update_stage(
            job_id, DownloadStage.DOWNLOADING, f"Downloading {product_count} files..."
        )

        # Progress callback
        def on_progress(filename: str, current: int, total: int):
            download_tracker.update_file_progress(job_id, filename, current)

        # Run download in thread pool
        result = await asyncio.to_thread(
            mast_service.download_observation_with_progress, obs_id, product_type, on_progress
        )

        if result["status"] == "completed":
            # Add all files to tracker
            for filepath in result.get("files", []):
                download_tracker.add_completed_file(job_id, filepath)
            download_tracker.complete_job(job_id, result.get("download_dir", ""))
        else:
            download_tracker.fail_job(job_id, result.get("error", "Unknown error"))

    except Exception as e:
        logger.error(f"Download job {job_id} failed: {e}")
        download_tracker.fail_job(job_id, str(e))


# === Chunked Download Endpoints ===


@router.post("/download/start-chunked")
async def start_chunked_download(request: ChunkedDownloadRequest):
    """
    Start a chunked download job with byte-level progress tracking.
    Returns immediately with a job ID for progress polling.
    Supports resume via resume_job_id parameter.
    """
    # Check if resuming an existing job
    if request.resume_job_id:
        existing_state = state_manager.load_job_state(request.resume_job_id)
        if existing_state and existing_state.status in ("paused", "failed", "downloading"):
            job_id = request.resume_job_id

            # Prevent concurrent resume of the same job
            async with _resume_lock:
                if job_id in _resuming_jobs:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Job {job_id} is already being resumed",
                    )
                _resuming_jobs.add(job_id)

            # Re-register the job in tracker
            download_tracker.create_job(existing_state.obs_id, job_id)
            # Start resume in background
            asyncio.create_task(
                _run_chunked_download_job(
                    job_id,
                    existing_state.obs_id,
                    request.product_type,
                    calib_level=request.calib_level,
                    resume_state=existing_state,
                )
            )
            return {
                "job_id": job_id,
                "obs_id": existing_state.obs_id,
                "message": "Download resumed",
                "is_resume": True,
            }

    # New download
    job_id = download_tracker.create_job(request.obs_id)

    # Start download in background
    asyncio.create_task(
        _run_chunked_download_job(
            job_id, request.obs_id, request.product_type, calib_level=request.calib_level
        )
    )

    return {
        "job_id": job_id,
        "obs_id": request.obs_id,
        "message": "Chunked download started",
        "is_resume": False,
    }


@router.post("/download/resume/{job_id}")
async def resume_download(job_id: str):
    """Resume a paused or failed download job."""
    # Load state from disk
    existing_state = state_manager.load_job_state(job_id)
    if not existing_state:
        raise HTTPException(status_code=404, detail=f"No resumable state found for job {job_id}")

    if existing_state.status not in ("paused", "failed", "downloading"):
        raise HTTPException(
            status_code=400,
            detail=f"Job {job_id} is not resumable (status: {existing_state.status})",
        )

    # Prevent concurrent resume of the same job
    async with _resume_lock:
        if job_id in _resuming_jobs:
            raise HTTPException(
                status_code=409,
                detail=f"Job {job_id} is already being resumed",
            )
        _resuming_jobs.add(job_id)

    # Re-register the job in tracker with saved progress
    download_tracker.create_job(existing_state.obs_id, job_id)
    job = download_tracker.get_job(job_id)
    if job and existing_state.files:
        job.total_bytes = existing_state.total_bytes
        job.downloaded_bytes = existing_state.downloaded_bytes
        job.total_files = len(existing_state.files)
        job.downloaded_files = sum(1 for f in existing_state.files if f.status == "complete")
        job.stage = DownloadStage.DOWNLOADING
        job.message = "Resuming download..."

    # Start resume in background
    asyncio.create_task(
        _run_chunked_download_job(
            job_id, existing_state.obs_id, "SCIENCE", resume_state=existing_state
        )
    )

    return PauseResumeResponse(job_id=job_id, status="resuming", message="Download resumed")


@router.post("/download/pause/{job_id}")
async def pause_download(job_id: str):
    """Pause an active download job."""
    downloader = _active_downloaders.get(job_id)
    if not downloader:
        raise HTTPException(status_code=404, detail=f"No active download for job {job_id}")

    downloader.pause()
    download_tracker.pause_job(job_id)

    return PauseResumeResponse(job_id=job_id, status="paused", message="Download paused")


@router.post("/download/cancel/{job_id}")
async def cancel_download(job_id: str):
    """Cancel an active download job and clean up its state."""
    downloader = _active_downloaders.get(job_id)

    if downloader:
        # Active download - cancel it
        downloader.cancel()
        download_tracker.fail_job(job_id, "Download cancelled by user", is_resumable=False)

        # Update state file to cancelled status
        existing_state = state_manager.load_job_state(job_id)
        if existing_state:
            existing_state.status = "cancelled"
            existing_state.error = "Cancelled by user"
            state_manager.save_job_state(existing_state)

        return PauseResumeResponse(job_id=job_id, status="cancelled", message="Download cancelled")
    else:
        # Not active - check if we have a state file to mark as cancelled
        existing_state = state_manager.load_job_state(job_id)
        if existing_state:
            existing_state.status = "cancelled"
            existing_state.error = "Cancelled by user"
            state_manager.save_job_state(existing_state)

            return PauseResumeResponse(
                job_id=job_id, status="cancelled", message="Download marked as cancelled"
            )

        raise HTTPException(status_code=404, detail=f"No download found for job {job_id}")


@router.get("/download/resumable")
async def list_resumable_downloads():
    """List all downloads that can be resumed."""
    jobs = state_manager.get_resumable_jobs()
    return ResumableJobsResponse(jobs=[ResumableJobSummary(**j) for j in jobs], count=len(jobs))


@router.delete("/download/resumable/{job_id}")
async def dismiss_resumable_download(job_id: str, delete_files: bool = False):
    """Dismiss a resumable download job, optionally deleting downloaded files."""
    state = state_manager.load_job_state(job_id)
    if not state:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    deleted_files = []
    if delete_files and state.files:
        for f in state.files:
            if f.status == "complete" and f.local_path and os.path.exists(f.local_path):
                try:
                    os.remove(f.local_path)
                    deleted_files.append(f.local_path)
                except OSError as e:
                    logger.warning(f"Failed to delete file {f.local_path}: {e}")

    state_manager.delete_job_state(job_id)
    download_tracker.remove_job(job_id)

    return {
        "job_id": job_id,
        "dismissed": True,
        "deleted_files": len(deleted_files),
    }


@router.get("/download/progress-chunked/{job_id}")
async def get_chunked_download_progress(job_id: str):
    """Get detailed byte-level progress for a chunked download job."""
    job = download_tracker.get_job(job_id)
    if not job:
        # Try loading from state file
        state = state_manager.load_job_state(job_id)
        if state:
            return ChunkedDownloadProgressResponse(
                job_id=state.job_id,
                obs_id=state.obs_id,
                stage=state.status,
                message=f"Job {state.status} - can be resumed",
                progress=int(state.progress_percent),
                total_files=len(state.files),
                downloaded_files=sum(1 for f in state.files if f.status == "complete"),
                files=[f.local_path for f in state.files if f.status == "complete"],
                started_at=state.started_at.isoformat() if state.started_at else "",
                completed_at=state.completed_at.isoformat() if state.completed_at else None,
                download_dir=state.download_dir,
                is_complete=state.status in ("complete", "failed"),
                total_bytes=state.total_bytes,
                downloaded_bytes=state.downloaded_bytes,
                download_progress_percent=state.progress_percent,
                speed_bytes_per_sec=0.0,
                eta_seconds=None,
                file_progress=[
                    FileProgressResponse(
                        filename=f.filename,
                        total_bytes=f.total_bytes,
                        downloaded_bytes=f.downloaded_bytes,
                        progress_percent=f.progress_percent,
                        status=f.status,
                    )
                    for f in state.files
                ],
                is_resumable=state.status in ("paused", "failed", "downloading"),
            )
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    return ChunkedDownloadProgressResponse(
        job_id=job.job_id,
        obs_id=job.obs_id,
        stage=job.stage.value,
        message=job.message,
        progress=job.progress,
        total_files=job.total_files,
        downloaded_files=job.downloaded_files,
        current_file=job.current_file,
        files=job.files,
        error=job.error,
        started_at=job.started_at.isoformat(),
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        download_dir=job.download_dir,
        is_complete=job.stage in (DownloadStage.COMPLETE, DownloadStage.FAILED),
        total_bytes=job.total_bytes,
        downloaded_bytes=job.downloaded_bytes,
        download_progress_percent=job.download_progress_percent,
        speed_bytes_per_sec=job.speed_bytes_per_sec,
        eta_seconds=job.eta_seconds,
        file_progress=[
            FileProgressResponse(
                filename=fp.filename,
                total_bytes=fp.total_bytes,
                downloaded_bytes=fp.downloaded_bytes,
                progress_percent=fp.progress_percent,
                status=fp.status,
            )
            for fp in job.file_progress
        ],
        is_resumable=job.is_resumable,
    )


def _validate_obs_id(obs_id: str) -> None:
    """Validate obs_id contains only safe characters to prevent path traversal."""
    import re

    if not re.match(r"^[a-zA-Z0-9._-]+$", obs_id):
        raise ValueError(f"Invalid obs_id: {obs_id}")


async def _run_chunked_download_job(
    job_id: str,
    obs_id: str,
    product_type: str,
    calib_level: list[int] | None = None,
    resume_state: DownloadJobState = None,
):
    """Background task to run chunked download with byte-level progress."""
    _validate_obs_id(obs_id)

    downloader = ChunkedDownloader()
    _active_downloaders[job_id] = downloader
    speed_tracker = SpeedTracker()
    _speed_trackers[job_id] = speed_tracker

    try:
        download_tracker.update_stage(
            job_id, DownloadStage.FETCHING_PRODUCTS, "Fetching product information from MAST..."
        )
        download_tracker.set_resumable(job_id, True)

        # Create observation-specific download directory
        # Normalize so startswith is on the same variable flowing to makedirs
        obs_dir = os.path.normpath(os.path.join(download_dir, obs_id))
        if not obs_dir.startswith(os.path.normpath(download_dir) + os.sep):
            raise ValueError(f"Invalid obs_id for path: {obs_id}")
        os.makedirs(obs_dir, exist_ok=True)

        # Get product URLs and sizes
        if resume_state and resume_state.files:
            # Use existing file info from resume state
            files_info = [
                {"url": f.url, "filename": f.filename, "size": f.total_bytes}
                for f in resume_state.files
            ]
            job_state = resume_state
            job_state.status = "downloading"
        else:
            # Fetch fresh product info (filtered by calib_level if specified)
            products_info = await asyncio.to_thread(
                mast_service.get_products_with_urls, obs_id, product_type, calib_level
            )

            if products_info["total_files"] == 0:
                download_tracker.update_stage(
                    job_id, DownloadStage.COMPLETE, "No files to download"
                )
                download_tracker.complete_job(job_id, obs_dir)
                return

            files_info = products_info["products"]

            # Create job state
            job_state = DownloadJobState(job_id=job_id, obs_id=obs_id, download_dir=obs_dir)

        # Update tracker with totals
        download_tracker.set_total_files(job_id, len(files_info))
        total_bytes = sum(f.get("size", 0) for f in files_info)
        download_tracker.set_total_bytes(job_id, total_bytes)
        download_tracker.update_stage(
            job_id,
            DownloadStage.DOWNLOADING,
            f"Downloading {len(files_info)} files ({_format_bytes(total_bytes)})...",
        )

        # Initialize file progress list in tracker
        file_progress_list = [
            FileProgress(
                filename=f.get("filename", ""),
                total_bytes=f.get("size", 0),
                downloaded_bytes=0,
                status="pending",
            )
            for f in files_info
        ]
        download_tracker.set_file_progress_list(job_id, file_progress_list)

        # Progress callback
        last_update_time = [time.time()]

        def on_progress(state: DownloadJobState):
            now = time.time()
            # Update at most every 100ms to avoid overwhelming
            if now - last_update_time[0] < 0.1:
                return
            last_update_time[0] = now

            # Update speed tracker
            speed_tracker.add_sample(state.downloaded_bytes)

            # Calculate speed and ETA
            speed = speed_tracker.get_speed()
            remaining = state.total_bytes - state.downloaded_bytes
            eta = speed_tracker.get_eta(remaining) if remaining > 0 else 0.0

            # Update tracker
            download_tracker.update_byte_progress(
                job_id,
                downloaded_bytes=state.downloaded_bytes,
                speed_bytes_per_sec=speed,
                eta_seconds=eta,
            )

            # Update file progress
            for file_state in state.files:
                download_tracker.update_single_file_progress(
                    job_id,
                    filename=file_state.filename,
                    downloaded_bytes=file_state.downloaded_bytes,
                    total_bytes=file_state.total_bytes,
                    status=file_state.status,
                )

            # Update message
            current_file = next((f for f in state.files if f.status == "downloading"), None)
            if current_file:
                download_tracker.update_stage(
                    job_id,
                    DownloadStage.DOWNLOADING,
                    f"Downloading: {current_file.filename} ({_format_bytes(speed)}/s)",
                )

            # Persist state periodically for resume capability
            state_manager.save_job_state(state)

        # Run the download
        result_state = await downloader.download_files(
            files_info=files_info,
            download_dir=obs_dir,
            job_state=job_state,
            progress_callback=on_progress,
        )

        # Update final state
        if result_state.status == "complete":
            for file_state in result_state.files:
                if file_state.status == "complete":
                    download_tracker.add_completed_file(job_id, file_state.local_path)
            download_tracker.complete_job(job_id, obs_dir)
            # Clean up state file on success
            state_manager.delete_job_state(job_id)
        elif result_state.status == "paused":
            download_tracker.pause_job(job_id)
            state_manager.save_job_state(result_state)
        else:
            download_tracker.fail_job(
                job_id, result_state.error or "Download failed", is_resumable=True
            )
            state_manager.save_job_state(result_state)

    except Exception as e:
        logger.error(f"Chunked download job {job_id} failed: {e}")
        download_tracker.fail_job(job_id, str(e), is_resumable=True)
        # Save state for potential retry
        if "job_state" in dir():
            job_state.status = "failed"
            job_state.error = str(e)
            state_manager.save_job_state(job_state)

    finally:
        # Cleanup active downloader tracking
        _active_downloaders.pop(job_id, None)
        _speed_trackers.pop(job_id, None)
        _resuming_jobs.discard(job_id)

        # Run periodic cleanup of old state files (async-safe, non-blocking)
        try:
            state_manager.cleanup_completed()
            state_manager.cleanup_orphaned_partial_files()
        except Exception as cleanup_error:
            logger.warning(f"Post-download cleanup failed: {cleanup_error}")


# === S3 Download Endpoints ===


# Track active S3 downloaders by job_id
_active_s3_downloaders: dict = {}


@router.post("/download/start-s3")
async def start_s3_download(request: S3DownloadRequest):
    """
    Start an S3 download job using the STScI public bucket.
    Returns immediately with a job ID for progress polling.
    """
    job_id = download_tracker.create_job(request.obs_id)

    asyncio.create_task(
        _run_s3_download_job(
            job_id,
            request.obs_id,
            request.product_type,
            calib_level=request.calib_level,
        )
    )

    return {
        "job_id": job_id,
        "obs_id": request.obs_id,
        "message": "S3 download started",
        "download_source": "s3",
    }


async def _run_s3_download_job(
    job_id: str,
    obs_id: str,
    product_type: str,
    calib_level: list[int] | None = None,
):
    """Background task to run S3 download with progress."""
    from .s3_downloader import S3Downloader
    from .s3_resolver import resolve_s3_keys_from_products

    _validate_obs_id(obs_id)

    downloader = S3Downloader()
    _active_s3_downloaders[job_id] = downloader
    speed_tracker = SpeedTracker()
    _speed_trackers[job_id] = speed_tracker

    try:
        download_tracker.update_stage(
            job_id, DownloadStage.FETCHING_PRODUCTS, "Fetching product information from MAST..."
        )
        download_tracker.set_resumable(job_id, False)  # S3 downloads don't support resume yet

        # Create observation-specific download directory
        obs_dir = os.path.normpath(os.path.join(download_dir, obs_id))
        if not obs_dir.startswith(os.path.normpath(download_dir) + os.sep):
            raise ValueError(f"Invalid obs_id for path: {obs_id}")
        os.makedirs(obs_dir, exist_ok=True)

        # Fetch product info from MAST (same as chunked downloader)
        products_info = await asyncio.to_thread(
            mast_service.get_products_with_urls, obs_id, product_type, calib_level
        )

        if products_info["total_files"] == 0:
            download_tracker.update_stage(job_id, DownloadStage.COMPLETE, "No files to download")
            download_tracker.complete_job(job_id, obs_dir)
            return

        # Resolve S3 keys for each product
        products_with_keys = await asyncio.to_thread(
            resolve_s3_keys_from_products, products_info["products"]
        )

        if not products_with_keys:
            # Fallback: no S3 keys resolved
            download_tracker.update_stage(
                job_id, DownloadStage.FAILED, "Could not resolve S3 paths for any products"
            )
            download_tracker.fail_job(job_id, "S3 path resolution failed for all products")
            return

        # Build files_info for the S3 downloader
        files_info = [
            {
                "s3_key": p["s3_key"],
                "filename": p.get("filename", ""),
                "size": p.get("size", 0),
            }
            for p in products_with_keys
        ]

        # Update tracker
        download_tracker.set_total_files(job_id, len(files_info))
        total_bytes = sum(f.get("size", 0) for f in files_info)
        download_tracker.set_total_bytes(job_id, total_bytes)
        download_tracker.update_stage(
            job_id,
            DownloadStage.DOWNLOADING,
            f"Downloading {len(files_info)} files via S3 ({_format_bytes(total_bytes)})...",
        )

        # Initialize file progress
        file_progress_list = [
            FileProgress(
                filename=f.get("filename", ""),
                total_bytes=f.get("size", 0),
                downloaded_bytes=0,
                status="pending",
            )
            for f in files_info
        ]
        download_tracker.set_file_progress_list(job_id, file_progress_list)

        # Create job state
        from .chunked_downloader import DownloadJobState

        job_state = DownloadJobState(job_id=job_id, obs_id=obs_id, download_dir=obs_dir)

        # Progress callback
        last_update_time = [time.time()]

        def on_progress(state: DownloadJobState):
            now = time.time()
            if now - last_update_time[0] < 0.1:
                return
            last_update_time[0] = now

            speed_tracker.add_sample(state.downloaded_bytes)
            speed = speed_tracker.get_speed()
            remaining = state.total_bytes - state.downloaded_bytes
            eta = speed_tracker.get_eta(remaining) if remaining > 0 else 0.0

            download_tracker.update_byte_progress(
                job_id,
                downloaded_bytes=state.downloaded_bytes,
                speed_bytes_per_sec=speed,
                eta_seconds=eta,
            )

            for file_state in state.files:
                download_tracker.update_single_file_progress(
                    job_id,
                    filename=file_state.filename,
                    downloaded_bytes=file_state.downloaded_bytes,
                    total_bytes=file_state.total_bytes,
                    status=file_state.status,
                )

            current_file = next((f for f in state.files if f.status == "downloading"), None)
            if current_file:
                download_tracker.update_stage(
                    job_id,
                    DownloadStage.DOWNLOADING,
                    f"S3: {current_file.filename} ({_format_bytes(speed)}/s)",
                )

        # Run the download (synchronous, so run in thread)
        result_state = await asyncio.to_thread(
            downloader.download_files,
            files_info=files_info,
            download_dir=obs_dir,
            job_state=job_state,
            progress_callback=on_progress,
        )

        # Update final state
        if result_state.status == "complete":
            for file_state in result_state.files:
                if file_state.status == "complete":
                    download_tracker.add_completed_file(job_id, file_state.local_path)
            download_tracker.complete_job(job_id, obs_dir)
        elif result_state.status == "paused":
            download_tracker.pause_job(job_id)
        else:
            download_tracker.fail_job(
                job_id, result_state.error or "S3 download failed", is_resumable=False
            )

    except Exception as e:
        logger.error(f"S3 download job {job_id} failed: {e}")
        download_tracker.fail_job(job_id, str(e), is_resumable=False)

    finally:
        _active_s3_downloaders.pop(job_id, None)
        _speed_trackers.pop(job_id, None)


def _format_bytes(bytes_val: float) -> str:
    """Format bytes as human-readable string."""
    if bytes_val < 1024:
        return f"{bytes_val:.0f} B"
    elif bytes_val < 1024 * 1024:
        return f"{bytes_val / 1024:.1f} KB"
    elif bytes_val < 1024 * 1024 * 1024:
        return f"{bytes_val / (1024 * 1024):.1f} MB"
    else:
        return f"{bytes_val / (1024 * 1024 * 1024):.2f} GB"
