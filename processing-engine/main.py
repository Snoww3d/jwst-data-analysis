import io
import logging
import os
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from astropy.io import fits
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.composite.routes import router as composite_router
from app.mast.routes import router as mast_router
from app.processing.enhancement import (
    asinh_stretch,
    histogram_equalization,
    log_stretch,
    normalize_to_range,
    power_stretch,
    sqrt_stretch,
    zscale_stretch,
)
from app.processing.statistics import compute_histogram, compute_percentiles


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Security: Define allowed data directory for file access
# All file operations must be within this directory to prevent path traversal
ALLOWED_DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data")).resolve()

# Resource limits for FITS processing (configurable via environment)
# Prevents memory exhaustion from processing extremely large files (DoS protection)
MAX_FITS_FILE_SIZE_BYTES = (
    int(os.environ.get("MAX_FITS_FILE_SIZE_MB", "2048")) * 1024 * 1024
)  # Default 2GB
MAX_FITS_ARRAY_ELEMENTS = int(
    os.environ.get("MAX_FITS_ARRAY_ELEMENTS", "100000000")
)  # Default 100M pixels


def validate_file_path(file_path: str) -> Path:
    """
    Validate that a file path is within the allowed data directory.
    Prevents path traversal attacks (e.g., ../../etc/passwd).

    Args:
        file_path: The file path to validate (can be relative or absolute)

    Returns:
        Resolved Path object if valid

    Raises:
        HTTPException: 403 if path is outside allowed directory, 404 if file doesn't exist
    """
    try:
        # Resolve the path (handles .., symlinks, etc.)
        requested_path = (ALLOWED_DATA_DIR / file_path).resolve()

        # Security check: ensure path is within allowed directory
        if not requested_path.is_relative_to(ALLOWED_DATA_DIR):
            logger.warning(f"Path traversal attempt blocked: {file_path}")
            raise HTTPException(
                status_code=403, detail="Access denied: path outside allowed directory"
            )

        # Check file exists
        if not requested_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {requested_path.name}")

        # Check it's a file, not a directory
        if not requested_path.is_file():
            raise HTTPException(status_code=400, detail="Path is not a file")

        return requested_path

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Path validation error: {e}")
        raise HTTPException(status_code=400, detail="Invalid file path") from e


def validate_fits_file_size(file_path: Path) -> None:
    """
    Validate that a FITS file doesn't exceed the maximum allowed size.
    Prevents memory exhaustion from processing extremely large files.

    Args:
        file_path: Validated Path object to check

    Raises:
        HTTPException: 413 if file exceeds maximum size
    """
    file_size = file_path.stat().st_size
    if file_size > MAX_FITS_FILE_SIZE_BYTES:
        max_mb = MAX_FITS_FILE_SIZE_BYTES / (1024 * 1024)
        file_mb = file_size / (1024 * 1024)
        logger.warning(f"FITS file too large: {file_mb:.1f}MB (max {max_mb:.1f}MB)")
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {file_mb:.1f}MB exceeds maximum {max_mb:.1f}MB",
        )


def validate_fits_array_size(shape: tuple) -> None:
    """
    Validate that FITS array dimensions won't exceed memory limits.
    Called BEFORE loading data into memory to prevent allocation attacks.

    Args:
        shape: Array shape tuple from HDU header

    Raises:
        HTTPException: 413 if array would exceed maximum elements
    """
    total_elements = 1
    for dim in shape:
        total_elements *= dim

    if total_elements > MAX_FITS_ARRAY_ELEMENTS:
        logger.warning(
            f"FITS array too large: {total_elements:,} elements (max {MAX_FITS_ARRAY_ELEMENTS:,})"
        )
        raise HTTPException(
            status_code=413,
            detail=f"Image too large: {total_elements:,} pixels exceeds maximum {MAX_FITS_ARRAY_ELEMENTS:,}",
        )


app = FastAPI(title="JWST Data Processing Engine", version="1.0.0")

# Include MAST routes
app.include_router(mast_router)

# Include Composite routes
app.include_router(composite_router)


