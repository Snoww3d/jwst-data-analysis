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
    asinh_a: float = Field(default=0.05, ge=0.001, le=1.0, description="Asinh softening parameter")
    curve: CurveType = Field(default="linear", description="Tone curve preset")
    weight: float = Field(
        default=1.0, ge=0.0, le=2.0, description="Channel intensity weight (0.0-2.0)"
    )


class OverallAdjustments(BaseModel):
    """Global post-stack levels and stretch adjustments."""

    stretch: str = Field(
        default="linear",
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


class SharpeningConfig(BaseModel):
    """Unsharp masking parameters applied to the final RGB composite.

    Sharpening is applied in luminance space (ITU-R BT.709) — the delta
    between the original and Gaussian-blurred luminance is added back to
    each channel. This preserves color balance and avoids chroma noise.

    Disabled when ``amount`` is 0 (the default) so existing composites are
    byte-identical unless a caller opts in.
    """

    radius: float = Field(
        default=1.5,
        ge=0.5,
        le=10.0,
        description="Gaussian blur sigma in pixels (0.5-10.0)",
    )
    amount: float = Field(
        default=0.0,
        ge=0.0,
        le=3.0,
        description="Sharpening strength (0=disabled, 1=typical, up to 3 for aggressive)",
    )
    threshold: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Minimum luminance delta to sharpen (0-1). Protects noise floor.",
    )


class SaturationConfig(BaseModel):
    """Global saturation, vibrancy, and hue rotation applied after sharpening.

    Operates in HSL space via a single round-trip (rgb_to_hsl → adjust → hsl_to_rgb).
    All defaults produce a no-op so existing composites are byte-identical
    unless a caller opts in.
    """

    saturation: float = Field(
        default=1.0,
        ge=0.0,
        le=2.0,
        description="Multiplicative saturation scale (0=grayscale, 1=unchanged, 2=max boost)",
    )
    vibrancy: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Selective saturation boost — muted colors get the largest increase (0=off, 1=max)",
    )
    hue_rotation: float = Field(
        default=0.0,
        ge=-30.0,
        le=30.0,
        description="Global hue shift in degrees (-30 to +30)",
    )


# --- N-Channel Composite Models (B3.1) ---


class ChannelColor(BaseModel):
    """Color assignment for a single channel — hue, explicit RGB weights, or luminance."""

    hue: float | None = Field(default=None, ge=0, le=360, description="Hue angle (0-360°)")
    rgb: tuple[float, float, float] | None = Field(
        default=None, description="Explicit RGB weights, each in [0, 1]"
    )
    luminance: bool = Field(default=False, description="Use as luminance (detail) channel")

    @model_validator(mode="after")
    def exactly_one_color_spec(self) -> "ChannelColor":
        has_hue = self.hue is not None
        has_rgb = self.rgb is not None
        has_lum = self.luminance
        count = sum([has_hue, has_rgb, has_lum])
        if count == 0:
            raise ValueError("Provide one of: hue, rgb, or luminance=true")
        if count > 1:
            raise ValueError("Provide only one of: hue, rgb, or luminance=true")
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
    auto_stretch: bool = Field(
        default=False,
        description="Compute stretch params from data statistics instead of using request values",
    )


class NChannelCompositeRequest(BaseModel):
    """Request to generate an N-channel composite image."""

    channels: list[NChannelConfig] = Field(
        ..., min_length=1, description="Channel configurations with color assignments"
    )
    overall: OverallAdjustments | None = Field(
        default=None, description="Optional global post-stack levels and stretch adjustments"
    )
    sharpening: SharpeningConfig | None = Field(
        default=None,
        description="Optional unsharp masking applied to the final RGB composite",
    )
    saturation: SaturationConfig | None = Field(
        default=None,
        description="Optional saturation, vibrancy, and hue rotation applied after sharpening",
    )
    background_neutralization: bool = Field(
        default=True,
        description="Subtract per-channel sky background to neutralize color casts",
    )
    feather_strength: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Edge feathering strength (None=auto for multi-instrument, 0=off, 0.01-1.0=manual)",
    )
    rotation_degrees: float = Field(
        default=0.0,
        ge=-180,
        le=180,
        description="Rotation angle in degrees (positive = clockwise)",
    )
    crop_center_x: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Horizontal crop center (0=left, 0.5=center, 1=right)",
    )
    crop_center_y: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Vertical crop center (0=top, 0.5=center, 1=bottom)",
    )
    crop_zoom: float = Field(
        default=1.0,
        ge=0.1,
        le=5.0,
        description="Zoom factor (1.0=fit, higher=zoom in)",
    )
    output_format: Literal["png", "jpeg"] = Field(default="png", description="Output image format")
    quality: int = Field(default=95, ge=1, le=100, description="JPEG quality (1-100)")
    width: int = Field(default=1000, gt=0, le=4096, description="Output image width")
    height: int = Field(default=1000, gt=0, le=4096, description="Output image height")
    debug_masks: bool = Field(
        default=False,
        description="Return per-channel coverage/feather masks instead of the composite image",
    )


