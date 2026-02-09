#!/usr/bin/env python3
"""
Generate JWST Image Processing Research PDF Document
"""

import os

from fpdf import FPDF
from datetime import datetime

class ResearchPDF(FPDF):
    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=20)

    def header(self):
        self.set_font('Helvetica', 'I', 9)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, 'JWST Data Analysis Application - Technical Research Document', align='C')
        self.ln(5)
        self.set_draw_color(200, 200, 200)
        self.line(10, 18, 200, 18)
        self.ln(10)

    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f'Page {self.page_no()}/{{nb}}', align='C')

    def chapter_title(self, title):
        self.set_font('Helvetica', 'B', 16)
        self.set_text_color(31, 73, 125)
        self.cell(0, 10, title, ln=True)
        self.ln(2)

    def section_title(self, title):
        self.set_font('Helvetica', 'B', 12)
        self.set_text_color(51, 51, 51)
        self.cell(0, 8, title, ln=True)
        self.ln(1)

    def subsection_title(self, title):
        self.set_font('Helvetica', 'B', 11)
        self.set_text_color(80, 80, 80)
        self.cell(0, 7, title, ln=True)
        self.ln(1)

    def body_text(self, text):
        self.set_font('Helvetica', '', 10)
        self.set_text_color(51, 51, 51)
        self.multi_cell(0, 5, text)
        self.ln(2)

    def bullet_point(self, text, indent=5):
        self.set_font('Helvetica', '', 10)
        self.set_text_color(51, 51, 51)
        x = self.get_x()
        self.set_x(x + indent)
        self.cell(5, 5, chr(149))  # bullet character
        self.multi_cell(0, 5, text)
        self.set_x(x)

    def code_block(self, code):
        self.set_font('Courier', '', 9)
        self.set_fill_color(245, 245, 245)
        self.set_text_color(51, 51, 51)
        self.multi_cell(0, 4.5, code, fill=True)
        self.ln(3)

    def table_header(self, headers, widths):
        self.set_font('Helvetica', 'B', 9)
        self.set_fill_color(31, 73, 125)
        self.set_text_color(255, 255, 255)
        for i, header in enumerate(headers):
            self.cell(widths[i], 7, header, border=1, fill=True, align='C')
        self.ln()

    def table_row(self, data, widths, fill=False):
        self.set_font('Helvetica', '', 9)
        self.set_text_color(51, 51, 51)
        if fill:
            self.set_fill_color(240, 240, 240)
        for i, cell in enumerate(data):
            self.cell(widths[i], 6, cell, border=1, fill=fill, align='L')
        self.ln()