@app.on_event("startup")
async def startup_cleanup():
    """Run cleanup of old download state files on startup."""
    import os

    from app.mast.download_state_manager import DownloadStateManager

    download_dir = os.environ.get("MAST_DOWNLOAD_DIR", os.path.join(os.getcwd(), "data", "mast"))
    state_manager = DownloadStateManager(download_dir)

    # Cleanup old completed/cancelled state files
    removed_states = state_manager.cleanup_completed()
    removed_partials = state_manager.cleanup_orphaned_partial_files()

    if removed_states > 0 or removed_partials > 0:
        logger.info(
            f"Startup cleanup: removed {removed_states} old state files, {removed_partials} orphaned partial files"
        )


class ProcessingRequest(BaseModel):
    data_id: str
    algorithm: str
    parameters: dict[str, Any]


class ProcessingResponse(BaseModel):
    status: str
    message: str
    result_id: str | None = None
    results: dict[str, Any] | None = None


@app.get("/")
async def root():
    return {"message": "JWST Data Processing Engine", "status": "running"}


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "jwst-processing-engine"}


@app.post("/process", response_model=ProcessingResponse)
async def process_data(request: ProcessingRequest):
    """
    Process JWST data using specified algorithm
    """
    try:
        logger.info(
            f"Processing request for data {request.data_id} with algorithm {request.algorithm}"
        )

        # TODO: Implement actual processing logic in Phase 3
        # This is a placeholder that will be expanded with real scientific computing

        if request.algorithm == "basic_analysis":
            result = await perform_basic_analysis(request.data_id, request.parameters)
        elif request.algorithm == "image_enhancement":
            result = await perform_image_enhancement(request.data_id, request.parameters)
        elif request.algorithm == "noise_reduction":
            result = await perform_noise_reduction(request.data_id, request.parameters)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown algorithm: {request.algorithm}")

        return ProcessingResponse(
            status="completed",
            message="Processing completed successfully",
            result_id=f"result_{request.data_id}",
            results=result,
        )

    except Exception as e:
        logger.error(f"Error processing data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}") from e


async def perform_basic_analysis(data_id: str, parameters: dict[str, Any]) -> dict[str, Any]:
    """
    Perform basic analysis on JWST data
    """
    # TODO: Implement actual analysis in Phase 3
    return {
        "analysis_type": "basic",
        "data_id": data_id,
        "statistics": {"mean": 0.0, "std": 0.0, "min": 0.0, "max": 0.0},
        "metadata": {"processed_at": "2024-01-01T00:00:00Z", "algorithm_version": "1.0.0"},
    }


async def perform_image_enhancement(data_id: str, parameters: dict[str, Any]) -> dict[str, Any]:
    """
    Perform image enhancement on JWST image data
    """
    # TODO: Implement actual image enhancement in Phase 3
    return {
        "enhancement_type": "basic",
        "data_id": data_id,
        "enhancement_parameters": parameters,
        "output_path": f"/processed/{data_id}_enhanced.fits",
        "metadata": {"processed_at": "2024-01-01T00:00:00Z", "algorithm_version": "1.0.0"},
    }


async def perform_noise_reduction(data_id: str, parameters: dict[str, Any]) -> dict[str, Any]:
    """
    Perform noise reduction on JWST data
    """
    # TODO: Implement actual noise reduction in Phase 3
    return {
        "reduction_type": "basic",
        "data_id": data_id,
        "reduction_parameters": parameters,
        "output_path": f"/processed/{data_id}_reduced.fits",
        "noise_metrics": {"before": 0.0, "after": 0.0, "improvement": 0.0},
        "metadata": {"processed_at": "2024-01-01T00:00:00Z", "algorithm_version": "1.0.0"},
    }


@app.get("/algorithms")
async def get_available_algorithms():
    """
    Get list of available processing algorithms
    """
    return {
        "algorithms": [
            {
                "name": "basic_analysis",
                "description": "Perform basic statistical analysis on JWST data",
                "parameters": {
                    "normalize": {"type": "boolean", "default": True},
                    "calculate_statistics": {"type": "boolean", "default": True},
                },
            },
            {
                "name": "image_enhancement",
                "description": "Enhance image quality using various filters",
                "parameters": {
                    "enhancement_type": {"type": "string", "default": "histogram_equalization"},
                    "brightness": {"type": "float", "default": 1.0},
                    "contrast": {"type": "float", "default": 1.0},
                },
            },
            {
                "name": "noise_reduction",
                "description": "Reduce noise in JWST data using advanced algorithms",
                "parameters": {
                    "method": {"type": "string", "default": "gaussian"},
                    "kernel_size": {"type": "integer", "default": 3},
                    "sigma": {"type": "float", "default": 1.0},
                },
            },
        ]
    }


