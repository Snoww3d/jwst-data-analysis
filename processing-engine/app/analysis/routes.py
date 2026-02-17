"""
FastAPI routes for region selection and statistics computation.
"""

import logging

import numpy as np
from astropy.io import fits
from fastapi import APIRouter, HTTPException

from app.storage.helpers import resolve_fits_path

from .models import RegionStatisticsRequest, RegionStatisticsResponse


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analysis", tags=["Analysis"])


def create_rectangle_mask(
    shape: tuple[int, int], x: int, y: int, width: int, height: int
) -> np.ndarray:
    """Create a boolean mask for a rectangular region."""
    mask = np.zeros(shape, dtype=bool)
    img_h, img_w = shape
    # Clamp to image bounds
    x0 = max(0, x)
    y0 = max(0, y)
    x1 = min(img_w, x + width)
    y1 = min(img_h, y + height)
    if x0 < x1 and y0 < y1:
        mask[y0:y1, x0:x1] = True
    return mask


def create_ellipse_mask(
    shape: tuple[int, int], cx: float, cy: float, rx: float, ry: float
) -> np.ndarray:
    """Create a boolean mask for an elliptical region."""
    img_h, img_w = shape
    yy, xx = np.ogrid[:img_h, :img_w]
    # Ellipse equation: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 <= 1
    dist = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
    return dist <= 1.0


@router.post("/region-statistics", response_model=RegionStatisticsResponse)
async def compute_region_statistics(request: RegionStatisticsRequest):
    """
    Compute statistics for a selected region within a FITS image.

    Supports rectangle and ellipse region types. Returns mean, median,
    std, min, max, sum, and pixel count for the selected region.
    """
    try:
        # Validate region parameters
        if request.region_type == "rectangle" and request.rectangle is None:
            raise HTTPException(
                status_code=400,
                detail="Rectangle region is required when region_type is 'rectangle'",
            )
        if request.region_type == "ellipse" and request.ellipse is None:
            raise HTTPException(
                status_code=400,
                detail="Ellipse region is required when region_type is 'ellipse'",
            )

        # Resolve storage key to local path (works with local or S3 storage)
        local_path = resolve_fits_path(request.file_path)
        logger.info(f"Computing region statistics for: {local_path.name}")

        with fits.open(local_path) as hdul:
            # Find image data
            data = None
            if request.hdu_index >= 0:
                if request.hdu_index >= len(hdul):
                    raise HTTPException(
                        status_code=400,
                        detail=f"HDU index {request.hdu_index} out of range (file has {len(hdul)} HDUs)",
                    )
                hdu = hdul[request.hdu_index]
                if hdu.data is not None and len(hdu.data.shape) >= 2:
                    data = hdu.data.astype(np.float64)
            else:
                # Find first image HDU
                for hdu in hdul:
                    if hdu.data is not None and len(hdu.data.shape) >= 2:
                        data = hdu.data.astype(np.float64)
                        break

            if data is None:
                raise HTTPException(status_code=400, detail="No image data found in FITS file")

            # Handle 3D+ cubes - take middle slice
            while len(data.shape) > 2:
                mid_idx = data.shape[0] // 2
                data = data[mid_idx]

            # Create region mask
            if request.region_type == "rectangle":
                r = request.rectangle
                assert r is not None
                mask = create_rectangle_mask(data.shape, r.x, r.y, r.width, r.height)
            else:
                e = request.ellipse
                assert e is not None
                mask = create_ellipse_mask(data.shape, e.cx, e.cy, e.rx, e.ry)

            # Extract pixels and filter NaNs
            region_pixels = data[mask]
            valid_pixels = region_pixels[np.isfinite(region_pixels)]

            if len(valid_pixels) == 0:
                raise HTTPException(
                    status_code=400,
                    detail="No valid pixels in selected region",
                )

            logger.info(
                f"Region statistics: {len(valid_pixels)} valid pixels "
                f"(of {np.sum(mask)} total in region)"
            )

            return RegionStatisticsResponse(
                mean=float(np.mean(valid_pixels)),
                median=float(np.median(valid_pixels)),
                std=float(np.std(valid_pixels)),
                min=float(np.min(valid_pixels)),
                max=float(np.max(valid_pixels)),
                sum=float(np.sum(valid_pixels)),
                pixel_count=int(len(valid_pixels)),
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error computing region statistics: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Region statistics computation failed: {str(e)}"
        ) from e
