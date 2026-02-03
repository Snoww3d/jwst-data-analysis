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
        /// Gets or sets mongoDB ID of the data record (will be resolved to file path).
        /// </summary>
        [Required]
        public string DataId { get; set; } = string.Empty;

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
    /// Internal channel configuration sent to processing engine (with file paths).
    /// </summary>
    internal class ProcessingChannelConfig
    {
        [JsonPropertyName("file_path")]
        public string FilePath { get; set; } = string.Empty;

        [JsonPropertyName("stretch")]
        public string Stretch { get; set; } = "asinh";

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