@app.get("/preview/{data_id}")
async def generate_preview(
    data_id: str,
    file_path: str,
    cmap: str = "inferno",
    width: int = 1000,
    height: int = 1000,
    stretch: str = "zscale",  # Stretch algorithm: zscale, asinh, log, sqrt, power, histeq, linear
    gamma: float = 1.0,  # Gamma correction: 0.1 to 5.0
    black_point: float = 0.0,  # Black point percentile: 0.0 to 1.0
    white_point: float = 1.0,  # White point percentile: 0.0 to 1.0
    asinh_a: float = 0.1,  # Asinh softening parameter: 0.001 to 1.0
    slice_index: int = -1,  # For 3D cubes: -1 = middle slice, 0-N for specific slice
):
    """
    Generate a PNG preview for a FITS file with configurable stretch and level controls.

    Args:
        data_id: Identifier for the data (used for logging/tracking)
        file_path: Path to the FITS file (must be within allowed data directory)
        cmap: Colormap name (inferno, magma, viridis, plasma, grayscale, hot, cool, rainbow, jet)
        width: Output image width in pixels
        height: Output image height in pixels
        stretch: Stretch algorithm (zscale, asinh, log, sqrt, power, histeq, linear)
        gamma: Gamma correction factor (0.1 to 5.0, default 1.0)
        black_point: Black point as percentile (0.0 to 1.0, default 0.0)
        white_point: White point as percentile (0.0 to 1.0, default 1.0)
        asinh_a: Asinh softening parameter (only used when stretch=asinh)
        slice_index: For 3D data cubes, which slice to show (-1 = middle)
    """
    try:
        # Security: Validate file path is within allowed directory
        validated_path = validate_file_path(file_path)
        # Security: Validate file size to prevent memory exhaustion
        validate_fits_file_size(validated_path)
        logger.info(
            f"Generating preview for: {validated_path} with stretch={stretch}, gamma={gamma}"
        )

        # Read FITS file
        with fits.open(validated_path) as hdul:
            # Find the first image extension with 2D data
            data = None
            for i, hdu in enumerate(hdul):
                if hdu.data is not None:
                    logger.info(f"HDU {i}: shape={hdu.data.shape}, dtype={hdu.data.dtype}")
                    if len(hdu.data.shape) >= 2:
                        # Security: Validate array size before loading into memory
                        validate_fits_array_size(hdu.data.shape)
                        data = hdu.data.astype(np.float64)
                        break

            if data is None:
                raise HTTPException(status_code=400, detail="No image data found in FITS file")

            original_shape = data.shape
            logger.info(f"Original data shape: {original_shape}")

            # Handle 3D+ data cubes
            n_slices = original_shape[0] if len(original_shape) > 2 else 1
            if len(data.shape) > 2:
                if slice_index < 0:
                    slice_index = data.shape[0] // 2
                slice_index = max(0, min(slice_index, data.shape[0] - 1))
                data = data[slice_index]
                logger.info(
                    f"Using slice {slice_index} of {n_slices}, reduced to shape: {data.shape}"
                )
            else:
                slice_index = 0

            # Continue reducing if still > 2D
            while len(data.shape) > 2:
                mid_idx = data.shape[0] // 2
                data = data[mid_idx]
                logger.info(f"Further reduced to shape: {data.shape}")

            # Handle NaN values
            data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)

            # Apply stretch algorithm
            try:
                if stretch == "zscale":
                    stretched, _, _ = zscale_stretch(data)
                elif stretch == "asinh":
                    stretched = asinh_stretch(data, a=asinh_a)
                elif stretch == "log":
                    stretched = log_stretch(data)
                elif stretch == "sqrt":
                    stretched = sqrt_stretch(data)
                elif stretch == "power":
                    # Note: power_stretch uses exponent, gamma is 1/exponent for display
                    stretched = power_stretch(data, power=1.0 / gamma if gamma != 0 else 1.0)
                elif stretch == "histeq":
                    stretched = histogram_equalization(data)
                elif stretch == "linear":
                    stretched = normalize_to_range(data)
                else:
                    # Fallback to zscale
                    logger.warning(f"Unknown stretch '{stretch}', falling back to zscale")
                    stretched, _, _ = zscale_stretch(data)
            except Exception as stretch_error:
                logger.warning(f"Stretch {stretch} failed: {stretch_error}, falling back to zscale")
                stretched, _, _ = zscale_stretch(data)

            # Apply black/white point clipping (percentile-based)
            if black_point > 0.0 or white_point < 1.0:
                bp_value = np.percentile(stretched, black_point * 100)
                wp_value = np.percentile(stretched, white_point * 100)
                if wp_value > bp_value:
                    stretched = np.clip((stretched - bp_value) / (wp_value - bp_value), 0, 1)
                else:
                    stretched = np.clip(stretched, 0, 1)

            # Apply gamma correction (only for non-power stretches since power already uses gamma)
            if stretch != "power" and gamma != 1.0:
                stretched = np.power(np.clip(stretched, 0, 1), 1.0 / gamma)

            # Ensure data is in 0-1 range
            stretched = np.clip(stretched, 0, 1)

            # Validate colormap
            valid_cmaps = [
                "grayscale",
                "gray",
                "inferno",
                "magma",
                "viridis",
                "plasma",
                "hot",
                "cool",
                "rainbow",
                "jet",
            ]
            if cmap not in valid_cmaps and cmap not in plt.colormaps():
                cmap = "inferno"
            if cmap == "grayscale":
                cmap = "gray"

            # Create plot without axes
            fig = plt.figure(figsize=(width / 100, height / 100), dpi=100)
            plt.imshow(stretched, origin="lower", cmap=cmap, vmin=0, vmax=1)
            plt.axis("off")

            # Save to buffer
            buf = io.BytesIO()
            plt.savefig(buf, format="png", bbox_inches="tight", pad_inches=0)
            plt.close(fig)
            buf.seek(0)

            logger.info(f"Preview generated successfully, size: {buf.getbuffer().nbytes} bytes")

            # Create response with cube info headers
            response = Response(content=buf.getvalue(), media_type="image/png")
            response.headers["X-Cube-Slices"] = str(n_slices)
            response.headers["X-Cube-Current"] = str(slice_index)
            return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating preview: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Preview generation failed: {str(e)}") from e


