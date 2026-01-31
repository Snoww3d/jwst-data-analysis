"""
Source Detection Module

Provides functions for detecting astronomical sources in images.
Includes both point source detection (stars) and extended source detection
(galaxies, nebulae) via image segmentation.

Reference: docs/JWST_Image_Processing_Research.pdf Section 3.4
"""

import logging
from typing import Any, Literal

import numpy as np
from astropy.table import Table
from numpy.typing import NDArray
from photutils.detection import DAOStarFinder, IRAFStarFinder
from photutils.segmentation import SourceCatalog, deblend_sources
from photutils.segmentation import detect_sources as photutils_detect_sources


logger = logging.getLogger(__name__)

# Type alias for detection methods
DetectionMethod = Literal["daofind", "iraf", "segmentation", "auto"]


def detect_point_sources(
    data: NDArray[np.floating],
    threshold: float,
    fwhm: float = 3.0,
    method: Literal["daofind", "iraf"] = "daofind",
    sharplo: float = 0.2,
    sharphi: float = 1.0,
    roundlo: float = -1.0,
    roundhi: float = 1.0,
    exclude_border: bool = True,
) -> Table | None:
    """
    Detect point sources (stars) using DAOFIND or IRAF algorithm.

    The DAOFIND algorithm convolves the image with a Gaussian kernel
    matching the expected PSF and identifies local maxima above threshold.

    Args:
        data: 2D background-subtracted image array
        threshold: Detection threshold (typically n * background_rms)
        fwhm: Expected FWHM of point sources in pixels (default: 3.0)
        method: Detection algorithm ('daofind' or 'iraf', default: 'daofind')
        sharplo: Lower sharpness bound (default: 0.2)
        sharphi: Upper sharpness bound (default: 1.0)
        roundlo: Lower roundness bound (default: -1.0)
        roundhi: Upper roundness bound (default: 1.0)
        exclude_border: Exclude sources near image border (default: True)

    Returns:
        Astropy Table with columns: id, xcentroid, ycentroid, flux, sharpness, etc.
        Returns None if no sources found.

    Example:
        >>> # After background subtraction
        >>> sources = detect_point_sources(data - background,
        ...                                threshold=5*bkg_rms,
        ...                                fwhm=2.5)
        >>> print(f"Found {len(sources)} stars")
    """
    logger.info(f"Detecting point sources with {method}, threshold={threshold:.2f}, fwhm={fwhm}")

    if method == "daofind":
        finder = DAOStarFinder(
            fwhm=fwhm,
            threshold=threshold,
            sharplo=sharplo,
            sharphi=sharphi,
            roundlo=roundlo,
            roundhi=roundhi,
            exclude_border=exclude_border,
        )
    elif method == "iraf":
        finder = IRAFStarFinder(
            fwhm=fwhm,
            threshold=threshold,
            sharplo=sharplo,
            sharphi=sharphi,
            roundlo=roundlo,
            roundhi=roundhi,
            exclude_border=exclude_border,
        )
    else:
        raise ValueError(f"Unknown method: {method}. Use 'daofind' or 'iraf'.")

    sources = finder(data)

    if sources is None:
        logger.info("No point sources detected")
        return None

    logger.info(f"Detected {len(sources)} point sources")
    return sources


def detect_extended_sources(
    data: NDArray[np.floating],
    threshold: float | NDArray[np.floating],
    npixels: int = 10,
    connectivity: int = 8,
    deblend: bool = True,
    nlevels: int = 32,
    contrast: float = 0.001,
    mask: NDArray[np.bool_] | None = None,
) -> Any:  # Returns SegmentationImage
    """
    Detect extended sources via image segmentation.

    Identifies connected regions of pixels above threshold and optionally
    deblends overlapping sources using multi-thresholding.

    Args:
        data: 2D image array (background-subtracted recommended)
        threshold: Detection threshold (scalar or 2D array like background + n*rms)
        npixels: Minimum pixels for a source (default: 10)
        connectivity: 4 or 8-connected pixels (default: 8)
        deblend: Whether to deblend overlapping sources (default: True)
        nlevels: Deblending threshold levels (default: 32)
        contrast: Deblending contrast parameter (default: 0.001)
        mask: Boolean mask where True excludes pixels

    Returns:
        SegmentationImage object with labeled sources

    Example:
        >>> threshold = background + 2.0 * background_rms
        >>> segm = detect_extended_sources(data, threshold, npixels=5)
        >>> print(f"Found {segm.nlabels} extended sources")
    """
    logger.info(f"Detecting extended sources with npixels={npixels}, deblend={deblend}")

    # Initial detection
    segm = photutils_detect_sources(
        data, threshold, npixels=npixels, connectivity=connectivity, mask=mask
    )

    if segm is None:
        logger.info("No extended sources detected")
        return None

    logger.info(f"Initial detection: {segm.nlabels} sources")

    # Optionally deblend
    if deblend and segm.nlabels > 0:
        try:
            segm = deblend_sources(data, segm, npixels=npixels, nlevels=nlevels, contrast=contrast)
            logger.info(f"After deblending: {segm.nlabels} sources")
        except Exception as e:
            logger.warning(f"Deblending failed: {e}")

    return segm


