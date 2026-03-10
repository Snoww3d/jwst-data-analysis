"""
FastAPI routes for region selection and statistics computation.
"""

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError

import numpy as np
from astropy.io import fits
from astropy.io.fits import BinTableHDU, TableHDU
from astropy.table import Table
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
    SpectralColumnMeta,
    SpectralDataResponse,
    TableColumnInfo,
    TableDataResponse,
    TableHduInfo,
    TableInfoResponse,
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


def _serialize_cell(val):
    """Safely serialize a table cell value for JSON."""
    if val is None:
        return None

    # Handle numpy masked values
    if hasattr(val, "mask") and np.ma.is_masked(val):
        return None

    # Handle bytes
    if isinstance(val, bytes):
        try:
            return val.decode("utf-8", errors="replace").strip()
        except Exception:
            return str(val)

    # Handle numpy arrays / multi-element values
    if hasattr(val, "__len__") and not isinstance(val, str):
        try:
            result = str(val)
            return result[:100] if len(result) > 100 else result
        except Exception:
            return None

    # Handle numpy scalars
    if hasattr(val, "item"):
        try:
            native = val.item()
            # Check for NaN/inf
            if isinstance(native, float) and (math.isnan(native) or math.isinf(native)):
                return None
            return native
        except Exception:
            return str(val)

    # Handle regular floats with NaN/inf
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return None
        return val

    return val


def _safe_str(val) -> str:
    """Convert a cell value to string for search."""
    if val is None:
        return ""
    if hasattr(val, "mask") and np.ma.is_masked(val):
        return ""
    if isinstance(val, bytes):
        try:
            return val.decode("utf-8", errors="replace").strip()
        except Exception:
            return ""
    try:
        return str(val)
    except Exception:
        return ""


@router.post("/region-statistics", response_model=RegionStatisticsResponse)
def compute_region_statistics(request: RegionStatisticsRequest):
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
def detect_sources_endpoint(request: SourceDetectionRequest):
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

            # Limit image size to prevent OOM during background estimation
            max_analysis_pixels = 50_000_000  # 50 megapixels
            if data.shape[0] * data.shape[1] > max_analysis_pixels:
                raise HTTPException(
                    status_code=413,
                    detail=f"Image too large for source detection ({data.shape[0]}x{data.shape[1]} = {data.shape[0] * data.shape[1]:,} pixels). Maximum: {max_analysis_pixels:,}",
                )

            # Handle NaN values for background estimation
            nan_mask = ~np.isfinite(data)
            if np.all(nan_mask):
                raise HTTPException(
                    status_code=400,
                    detail="Image contains only NaN/inf values; cannot detect sources",
                )
            has_nan = np.any(nan_mask)
            if has_nan:
                fill_val = float(np.nanmedian(data))
                data = np.nan_to_num(data, nan=fill_val, posinf=fill_val, neginf=0.0)

            # Estimate background with timeout to prevent indefinite hangs
            # on pathological data where the iterative algorithm won't converge.
            BACKGROUND_TIMEOUT_SECS = 60
            try:
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(
                        estimate_background,
                        data,
                        coverage_mask=nan_mask if has_nan else None,
                    )
                    background, background_rms = future.result(timeout=BACKGROUND_TIMEOUT_SECS)
            except FuturesTimeoutError:
                logger.warning(
                    f"2D background estimation timed out after {BACKGROUND_TIMEOUT_SECS}s, "
                    "using simple estimate"
                )
                from app.processing.background import estimate_background_simple

                bkg_val, bkg_rms = estimate_background_simple(data)
                background = np.full_like(data, bkg_val)
                background_rms = np.full_like(data, bkg_rms)
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

            # Filter out sources in originally-NaN regions (e.g. detector borders)
            if has_nan and sources_list:
                pre_filter = len(sources_list)
                valid_sources = []
                img_h, img_w = nan_mask.shape
                for s in sources_list:
                    yi = int(round(s.ycentroid))
                    xi = int(round(s.xcentroid))
                    if 0 <= yi < img_h and 0 <= xi < img_w and not nan_mask[yi, xi]:
                        valid_sources.append(s)
                sources_list = valid_sources
                if pre_filter != len(sources_list):
                    logger.info(f"Filtered {pre_filter - len(sources_list)} sources in NaN regions")

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


