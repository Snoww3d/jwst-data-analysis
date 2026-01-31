"""
JWST Image Processing Module

This module provides comprehensive image processing capabilities for
James Webb Space Telescope data analysis.

Modules:
    - utils: FITS file I/O and basic utilities
    - background: Background estimation and subtraction
    - filters: Noise reduction and smoothing filters
    - enhancement: Contrast and display enhancement
    - statistics: Robust statistical analysis
    - detection: Source detection (point and extended)
    - pipeline: Processing pipeline composition
    - analysis: Legacy analysis functions

Reference: docs/JWST_Image_Processing_Research.pdf
"""

# Utilities
# Legacy analysis (for backward compatibility)
from .analysis import perform_basic_analysis

# Background estimation
from .background import (
    create_background_mask,
    estimate_background,
    estimate_background_simple,
    get_background_statistics,
    subtract_background,
)

# Source detection
from .detection import (
    create_source_catalog,
    detect_extended_sources,
    detect_point_sources,
    detect_sources,
    estimate_fwhm,
    sources_to_dict,
)

# Image enhancement
from .enhancement import (
    adjust_brightness_contrast,
    apply_colormap,
    asinh_stretch,
    create_rgb_image,
    enhance_image,
    histogram_equalization,
    log_stretch,
    normalize_to_range,
    power_stretch,
    sqrt_stretch,
    zscale_stretch,
)

# Noise reduction filters
from .filters import (
    astropy_box_filter,
    astropy_gaussian_filter,
    box_filter,
    gaussian_filter,
    median_filter,
    reduce_noise,
    sigma_clip_pixels,
    unsharp_mask,
)

# Pipeline
from .pipeline import (
    PipelineResult,
    PipelineStep,
    ProcessingPipeline,
    create_standard_pipeline,
    run_pipeline_async,
)

# Statistical analysis
from .statistics import (
    compare_images,
    compute_advanced_stats,
    compute_basic_stats,
    compute_histogram,
    compute_percentiles,
    compute_robust_stats,
    compute_snr,
    compute_statistics,
)
from .utils import (
    load_fits_data,
    normalize_array,
    save_fits_data,
)


__all__ = [
    # Utils
    "load_fits_data",
    "save_fits_data",
    "normalize_array",
    # Background
    "estimate_background",
    "estimate_background_simple",
    "subtract_background",
    "create_background_mask",
    "get_background_statistics",
    # Filters
    "gaussian_filter",
    "median_filter",
    "box_filter",
    "astropy_gaussian_filter",
    "astropy_box_filter",
    "reduce_noise",
    "unsharp_mask",
    "sigma_clip_pixels",
    # Enhancement
    "normalize_to_range",
    "zscale_stretch",
    "asinh_stretch",
    "log_stretch",
    "sqrt_stretch",
    "power_stretch",
    "histogram_equalization",
    "enhance_image",
    "adjust_brightness_contrast",
    "create_rgb_image",
    "apply_colormap",
    # Statistics
    "compute_basic_stats",
    "compute_robust_stats",
    "compute_advanced_stats",
    "compute_statistics",
    "compute_histogram",
    "compute_percentiles",
    "compute_snr",
    "compare_images",
    # Detection
    "detect_point_sources",
    "detect_extended_sources",
    "create_source_catalog",
    "detect_sources",
    "sources_to_dict",
    "estimate_fwhm",
    # Pipeline
    "PipelineStep",
    "PipelineResult",
    "ProcessingPipeline",
    "create_standard_pipeline",
    "run_pipeline_async",
    # Legacy
    "perform_basic_analysis",
]