def create_source_catalog(
    data: NDArray[np.floating],
    segmentation,
    background: NDArray[np.floating] | None = None,
    error: NDArray[np.floating] | None = None,
) -> Table:
    """
    Create a catalog of source properties from segmentation.

    Extracts position, flux, shape, and other properties for each
    detected source in the segmentation map.

    Args:
        data: 2D image array
        segmentation: SegmentationImage from detect_extended_sources
        background: Background array for local background subtraction
        error: Error/uncertainty array for flux errors

    Returns:
        Astropy Table with source properties:
            - label, xcentroid, ycentroid
            - area, equivalent_radius
            - flux, flux_err (if error provided)
            - elongation, ellipticity, orientation
            - bbox coordinates

    Example:
        >>> segm = detect_extended_sources(data, threshold)
        >>> catalog = create_source_catalog(data, segm)
        >>> bright_sources = catalog[catalog['flux'] > 1000]
    """
    logger.info("Creating source catalog from segmentation")

    cat = SourceCatalog(data, segmentation, background=background, error=error)

    # Convert to table and select useful columns
    table = cat.to_table()

    logger.info(f"Created catalog with {len(table)} sources")

    return table


def detect_sources(
    data: NDArray[np.floating],
    background: NDArray[np.floating],
    background_rms: NDArray[np.floating],
    method: DetectionMethod = "auto",
    threshold_sigma: float = 5.0,
    fwhm: float = 3.0,
    npixels: int = 10,
    deblend: bool = True,
    **kwargs,
) -> dict[str, Any]:
    """
    Unified interface for source detection.

    Automatically chooses between point source and extended source
    detection based on method or image characteristics.

    Args:
        data: 2D image array (NOT background-subtracted)
        background: 2D background model
        background_rms: 2D background RMS model
        method: Detection method:
            - 'daofind': Point source detection with DAOFIND
            - 'iraf': Point source detection with IRAF starfind
            - 'segmentation': Extended source detection
            - 'auto': Choose based on image (default)
        threshold_sigma: Detection threshold in sigma (default: 5.0)
        fwhm: Expected FWHM for point sources (default: 3.0)
        npixels: Minimum pixels for extended sources (default: 10)
        deblend: Deblend extended sources (default: True)
        **kwargs: Additional method-specific parameters

    Returns:
        Dictionary with:
            - method: Detection method used
            - n_sources: Number of sources found
            - sources: Table of sources (for point sources)
            - segmentation: SegmentationImage (for extended sources)
            - catalog: Source catalog (for extended sources)
            - threshold: Threshold value used

    Example:
        >>> result = detect_sources(data, background, background_rms,
        ...                         threshold_sigma=3.0)
        >>> print(f"Found {result['n_sources']} sources using {result['method']}")
    """
    # Background subtract
    data_sub = data - background

    # Compute threshold
    threshold_value = threshold_sigma * np.median(background_rms)
    threshold_2d = threshold_sigma * background_rms

    result = {
        "method": method,
        "threshold_sigma": threshold_sigma,
        "threshold_value": float(threshold_value),
        "n_sources": 0,
        "sources": None,
        "segmentation": None,
        "catalog": None,
    }

    if method == "auto":
        # Simple heuristic: use point source for uniform backgrounds
        rms_variation = np.std(background_rms) / np.mean(background_rms)
        method = "daofind" if rms_variation < 0.1 else "segmentation"
        result["method"] = method
        logger.info(f"Auto-selected method: {method}")

    if method in ("daofind", "iraf"):
        sources = detect_point_sources(
            data_sub, threshold=threshold_value, fwhm=fwhm, method=method, **kwargs
        )
        if sources is not None:
            result["sources"] = sources
            result["n_sources"] = len(sources)

    elif method == "segmentation":
        segm = detect_extended_sources(
            data_sub, threshold=threshold_2d, npixels=npixels, deblend=deblend, **kwargs
        )
        if segm is not None:
            result["segmentation"] = segm
            result["n_sources"] = segm.nlabels

            # Also create catalog
            catalog = create_source_catalog(data_sub, segm, error=background_rms)
            result["catalog"] = catalog

    else:
        raise ValueError(f"Unknown method: {method}")

    logger.info(f"Detection complete: {result['n_sources']} sources found")

    return result


def sources_to_dict(sources: Table | None) -> list[dict[str, Any]]:
    """
    Convert source table to list of dictionaries for JSON serialization.

    Args:
        sources: Astropy Table of sources

    Returns:
        List of dictionaries, one per source
    """
    if sources is None:
        return []

    result = []
    for row in sources:
        source_dict = {}
        for col in sources.colnames:
            val = row[col]
            # Convert numpy types to Python types
            if hasattr(val, "item"):
                val = val.item()
            source_dict[col] = val
        result.append(source_dict)

    return result


def estimate_fwhm(
    data: NDArray[np.floating], threshold: float, max_sources: int = 100
) -> float | None:
    """
    Estimate the FWHM of point sources in an image.

    Uses initial detection with assumed FWHM, then refines estimate
    from detected source properties.

    Args:
        data: Background-subtracted 2D image
        threshold: Detection threshold
        max_sources: Maximum sources to use for estimate (default: 100)

    Returns:
        Estimated FWHM in pixels, or None if estimation fails
    """
    # Initial detection with default FWHM
    sources = detect_point_sources(data, threshold, fwhm=3.0)

    if sources is None or len(sources) < 3:
        logger.warning("Insufficient sources for FWHM estimation")
        return None

    # Use sharpness to estimate FWHM
    # For DAOStarFinder, FWHM ~ 1 / sqrt(sharpness) approximately
    # This is a rough estimate
    sharpness = sources["sharpness"][:max_sources]
    median_sharp = np.median(sharpness)

    if median_sharp <= 0:
        return None

    # Empirical relation (approximate)
    estimated_fwhm = 3.0 / np.sqrt(median_sharp / 0.5)

    logger.info(f"Estimated FWHM: {estimated_fwhm:.2f} pixels")

    return float(np.clip(estimated_fwhm, 1.0, 20.0))
