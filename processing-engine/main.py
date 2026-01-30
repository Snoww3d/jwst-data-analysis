from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Dict, Any, Optional
from pathlib import Path
import logging
import os
import io
import numpy as np
import matplotlib.pyplot as plt
from astropy.io import fits
from astropy.visualization import ZScaleInterval, ImageNormalize

# Import enhancement module for stretch functions
from app.processing.enhancement import (
    zscale_stretch, asinh_stretch, log_stretch,
    sqrt_stretch, power_stretch, histogram_equalization,
    normalize_to_range
)

# Import statistics module for histogram computation
from app.processing.statistics import compute_histogram, compute_percentiles

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Security: Define allowed data directory for file access
# All file operations must be within this directory to prevent path traversal
ALLOWED_DATA_DIR = Path(os.environ.get("DATA_DIR", "/app/data")).resolve()


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
            raise HTTPException(status_code=403, detail="Access denied: path outside allowed directory")

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
        raise HTTPException(status_code=400, detail="Invalid file path")

app = FastAPI(title="JWST Data Processing Engine", version="1.0.0")

# Include MAST routes
from app.mast.routes import router as mast_router
app.include_router(mast_router)


@app.on_event("startup")
async def startup_cleanup():
    """Run cleanup of old download state files on startup."""
    from app.mast.download_state_manager import DownloadStateManager
    import os

    download_dir = os.environ.get("MAST_DOWNLOAD_DIR", os.path.join(os.getcwd(), "data", "mast"))
    state_manager = DownloadStateManager(download_dir)

    # Cleanup old completed/cancelled state files
    removed_states = state_manager.cleanup_completed()
    removed_partials = state_manager.cleanup_orphaned_partial_files()

    if removed_states > 0 or removed_partials > 0:
        logger.info(f"Startup cleanup: removed {removed_states} old state files, {removed_partials} orphaned partial files")

class ProcessingRequest(BaseModel):
    data_id: str
    algorithm: str
    parameters: Dict[str, Any]