def create_pdf():
    pdf = ResearchPDF()
    pdf.alias_nb_pages()

    # Title Page
    pdf.add_page()
    pdf.set_font('Helvetica', 'B', 28)
    pdf.set_text_color(31, 73, 125)
    pdf.ln(40)
    pdf.cell(0, 15, 'JWST Image Processing', align='C', ln=True)
    pdf.cell(0, 15, 'Implementation Research', align='C', ln=True)

    pdf.ln(20)
    pdf.set_font('Helvetica', '', 14)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 10, 'Technical Research Document', align='C', ln=True)
    pdf.cell(0, 10, 'JWST Data Analysis Application', align='C', ln=True)

    pdf.ln(30)
    pdf.set_font('Helvetica', '', 11)
    pdf.cell(0, 8, f'Date: {datetime.now().strftime("%B %d, %Y")}', align='C', ln=True)
    pdf.cell(0, 8, 'Version: 1.0', align='C', ln=True)

    pdf.ln(40)
    pdf.set_font('Helvetica', 'I', 10)
    pdf.set_text_color(128, 128, 128)
    pdf.multi_cell(0, 5,
        'This document presents comprehensive research into image processing algorithms and techniques '
        'for analyzing James Webb Space Telescope (JWST) data, including recommended implementations '
        'using Python scientific computing libraries.', align='C')

    # Executive Summary
    pdf.add_page()
    pdf.chapter_title('1. Executive Summary')

    pdf.body_text(
        'This research document outlines the recommended approach for implementing image processing '
        'capabilities in the JWST Data Analysis Application. The research covers industry-standard '
        'astronomical image processing techniques, leveraging established Python libraries used by '
        'the Space Telescope Science Institute (STScI) and the broader astronomical community.'
    )

    pdf.section_title('Key Findings')
    pdf.bullet_point('The official JWST pipeline (jwst package) provides calibration but not post-pipeline analysis')
    pdf.bullet_point('Photutils is the recommended library for background estimation, source detection, and photometry')
    pdf.bullet_point('Astropy provides essential FITS handling and NaN-safe convolution operations')
    pdf.bullet_point('SciPy ndimage offers efficient filtering algorithms for noise reduction')
    pdf.bullet_point('A modular pipeline architecture allows flexible algorithm composition')

    pdf.ln(3)
    pdf.section_title('Recommended Implementation Priority')
    pdf.bullet_point('1. Background Estimation & Subtraction (foundation for all analysis)')
    pdf.bullet_point('2. Noise Reduction Filters (Gaussian, Median, Astropy convolution)')
    pdf.bullet_point('3. Image Enhancement (ZScale, Asinh stretch, histogram equalization)')
    pdf.bullet_point('4. Source Detection (point sources via DAOFIND, extended via segmentation)')
    pdf.bullet_point('5. Statistical Analysis (sigma-clipped statistics, robust estimators)')

    # Current State Analysis
    pdf.add_page()
    pdf.chapter_title('2. Current System Analysis')

    pdf.section_title('2.1 Existing Infrastructure')
    pdf.body_text(
        'The JWST Data Analysis Application currently has a Python-based processing engine with '
        'FastAPI endpoints. The following components are already implemented and functional:'
    )

    pdf.subsection_title('Implemented Components')
    headers = ['Component', 'Status', 'Location']
    widths = [60, 40, 90]
    pdf.table_header(headers, widths)
    data = [
        ('FITS File I/O', 'Complete', 'app/processing/utils.py'),
        ('Array Normalization', 'Complete', 'app/processing/utils.py'),
        ('Preview Generation', 'Basic', 'main.py (ZScale only)'),
        ('MAST Integration', 'Complete', 'app/mast/'),
        ('Chunked Downloads', 'Complete', 'app/mast/chunked_downloader.py'),
        ('Processing Stubs', 'Placeholder', 'main.py'),
    ]
    for i, row in enumerate(data):
        pdf.table_row(row, widths, fill=(i % 2 == 0))

    pdf.ln(5)
    pdf.section_title('2.2 Available Dependencies')
    pdf.body_text('The processing engine currently includes the following Python packages:')

    headers = ['Package', 'Version', 'Purpose']
    widths = [50, 30, 110]
    pdf.table_header(headers, widths)
    data = [
        ('NumPy', '1.26.2', 'Array operations and numerical computing'),
        ('SciPy', '1.11.4', 'Scientific computing, signal processing, filtering'),
        ('Astropy', '6.0.0', 'FITS handling, WCS, astronomical utilities'),
        ('Matplotlib', '3.8.2', 'Visualization and image rendering'),
        ('Pillow', '10.1.0', 'Image format conversion'),
        ('Pandas', '2.1.4', 'Data manipulation and analysis'),
    ]
    for i, row in enumerate(data):
        pdf.table_row(row, widths, fill=(i % 2 == 0))

    pdf.ln(5)
    pdf.section_title('2.3 Missing Dependencies')
    pdf.body_text(
        'The following packages are recommended additions to enable full astronomical image processing:'
    )

    headers = ['Package', 'Version', 'Purpose']
    widths = [50, 30, 110]
    pdf.table_header(headers, widths)
    data = [
        ('photutils', '>=1.10.0', 'Background estimation, source detection, photometry'),
        ('scikit-image', '>=0.22.0', 'Additional image processing algorithms (optional)'),
    ]
    for i, row in enumerate(data):
        pdf.table_row(row, widths, fill=(i % 2 == 0))

    # Algorithm Research
    pdf.add_page()
    pdf.chapter_title('3. Image Processing Algorithms')

    pdf.section_title('3.1 Background Estimation & Subtraction')
    pdf.body_text(
        'Accurate background estimation is the foundation of astronomical image analysis. The background '
        'in JWST images consists of sky emission, detector bias, and scattered light. Removing this '
        'background is essential for accurate photometry and source detection.'
    )

    pdf.subsection_title('Recommended Approach: 2D Background Estimation')
    pdf.body_text(
        'The photutils Background2D class implements mesh-based background estimation with sigma clipping. '
        'This approach divides the image into boxes, estimates local background in each box using robust '
        'statistics, and interpolates to create a full-resolution background model.'
    )

    pdf.body_text('Key parameters for Background2D:')
    pdf.bullet_point('box_size: Size of boxes for local estimation (typically 50-100 pixels)')
    pdf.bullet_point('filter_size: Median filter window to smooth local estimates (typically 3-5)')
    pdf.bullet_point('sigma_clip: Sigma threshold for outlier rejection (typically 3-sigma)')
    pdf.bullet_point('bkg_estimator: Statistical estimator (MedianBackground recommended)')

    pdf.ln(2)
    pdf.subsection_title('Implementation Example')
    code = '''from photutils.background import Background2D, MedianBackground
from astropy.stats import SigmaClip

def estimate_background(data, box_size=50, filter_size=3):
    """
    Estimate 2D background using mesh-based approach.

    Parameters:
        data: 2D numpy array of image data
        box_size: Size of estimation boxes in pixels
        filter_size: Median filter window size

    Returns:
        background: 2D background model
        background_rms: 2D background noise model
    """
    sigma_clip = SigmaClip(sigma=3.0, maxiters=10)
    bkg_estimator = MedianBackground()

    bkg = Background2D(
        data,
        box_size=box_size,
        filter_size=filter_size,
        sigma_clip=sigma_clip,
        bkg_estimator=bkg_estimator
    )

    return bkg.background, bkg.background_rms'''
    pdf.code_block(code)

    # Noise Reduction
    pdf.add_page()
    pdf.section_title('3.2 Noise Reduction Algorithms')
    pdf.body_text(
        'JWST images contain various noise sources including readout noise, dark current, cosmic rays, '
        'and photon noise. Different filtering techniques are optimal for different noise characteristics.'
    )

    pdf.subsection_title('Available Methods')
    headers = ['Method', 'Best For', 'Library']
    widths = [50, 80, 60]
    pdf.table_header(headers, widths)
    data = [
        ('Gaussian Filter', 'General smoothing, white noise', 'scipy.ndimage'),
        ('Median Filter', 'Salt & pepper noise, cosmic rays', 'scipy.ndimage'),
        ('Bilateral Filter', 'Edge-preserving smoothing', 'scipy.ndimage'),
        ('Astropy Convolve', 'NaN-safe Gaussian smoothing', 'astropy.convolution'),
        ('Sigma Clipping', 'Statistical outlier removal', 'astropy.stats'),
    ]
    for i, row in enumerate(data):
        pdf.table_row(row, widths, fill=(i % 2 == 0))

    pdf.ln(5)
    pdf.subsection_title('Critical Note: NaN Handling')
    pdf.body_text(
        'JWST data frequently contains NaN values from bad pixels, cosmic ray hits, or masked regions. '
        'Standard scipy.ndimage filters propagate NaN values, making them unsuitable for direct use. '
        'The astropy.convolution module properly handles NaN values by ignoring them during convolution '
        'and optionally interpolating across them.'
    )

    pdf.subsection_title('Implementation Example')
    code = '''from scipy.ndimage import gaussian_filter, median_filter
from astropy.convolution import convolve, Gaussian2DKernel

def reduce_noise(data, method='gaussian', kernel_size=3, sigma=1.0):
    """
    Apply noise reduction filter to image data.

    Parameters:
        data: 2D numpy array
        method: 'gaussian', 'median', or 'astropy_gaussian'
        kernel_size: Size of filter kernel
        sigma: Standard deviation for Gaussian filters

    Returns:
        Filtered image data
    """
    if method == 'gaussian':
        # Fast but propagates NaN
        return gaussian_filter(data, sigma=sigma)

    elif method == 'median':
        # Good for cosmic rays, propagates NaN
        return median_filter(data, size=kernel_size)

    elif method == 'astropy_gaussian':
        # Properly handles NaN values
        kernel = Gaussian2DKernel(x_stddev=sigma)
        return convolve(data, kernel, nan_treatment='interpolate')'''
    pdf.code_block(code)

    # Image Enhancement
    pdf.add_page()
    pdf.section_title('3.3 Image Enhancement Techniques')
    pdf.body_text(
        'Astronomical images have extreme dynamic ranges that require specialized visualization techniques. '
        'Standard linear scaling cannot display both faint nebulosity and bright stars simultaneously.'
    )

    pdf.subsection_title('Scaling Methods')
    headers = ['Method', 'Description', 'Use Case']
    widths = [45, 75, 70]
    pdf.table_header(headers, widths)
    data = [
        ('ZScale', 'IRAF algorithm, samples pixels', 'General astronomical images'),
        ('Asinh Stretch', 'Inverse hyperbolic sine', 'High dynamic range, galaxies'),
        ('Log Stretch', 'Logarithmic scaling', 'Extended emission, nebulae'),
        ('Sqrt Stretch', 'Square root scaling', 'Moderate dynamic range'),
        ('Histogram Eq.', 'Equalize histogram', 'Maximize contrast'),
        ('Power Stretch', 'Power law scaling', 'Customizable enhancement'),
    ]
    for i, row in enumerate(data):
        pdf.table_row(row, widths, fill=(i % 2 == 0))

    pdf.ln(5)
    pdf.subsection_title('Implementation Example')
    code = '''from astropy.visualization import (
    ZScaleInterval, AsinhStretch, LogStretch,
    SqrtStretch, HistEqStretch, ImageNormalize
)
import numpy as np

def enhance_image(data, method='zscale', **kwargs):
    """
    Apply contrast enhancement to astronomical image.

    Parameters:
        data: 2D numpy array
        method: Enhancement method name
        **kwargs: Method-specific parameters

    Returns:
        Enhanced image (0-1 range)
    """
    # Handle NaN values
    valid_data = data[~np.isnan(data)]

    if method == 'zscale':
        interval = ZScaleInterval(
            contrast=kwargs.get('contrast', 0.25)
        )
        vmin, vmax = interval.get_limits(valid_data)
        norm = ImageNormalize(vmin=vmin, vmax=vmax)
        return norm(data)

    elif method == 'asinh':
        stretch = AsinhStretch(a=kwargs.get('a', 0.1))
        normalized = (data - np.nanmin(data)) / np.nanptp(data)
        return stretch(normalized)

    elif method == 'log':
        stretch = LogStretch(a=kwargs.get('a', 1000))
        normalized = (data - np.nanmin(data)) / np.nanptp(data)
        return stretch(normalized)

    elif method == 'histogram_eq':
        stretch = HistEqStretch(valid_data)
        normalized = (data - np.nanmin(data)) / np.nanptp(data)
        return stretch(normalized)'''
    pdf.code_block(code)

    # Source Detection
    pdf.add_page()
    pdf.section_title('3.4 Source Detection')
    pdf.body_text(
        'Source detection identifies astronomical objects in images. Two primary approaches exist: '
        'point source detection optimized for stars, and segmentation-based detection for extended sources.'
    )

    pdf.subsection_title('Point Source Detection (DAOFIND)')
    pdf.body_text(
        'The DAOFIND algorithm (Stetson 1987) detects stellar sources by convolving the image with '
        'a Gaussian kernel matching the expected PSF and identifying local maxima above a threshold. '
        'This is implemented in photutils as DAOStarFinder.'
    )

    pdf.subsection_title('Segmentation-Based Detection')
    pdf.body_text(
        'For extended sources (galaxies, nebulae), image segmentation identifies connected regions '
        'of pixels above a threshold. The detect_sources function creates a segmentation map where '
        'each source is assigned a unique integer label.'
    )

    pdf.subsection_title('Implementation Example')
    code = '''from photutils.detection import DAOStarFinder
from photutils.segmentation import detect_sources, deblend_sources

def detect_stars(data, background, fwhm=3.0, threshold_sigma=5.0):
    """
    Detect point sources using DAOFIND algorithm.

    Parameters:
        data: Background-subtracted image
        background: Background2D object
        fwhm: Expected FWHM of stars in pixels
        threshold_sigma: Detection threshold in sigma

    Returns:
        Table of detected sources with positions and fluxes
    """
    threshold = threshold_sigma * background.background_rms_median

    finder = DAOStarFinder(
        fwhm=fwhm,
        threshold=threshold,
        sharplo=0.2, sharphi=1.0,  # Shape constraints
        roundlo=-1.0, roundhi=1.0
    )

    sources = finder(data - background.background)
    return sources

def detect_extended(data, background, npixels=10, threshold_sigma=2.0):
    """
    Detect extended sources via segmentation.
    """
    threshold = background.background + (
        threshold_sigma * background.background_rms
    )

    # Initial detection
    segm = detect_sources(data, threshold, npixels=npixels)

    # Deblend overlapping sources
    segm_deblend = deblend_sources(
        data, segm, npixels=npixels,
        nlevels=32, contrast=0.001
    )

    return segm_deblend'''
    pdf.code_block(code)

    # Statistical Analysis
    pdf.add_page()
    pdf.section_title('3.5 Statistical Analysis')
    pdf.body_text(
        'Robust statistical analysis is essential for characterizing astronomical data. Standard statistics '
        '(mean, standard deviation) are biased by outliers and source contamination. Astronomical analysis '
        'requires robust estimators that are resistant to these effects.'
    )

    pdf.subsection_title('Robust Estimators')
    headers = ['Estimator', 'Measures', 'Advantages']
    widths = [55, 45, 90]
    pdf.table_header(headers, widths)
    data = [
        ('Sigma-clipped Mean', 'Central tendency', 'Removes outliers iteratively'),
        ('Median', 'Central tendency', 'Robust to outliers, simple'),
        ('Biweight Location', 'Central tendency', 'Most robust, handles asymmetry'),
        ('MAD Std', 'Dispersion', 'Robust standard deviation estimate'),
        ('Biweight Scale', 'Dispersion', 'Most robust dispersion estimate'),
    ]
    for i, row in enumerate(data):
        pdf.table_row(row, widths, fill=(i % 2 == 0))

    pdf.ln(5)
    pdf.subsection_title('Implementation Example')
    code = '''from astropy.stats import (
    sigma_clipped_stats, biweight_location,
    biweight_scale, mad_std
)
import numpy as np

def compute_statistics(data, mask=None, sigma=3.0):
    """
    Compute robust statistics for astronomical image.

    Parameters:
        data: 2D numpy array
        mask: Boolean mask (True = exclude)
        sigma: Sigma threshold for clipping

    Returns:
        Dictionary of statistical measures
    """
    # Apply mask if provided
    if mask is not None:
        valid_data = data[~mask & ~np.isnan(data)]
    else:
        valid_data = data[~np.isnan(data)]

    # Sigma-clipped statistics
    mean, median, std = sigma_clipped_stats(
        valid_data, sigma=sigma, maxiters=5
    )

    # Robust estimators
    bwloc = biweight_location(valid_data)
    bwscale = biweight_scale(valid_data)
    mad = mad_std(valid_data)

    return {
        'mean': float(mean),
        'median': float(median),
        'std': float(std),
        'biweight_location': float(bwloc),
        'biweight_scale': float(bwscale),
        'mad_std': float(mad),
        'min': float(np.nanmin(data)),
        'max': float(np.nanmax(data)),
        'n_pixels': int(valid_data.size),
        'n_nan': int(np.sum(np.isnan(data)))
    }'''
    pdf.code_block(code)

    # Architecture
    pdf.add_page()
    pdf.chapter_title('4. Proposed Architecture')

    pdf.section_title('4.1 Module Structure')
    pdf.body_text(
        'The recommended architecture organizes processing capabilities into focused modules, '
        'each handling a specific aspect of image processing. This enables flexible composition '
        'of algorithms into processing pipelines.'
    )

    code = '''processing-engine/app/processing/
    __init__.py           # Module exports
    utils.py              # FITS I/O (existing)
    background.py         # Background estimation & subtraction
    filters.py            # Noise reduction filters
    enhancement.py        # Contrast & scaling
    detection.py          # Source detection
    statistics.py         # Statistical analysis
    photometry.py         # Aperture/PSF photometry (future)
    pipeline.py           # Algorithm composition'''
    pdf.code_block(code)

    pdf.section_title('4.2 Processing Pipeline Design')
    pdf.body_text(
        'A typical JWST image processing pipeline follows this flow:'
    )

    code = '''Input FITS File
       |
       v
+------------------+
| Load FITS Data   |  --> Header metadata extraction
+------------------+
       |
       v
+------------------+
| Background       |  --> Background model + RMS map
| Estimation       |
+------------------+
       |
       v
+------------------+
| Background       |  --> Science-ready image
| Subtraction      |
+------------------+
       |
       v
+------------------+
| Noise Reduction  |  --> Smoothed image (optional)
| (optional)       |
+------------------+
       |
       v
+------------------+
| Source Detection |  --> Source catalog (optional)
| (optional)       |
+------------------+
       |
       v
+------------------+
| Enhancement      |  --> Display-ready image
| for Display      |
+------------------+
       |
       v
+------------------+     +------------------+
| Save Processed   | --> | PNG Preview      |
| FITS             |     | Generation       |
+------------------+     +------------------+'''
    pdf.code_block(code)

    # API Design
    pdf.add_page()
    pdf.section_title('4.3 API Endpoint Design')
    pdf.body_text(
        'The processing engine exposes RESTful endpoints for each algorithm category. '
        'The existing /process endpoint can be extended with new algorithm types.'
    )

    headers = ['Endpoint', 'Method', 'Description']
    widths = [70, 25, 95]
    pdf.table_header(headers, widths)
    data = [
        ('/process', 'POST', 'Execute processing algorithm'),
        ('/algorithms', 'GET', 'List available algorithms'),
        ('/preview/{id}', 'GET', 'Generate PNG preview'),
        ('/statistics/{id}', 'GET', 'Compute image statistics'),
        ('/background/{id}', 'POST', 'Estimate and subtract background'),
        ('/detect/{id}', 'POST', 'Detect sources in image'),
    ]
    for i, row in enumerate(data):
        pdf.table_row(row, widths, fill=(i % 2 == 0))

    pdf.ln(5)
    pdf.section_title('4.4 Algorithm Registry')
    pdf.body_text(
        'The /algorithms endpoint should return a comprehensive registry of available '
        'processing algorithms with their parameters:'
    )

    code = '''{
  "algorithms": [
    {
      "name": "background_subtraction",
      "category": "preprocessing",
      "description": "Estimate and subtract 2D background",
      "parameters": {
        "box_size": {"type": "integer", "default": 50},
        "filter_size": {"type": "integer", "default": 3},
        "sigma_clip": {"type": "float", "default": 3.0}
      }
    },
    {
      "name": "noise_reduction",
      "category": "filtering",
      "description": "Apply noise reduction filter",
      "parameters": {
        "method": {"type": "string", "enum": ["gaussian",
                   "median", "astropy_gaussian"]},
        "kernel_size": {"type": "integer", "default": 3},
        "sigma": {"type": "float", "default": 1.0}
      }
    },
    {
      "name": "source_detection",
      "category": "analysis",
      "description": "Detect sources in image",
      "parameters": {
        "method": {"type": "string", "enum": ["daofind",
                   "segmentation"]},
        "threshold_sigma": {"type": "float", "default": 5.0},
        "fwhm": {"type": "float", "default": 3.0}
      }
    }
  ]
}'''
    pdf.code_block(code)

    # Implementation Plan
    pdf.add_page()
    pdf.chapter_title('5. Implementation Roadmap')

    pdf.section_title('5.1 Phase 1: Foundation')
    pdf.body_text('Establish core infrastructure and dependencies.')
    pdf.bullet_point('Add photutils to requirements.txt')
    pdf.bullet_point('Create module structure (background.py, filters.py, etc.)')
    pdf.bullet_point('Implement background estimation with Background2D')
    pdf.bullet_point('Add comprehensive unit tests')

    pdf.ln(3)
    pdf.section_title('5.2 Phase 2: Core Algorithms')
    pdf.body_text('Implement primary image processing algorithms.')
    pdf.bullet_point('Noise reduction filters (Gaussian, Median, Astropy convolution)')
    pdf.bullet_point('Image enhancement (ZScale, Asinh, Log, Histogram equalization)')
    pdf.bullet_point('Statistical analysis (sigma-clipped stats, robust estimators)')
    pdf.bullet_point('Update /algorithms endpoint with new capabilities')

    pdf.ln(3)
    pdf.section_title('5.3 Phase 3: Source Detection')
    pdf.body_text('Add source detection capabilities.')
    pdf.bullet_point('Point source detection with DAOStarFinder')
    pdf.bullet_point('Extended source detection with segmentation')
    pdf.bullet_point('Source catalog generation and storage')
    pdf.bullet_point('Integration with frontend visualization')

    pdf.ln(3)
    pdf.section_title('5.4 Phase 4: Advanced Features')
    pdf.body_text('Extend with advanced analysis capabilities.')
    pdf.bullet_point('Pipeline composition (chain multiple algorithms)')
    pdf.bullet_point('Batch processing support')
    pdf.bullet_point('Aperture photometry')
    pdf.bullet_point('PSF photometry (if needed)')

    # References
    pdf.add_page()
    pdf.chapter_title('6. References & Resources')

    pdf.section_title('6.1 Official Documentation')
    pdf.bullet_point('JWST Pipeline: https://github.com/spacetelescope/jwst')
    pdf.bullet_point('JWST User Documentation: https://jwst-docs.stsci.edu/')
    pdf.bullet_point('STScI JDAT Notebooks: https://spacetelescope.github.io/jdat_notebooks/')
    pdf.bullet_point('Photutils: https://photutils.readthedocs.io/')
    pdf.bullet_point('Astropy: https://docs.astropy.org/')

    pdf.ln(3)
    pdf.section_title('6.2 Key Libraries')
    headers = ['Library', 'Documentation URL']
    widths = [50, 140]
    pdf.table_header(headers, widths)
    data = [
        ('photutils', 'https://photutils.readthedocs.io/en/stable/'),
        ('astropy', 'https://docs.astropy.org/en/stable/'),
        ('scipy.ndimage', 'https://docs.scipy.org/doc/scipy/reference/ndimage.html'),
        ('numpy', 'https://numpy.org/doc/stable/'),
    ]
    for i, row in enumerate(data):
        pdf.table_row(row, widths, fill=(i % 2 == 0))

    pdf.ln(5)
    pdf.section_title('6.3 Scientific References')
    pdf.bullet_point('Stetson, P.B. 1987, PASP, 99, 191 (DAOFIND algorithm)')
    pdf.bullet_point('Bertin, E. & Arnouts, S. 1996, A&AS, 117, 393 (SExtractor)')
    pdf.bullet_point('Bradley, L. et al. 2022, astropy/photutils (Photutils)')

    pdf.ln(5)
    pdf.section_title('6.4 Community Resources')
    pdf.bullet_point('STScI GitHub: https://github.com/spacetelescope')
    pdf.bullet_point('Astropy GitHub: https://github.com/astropy')
    pdf.bullet_point('JWST Help Desk: https://jwsthelp.stsci.edu/')

    # Save PDF
    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'JWST_Image_Processing_Research.pdf')
    pdf.output(output_path)
    return output_path


if __name__ == '__main__':
    output = create_pdf()
    print(f'PDF generated: {output}')