@app.get("/histogram/{data_id}")
async def get_histogram(
    data_id: str,
    file_path: str,
    bins: int = 256,
    slice_index: int = -1,
    stretch: str = "zscale",  # Stretch algorithm: zscale, asinh, log, sqrt, power, histeq, linear
    gamma: float = 1.0,  # Gamma correction: 0.1 to 5.0
    black_point: float = 0.0,  # Black point percentile: 0.0 to 1.0
    white_point: float = 1.0,  # White point percentile: 0.0 to 1.0
    asinh_a: float = 0.1,  # Asinh softening parameter: 0.001 to 1.0
):
    """
    Get histogram data for a FITS file with stretch applied.

    Args:
        data_id: Identifier for the data (used for logging/tracking)
        file_path: Path to the FITS file (must be within allowed data directory)
        bins: Number of histogram bins (default: 256)
        slice_index: For 3D data cubes, which slice to use (-1 = middle)
        stretch: Stretch algorithm (zscale, asinh, log, sqrt, power, histeq, linear)
        gamma: Gamma correction factor (0.1 to 5.0, default 1.0)
        black_point: Black point as percentile (0.0 to 1.0, default 0.0)
        white_point: White point as percentile (0.0 to 1.0, default 1.0)
        asinh_a: Asinh softening parameter (only used when stretch=asinh)

    Returns:
        JSON with histogram counts, bin_centers, and percentiles of stretched data
    """
    try:
        # Security: Validate file path is within allowed directory
        validated_path = validate_file_path(file_path)
        # Security: Validate file size to prevent memory exhaustion
        validate_fits_file_size(validated_path)
        logger.info(f"Computing histogram for: {validated_path}")

        # Read FITS file
        with fits.open(validated_path) as hdul:
            # Find the first image extension with 2D data
            data = None
            for _i, hdu in enumerate(hdul):
                if hdu.data is not None and len(hdu.data.shape) >= 2:
                    # Security: Validate array size before loading into memory
                    validate_fits_array_size(hdu.data.shape)
                    data = hdu.data.astype(np.float64)
                    break

            if data is None:
                raise HTTPException(status_code=400, detail="No image data found in FITS file")

            original_shape = data.shape
            n_slices = original_shape[0] if len(original_shape) > 2 else 1

            # Handle 3D+ data cubes
            if len(data.shape) > 2:
                if slice_index < 0:
                    slice_index = data.shape[0] // 2
                slice_index = max(0, min(slice_index, data.shape[0] - 1))
                data = data[slice_index]

            # Continue reducing if still > 2D
            while len(data.shape) > 2:
                mid_idx = data.shape[0] // 2
                data = data[mid_idx]

            # Handle NaN values
            data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)

            # Compute RAW histogram BEFORE any stretch (normalized to 0-1)
            raw_normalized = normalize_to_range(data)
            raw_histogram_data = compute_histogram(raw_normalized, bins=bins)

            # Apply stretch algorithm (same logic as preview endpoint)
            try:
                if stretch == "zscale":
                    stretched, _, _ = zscale_stretch(data)
                elif stretch == "asinh":
                    stretched = asinh_stretch(data, a=asinh_a)
                elif stretch == "log":
                    stretched = log_stretch(data)
                elif stretch == "sqrt":
                    stretched = sqrt_stretch(data)
                elif stretch == "power":
                    stretched = power_stretch(data, power=1.0 / gamma if gamma != 0 else 1.0)
                elif stretch == "histeq":
                    stretched = histogram_equalization(data)
                elif stretch == "linear":
                    stretched = normalize_to_range(data)
                else:
                    logger.warning(f"Unknown stretch '{stretch}', falling back to zscale")
                    stretched, _, _ = zscale_stretch(data)
            except Exception as stretch_error:
                logger.warning(f"Stretch {stretch} failed: {stretch_error}, falling back to zscale")
                stretched, _, _ = zscale_stretch(data)

            # Apply black/white point clipping (percentile-based)
            if black_point > 0.0 or white_point < 1.0:
                bp_value = np.percentile(stretched, black_point * 100)
                wp_value = np.percentile(stretched, white_point * 100)
                if wp_value > bp_value:
                    stretched = np.clip((stretched - bp_value) / (wp_value - bp_value), 0, 1)
                else:
                    stretched = np.clip(stretched, 0, 1)

            # Apply gamma correction (only for non-power stretches since power already uses gamma)
            if stretch != "power" and gamma != 1.0:
                stretched = np.power(np.clip(stretched, 0, 1), 1.0 / gamma)

            # Ensure data is in 0-1 range
            stretched = np.clip(stretched, 0, 1)

            # Compute histogram from STRETCHED data
            histogram_data = compute_histogram(stretched, bins=bins)

            # Compute key percentiles from stretched data for reference markers
            percentile_values = [0.5, 1, 5, 25, 50, 75, 95, 99, 99.5]
            percentiles = compute_percentiles(stretched, percentiles=percentile_values)

            # Get data statistics from stretched data for context
            valid_data = stretched[~np.isnan(stretched)]
            stats = {
                "min": float(np.min(valid_data)),
                "max": float(np.max(valid_data)),
                "mean": float(np.mean(valid_data)),
                "std": float(np.std(valid_data)),
            }

            return {
                "data_id": data_id,
                "histogram": {
                    "counts": histogram_data["counts"],
                    "bin_centers": histogram_data["bin_centers"],
                    "bin_edges": histogram_data["bin_edges"],
                    "n_bins": histogram_data["n_bins"],
                },
                "raw_histogram": {
                    "counts": raw_histogram_data["counts"],
                    "bin_centers": raw_histogram_data["bin_centers"],
                    "bin_edges": raw_histogram_data["bin_edges"],
                    "n_bins": raw_histogram_data["n_bins"],
                },
                "percentiles": percentiles,
                "stats": stats,
                "cube_info": {
                    "n_slices": n_slices,
                    "current_slice": slice_index,
                },
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error computing histogram: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Histogram computation failed: {str(e)}"
        ) from e


