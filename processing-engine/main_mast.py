"""
MAST Proxy Service — lightweight FastAPI entrypoint for MAST search and download.

Separated from the main processing engine so MAST searches remain responsive
even when heavy image processing (composites, mosaics) is running.
"""

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.exceptions import (
    ProcessingEngineError,
    generic_error_handler,
    processing_engine_error_handler,
)
from app.mast.routes import router as mast_router


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: startup and shutdown events."""
    from app.mast.download_state_manager import DownloadStateManager

    download_dir = os.environ.get("MAST_DOWNLOAD_DIR", os.path.join(os.getcwd(), "data", "mast"))
    state_manager = DownloadStateManager(download_dir)

    removed_states = state_manager.cleanup_completed()
    removed_partials = state_manager.cleanup_orphaned_partial_files()
    removed_tmps = state_manager.cleanup_stale_state_tmp_files()

    if removed_states > 0 or removed_partials > 0 or removed_tmps > 0:
        logger.info(
            f"Startup cleanup: removed {removed_states} old state files, "
            f"{removed_partials} orphaned partial files, "
            f"{removed_tmps} stale state tmp files"
        )

    yield


app = FastAPI(
    title="JWST MAST Proxy Service",
    version="1.0.0",
    lifespan=lifespan,
)

# Exception handlers — domain exceptions become structured JSON responses
app.add_exception_handler(ProcessingEngineError, processing_engine_error_handler)
app.add_exception_handler(Exception, generic_error_handler)

app.include_router(mast_router)


@app.get("/")
async def root():
    return {"message": "JWST MAST Proxy Service", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "jwst-mast-proxy"}
