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
from .utils import (
    load_fits_data,
    save_fits_data,
    normalize_array,
)

# Background estimation
from .background import (
    estimate_background,
    estimate_background_simple,
    subtract_background,
    create_background_mask,
    get_background_statistics,
)

# Noise reduction filters
from .filters import (
    gaussian_filter,
    median_filter,
    box_filter,
    astropy_gaussian_filter,
    astropy_box_filter,
    reduce_noise,
    unsharp_mask,
    sigma_clip_pixels,
)

# Image enhancement
from .enhancement import (
    normalize_to_range,
    zscale_stretch,
    asinh_stretch,
    log_stretch,
    sqrt_stretch,
    power_stretch,
    histogram_equalization,
    enhance_image,
    adjust_brightness_contrast,
    create_rgb_image,
    apply_colormap,
)

# Statistical analysis
from .statistics import (
    compute_basic_stats,
    compute_robust_stats,
    compute_advanced_stats,
    compute_statistics,
    compute_histogram,
    compute_percentiles,
    compute_snr,
    compare_images,
)

# Source detection
from .detection import (
    detect_point_sources,
    detect_extended_sources,
    create_source_catalog,
    detect_sources,
    sources_to_dict,
    estimate_fwhm,
)

# Pipeline
from .pipeline import (
    PipelineStep,
    PipelineResult,
    ProcessingPipeline,
    create_standard_pipeline,
    run_pipeline_async,
)

# Legacy analysis (for backward compatibility)
from .analysis import perform_basic_analysis

__all__ = [
    # Utils
    'load_fits_data',
    'save_fits_data',
    'normalize_array',

    # Background
    'estimate_background',
    'estimate_background_simple',
    'subtract_background',
    'create_background_mask',
    'get_background_statistics',

    # Filters
    'gaussian_filter',
    'median_filter',
    'box_filter',
    'astropy_gaussian_filter',
    'astropy_box_filter',
    'reduce_noise',
    'unsharp_mask',
    'sigma_clip_pixels',

    # Enhancement
    'normalize_to_range',
    'zscale_stretch',
    'asinh_stretch',
    'log_stretch',
    'sqrt_stretch',
    'power_stretch',
    'histogram_equalization',
    'enhance_image',
    'adjust_brightness_contrast',
    'create_rgb_image',
    'apply_colormap',

    # Statistics
    'compute_basic_stats',
    'compute_robust_stats',
    'compute_advanced_stats',
    'compute_statistics',
    'compute_histogram',
    'compute_percentiles',
    'compute_snr',
    'compare_images',

    # Detection
    'detect_point_sources',
    'detect_extended_sources',
    'create_source_catalog',
    'detect_sources',
    'sources_to_dict',
    'estimate_fwhm',

    # Pipeline
    'PipelineStep',
    'PipelineResult',
    'ProcessingPipeline',
    'create_standard_pipeline',
    'run_pipeline_async',

    # Legacy
    'perform_basic_analysis',
]
