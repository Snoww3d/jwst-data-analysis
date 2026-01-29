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
    height: int = 1000
):
    """
    Generate a PNG preview for a FITS file.

    Args:
        data_id: Identifier for the data (used for logging/tracking)
        file_path: Path to the FITS file (must be within allowed data directory)
    """
    try:
        # Security: Validate file path is within allowed directory
        validated_path = validate_file_path(file_path)
        logger.info(f"Generating preview for: {validated_path}")

        # Read FITS file
        with fits.open(validated_path) as hdul:
            # Find the first image extension with 2D data
            data = None
            for i, hdu in enumerate(hdul):
                if hdu.data is not None:
                    logger.info(f"HDU {i}: shape={hdu.data.shape}, dtype={hdu.data.dtype}")
                    if len(hdu.data.shape) >= 2:
                        data = hdu.data
                        break

            if data is None:
                raise HTTPException(status_code=400, detail="No image data found in FITS file")

            logger.info(f"Original data shape: {data.shape}")

            # Handle 3D+ data cubes - collapse to 2D
            while len(data.shape) > 2:
                # Take middle slice for better representation
                mid_idx = data.shape[0] // 2
                data = data[mid_idx]
                logger.info(f"Reduced to shape: {data.shape}")

            # Handle NaN values
            data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)

            # Normalize image using ZScale (robust to outliers)
            interval = ZScaleInterval()
            try:
                vmin, vmax = interval.get_limits(data)
            except Exception:
                # Fallback to percentile-based scaling
                vmin, vmax = np.percentile(data[np.isfinite(data)], [1, 99])

            if vmin == vmax:
                vmax = vmin + 1  # Avoid division by zero

            norm = ImageNormalize(vmin=vmin, vmax=vmax)

            # Validate colormap
            valid_cmaps = ['grayscale', 'gray', 'inferno', 'magma', 'viridis', 'plasma', 'hot', 'cool', 'rainbow', 'jet']
            if cmap not in valid_cmaps and cmap not in plt.colormaps():
                cmap = 'inferno'
            if cmap == 'grayscale':
                cmap = 'gray'

            # Create plot without axes
            fig = plt.figure(figsize=(width/100, height/100), dpi=100)
            plt.imshow(data, origin='lower', cmap=cmap, norm=norm)
            plt.axis('off')

            # Save to buffer
            buf = io.BytesIO()
            plt.savefig(buf, format='png', bbox_inches='tight', pad_inches=0)
            plt.close(fig)
            buf.seek(0)

            logger.info(f"Preview generated successfully, size: {buf.getbuffer().nbytes} bytes")
            return Response(content=buf.getvalue(), media_type="image/png")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating preview: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Preview generation failed: {str(e)}")

# Existing endpoint definitions...
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 