@app.get("/pixeldata/{data_id}")
async def get_pixel_data(
    data_id: str,
    file_path: str,
    max_size: int = 1200,
    slice_index: int = -1,
):
    """
    Get pixel data array for hover coordinate display.

    Returns a downsampled pixel array matching the preview size, along with
    dimensions, scale factor, WCS parameters, and units for client-side
    coordinate calculations.

    Args:
        data_id: Identifier for the data (used for logging/tracking)
        file_path: Path to the FITS file (must be within allowed data directory)
        max_size: Maximum dimension for downsampling (default: 1200)
        slice_index: For 3D data cubes, which slice to use (-1 = middle)

    Returns:
        JSON with pixel array (base64 Float32), dimensions, WCS params, and units
    """
    import base64
    import struct

    try:
        # Security: Validate file path is within allowed directory
        validated_path = validate_file_path(file_path)
        # Security: Validate file size to prevent memory exhaustion
        validate_fits_file_size(validated_path)
        logger.info(f"Getting pixel data for: {validated_path}")

        # Read FITS file
        with fits.open(validated_path) as hdul:
            # Find the first image extension with 2D data
            data = None
            header = None
            for hdu in hdul:
                if hdu.data is not None and len(hdu.data.shape) >= 2:
                    # Security: Validate array size before loading into memory
                    validate_fits_array_size(hdu.data.shape)
                    data = hdu.data.astype(np.float64)
                    header = hdu.header
                    break

            if data is None:
                raise HTTPException(status_code=400, detail="No image data found in FITS file")

            original_shape = data.shape
            logger.info(f"Original data shape: {original_shape}")

            # Handle 3D+ data cubes
            if len(data.shape) > 2:
                if slice_index < 0:
                    slice_index = data.shape[0] // 2
                slice_index = max(0, min(slice_index, data.shape[0] - 1))
                data = data[slice_index]
                logger.info(f"Using slice {slice_index}, reduced to shape: {data.shape}")

            # Continue reducing if still > 2D
            while len(data.shape) > 2:
                mid_idx = data.shape[0] // 2
                data = data[mid_idx]

            # Get 2D shape
            height, width = data.shape

            # Downsample if necessary to match preview size
            scale_factor = 1.0
            if width > max_size or height > max_size:
                # Calculate scale to fit within max_size
                scale_factor = max(width, height) / max_size
                new_width = int(width / scale_factor)
                new_height = int(height / scale_factor)

                # Simple block averaging for downsampling
                from scipy import ndimage

                zoom_factor = (new_height / height, new_width / width)
                data = ndimage.zoom(data, zoom_factor, order=1)
                logger.info(f"Downsampled from {height}x{width} to {data.shape}")

            # Handle NaN values - replace with 0 for display purposes
            data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)

            # Get preview shape after any downsampling
            preview_height, preview_width = data.shape

            # Extract WCS parameters from header if available
            wcs_params = None
            if header is not None:
                try:
                    wcs_params = {
                        "crpix1": float(header.get("CRPIX1", 0)),
                        "crpix2": float(header.get("CRPIX2", 0)),
                        "crval1": float(header.get("CRVAL1", 0)),
                        "crval2": float(header.get("CRVAL2", 0)),
                        "cdelt1": float(header.get("CDELT1", header.get("CD1_1", 0))),
                        "cdelt2": float(header.get("CDELT2", header.get("CD2_2", 0))),
                        "cd1_1": float(header.get("CD1_1", header.get("CDELT1", 0))),
                        "cd1_2": float(header.get("CD1_2", 0)),
                        "cd2_1": float(header.get("CD2_1", 0)),
                        "cd2_2": float(header.get("CD2_2", header.get("CDELT2", 0))),
                        "ctype1": str(header.get("CTYPE1", "")),
                        "ctype2": str(header.get("CTYPE2", "")),
                    }
                    # Only include WCS if we have valid reference pixel and values
                    if wcs_params["crpix1"] == 0 and wcs_params["crval1"] == 0:
                        wcs_params = None
                except (ValueError, KeyError) as e:
                    logger.warning(f"Could not extract WCS parameters: {e}")
                    wcs_params = None

            # Get units from header
            units = str(header.get("BUNIT", "")) if header is not None else ""

            # Convert pixel data to Float32 and base64 encode for efficient transport
            # Flatten row-major (C order) for JavaScript compatibility
            flat_data = data.astype(np.float32).flatten()
            # Pack as binary float32 array
            binary_data = struct.pack(f"{len(flat_data)}f", *flat_data)
            pixels_base64 = base64.b64encode(binary_data).decode("ascii")

            return {
                "data_id": data_id,
                "original_shape": [
                    int(original_shape[-2]),
                    int(original_shape[-1]),
                ],  # [height, width]
                "preview_shape": [preview_height, preview_width],  # [height, width]
                "scale_factor": scale_factor,
                "wcs": wcs_params,
                "units": units,
                "pixels": pixels_base64,
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting pixel data: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Pixel data retrieval failed: {str(e)}") from e


# Existing endpoint definitions...
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
