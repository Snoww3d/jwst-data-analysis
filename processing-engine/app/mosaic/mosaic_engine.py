"""
Core WCS mosaic engine using the reproject library.

Reprojects multiple FITS files onto a common WCS grid and combines them.
"""

import logging
from pathlib import Path

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from reproject import reproject_interp
from reproject.mosaicking import find_optimal_celestial_wcs, reproject_and_coadd


logger = logging.getLogger(__name__)


def load_fits_2d_with_wcs(file_path: Path) -> tuple[np.ndarray, WCS]:
    """
    Load 2D image data and celestial WCS from a FITS file.

    Handles 3D+ cubes by extracting the middle slice.
    Replaces NaN/Inf with 0.0.

    Args:
        file_path: Path to the FITS file

    Returns:
        Tuple of (2D numpy array, WCS object)

    Raises:
        ValueError: If no image data or no celestial WCS found
    """
    with fits.open(file_path) as hdul:
        data = None
        header = None

        for hdu in hdul:
            if hdu.data is not None and len(hdu.data.shape) >= 2:
                data = hdu.data.astype(np.float64)
                header = hdu.header
                break

        if data is None:
            raise ValueError(f"No image data found in FITS file: {file_path.name}")

        # Handle 3D+ data cubes - take middle slice
        while len(data.shape) > 2:
            mid_idx = data.shape[0] // 2
            data = data[mid_idx]

        # Handle NaN/Inf values
        data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)

        # Extract celestial WCS
        wcs = WCS(header, naxis=2)
        if not wcs.has_celestial:
            raise ValueError(f"No celestial WCS found in FITS file: {file_path.name}")

        # Ensure WCS shape matches data
        wcs_celestial = wcs.celestial
        return data, wcs_celestial


def generate_mosaic(
    file_data: list[tuple[np.ndarray, WCS]],
    combine_method: str = "mean",
    max_output_pixels: int = 64_000_000,
) -> tuple[np.ndarray, np.ndarray, WCS]:
    """
    Reproject and combine multiple images onto a common WCS grid.

    Args:
        file_data: List of (data, wcs) tuples from load_fits_2d_with_wcs
        combine_method: How to combine overlapping pixels ('mean', 'median', 'sum')
        max_output_pixels: Maximum output grid size in pixels

    Returns:
        Tuple of (mosaic_array, footprint_array, output_wcs)

    Raises:
        ValueError: If reprojection fails or output is too large
    """
    # Build input list for reproject_and_coadd
    input_data = [(data, wcs) for data, wcs in file_data]

    # Find optimal output WCS covering all inputs
    try:
        wcs_out, shape_out = find_optimal_celestial_wcs(input_data)
    except Exception as e:
        raise ValueError(f"Could not determine common WCS for input files: {e}") from e

    # Check output size limit
    total_pixels = shape_out[0] * shape_out[1]
    if total_pixels > max_output_pixels:
        raise ValueError(
            f"Output mosaic would be {total_pixels:,} pixels "
            f"(max {max_output_pixels:,}). "
            f"Shape: {shape_out[1]}x{shape_out[0]}"
        )

    logger.info(
        f"Mosaic output grid: {shape_out[1]}x{shape_out[0]} "
        f"({total_pixels:,} pixels), combine={combine_method}"
    )

    # Validate combine_method
    valid_methods = {"mean", "sum", "first", "last", "min", "max"}
    combine_func = combine_method if combine_method in valid_methods else "mean"

    # Reproject and combine
    try:
        mosaic_array, footprint_array = reproject_and_coadd(
            input_data,
            wcs_out,
            shape_out=shape_out,
            reproject_function=reproject_interp,
            combine_function=combine_func,
        )
    except Exception as e:
        raise ValueError(f"Mosaic reprojection failed: {e}") from e

    # Replace any remaining NaN with 0
    mosaic_array = np.nan_to_num(mosaic_array, nan=0.0, posinf=0.0, neginf=0.0)

    return mosaic_array, footprint_array, wcs_out


def get_footprints(
    file_data: list[tuple[np.ndarray, WCS, str]],
) -> tuple[list[dict], dict]:
    """
    Compute corner RA/Dec coordinates for each file's WCS footprint.

    Args:
        file_data: List of (data, wcs, file_path) tuples

    Returns:
        Tuple of (footprint_list, bounding_box)
        footprint_list: List of dicts with corners_ra, corners_dec, center_ra, center_dec
        bounding_box: Dict with min_ra, max_ra, min_dec, max_dec
    """
    footprints = []
    all_ra = []
    all_dec = []

    for data, wcs, file_path in file_data:
        height, width = data.shape

        # Corner pixel coordinates (0-indexed)
        corners_x = [0, width - 1, width - 1, 0]
        corners_y = [0, 0, height - 1, height - 1]

        # Convert pixel to world coordinates
        corners_ra_list = []
        corners_dec_list = []
        for cx, cy in zip(corners_x, corners_y, strict=True):
            world = wcs.pixel_to_world_values(cx, cy)
            corners_ra_list.append(float(world[0]))
            corners_dec_list.append(float(world[1]))

        # Center pixel
        center_world = wcs.pixel_to_world_values(width / 2, height / 2)
        center_ra = float(center_world[0])
        center_dec = float(center_world[1])

        footprints.append(
            {
                "file_path": file_path,
                "corners_ra": corners_ra_list,
                "corners_dec": corners_dec_list,
                "center_ra": center_ra,
                "center_dec": center_dec,
            }
        )

        all_ra.extend(corners_ra_list)
        all_dec.extend(corners_dec_list)

    bounding_box = {
        "min_ra": min(all_ra),
        "max_ra": max(all_ra),
        "min_dec": min(all_dec),
        "max_dec": max(all_dec),
    }

    return footprints, bounding_box