@router.get("/table-info", response_model=TableInfoResponse)
def get_table_info(file_path: str):
    """
    List table HDUs in a FITS file with column metadata.
    """
    try:
        local_path = resolve_fits_path(file_path)
        logger.info(f"Getting table info for: {local_path.name}")

        table_hdus = []
        with fits.open(local_path, memmap=True) as hdul:
            for i, hdu in enumerate(hdul):
                if not isinstance(hdu, (BinTableHDU, TableHDU)):
                    continue

                columns = []
                for col in hdu.columns:
                    is_array = False
                    array_shape = None
                    dtype_str = col.format

                    # Detect array columns (e.g. "10E" = array of 10 floats)
                    if col.dim is not None:
                        is_array = True
                        # Parse TDIM string like "(10,)" or "(3,4)"
                        dim_str = col.dim.strip("()")
                        if dim_str:
                            array_shape = [int(x.strip()) for x in dim_str.split(",") if x.strip()]
                    elif (
                        len(col.format) > 1
                        and col.format[:-1].isdigit()
                        and int(col.format[:-1]) > 1
                    ):
                        is_array = True
                        array_shape = [int(col.format[:-1])]

                    columns.append(
                        TableColumnInfo(
                            name=col.name,
                            dtype=dtype_str,
                            unit=str(col.unit) if col.unit else None,
                            format=col.disp,
                            is_array=is_array,
                            array_shape=array_shape,
                        )
                    )

                table_hdus.append(
                    TableHduInfo(
                        index=i,
                        name=hdu.name if hdu.name != "" else None,
                        hdu_type=type(hdu).__name__,
                        n_rows=hdu.data.shape[0] if hdu.data is not None else 0,
                        n_columns=len(hdu.columns),
                        columns=columns,
                    )
                )

        return TableInfoResponse(
            file_name=local_path.name,
            table_hdus=table_hdus,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting table info: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read table info: {str(e)}") from e


@router.get("/table-data", response_model=TableDataResponse)
def get_table_data(
    file_path: str,
    hdu_index: int = 0,
    page: int = 0,
    page_size: int = 100,
    sort_column: str | None = None,
    sort_direction: str | None = None,
    search: str | None = None,
):
    """
    Read paginated data from a specific table HDU.
    """
    try:
        # Validate page_size
        if page_size < 1 or page_size > 500:
            raise HTTPException(status_code=400, detail="page_size must be between 1 and 500")
        if page < 0:
            raise HTTPException(status_code=400, detail="page must be >= 0")

        local_path = resolve_fits_path(file_path)
        logger.info(f"Getting table data for: {local_path.name}, HDU {hdu_index}")

        with fits.open(local_path, memmap=True) as hdul:
            if hdu_index < 0 or hdu_index >= len(hdul):
                raise HTTPException(
                    status_code=400,
                    detail=f"HDU index {hdu_index} out of range (file has {len(hdul)} HDUs)",
                )

            hdu = hdul[hdu_index]
            if not isinstance(hdu, (BinTableHDU, TableHDU)):
                raise HTTPException(
                    status_code=400,
                    detail=f"HDU {hdu_index} is not a table (type: {type(hdu).__name__})",
                )

            # Read as astropy Table for easier manipulation
            table = Table.read(local_path, hdu=hdu_index)

            # Build column metadata
            columns = []
            for col in hdu.columns:
                is_array = False
                array_shape = None
                if col.dim is not None:
                    is_array = True
                    dim_str = col.dim.strip("()")
                    if dim_str:
                        array_shape = [int(x.strip()) for x in dim_str.split(",") if x.strip()]
                elif len(col.format) > 1 and col.format[:-1].isdigit() and int(col.format[:-1]) > 1:
                    is_array = True
                    array_shape = [int(col.format[:-1])]

                columns.append(
                    TableColumnInfo(
                        name=col.name,
                        dtype=col.format,
                        unit=str(col.unit) if col.unit else None,
                        format=col.disp,
                        is_array=is_array,
                        array_shape=array_shape,
                    )
                )

            total_rows = len(table)
            col_names = table.colnames

            # Search filter: find rows where any cell contains the search term
            if search and search.strip():
                search_lower = search.strip().lower()
                mask = np.zeros(len(table), dtype=bool)
                for col_name in col_names:
                    try:
                        col_data = table[col_name]
                        str_vals = [_safe_str(val).lower() for val in col_data]
                        for idx, sv in enumerate(str_vals):
                            if search_lower in sv:
                                mask[idx] = True
                    except Exception:
                        continue
                table = table[mask]
                total_rows = len(table)

            # Sort
            if sort_column and sort_column in col_names:
                try:
                    table.sort(sort_column)
                    if sort_direction and sort_direction.lower() == "desc":
                        table.reverse()
                except Exception:
                    pass  # Skip sort if column is not sortable (e.g., array column)

            # Paginate
            start = page * page_size
            end = min(start + page_size, len(table))
            if start >= len(table) and len(table) > 0:
                # Clamp to last page
                page = max(0, (len(table) - 1) // page_size)
                start = page * page_size
                end = min(start + page_size, len(table))

            page_table = table[start:end] if len(table) > 0 else table

            # Serialize rows
            rows = []
            for row in page_table:
                row_dict = {}
                for col_name in col_names:
                    row_dict[col_name] = _serialize_cell(row[col_name])
                rows.append(row_dict)

            return TableDataResponse(
                hdu_index=hdu_index,
                hdu_name=hdu.name if hdu.name != "" else None,
                total_rows=total_rows,
                total_columns=len(col_names),
                page=page,
                page_size=page_size,
                columns=columns,
                rows=rows,
                sort_column=sort_column,
                sort_direction=sort_direction,
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting table data: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read table data: {str(e)}") from e


# Spectral column names to look for (case-insensitive matching)
SPECTRAL_WAVELENGTH_NAMES = {"WAVELENGTH", "WAVE", "LAMBDA"}
SPECTRAL_KNOWN_COLUMNS = {
    "WAVELENGTH",
    "WAVE",
    "LAMBDA",
    "FLUX",
    "FLUX_ERROR",
    "ERROR",
    "SURF_BRIGHT",
    "SB_ERROR",
    "NET",
    "BACKGROUND",
    "BACKGROUND_ERROR",
    "DQ",
    "NPIXELS",
    "BERROR",
    "FLUX_VAR_POISSON",
    "FLUX_VAR_RNOISE",
    "FLUX_VAR_FLAT",
    "SB_VAR_POISSON",
    "SB_VAR_RNOISE",
    "SB_VAR_FLAT",
}

MAX_SPECTRAL_POINTS = 500_000


def _serialize_array(col_data) -> list:
    """Serialize a table column array for JSON (spectral data).

    Handles numpy scalars, masked values, NaN/inf, bytes, and
    variable-length array elements. Mirrors _serialize_cell logic.
    """
    result = []
    for val in col_data:
        if val is None or (hasattr(val, "mask") and np.ma.is_masked(val)):
            result.append(None)
        elif isinstance(val, bytes):
            try:
                result.append(val.decode("utf-8", errors="replace").strip())
            except Exception:
                result.append(str(val))
        elif hasattr(val, "__len__") and not isinstance(val, str):
            # Multi-element arrays (e.g. variable-length columns) — skip
            result.append(None)
        elif hasattr(val, "item"):
            try:
                native = val.item()
                if isinstance(native, float) and (math.isnan(native) or math.isinf(native)):
                    result.append(None)
                else:
                    result.append(native)
            except (ValueError, OverflowError):
                result.append(None)
        elif isinstance(val, float):
            if math.isnan(val) or math.isinf(val):
                result.append(None)
            else:
                result.append(val)
        else:
            result.append(val)
    return result


@router.get("/spectral-data", response_model=SpectralDataResponse)
def get_spectral_data(file_path: str, hdu_index: int = 1):
    """
    Extract spectral data from a FITS file for plotting.

    Returns column arrays (wavelength, flux, error, etc.) optimized for
    chart rendering rather than paginated table display.
    """
    try:
        if hdu_index < 0:
            raise HTTPException(status_code=400, detail="hdu_index must be >= 0")

        if not file_path or not file_path.strip():
            raise HTTPException(status_code=400, detail="file_path is required")

        local_path = resolve_fits_path(file_path)
        logger.info(f"Getting spectral data for: {local_path.name}, HDU {hdu_index}")

        with fits.open(local_path, memmap=True) as hdul:
            if hdu_index >= len(hdul):
                raise HTTPException(
                    status_code=400,
                    detail=f"HDU index {hdu_index} out of range (file has {len(hdul)} HDUs)",
                )

            hdu = hdul[hdu_index]
            if not isinstance(hdu, (BinTableHDU, TableHDU)):
                raise HTTPException(
                    status_code=400,
                    detail=f"HDU {hdu_index} is not a table (type: {type(hdu).__name__})",
                )

            # Read as astropy Table
            table = Table.read(local_path, hdu=hdu_index)

            # Find wavelength column (case-insensitive)
            col_names_upper = {name.upper(): name for name in table.colnames}
            wavelength_col = None
            for wl_name in SPECTRAL_WAVELENGTH_NAMES:
                if wl_name in col_names_upper:
                    wavelength_col = col_names_upper[wl_name]
                    break

            if wavelength_col is None:
                raise HTTPException(
                    status_code=400,
                    detail="No WAVELENGTH column found. This does not appear to be a spectral file.",
                )

            # Determine which columns to include
            columns_to_include = []
            for col_name in table.colnames:
                # Skip array columns (multi-dimensional)
                col_data = table[col_name]
                if hasattr(col_data, "ndim") and col_data.ndim > 1:
                    continue
                # Include known spectral columns
                if col_name.upper() in SPECTRAL_KNOWN_COLUMNS:
                    columns_to_include.append(col_name)

            # Ensure wavelength is first
            if wavelength_col in columns_to_include:
                columns_to_include.remove(wavelength_col)
            columns_to_include.insert(0, wavelength_col)

            n_points = len(table)

            if n_points > MAX_SPECTRAL_POINTS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Spectrum too large ({n_points} points). Maximum is {MAX_SPECTRAL_POINTS}.",
                )

            # Build response
            column_metas = []
            data_dict = {}
            for col_name in columns_to_include:
                col = table[col_name]
                unit_str = str(col.unit) if col.unit and str(col.unit) != "" else None

                column_metas.append(
                    SpectralColumnMeta(
                        name=col_name,
                        unit=unit_str,
                        n_points=n_points,
                    )
                )

                data_dict[col_name] = _serialize_array(col.data)

            return SpectralDataResponse(
                hdu_index=hdu_index,
                hdu_name=hdu.name or None,
                n_points=n_points,
                columns=column_metas,
                data=data_dict,
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting spectral data: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Failed to read spectral data: {str(e)}"
        ) from e
