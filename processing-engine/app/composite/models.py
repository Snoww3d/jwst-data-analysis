"""
Pydantic models for composite image generation.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


CurveType = Literal["linear", "s_curve", "inverse_s", "shadows", "highlights"]


class ChannelConfig(BaseModel):
    """Configuration for a single RGB channel."""

    file_paths: list[str] = Field(
        ..., min_length=1, description="Paths to FITS files (relative to data directory)"
    )
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
    weight: float = Field(
        default=1.0, ge=0.0, le=2.0, description="Channel intensity weight (0.0-2.0)"
    )


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


# --- N-Channel Composite Models (B3.1) ---


class ChannelColor(BaseModel):
    """Color assignment for a single channel — either hue or explicit RGB weights."""

    hue: float | None = Field(default=None, ge=0, le=360, description="Hue angle (0-360°)")
    rgb: tuple[float, float, float] | None = Field(
        default=None, description="Explicit RGB weights, each in [0, 1]"
    )

    @model_validator(mode="after")
    def exactly_one_color_spec(self) -> "ChannelColor":
        if self.hue is not None and self.rgb is not None:
            raise ValueError("Provide either hue or rgb, not both")
        if self.hue is None and self.rgb is None:
            raise ValueError("Provide either hue or rgb")
        return self

    @field_validator("rgb")
    @classmethod
    def rgb_components_in_range(cls, v: tuple[float, float, float] | None):
        if v is not None:
            for i, component in enumerate(v):
                if not 0.0 <= component <= 1.0:
                    raise ValueError(f"RGB component {i} value {component} outside [0, 1]")
        return v


class NChannelConfig(ChannelConfig):
    """Configuration for a single channel in an N-channel composite."""

    color: ChannelColor = Field(..., description="Color assignment for this channel")
    label: str | None = Field(default=None, description="Filter name (e.g. 'F444W')")
    wavelength_um: float | None = Field(
        default=None, gt=0, description="Filter wavelength in micrometers"
    )


class NChannelCompositeRequest(BaseModel):
    """Request to generate an N-channel composite image."""

    channels: list[NChannelConfig] = Field(
        ..., min_length=1, description="Channel configurations with color assignments"
    )
    overall: OverallAdjustments | None = Field(
        default=None, description="Optional global post-stack levels and stretch adjustments"
    )
    background_neutralization: bool = Field(
        default=True,
        description="Subtract per-channel sky background to neutralize color casts",
    )
    output_format: Literal["png", "jpeg"] = Field(default="png", description="Output image format")
    quality: int = Field(default=95, ge=1, le=100, description="JPEG quality (1-100)")
    width: int = Field(default=1000, gt=0, le=4096, description="Output image width")
    height: int = Field(default=1000, gt=0, le=4096, description="Output image height")
