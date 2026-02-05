"""
Pydantic models for WCS mosaic image generation.
"""

from typing import Literal

from pydantic import BaseModel, Field


class MosaicFileConfig(BaseModel):
    """Configuration for a single input file in the mosaic."""

    file_path: str = Field(..., description="Path to FITS file (relative to data directory)")
    stretch: str = Field(
        default="asinh",
        description="Stretch method: zscale, asinh, log, sqrt, power, histeq, linear",
    )
    black_point: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Black point percentile (0.0-1.0)"
    )
    white_point: float = Field(
        default=1.0, ge=0.0, le=1.0, description="White point percentile (0.0-1.0)"
    )
    gamma: float = Field(default=1.0, gt=0.0, le=5.0, description="Gamma correction (0.1-5.0)")
    asinh_a: float = Field(default=0.1, ge=0.001, le=1.0, description="Asinh softening parameter")


class MosaicRequest(BaseModel):
    """Request to generate a WCS-aware mosaic image from multiple FITS files."""

    files: list[MosaicFileConfig] = Field(..., min_length=2, description="Input files (minimum 2)")
    output_format: Literal["png", "jpeg"] = Field(default="png", description="Output image format")
    quality: int = Field(default=95, ge=1, le=100, description="JPEG quality (1-100)")
    width: int | None = Field(
        default=None, gt=0, le=8000, description="Output image width (None = native resolution)"
    )
    height: int | None = Field(
        default=None, gt=0, le=8000, description="Output image height (None = native resolution)"
    )
    combine_method: Literal["mean", "sum", "first", "last", "min", "max"] = Field(
        default="mean", description="Method for combining overlapping pixels"
    )
    cmap: str = Field(default="inferno", description="Colormap for single-channel output")


class MosaicResponse(BaseModel):
    """Response metadata for mosaic generation."""

    success: bool
    message: str
    width: int
    height: int
    format: str
    n_files: int
    combine_method: str


class FootprintRequest(BaseModel):
    """Request to compute WCS footprints for FITS files."""

    file_paths: list[str] = Field(
        ..., min_length=1, description="Paths to FITS files (relative to data directory)"
    )


class FootprintEntry(BaseModel):
    """WCS footprint for a single file."""

    file_path: str
    corners_ra: list[float] = Field(description="RA coordinates of image corners (degrees)")
    corners_dec: list[float] = Field(description="Dec coordinates of image corners (degrees)")
    center_ra: float = Field(description="Center RA (degrees)")
    center_dec: float = Field(description="Center Dec (degrees)")


class FootprintResponse(BaseModel):
    """Response with WCS footprints for all input files."""

    footprints: list[FootprintEntry]
    bounding_box: dict[str, float] = Field(
        description="Bounding box: min_ra, max_ra, min_dec, max_dec"
    )
    n_files: int
