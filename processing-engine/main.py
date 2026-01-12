from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Dict, Any, Optional
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
async def generate_preview(data_id: str, file_path: str):
    """
    Generate a PNG preview for a FITS file.
    """
    try:
        # Validate file path
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

        # Read FITS file
        with fits.open(file_path) as hdul:
            # Find the first image extension
            data = None
            for hdu in hdul:
                if hdu.data is not None and len(hdu.data.shape) >= 2:
                    data = hdu.data
                    break
            
            if data is None:
                raise HTTPException(status_code=400, detail="No image data found in FITS file")

            # Handle 3D data (take the first slice)
            if len(data.shape) > 2:
                data = data[0]

            # Normalize image using ZScale
            interval = ZScaleInterval()
            vmin, vmax = interval.get_limits(data)
            norm = ImageNormalize(vmin=vmin, vmax=vmax)

            # Create plot without axes
            plt.figure(figsize=(8, 8), dpi=100)
            plt.imshow(data, origin='lower', cmap='inferno', norm=norm)
            plt.axis('off')
            
            # Save to buffer
            buf = io.BytesIO()
            plt.savefig(buf, format='png', bbox_inches='tight', pad_inches=0)
            plt.close()
            buf.seek(0)
            
            return Response(content=buf.getvalue(), media_type="image/png")

    except Exception as e:
        logger.error(f"Error generating preview: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Preview generation failed: {str(e)}")

# Existing endpoint definitions...
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 