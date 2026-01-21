"""
FastAPI routes for MAST portal integration.
"""

from fastapi import APIRouter, HTTPException
from datetime import datetime
import logging
import os
import asyncio

from .models import (
    MastTargetSearchRequest,
    MastCoordinateSearchRequest,
    MastObservationSearchRequest,
    MastProgramSearchRequest,
    MastSearchResponse,
    MastDownloadRequest,
    MastDownloadResponse,
    MastDataProductsRequest,
    MastDataProductsResponse
)
from .mast_service import MastService
from .download_tracker import download_tracker, DownloadStage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mast", tags=["MAST"])

# Initialize service with configurable download directory
download_dir = os.environ.get("MAST_DOWNLOAD_DIR", os.path.join(os.getcwd(), "data", "mast"))
mast_service = MastService(download_dir=download_dir)

# Configurable timeout for MAST searches (default 2 minutes)
MAST_SEARCH_TIMEOUT = int(os.environ.get("MAST_SEARCH_TIMEOUT", "120"))


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
                filters=request.filters
            ),
            timeout=MAST_SEARCH_TIMEOUT
        )
        return MastSearchResponse(
            search_type="target",
            query_params={"target_name": request.target_name, "radius": request.radius},
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat()
        )
    except asyncio.TimeoutError:
        logger.error(f"Target search timed out after {MAST_SEARCH_TIMEOUT}s for: {request.target_name}")
        raise HTTPException(status_code=504, detail=f"MAST search timed out after {MAST_SEARCH_TIMEOUT} seconds. Try a smaller search radius or more specific target name.")
    except Exception as e:
        logger.error(f"Target search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
                radius=request.radius
            ),
            timeout=MAST_SEARCH_TIMEOUT
        )
        return MastSearchResponse(
            search_type="coordinates",
            query_params={"ra": request.ra, "dec": request.dec, "radius": request.radius},
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat()
        )
    except asyncio.TimeoutError:
        logger.error(f"Coordinate search timed out after {MAST_SEARCH_TIMEOUT}s for RA={request.ra}, Dec={request.dec}")
        raise HTTPException(status_code=504, detail=f"MAST search timed out after {MAST_SEARCH_TIMEOUT} seconds. Try a smaller search radius.")
    except Exception as e:
        logger.error(f"Coordinate search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search/observation", response_model=MastSearchResponse)
async def search_by_observation_id(request: MastObservationSearchRequest):
    """Search MAST by observation ID."""
    try:
        # Run synchronous MAST call in thread pool with timeout
        results = await asyncio.wait_for(
            asyncio.to_thread(
                mast_service.search_by_observation_id,
                obs_id=request.obs_id
            ),
            timeout=MAST_SEARCH_TIMEOUT
        )
        return MastSearchResponse(
            search_type="observation_id",
            query_params={"obs_id": request.obs_id},
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat()
        )
    except asyncio.TimeoutError:
        logger.error(f"Observation ID search timed out after {MAST_SEARCH_TIMEOUT}s for: {request.obs_id}")
        raise HTTPException(status_code=504, detail=f"MAST search timed out after {MAST_SEARCH_TIMEOUT} seconds.")
    except Exception as e:
        logger.error(f"Observation ID search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search/program", response_model=MastSearchResponse)
async def search_by_program_id(request: MastProgramSearchRequest):
    """Search MAST by program/proposal ID."""
    try:
        # Run synchronous MAST call in thread pool with timeout
        results = await asyncio.wait_for(
            asyncio.to_thread(
                mast_service.search_by_program_id,
                program_id=request.program_id
            ),
            timeout=MAST_SEARCH_TIMEOUT
        )
        return MastSearchResponse(
            search_type="program_id",
            query_params={"program_id": request.program_id},
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat()
        )
    except asyncio.TimeoutError:
        logger.error(f"Program ID search timed out after {MAST_SEARCH_TIMEOUT}s for: {request.program_id}")
        raise HTTPException(status_code=504, detail=f"MAST search timed out after {MAST_SEARCH_TIMEOUT} seconds.")
    except Exception as e:
        logger.error(f"Program ID search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/products", response_model=MastDataProductsResponse)
async def get_data_products(request: MastDataProductsRequest):
    """Get available data products for an observation."""
    try:
        # Run synchronous MAST call in thread pool with timeout
        products = await asyncio.wait_for(
            asyncio.to_thread(
                mast_service.get_data_products,
                obs_id=request.obs_id
            ),
            timeout=MAST_SEARCH_TIMEOUT
        )
        return MastDataProductsResponse(
            obs_id=request.obs_id,
            products=products,
            product_count=len(products)
        )
    except asyncio.TimeoutError:
        logger.error(f"Get products timed out after {MAST_SEARCH_TIMEOUT}s for: {request.obs_id}")
        raise HTTPException(status_code=504, detail=f"Request timed out after {MAST_SEARCH_TIMEOUT} seconds.")
    except Exception as e:
        logger.error(f"Get products failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
                    obs_id=request.obs_id
                ),
                timeout=MAST_DOWNLOAD_TIMEOUT
            )
        else:
            result = await asyncio.wait_for(
                asyncio.to_thread(
                    mast_service.download_observation,
                    obs_id=request.obs_id,
                    product_type=request.product_type
                ),
                timeout=MAST_DOWNLOAD_TIMEOUT
            )

        return MastDownloadResponse(
            status=result.get("status", "unknown"),
            obs_id=request.obs_id,
            files=result.get("files", []),
            file_count=len(result.get("files", [])),
            download_dir=result.get("download_dir"),
            error=result.get("error"),
            timestamp=result.get("timestamp", datetime.utcnow().isoformat())
        )
    except asyncio.TimeoutError:
        logger.error(f"Download timed out after {MAST_DOWNLOAD_TIMEOUT}s for: {request.obs_id}")
        raise HTTPException(status_code=504, detail=f"Download timed out after {MAST_DOWNLOAD_TIMEOUT} seconds. The files may be very large.")
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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

    return {
        "job_id": job_id,
        "obs_id": request.obs_id,
        "message": "Download started"
    }


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
            download_tracker.update_stage(
                job_id, DownloadStage.COMPLETE, "No files to download"
            )
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
            mast_service.download_observation_with_progress,
            obs_id,
            product_type,
            on_progress
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