# --- Channel Analysis Models ---


class AnalyzeChannelsRequest(BaseModel):
    """Request to analyze channels and compute auto-stretch parameters + histograms."""

    channels: list[NChannelConfig] = Field(
        ..., min_length=1, description="Channel configurations to analyze"
    )
    background_neutralization: bool = Field(
        default=True,
        description="Subtract per-channel sky background before analysis",
    )


class AutoStretchMeta(BaseModel):
    """Detection metadata from auto-stretch analysis."""

    dynamic_range: float = Field(description="Ratio of max signal to noise floor")
    noise: float = Field(description="1-sigma noise estimate from sigma-clipped stats")
    snr: float = Field(description="Signal-to-noise ratio (99.9th percentile / noise)")
    hdr_detected: bool = Field(description="Whether extreme dynamic range was detected (>5000)")
    curve_reason: str = Field(
        description="Why this tone curve was chosen: hdr, high_snr, medium_snr, noisy, "
        "insufficient_data, constant_data"
    )
    instrument_adjusted: bool = Field(
        description="Whether instrument-specific adjustments were applied"
    )
    valid_pixels: int = Field(description="Number of valid (>0) pixels in the channel")
    zero_coverage_frac: float = Field(description="Fraction of pixels with no coverage (value=0)")


class ChannelHistogram(BaseModel):
    """Histogram data for a single channel's valid pixels."""

    counts: list[int] = Field(description="Bin counts")
    bin_centers: list[float] = Field(description="Center value of each bin")
    bin_edges: list[float] = Field(description="Edge values (len = n_bins + 1)")
    n_bins: int = Field(description="Number of bins")


class ChannelStats(BaseModel):
    """Basic statistics for a channel's valid pixels."""

    min: float
    max: float
    mean: float
    std: float


class ChannelAnalysisResult(BaseModel):
    """Analysis result for a single channel."""

    channel_name: str = Field(description="Channel identifier (e.g. 'ch0_F444W')")
    label: str | None = Field(default=None, description="Filter label")
    params: dict = Field(description="Computed stretch parameters (stretch, asinh_a, etc.)")
    histogram: ChannelHistogram
    meta: AutoStretchMeta
    stats: ChannelStats


class AnalyzeChannelsResponse(BaseModel):
    """Response from the analyze-channels endpoint."""

    channels: list[ChannelAnalysisResult]


class EstimateResponse(BaseModel):
    """Verdict from /composite/estimate.

    status="ok"   — generation will succeed at the requested output shape.
    status="warn" — generation will succeed but output will mildly downscale.
    status="fail" — generation will return HTTP 413 at the current memory limit
                    and threshold; tune env vars or reduce inputs.
    """

    status: str = Field(description="ok | warn | fail")
    original_shape: tuple[int, int] = Field(
        description="WCS-derived shape before any downscale, encoded as JSON array [height, width]"
    )
    output_shape: tuple[int, int] = Field(
        description="Effective output shape, encoded as JSON array [height, width]"
    )
    side_factor: float = Field(description="Side-length factor; 1.0 = no downscale")
    detail: str = Field(description="Actionable diagnostic message; empty on ok")
    memory_limit_mb: int = Field(description="Current MAX_COMPOSITE_MEMORY_BYTES in MB (decimal)")
    fail_threshold: float = Field(description="Current COMPOSITE_DOWNSCALE_FAIL_THRESHOLD")
