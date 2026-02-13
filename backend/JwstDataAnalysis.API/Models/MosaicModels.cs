// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace JwstDataAnalysis.API.Models
{
    /// <summary>
    /// Configuration for a single input file in mosaic generation.
    /// </summary>
    public class MosaicFileConfigDto
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
    /// Request to generate a WCS-aware mosaic image from 2+ FITS files.
    /// </summary>
    public class MosaicRequestDto
    {
        /// <summary>
        /// Gets or sets input files (minimum 2 required).
        /// </summary>
        [Required]
        [MinLength(2)]
        public List<MosaicFileConfigDto> Files { get; set; } = [];

        /// <summary>
        /// Gets or sets output format: png, jpeg, or fits.
        /// </summary>
        public string OutputFormat { get; set; } = "png";

        /// <summary>
        /// Gets or sets JPEG quality (1-100).
        /// </summary>
        [Range(1, 100)]
        public int Quality { get; set; } = 95;

        /// <summary>
        /// Gets or sets optional output image width (null = native resolution).
        /// </summary>
        [Range(1, 8000)]
        public int? Width { get; set; }

        /// <summary>
        /// Gets or sets optional output image height (null = native resolution).
        /// </summary>
        [Range(1, 8000)]
        public int? Height { get; set; }

        /// <summary>
        /// Gets or sets method for combining overlapping pixels: mean, sum, first, last, min, max.
        /// </summary>
        public string CombineMethod { get; set; } = "mean";

        /// <summary>
        /// Gets or sets colormap for single-channel output.
        /// </summary>
        public string Cmap { get; set; } = "grayscale";
    }

    /// <summary>
    /// Response for server-side mosaic generation and persistence.
    /// </summary>
    public class SavedMosaicResponseDto
    {
        /// <summary>
        /// Gets or sets the created data record ID.
        /// </summary>
        public string DataId { get; set; } = string.Empty;

        /// <summary>
        /// Gets or sets persisted file name.
        /// </summary>
        public string FileName { get; set; } = string.Empty;

        /// <summary>
        /// Gets or sets persisted file size in bytes.
        /// </summary>
        public long FileSize { get; set; }

        /// <summary>
        /// Gets or sets file format.
        /// </summary>
        public string FileFormat { get; set; } = "fits";

        /// <summary>
        /// Gets or sets processing level.
        /// </summary>
        public string ProcessingLevel { get; set; } = ProcessingLevels.Level3;

        /// <summary>
        /// Gets or sets source data IDs used to generate this mosaic.
        /// </summary>
        public List<string> DerivedFrom { get; set; } = [];
    }

    /// <summary>
    /// Request to compute WCS footprints for FITS files.
    /// </summary>
    public class FootprintRequestDto
    {
        /// <summary>
        /// Gets or sets data IDs to compute footprints for.
        /// </summary>
        [Required]
        [MinLength(1)]
        public List<string> DataIds { get; set; } = [];
    }

    /// <summary>
    /// WCS footprint for a single file.
    /// </summary>
    public class FootprintEntryDto
    {
        /// <summary>
        /// Gets or sets file path.
        /// </summary>
        [JsonPropertyName("file_path")]
        public string FilePath { get; set; } = string.Empty;

        /// <summary>
        /// Gets or sets RA coordinates of image corners (degrees).
        /// </summary>
        [JsonPropertyName("corners_ra")]
        public List<double> CornersRa { get; set; } = [];

        /// <summary>
        /// Gets or sets Dec coordinates of image corners (degrees).
        /// </summary>
        [JsonPropertyName("corners_dec")]
        public List<double> CornersDec { get; set; } = [];

        /// <summary>
        /// Gets or sets center RA (degrees).
        /// </summary>
        [JsonPropertyName("center_ra")]
        public double CenterRa { get; set; }

        /// <summary>
        /// Gets or sets center Dec (degrees).
        /// </summary>
        [JsonPropertyName("center_dec")]
        public double CenterDec { get; set; }
    }

    /// <summary>
    /// Response with WCS footprints for all input files.
    /// </summary>
    public class FootprintResponseDto
    {
        /// <summary>
        /// Gets or sets footprint entries.
        /// </summary>
        [JsonPropertyName("footprints")]
        public List<FootprintEntryDto> Footprints { get; set; } = [];

        /// <summary>
        /// Gets or sets bounding box (min_ra, max_ra, min_dec, max_dec).
        /// </summary>
        [JsonPropertyName("bounding_box")]
        public Dictionary<string, double> BoundingBox { get; set; } = [];

        /// <summary>
        /// Gets or sets number of files.
        /// </summary>
        [JsonPropertyName("n_files")]
        public int NFiles { get; set; }
    }

    /// <summary>
    /// Internal file configuration sent to processing engine (with file paths).
    /// </summary>
    internal class ProcessingMosaicFileConfig
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
    /// Internal mosaic request sent to processing engine.
    /// </summary>
    internal class ProcessingMosaicRequest
    {
        [JsonPropertyName("files")]
        public List<ProcessingMosaicFileConfig> Files { get; set; } = [];

        [JsonPropertyName("output_format")]
        public string OutputFormat { get; set; } = "png";

        [JsonPropertyName("quality")]
        public int Quality { get; set; } = 95;

        [JsonPropertyName("width")]
        public int? Width { get; set; }

        [JsonPropertyName("height")]
        public int? Height { get; set; }

        [JsonPropertyName("combine_method")]
        public string CombineMethod { get; set; } = "mean";

        [JsonPropertyName("cmap")]
        public string Cmap { get; set; } = "grayscale";
    }

    /// <summary>
    /// Internal footprint request sent to processing engine.
    /// </summary>
    internal class ProcessingFootprintRequest
    {
        [JsonPropertyName("file_paths")]
        public List<string> FilePaths { get; set; } = [];
    }
}
