// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace JwstDataAnalysis.API.Models
{
    /// <summary>
    /// Configuration for a single RGB channel in composite generation.
    /// </summary>
    public class ChannelConfigDto
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
        public string Stretch { get; set; } = "zscale";

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
        public double AsinhA { get; set; } = 0.1;

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
    }

    /// <summary>
    /// Global post-stack levels and stretch adjustments.
    /// </summary>
    public class OverallAdjustmentsDto
    {
        /// <summary>
        /// Gets or sets stretch method: zscale, asinh, log, sqrt, power, histeq, linear.
        /// </summary>
        [RegularExpression("^(zscale|asinh|log|sqrt|power|histeq|linear)$")]
        public string Stretch { get; set; } = "zscale";

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
    /// Request to generate an RGB composite image from 3 FITS files.
    /// </summary>
    public class CompositeRequestDto
    {
        /// <summary>
        /// Gets or sets red channel configuration.
        /// </summary>
        [Required]
        public ChannelConfigDto Red { get; set; } = null!;

        /// <summary>
        /// Gets or sets green channel configuration.
        /// </summary>
        [Required]
        public ChannelConfigDto Green { get; set; } = null!;

        /// <summary>
        /// Gets or sets blue channel configuration.
        /// </summary>
        [Required]
        public ChannelConfigDto Blue { get; set; } = null!;

        /// <summary>
        /// Gets or sets optional overall post-stack levels and stretch adjustments.
        /// </summary>
        public OverallAdjustmentsDto? Overall { get; set; }

        /// <summary>
        /// Gets or sets a value indicating whether to subtract per-channel sky background
        /// to neutralize color casts (default true).
        /// </summary>
        public bool BackgroundNeutralization { get; set; } = true;

        /// <summary>
        /// Gets or sets output image format: png or jpeg.
        /// </summary>
        public string OutputFormat { get; set; } = "png";

        /// <summary>
        /// Gets or sets jPEG quality (1-100).
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
    /// Color specification for an N-channel composite — either hue angle or explicit RGB weights.
    /// </summary>
    public class ChannelColorDto
    {
        /// <summary>
        /// Gets or sets hue angle (0-360). Provide either Hue or Rgb, not both.
        /// </summary>
        [Range(0.0, 360.0)]
        public double? Hue { get; set; }

        /// <summary>
        /// Gets or sets explicit RGB weights, each in [0, 1]. Provide either Hue or Rgb, not both.
        /// </summary>
        public double[]? Rgb { get; set; }
    }

    /// <summary>
    /// Configuration for a single channel in an N-channel composite.
    /// Extends ChannelConfigDto with color assignment, label, and wavelength.
    /// </summary>
    public class NChannelConfigDto : ChannelConfigDto
    {
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
        /// Gets or sets a value indicating whether to subtract per-channel sky background (default true).
        /// </summary>
        public bool BackgroundNeutralization { get; set; } = true;

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
    /// Internal channel configuration sent to processing engine (with file paths).
    /// </summary>
    internal class ProcessingChannelConfig
    {
        [JsonPropertyName("file_paths")]
        public List<string> FilePaths { get; set; } = new();

        [JsonPropertyName("stretch")]
        public string Stretch { get; set; } = "zscale";

        [JsonPropertyName("black_point")]
        public double BlackPoint { get; set; } = 0.0;

        [JsonPropertyName("white_point")]
        public double WhitePoint { get; set; } = 1.0;

        [JsonPropertyName("gamma")]
        public double Gamma { get; set; } = 1.0;

        [JsonPropertyName("asinh_a")]
        public double AsinhA { get; set; } = 0.1;

        [JsonPropertyName("curve")]
        public string Curve { get; set; } = "linear";

        [JsonPropertyName("weight")]
        public double Weight { get; set; } = 1.0;
    }

    /// <summary>
    /// Internal global adjustments sent to processing engine.
    /// </summary>
    internal class ProcessingOverallAdjustments
    {
        [JsonPropertyName("stretch")]
        public string Stretch { get; set; } = "zscale";

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
    /// Internal request sent to processing engine.
    /// </summary>
    internal class ProcessingCompositeRequest
    {
        [JsonPropertyName("red")]
        public ProcessingChannelConfig Red { get; set; } = null!;

        [JsonPropertyName("green")]
        public ProcessingChannelConfig Green { get; set; } = null!;

        [JsonPropertyName("blue")]
        public ProcessingChannelConfig Blue { get; set; } = null!;

        [JsonPropertyName("overall")]
        public ProcessingOverallAdjustments? Overall { get; set; }

        [JsonPropertyName("background_neutralization")]
        public bool BackgroundNeutralization { get; set; } = true;

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
    /// Internal color specification sent to processing engine.
    /// </summary>
    internal class ProcessingChannelColor
    {
        [JsonPropertyName("hue")]
        public double? Hue { get; set; }

        [JsonPropertyName("rgb")]
        public double[]? Rgb { get; set; }
    }

    /// <summary>
    /// Internal N-channel config sent to processing engine (with file paths and color).
    /// </summary>
    internal class ProcessingNChannelConfig : ProcessingChannelConfig
    {
        [JsonPropertyName("color")]
        public ProcessingChannelColor Color { get; set; } = null!;

        [JsonPropertyName("label")]
        public string? Label { get; set; }

        [JsonPropertyName("wavelength_um")]
        public double? WavelengthUm { get; set; }
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

        [JsonPropertyName("background_neutralization")]
        public bool BackgroundNeutralization { get; set; } = true;

        [JsonPropertyName("output_format")]
        public string OutputFormat { get; set; } = "png";

        [JsonPropertyName("quality")]
        public int Quality { get; set; } = 95;

        [JsonPropertyName("width")]
        public int Width { get; set; } = 1000;

        [JsonPropertyName("height")]
        public int Height { get; set; } = 1000;
    }
}
