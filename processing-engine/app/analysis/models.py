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
