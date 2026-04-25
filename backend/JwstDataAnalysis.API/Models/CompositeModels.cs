// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace JwstDataAnalysis.API.Models
{
    /// <summary>
    /// Global post-stack levels and stretch adjustments.
    /// </summary>
    public class OverallAdjustmentsDto
    {
        /// <summary>
        /// Gets or sets stretch method: zscale, asinh, log, sqrt, power, histeq, linear.
        /// </summary>
        [RegularExpression("^(zscale|asinh|log|sqrt|power|histeq|linear)$")]
        public string Stretch { get; set; } = "linear";

        /// <summary>
        /// Gets or sets black point percentile (0.0-1.0).
        /// </summary>
        [Range(0.0, 1.0)]
        public double BlackPoint { get; set; } = 0.0;

        /// <summary>
        /// Gets or sets white point percentile (0.0-1.0).
        /// </summary>
        [Range(0.0, 1.0)]
        public double WhitePoint { get; set; } = 1.0;

        /// <summary>
        /// Gets or sets gamma correction (0.1-5.0).
        /// </summary>
        [Range(0.1, 5.0)]
        public double Gamma { get; set; } = 1.0;

        /// <summary>
        /// Gets or sets asinh softening parameter (0.001-1.0, used when stretch=asinh).
        /// </summary>
        [Range(0.001, 1.0)]
        public double AsinhA { get; set; } = 0.1;
    }

    /// <summary>
    /// Unsharp masking parameters applied to the final RGB composite.
    /// </summary>
    public class SharpeningConfigDto
    {
        /// <summary>
        /// Gets or sets the Gaussian blur sigma in pixels (0.5-10.0).
        /// </summary>
        [Range(0.5, 10.0)]
        public double Radius { get; set; } = 1.5;

        /// <summary>
        /// Gets or sets the sharpening strength (0=disabled, 1=typical, up to 3 for aggressive).
        /// </summary>
        [Range(0.0, 3.0)]
        public double Amount { get; set; }

        /// <summary>
        /// Gets or sets the minimum luminance delta to sharpen (0-1). Protects the noise floor.
        /// </summary>
        [Range(0.0, 1.0)]
        public double Threshold { get; set; }
    }

    /// <summary>
    /// Global saturation, vibrancy, and hue rotation applied after sharpening.
    /// </summary>
    public class SaturationConfigDto
    {
        /// <summary>
        /// Gets or sets the multiplicative saturation scale (0=grayscale, 1=unchanged, 2=max boost).
        /// </summary>
        [Range(0.0, 2.0)]
        public double Saturation { get; set; } = 1.0;

        /// <summary>
        /// Gets or sets the selective saturation boost for muted colors (0=off, 1=max).
        /// </summary>
        [Range(0.0, 1.0)]
        public double Vibrancy { get; set; }

        /// <summary>
        /// Gets or sets the global hue shift in degrees (-30 to +30).
        /// </summary>
        [Range(-30.0, 30.0)]
        public double HueRotation { get; set; }
    }

    /// <summary>
    /// Color specification for an N-channel composite — either hue angle or explicit RGB weights.
    /// </summary>
    public class ChannelColorDto
    {
        /// <summary>
        /// Gets or sets hue angle (0-360). Provide one of: Hue, Rgb, or Luminance.
        /// </summary>
        [Range(0.0, 360.0)]
        public double? Hue { get; set; }

        /// <summary>
        /// Gets or sets explicit RGB weights, each in [0, 1]. Provide one of: Hue, Rgb, or Luminance.
        /// </summary>
        public double[]? Rgb { get; set; }

        /// <summary>
        /// Gets or sets a value indicating whether this channel is a luminance (detail) channel for LRGB compositing.
        /// </summary>
        public bool Luminance { get; set; }
    }

    /// <summary>
    /// Configuration for a single channel in an N-channel composite.
    /// </summary>
    public class NChannelConfigDto
    {
        /// <summary>
        /// Gets or sets mongoDB IDs of the data records (will be resolved to file paths).
        /// </summary>
        [Required]
        [MinLength(1)]
        public List<string> DataIds { get; set; } = new();

        /// <summary>
        /// Gets or sets stretch method: zscale, asinh, log, sqrt, power, histeq, linear.
        /// </summary>
        public string Stretch { get; set; } = "asinh";

        /// <summary>
        /// Gets or sets black point percentile (0.0-1.0).
        /// </summary>
        [Range(0.0, 1.0)]
        public double BlackPoint { get; set; } = 0.0;

        /// <summary>
        /// Gets or sets white point percentile (0.0-1.0).
        /// </summary>
        [Range(0.0, 1.0)]
        public double WhitePoint { get; set; } = 1.0;

        /// <summary>
        /// Gets or sets gamma correction (0.1-5.0).
        /// </summary>
        [Range(0.1, 5.0)]
        public double Gamma { get; set; } = 1.0;

        /// <summary>
        /// Gets or sets asinh softening parameter (0.001-1.0).
        /// </summary>
        [Range(0.001, 1.0)]
        public double AsinhA { get; set; } = 0.05;

        /// <summary>
        /// Gets or sets tone curve preset: linear, s_curve, inverse_s, shadows, highlights.
        /// </summary>
        [RegularExpression("^(linear|s_curve|inverse_s|shadows|highlights)$")]
        public string Curve { get; set; } = "linear";

        /// <summary>
        /// Gets or sets channel intensity weight (0.0-2.0). Multiplier applied after stretching.
        /// </summary>
        [Range(0.0, 2.0)]
        public double Weight { get; set; } = 1.0;

        /// <summary>
        /// Gets or sets color assignment for this channel.
        /// </summary>
        [Required]
        public ChannelColorDto Color { get; set; } = null!;

        /// <summary>
        /// Gets or sets optional display label (e.g. filter name "F444W").
        /// </summary>
        public string? Label { get; set; }

        /// <summary>
        /// Gets or sets optional filter wavelength in micrometers.
        /// </summary>
        [Range(0.001, 100.0)]
        public double? WavelengthUm { get; set; }

        /// <summary>
        /// Gets or sets a value indicating whether to auto-detect stretch parameters from data statistics.
        /// When true, the processing engine computes optimal params instead of using the request values.
        /// </summary>
        public bool AutoStretch { get; set; }
    }

    /// <summary>
    /// Request to generate an N-channel composite image.
    /// </summary>
    public class NChannelCompositeRequestDto
    {
        /// <summary>
        /// Gets or sets channel configurations with color assignments.
        /// </summary>
        [Required]
        [MinLength(1)]
        public List<NChannelConfigDto> Channels { get; set; } = new();

        /// <summary>
        /// Gets or sets optional overall post-stack levels and stretch adjustments.
        /// </summary>
        public OverallAdjustmentsDto? Overall { get; set; }

        /// <summary>
        /// Gets or sets optional unsharp masking applied to the final RGB composite.
        /// </summary>
        public SharpeningConfigDto? Sharpening { get; set; }

        /// <summary>
        /// Gets or sets optional saturation, vibrancy, and hue rotation applied after sharpening.
        /// </summary>
        public SaturationConfigDto? Saturation { get; set; }

        /// <summary>
        /// Gets or sets a value indicating whether to subtract per-channel sky background (default true).
        /// </summary>
        public bool BackgroundNeutralization { get; set; } = true;

        /// <summary>
        /// Gets or sets edge feathering strength (null=auto for multi-instrument, 0=off, 0.01-1.0=manual).
        /// </summary>
        [Range(0.0, 1.0)]
        public double? FeatherStrength { get; set; }

        /// <summary>
        /// Gets or sets rotation angle in degrees (-180 to 180, positive = clockwise).
        /// </summary>
        [Range(-180.0, 180.0)]
        public double RotationDegrees { get; set; } = 0.0;

        /// <summary>
        /// Gets or sets horizontal crop center (0=left, 0.5=center, 1=right).
        /// </summary>
        [Range(0.0, 1.0)]
        public double CropCenterX { get; set; } = 0.5;

        /// <summary>
        /// Gets or sets vertical crop center (0=top, 0.5=center, 1=bottom).
        /// </summary>
        [Range(0.0, 1.0)]
        public double CropCenterY { get; set; } = 0.5;

        /// <summary>
        /// Gets or sets zoom factor (0.1 to 5.0, 1.0 = fit).
        /// </summary>
        [Range(0.1, 5.0)]
        public double CropZoom { get; set; } = 1.0;

        /// <summary>
        /// Gets or sets output image format: png or jpeg.
        /// </summary>
        public string OutputFormat { get; set; } = "png";

        /// <summary>
        /// Gets or sets JPEG quality (1-100).
        /// </summary>
        [Range(1, 100)]
        public int Quality { get; set; } = 95;

        /// <summary>
        /// Gets or sets output image width (1-4096).
        /// </summary>
        [Range(1, 4096)]
        public int Width { get; set; } = 1000;

        /// <summary>
        /// Gets or sets output image height (1-4096).
        /// </summary>
        [Range(1, 4096)]
        public int Height { get; set; } = 1000;
    }

    /// <summary>
    /// Request to analyze channels — returns stretch params, histograms, and metadata.
    /// </summary>
    public class AnalyzeChannelsRequestDto
    {
        /// <summary>
        /// Gets or sets channel configurations to analyze.
        /// </summary>
        [Required]
        [MinLength(1)]
        public List<NChannelConfigDto> Channels { get; set; } = new();

        /// <summary>
        /// Gets or sets a value indicating whether background neutralization is enabled.
        /// </summary>
        public bool BackgroundNeutralization { get; set; } = true;
    }

    /// <summary>
    /// Internal global adjustments sent to processing engine.
    /// </summary>
    internal class ProcessingOverallAdjustments
    {
        [JsonPropertyName("stretch")]
        public string Stretch { get; set; } = "linear";

        [JsonPropertyName("black_point")]
        public double BlackPoint { get; set; } = 0.0;

        [JsonPropertyName("white_point")]
        public double WhitePoint { get; set; } = 1.0;

        [JsonPropertyName("gamma")]
        public double Gamma { get; set; } = 1.0;

        [JsonPropertyName("asinh_a")]
        public double AsinhA { get; set; } = 0.1;
    }

    /// <summary>
    /// Internal unsharp masking config sent to processing engine.
    /// </summary>
    internal class ProcessingSharpeningConfig
    {
        [JsonPropertyName("radius")]
        public double Radius { get; set; } = 1.5;

        [JsonPropertyName("amount")]
        public double Amount { get; set; }

        [JsonPropertyName("threshold")]
        public double Threshold { get; set; }
    }

    /// <summary>
    /// Internal saturation/vibrancy/hue config sent to processing engine.
    /// </summary>
    internal class ProcessingSaturationConfig
    {
        [JsonPropertyName("saturation")]
        public double Saturation { get; set; } = 1.0;

        [JsonPropertyName("vibrancy")]
        public double Vibrancy { get; set; }

        [JsonPropertyName("hue_rotation")]
        public double HueRotation { get; set; }
    }

    /// <summary>
    /// Internal color specification sent to processing engine.
    /// </summary>
    internal class ProcessingChannelColor
    {
        [JsonPropertyName("hue")]
        public double? Hue { get; set; }

        [JsonPropertyName("rgb")]
        public double[]? Rgb { get; set; }

        [JsonPropertyName("luminance")]
        public bool Luminance { get; set; }
    }

    /// <summary>
    /// Internal N-channel config sent to processing engine (with file paths and color).
    /// </summary>
    internal class ProcessingNChannelConfig
    {
        [JsonPropertyName("file_paths")]
        public List<string> FilePaths { get; set; } = new();

        [JsonPropertyName("stretch")]
        public string Stretch { get; set; } = "asinh";

        [JsonPropertyName("black_point")]
        public double BlackPoint { get; set; } = 0.0;

        [JsonPropertyName("white_point")]
        public double WhitePoint { get; set; } = 1.0;

        [JsonPropertyName("gamma")]
        public double Gamma { get; set; } = 1.0;

        [JsonPropertyName("asinh_a")]
        public double AsinhA { get; set; } = 0.05;

        [JsonPropertyName("curve")]
        public string Curve { get; set; } = "linear";

        [JsonPropertyName("weight")]
        public double Weight { get; set; } = 1.0;

        [JsonPropertyName("color")]
        public ProcessingChannelColor Color { get; set; } = null!;

        [JsonPropertyName("label")]
        public string? Label { get; set; }

        [JsonPropertyName("wavelength_um")]
        public double? WavelengthUm { get; set; }

        [JsonPropertyName("auto_stretch")]
        public bool AutoStretch { get; set; }
    }

    /// <summary>
    /// Internal analyze-channels request sent to processing engine (with file paths).
    /// </summary>
    internal class ProcessingAnalyzeChannelsRequest
    {
        [JsonPropertyName("channels")]
        public List<ProcessingNChannelConfig> Channels { get; set; } = new();

        [JsonPropertyName("background_neutralization")]
        public bool BackgroundNeutralization { get; set; } = true;
    }

    /// <summary>
    /// Internal N-channel request sent to processing engine.
    /// </summary>
    internal class ProcessingNChannelCompositeRequest
    {
        [JsonPropertyName("channels")]
        public List<ProcessingNChannelConfig> Channels { get; set; } = new();

        [JsonPropertyName("overall")]
        public ProcessingOverallAdjustments? Overall { get; set; }

        [JsonPropertyName("sharpening")]
        public ProcessingSharpeningConfig? Sharpening { get; set; }

        [JsonPropertyName("saturation")]
        public ProcessingSaturationConfig? Saturation { get; set; }

        [JsonPropertyName("background_neutralization")]
        public bool BackgroundNeutralization { get; set; } = true;

        [JsonPropertyName("feather_strength")]
        public double? FeatherStrength { get; set; }

        [JsonPropertyName("rotation_degrees")]
        public double RotationDegrees { get; set; } = 0.0;

        [JsonPropertyName("crop_center_x")]
        public double CropCenterX { get; set; } = 0.5;

        [JsonPropertyName("crop_center_y")]
        public double CropCenterY { get; set; } = 0.5;

        [JsonPropertyName("crop_zoom")]
        public double CropZoom { get; set; } = 1.0;

        [JsonPropertyName("output_format")]
        public string OutputFormat { get; set; } = "png";

        [JsonPropertyName("quality")]
        public int Quality { get; set; } = 95;

        [JsonPropertyName("width")]
        public int Width { get; set; } = 1000;

        [JsonPropertyName("height")]
        public int Height { get; set; } = 1000;
    }

    /// <summary>
    /// Wraps the bytes returned by the processing engine alongside the
    /// `X-Composite-*` and `X-Quality-*` response headers so the controller
    /// can forward them to the HTTP client.
    /// </summary>
    /// <remarks>
    /// Record equality compares <c>Bytes</c> and <c>Headers</c> by reference
    /// (not deep). Treat instances as transient; do not use as dictionary keys
    /// or in equality-based assertions.
    /// </remarks>
    public sealed record CompositeResult(byte[] Bytes, IReadOnlyDictionary<string, string> Headers);

    /// <summary>
    /// Verdict from the processing engine's POST /composite/estimate endpoint.
    /// status carries "ok" | "warn" | "fail"; shapes are encoded as
    /// JSON arrays [height, width].
    /// </summary>
    public sealed class CompositeEstimateResponseDto
    {
        [JsonPropertyName("status")]
        public string Status { get; set; } = "ok";

        [JsonPropertyName("original_shape")]
        public int[] OriginalShape { get; set; } = [0, 0];

        [JsonPropertyName("output_shape")]
        public int[] OutputShape { get; set; } = [0, 0];

        [JsonPropertyName("side_factor")]
        public double SideFactor { get; set; } = 1.0;

        [JsonPropertyName("detail")]
        public string Detail { get; set; } = string.Empty;

        [JsonPropertyName("memory_limit_mb")]
        public int MemoryLimitMb { get; set; }

        [JsonPropertyName("fail_threshold")]
        public double FailThreshold { get; set; }
    }
}
