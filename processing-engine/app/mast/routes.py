"""
FastAPI routes for MAST portal integration.
"""

from fastapi import APIRouter, HTTPException
from datetime import datetime
import logging
import os

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

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mast", tags=["MAST"])

# Initialize service with configurable download directory
download_dir = os.environ.get("MAST_DOWNLOAD_DIR", os.path.join(os.getcwd(), "data", "mast"))
mast_service = MastService(download_dir=download_dir)


@router.post("/search/target", response_model=MastSearchResponse)
async def search_by_target(request: MastTargetSearchRequest):
    """Search MAST by target name (e.g., 'NGC 1234', 'Carina Nebula')."""
    try:
        results = mast_service.search_by_target(
            target_name=request.target_name,
            radius=request.radius,
            filters=request.filters
        )
        return MastSearchResponse(
            search_type="target",
            query_params={"target_name": request.target_name, "radius": request.radius},
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat()
        )
    except Exception as e:
        logger.error(f"Target search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search/coordinates", response_model=MastSearchResponse)
async def search_by_coordinates(request: MastCoordinateSearchRequest):
    """Search MAST by RA/Dec coordinates."""
    try:
        results = mast_service.search_by_coordinates(
            ra=request.ra,
            dec=request.dec,
            radius=request.radius
        )
        return MastSearchResponse(
            search_type="coordinates",
            query_params={"ra": request.ra, "dec": request.dec, "radius": request.radius},
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat()
        )
    except Exception as e:
        logger.error(f"Coordinate search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search/observation", response_model=MastSearchResponse)
async def search_by_observation_id(request: MastObservationSearchRequest):
    """Search MAST by observation ID."""
    try:
        results = mast_service.search_by_observation_id(obs_id=request.obs_id)
        return MastSearchResponse(
            search_type="observation_id",
            query_params={"obs_id": request.obs_id},
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat()
        )
    except Exception as e:
        logger.error(f"Observation ID search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search/program", response_model=MastSearchResponse)
async def search_by_program_id(request: MastProgramSearchRequest):
    """Search MAST by program/proposal ID."""
    try:
        results = mast_service.search_by_program_id(program_id=request.program_id)
        return MastSearchResponse(
            search_type="program_id",
            query_params={"program_id": request.program_id},
            results=results,
            result_count=len(results),
            timestamp=datetime.utcnow().isoformat()
        )
    except Exception as e:
        logger.error(f"Program ID search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/products", response_model=MastDataProductsResponse)
async def get_data_products(request: MastDataProductsRequest):
    """Get available data products for an observation."""
    try:
        products = mast_service.get_data_products(obs_id=request.obs_id)
        return MastDataProductsResponse(
            obs_id=request.obs_id,
            products=products,
            product_count=len(products)
        )
    except Exception as e:
        logger.error(f"Get products failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/download", response_model=MastDownloadResponse)
async def download_observation(request: MastDownloadRequest):
    """Download FITS files for an observation."""
    try:
        if request.product_id:
            result = mast_service.download_product(
                product_id=request.product_id,
                obs_id=request.obs_id
            )
        else:
            result = mast_service.download_observation(
                obs_id=request.obs_id,
                product_type=request.product_type
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
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
