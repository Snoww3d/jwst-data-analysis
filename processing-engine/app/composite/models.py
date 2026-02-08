"""
Pydantic models for composite image generation.
"""

from typing import Literal

from pydantic import BaseModel, Field


CurveType = Literal["linear", "s_curve", "inverse_s", "shadows", "highlights"]


class ChannelConfig(BaseModel):
    """Configuration for a single RGB channel."""

    file_path: str = Field(..., description="Path to FITS file (relative to data directory)")
    stretch: str = Field(
        default="zscale",
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
    curve: CurveType = Field(default="linear", description="Tone curve preset")


class OverallAdjustments(BaseModel):
    """Global post-stack levels and stretch adjustments."""

    stretch: str = Field(
        default="zscale",
        pattern="^(zscale|asinh|log|sqrt|power|histeq|linear)$",
        description="Stretch method: zscale, asinh, log, sqrt, power, histeq, linear",
    )

    black_point: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Black point percentile (0.0-1.0)"
    )
    white_point: float = Field(
        default=1.0, ge=0.0, le=1.0, description="White point percentile (0.0-1.0)"
    )
    gamma: float = Field(default=1.0, gt=0.0, le=5.0, description="Gamma correction (0.1-5.0)")
    asinh_a: float = Field(
        default=0.1, ge=0.001, le=1.0, description="Asinh softening parameter (used for asinh)"
    )


class CompositeRequest(BaseModel):
    """Request to generate an RGB composite image from 3 FITS files."""

    red: ChannelConfig = Field(..., description="Red channel configuration")
    green: ChannelConfig = Field(..., description="Green channel configuration")
    blue: ChannelConfig = Field(..., description="Blue channel configuration")
    overall: OverallAdjustments | None = Field(
        default=None, description="Optional global post-stack levels and stretch adjustments"
    )
    output_format: Literal["png", "jpeg"] = Field(default="png", description="Output image format")
    quality: int = Field(default=95, ge=1, le=100, description="JPEG quality (1-100)")
    width: int = Field(default=1000, gt=0, le=4096, description="Output image width")
    height: int = Field(default=1000, gt=0, le=4096, description="Output image height")


class CompositeResponse(BaseModel):
    """Response metadata for composite generation."""

    success: bool
    message: str
    width: int
    height: int
    format: str
