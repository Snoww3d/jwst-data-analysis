"""
Shared helpers for resolving storage keys to local file paths.

All FITS file access in the processing engine should go through these
helpers so the backend can transparently switch between local and S3.
"""

import logging
import os
from pathlib import Path

from fastapi import HTTPException

from .factory import get_storage_provider


logger = logging.getLogger(__name__)

# Resource limits for FITS processing (configurable via environment)
MAX_FITS_FILE_SIZE_BYTES = (
    int(os.environ.get("MAX_FITS_FILE_SIZE_MB", "10240")) * 1024 * 1024
)  # Default 10GB


def resolve_fits_path(key: str) -> Path:
    """
    Resolve a storage key to a local file path that astropy can open.

    For local storage, this returns the actual path on disk.
    For S3 storage, this downloads the file to a temp cache and returns that path.

    The key is validated against path traversal: absolute paths and '..'
    components are rejected before the storage layer sees them.

    Args:
        key: Relative storage key (e.g. "mast/obs_id/file.fits")

    Returns:
        Path to a local file that can be opened with fits.open()

    Raises:
        HTTPException: 403 if key contains traversal, 404 if file not found
    """
    # Reject absolute paths and path traversal components
    if os.path.isabs(key) or ".." in Path(key).parts:
        logger.warning("Path traversal attempt blocked: %s", key)
        raise HTTPException(status_code=403, detail="Access denied: invalid path")

    storage = get_storage_provider()

    if not storage.exists(key):
        raise HTTPException(
            status_code=404,
            detail=f"File not found: {Path(key).name}",
        )

    local_path = storage.read_to_temp(key)

    if not local_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    return local_path


#: #1573: lives here, beside validate_fits_file_size, because it was previously
#: private to the render routes and every other FITS-reading endpoint silently
#: went unguarded. Import it from one place so a new endpoint gets it by habit.
MAX_FITS_ARRAY_ELEMENTS = int(os.environ.get("MAX_FITS_ARRAY_ELEMENTS", "200000000"))


def validate_fits_array_size(shape: tuple, max_elements: int = MAX_FITS_ARRAY_ELEMENTS) -> None:
    """Reject an HDU whose element count would blow the memory budget.

    Must be called with the shape from the HEADER, before touching ``hdu.data``
    — the allocation is the thing being prevented, so a check that runs after
    materialization is decoration.

    Raises:
        HTTPException: 413 if the array would exceed the maximum.
    """
    total_elements = 1
    for dim in shape:
        total_elements *= dim

    if total_elements > max_elements:
        logger.warning(
            "FITS array too large: %s elements (max %s)",
            f"{total_elements:,}",
            f"{max_elements:,}",
        )
        raise HTTPException(
            status_code=413,
            detail=f"Image too large: {total_elements:,} pixels exceeds maximum {max_elements:,}",
        )


def validate_fits_file_size(local_path: Path, max_bytes: int = MAX_FITS_FILE_SIZE_BYTES) -> None:
    """
    Validate that a local FITS file doesn't exceed the maximum allowed size.

    Args:
        local_path: Path to the local file to check
        max_bytes: Maximum file size in bytes

    Raises:
        HTTPException: 413 if file exceeds maximum size
    """
    file_size = local_path.stat().st_size
    if file_size > max_bytes:
        max_mb = max_bytes / (1024 * 1024)
        file_mb = file_size / (1024 * 1024)
        logger.warning("FITS file too large: %.1fMB (max %.1fMB)", file_mb, max_mb)
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {file_mb:.1f}MB exceeds maximum {max_mb:.1f}MB",
        )