class ProcessingResponse(BaseModel):
    status: str
    message: str
    result_id: Optional[str] = None
    results: Optional[Dict[str, Any]] = None

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
        logger.info(f"Processing request for data {request.data_id} with algorithm {request.algorithm}")
        
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
            results=result
        )
        
    except Exception as e:
        logger.error(f"Error processing data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

async def perform_basic_analysis(data_id: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Perform basic analysis on JWST data
    """
    # TODO: Implement actual analysis in Phase 3
    return {
        "analysis_type": "basic",
        "data_id": data_id,
        "statistics": {
            "mean": 0.0,
            "std": 0.0,
            "min": 0.0,
            "max": 0.0
        },
        "metadata": {
            "processed_at": "2024-01-01T00:00:00Z",
            "algorithm_version": "1.0.0"
        }
    }

async def perform_image_enhancement(data_id: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Perform image enhancement on JWST image data
    """
    # TODO: Implement actual image enhancement in Phase 3
    return {
        "enhancement_type": "basic",
        "data_id": data_id,
        "enhancement_parameters": parameters,
        "output_path": f"/processed/{data_id}_enhanced.fits",
        "metadata": {
            "processed_at": "2024-01-01T00:00:00Z",
            "algorithm_version": "1.0.0"
        }
    }

async def perform_noise_reduction(data_id: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Perform noise reduction on JWST data
    """
    # TODO: Implement actual noise reduction in Phase 3
    return {
        "reduction_type": "basic",
        "data_id": data_id,
        "reduction_parameters": parameters,
        "output_path": f"/processed/{data_id}_reduced.fits",
        "noise_metrics": {
            "before": 0.0,
            "after": 0.0,
            "improvement": 0.0
        },
        "metadata": {
            "processed_at": "2024-01-01T00:00:00Z",
            "algorithm_version": "1.0.0"
        }
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
                    "calculate_statistics": {"type": "boolean", "default": True}
                }
            },
            {
                "name": "image_enhancement",
                "description": "Enhance image quality using various filters",
                "parameters": {
                    "enhancement_type": {"type": "string", "default": "histogram_equalization"},
                    "brightness": {"type": "float", "default": 1.0},
                    "contrast": {"type": "float", "default": 1.0}
                }
            },
            {
                "name": "noise_reduction",
                "description": "Reduce noise in JWST data using advanced algorithms",
                "parameters": {
                    "method": {"type": "string", "default": "gaussian"},
                    "kernel_size": {"type": "integer", "default": 3},
                    "sigma": {"type": "float", "default": 1.0}
                }
            }
        ]
    }

@app.get("/preview/{data_id}")
async def generate_preview(
    data_id: str,
    file_path: str,
    cmap: str = "inferno",
    width: int = 1000,
    height: int = 1000,
    stretch: str = "zscale",      # Stretch algorithm: zscale, asinh, log, sqrt, power, histeq, linear
    gamma: float = 1.0,           # Gamma correction: 0.1 to 5.0
    black_point: float = 0.0,     # Black point percentile: 0.0 to 1.0
    white_point: float = 1.0,     # White point percentile: 0.0 to 1.0
    asinh_a: float = 0.1,         # Asinh softening parameter: 0.001 to 1.0
    slice_index: int = -1,        # For 3D cubes: -1 = middle slice, 0-N for specific slice
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
        logger.info(f"Generating preview for: {validated_path} with stretch={stretch}, gamma={gamma}")

        # Read FITS file
        with fits.open(validated_path) as hdul:
            # Find the first image extension with 2D data
            data = None
            for i, hdu in enumerate(hdul):
                if hdu.data is not None:
                    logger.info(f"HDU {i}: shape={hdu.data.shape}, dtype={hdu.data.dtype}")
                    if len(hdu.data.shape) >= 2:
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
                logger.info(f"Using slice {slice_index} of {n_slices}, reduced to shape: {data.shape}")
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
                if stretch == 'zscale':
                    stretched, _, _ = zscale_stretch(data)
                elif stretch == 'asinh':
                    stretched = asinh_stretch(data, a=asinh_a)
                elif stretch == 'log':
                    stretched = log_stretch(data)
                elif stretch == 'sqrt':
                    stretched = sqrt_stretch(data)
                elif stretch == 'power':
                    # Note: power_stretch uses exponent, gamma is 1/exponent for display
                    stretched = power_stretch(data, power=1.0/gamma if gamma != 0 else 1.0)
                elif stretch == 'histeq':
                    stretched = histogram_equalization(data)
                elif stretch == 'linear':
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
            if stretch != 'power' and gamma != 1.0:
                stretched = np.power(np.clip(stretched, 0, 1), 1.0/gamma)

            # Ensure data is in 0-1 range
            stretched = np.clip(stretched, 0, 1)

            # Validate colormap
            valid_cmaps = ['grayscale', 'gray', 'inferno', 'magma', 'viridis', 'plasma', 'hot', 'cool', 'rainbow', 'jet']
            if cmap not in valid_cmaps and cmap not in plt.colormaps():
                cmap = 'inferno'
            if cmap == 'grayscale':
                cmap = 'gray'

            # Create plot without axes
            fig = plt.figure(figsize=(width/100, height/100), dpi=100)
            plt.imshow(stretched, origin='lower', cmap=cmap, vmin=0, vmax=1)
            plt.axis('off')

            # Save to buffer
            buf = io.BytesIO()
            plt.savefig(buf, format='png', bbox_inches='tight', pad_inches=0)
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
        raise HTTPException(status_code=500, detail=f"Preview generation failed: {str(e)}")


@app.get("/histogram/{data_id}")
async def get_histogram(
    data_id: str,
    file_path: str,
    bins: int = 256,
    slice_index: int = -1,
    stretch: str = "zscale",      # Stretch algorithm: zscale, asinh, log, sqrt, power, histeq, linear
    gamma: float = 1.0,           # Gamma correction: 0.1 to 5.0
    black_point: float = 0.0,     # Black point percentile: 0.0 to 1.0
    white_point: float = 1.0,     # White point percentile: 0.0 to 1.0
    asinh_a: float = 0.1,         # Asinh softening parameter: 0.001 to 1.0
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
        logger.info(f"Computing histogram for: {validated_path}")

        # Read FITS file
        with fits.open(validated_path) as hdul:
            # Find the first image extension with 2D data
            data = None
            for i, hdu in enumerate(hdul):
                if hdu.data is not None and len(hdu.data.shape) >= 2:
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

            # Apply stretch algorithm (same logic as preview endpoint)
            try:
                if stretch == 'zscale':
                    stretched, _, _ = zscale_stretch(data)
                elif stretch == 'asinh':
                    stretched = asinh_stretch(data, a=asinh_a)
                elif stretch == 'log':
                    stretched = log_stretch(data)
                elif stretch == 'sqrt':
                    stretched = sqrt_stretch(data)
                elif stretch == 'power':
                    stretched = power_stretch(data, power=1.0/gamma if gamma != 0 else 1.0)
                elif stretch == 'histeq':
                    stretched = histogram_equalization(data)
                elif stretch == 'linear':
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
            if stretch != 'power' and gamma != 1.0:
                stretched = np.power(np.clip(stretched, 0, 1), 1.0/gamma)

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
                "percentiles": percentiles,
                "stats": stats,
                "cube_info": {
                    "n_slices": n_slices,
                    "current_slice": slice_index,
                }
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error computing histogram: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Histogram computation failed: {str(e)}")


# Existing endpoint definitions...
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 