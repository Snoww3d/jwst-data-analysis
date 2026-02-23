"""
Pydantic models for region selection and statistics.
"""

from typing import Literal

from pydantic import BaseModel, Field


class RectangleRegion(BaseModel):
    """Rectangle region defined by top-left corner and dimensions in pixel coordinates."""

    x: int = Field(..., ge=0, description="X coordinate of top-left corner")
    y: int = Field(..., ge=0, description="Y coordinate of top-left corner")
    width: int = Field(..., gt=0, description="Width in pixels")
    height: int = Field(..., gt=0, description="Height in pixels")


class EllipseRegion(BaseModel):
    """Ellipse region defined by center and radii in pixel coordinates."""

    cx: float = Field(..., ge=0, description="X coordinate of center")
    cy: float = Field(..., ge=0, description="Y coordinate of center")
    rx: float = Field(..., gt=0, description="X radius in pixels")
    ry: float = Field(..., gt=0, description="Y radius in pixels")


class RegionStatisticsRequest(BaseModel):
    """Request to compute statistics for a region within a FITS image."""

    file_path: str = Field(..., description="Path to FITS file (relative to data directory)")
    region_type: Literal["rectangle", "ellipse"] = Field(
        ..., description="Type of region selection"
    )
    rectangle: RectangleRegion | None = Field(
        default=None, description="Rectangle region (required if region_type is rectangle)"
    )
    ellipse: EllipseRegion | None = Field(
        default=None, description="Ellipse region (required if region_type is ellipse)"
    )
    hdu_index: int = Field(default=-1, description="HDU index (-1 for first image HDU)")


class RegionStatisticsResponse(BaseModel):
    """Computed statistics for a selected region."""

    mean: float
    median: float
    std: float
    min: float
    max: float
    sum: float
    pixel_count: int


class SourceDetectionRequest(BaseModel):
    """Request to detect sources in a FITS image."""

    file_path: str = Field(..., description="Path to FITS file (relative to data directory)")
    threshold_sigma: float = Field(
        default=5.0, ge=1.0, le=50.0, description="Detection threshold in sigma above background"
    )
    fwhm: float = Field(
        default=3.0, ge=0.5, le=20.0, description="Expected FWHM of point sources in pixels"
    )
    method: str = Field(
        default="auto", description="Detection method: auto, daofind, iraf, segmentation"
    )
    npixels: int = Field(
        default=10, ge=1, le=1000, description="Minimum pixels for extended source detection"
    )
    deblend: bool = Field(default=True, description="Whether to deblend overlapping sources")


class SourceInfo(BaseModel):
    """Information about a single detected source."""

    id: int
    xcentroid: float
    ycentroid: float
    flux: float | None = None
    sharpness: float | None = None
    roundness: float | None = None
    fwhm: float | None = None
    peak: float | None = None


class SourceDetectionResponse(BaseModel):
    """Response containing detected sources."""

    sources: list[SourceInfo]
    n_sources: int
    method: str
    threshold_sigma: float
    threshold_value: float
    estimated_fwhm: float | None = None
