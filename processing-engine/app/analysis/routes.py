"""
FastAPI routes for region selection and statistics computation.
"""

import logging

import numpy as np
from astropy.io import fits
from fastapi import APIRouter, HTTPException

from app.processing.background import estimate_background
from app.processing.detection import detect_sources, sources_to_dict
from app.storage.helpers import resolve_fits_path

from .models import (
    RegionStatisticsRequest,
    RegionStatisticsResponse,
    SourceDetectionRequest,
    SourceDetectionResponse,
    SourceInfo,
)


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


@router.post("/detect-sources", response_model=SourceDetectionResponse)
async def detect_sources_endpoint(request: SourceDetectionRequest):
    """
    Detect astronomical sources in a FITS image.

    Uses background estimation followed by source detection via DAOFIND,
    IRAF starfinder, or image segmentation depending on the method parameter.
    """
    try:
        # Validate method
        valid_methods = {"auto", "daofind", "iraf", "segmentation"}
        if request.method not in valid_methods:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid method '{request.method}'. Must be one of: {', '.join(sorted(valid_methods))}",
            )

        # Resolve storage key to local path
        local_path = resolve_fits_path(request.file_path)
        logger.info(f"Detecting sources in: {local_path.name}")

        with fits.open(local_path) as hdul:
            # Find image data
            data = None
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

            # Handle NaN values for background estimation
            nan_mask = ~np.isfinite(data)
            if np.any(nan_mask):
                data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)

            # Estimate background
            try:
                background, background_rms = estimate_background(data)
            except Exception as bkg_err:
                logger.warning(f"2D background estimation failed: {bkg_err}, using simple estimate")
                from app.processing.background import estimate_background_simple

                bkg_val, bkg_rms = estimate_background_simple(data)
                background = np.full_like(data, bkg_val)
                background_rms = np.full_like(data, bkg_rms)

            # Detect sources
            result = detect_sources(
                data,
                background,
                background_rms,
                method=request.method,
                threshold_sigma=request.threshold_sigma,
                fwhm=request.fwhm,
                npixels=request.npixels,
                deblend=request.deblend,
            )

            # Convert sources to response format
            sources_list = []
            if result["sources"] is not None:
                # Point source detection returns a Table
                raw_sources = sources_to_dict(result["sources"])
                for i, s in enumerate(raw_sources):
                    sources_list.append(
                        SourceInfo(
                            id=s.get("id", i + 1),
                            xcentroid=s.get("xcentroid", 0.0),
                            ycentroid=s.get("ycentroid", 0.0),
                            flux=s.get("flux", None),
                            sharpness=s.get("sharpness", None),
                            roundness=s.get("roundness1", s.get("roundness", None)),
                            fwhm=None,
                            peak=s.get("peak", None),
                        )
                    )
            elif result["catalog"] is not None:
                # Segmentation returns a catalog Table
                raw_sources = sources_to_dict(result["catalog"])
                for i, s in enumerate(raw_sources):
                    xc = s.get("xcentroid", 0.0)
                    yc = s.get("ycentroid", 0.0)
                    # Handle potential masked/nan values
                    if not np.isfinite(xc):
                        xc = 0.0
                    if not np.isfinite(yc):
                        yc = 0.0
                    sources_list.append(
                        SourceInfo(
                            id=s.get("label", i + 1),
                            xcentroid=float(xc),
                            ycentroid=float(yc),
                            flux=float(s["segment_flux"])
                            if "segment_flux" in s and np.isfinite(s["segment_flux"])
                            else None,
                            sharpness=None,
                            roundness=None,
                            fwhm=float(s["equivalent_radius"]) * 2
                            if "equivalent_radius" in s
                            and np.isfinite(s.get("equivalent_radius", float("nan")))
                            else None,
                            peak=float(s["max_value"])
                            if "max_value" in s and np.isfinite(s.get("max_value", float("nan")))
                            else None,
                        )
                    )

            logger.info(f"Detected {len(sources_list)} sources using {result['method']}")

            return SourceDetectionResponse(
                sources=sources_list,
                n_sources=len(sources_list),
                method=result["method"],
                threshold_sigma=result["threshold_sigma"],
                threshold_value=result["threshold_value"],
                estimated_fwhm=None,
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error detecting sources: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Source detection failed: {str(e)}") from e
