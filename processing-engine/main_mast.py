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

    if removed_states > 0 or removed_partials > 0:
        logger.info(
            f"Startup cleanup: removed {removed_states} old state files, "
            f"{removed_partials} orphaned partial files"
        )

    yield


app = FastAPI(
    title="JWST MAST Proxy Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(mast_router)


@app.get("/")
async def root():
    return {"message": "JWST MAST Proxy Service", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "jwst-mast-proxy"}
