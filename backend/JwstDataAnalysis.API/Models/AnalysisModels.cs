// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text.Json.Serialization;

namespace JwstDataAnalysis.API.Models
{
    /// <summary>
    /// Request to compute statistics for a region within a FITS image.
    /// </summary>
    public class RegionStatisticsRequestDto
    {
        public string DataId { get; set; } = string.Empty;

        public string RegionType { get; set; } = string.Empty;

        public RectangleRegionDto? Rectangle { get; set; }

        public EllipseRegionDto? Ellipse { get; set; }

        public int HduIndex { get; set; } = -1;
    }

    public class RectangleRegionDto
    {
        public int X { get; set; }

        public int Y { get; set; }

        public int Width { get; set; }

        public int Height { get; set; }
    }

    public class EllipseRegionDto
    {
        public double CenterX { get; set; }

        public double CenterY { get; set; }

        public double RadiusX { get; set; }

        public double RadiusY { get; set; }
    }

    /// <summary>
    /// Response containing computed region statistics.
    /// </summary>
    public class RegionStatisticsResponseDto
    {
        public double Mean { get; set; }

        public double Median { get; set; }

        public double Std { get; set; }

        public double Min { get; set; }

        public double Max { get; set; }

        public double Sum { get; set; }

        public int PixelCount { get; set; }
    }

    // === Source Detection DTOs ===

    /// <summary>
    /// Request to detect sources in a FITS image.
    /// </summary>
    public class SourceDetectionRequestDto
    {
        public string DataId { get; set; } = string.Empty;

        public double ThresholdSigma { get; set; } = 5.0;

        public double Fwhm { get; set; } = 3.0;

        public string Method { get; set; } = "auto";

        public int Npixels { get; set; } = 10;

        public bool Deblend { get; set; } = true;
    }

    /// <summary>
    /// Information about a single detected source.
    /// </summary>
    public class SourceInfoDto
    {
        public int Id { get; set; }

        public double Xcentroid { get; set; }

        public double Ycentroid { get; set; }

        public double? Flux { get; set; }

        public double? Sharpness { get; set; }

        public double? Roundness { get; set; }

        public double? Fwhm { get; set; }

        public double? Peak { get; set; }
    }

    /// <summary>
    /// Response containing detected sources.
    /// </summary>
    public class SourceDetectionResponseDto
    {
        public List<SourceInfoDto> Sources { get; set; } = [];

        public int NSources { get; set; }

        public string Method { get; set; } = string.Empty;

        public double ThresholdSigma { get; set; }

        public double ThresholdValue { get; set; }

        public double? EstimatedFwhm { get; set; }
    }

    // === Table Viewer DTOs ===

    /// <summary>
    /// Metadata for a single column in a FITS table.
    /// </summary>
    public class TableColumnInfoDto
    {
        public string Name { get; set; } = string.Empty;

        public string Dtype { get; set; } = string.Empty;

        public string? Unit { get; set; }

        public string? Format { get; set; }

        public bool IsArray { get; set; }

        public List<int>? ArrayShape { get; set; }
    }

    /// <summary>
    /// Metadata for a single table HDU.
    /// </summary>
    public class TableHduInfoDto
    {
        public int Index { get; set; }

        public string? Name { get; set; }

        public string HduType { get; set; } = string.Empty;

        public int NRows { get; set; }

        public int NColumns { get; set; }

        public List<TableColumnInfoDto> Columns { get; set; } = [];
    }

    /// <summary>
    /// Response listing table HDUs in a FITS file.
    /// </summary>
    public class TableInfoResponseDto
    {
        public string FileName { get; set; } = string.Empty;

        public List<TableHduInfoDto> TableHdus { get; set; } = [];
    }

    /// <summary>
    /// Response containing paginated table data.
    /// </summary>
    public class TableDataResponseDto
    {
        public int HduIndex { get; set; }

        public string? HduName { get; set; }

        public int TotalRows { get; set; }

        public int TotalColumns { get; set; }

        public int Page { get; set; }

        public int PageSize { get; set; }

        public List<TableColumnInfoDto> Columns { get; set; } = [];

        public List<Dictionary<string, object?>> Rows { get; set; } = [];

        public string? SortColumn { get; set; }

        public string? SortDirection { get; set; }
    }

    // === Spectral Viewer DTOs ===

    /// <summary>
    /// Metadata for a single column in spectral data.
    /// </summary>
    public class SpectralColumnMetaDto
    {
        public string Name { get; set; } = string.Empty;

        public string? Unit { get; set; }

        public int NPoints { get; set; }
    }

    /// <summary>
    /// Response containing spectral data as column arrays for plotting.
    /// </summary>
    public class SpectralDataResponseDto
    {
        public int HduIndex { get; set; }

        public string? HduName { get; set; }

        public int NPoints { get; set; }

        public List<SpectralColumnMetaDto> Columns { get; set; } = [];

        public Dictionary<string, List<double?>> Data { get; set; } = [];
    }

    // === Internal Processing Engine Models ===

    /// <summary>
    /// Internal request model for the processing engine (snake_case).
    /// </summary>
    internal class ProcessingRegionStatisticsRequest
    {
        [JsonPropertyName("file_path")]
        public string FilePath { get; set; } = string.Empty;

        [JsonPropertyName("region_type")]
        public string RegionType { get; set; } = string.Empty;

        [JsonPropertyName("rectangle")]
        public ProcessingRectangleRegion? Rectangle { get; set; }

        [JsonPropertyName("ellipse")]
        public ProcessingEllipseRegion? Ellipse { get; set; }

        [JsonPropertyName("hdu_index")]
        public int HduIndex { get; set; } = -1;
    }

    internal class ProcessingRectangleRegion
    {
        [JsonPropertyName("x")]
        public int X { get; set; }

        [JsonPropertyName("y")]
        public int Y { get; set; }

        [JsonPropertyName("width")]
        public int Width { get; set; }

        [JsonPropertyName("height")]
        public int Height { get; set; }
    }

    internal class ProcessingEllipseRegion
    {
        [JsonPropertyName("cx")]
        public double Cx { get; set; }

        [JsonPropertyName("cy")]
        public double Cy { get; set; }

        [JsonPropertyName("rx")]
        public double Rx { get; set; }

        [JsonPropertyName("ry")]
        public double Ry { get; set; }
    }

    /// <summary>
    /// Internal request model for the processing engine (snake_case).
    /// </summary>
    internal class ProcessingSourceDetectionRequest
    {
        [JsonPropertyName("file_path")]
        public string FilePath { get; set; } = string.Empty;

        [JsonPropertyName("threshold_sigma")]
        public double ThresholdSigma { get; set; } = 5.0;

        [JsonPropertyName("fwhm")]
        public double Fwhm { get; set; } = 3.0;

        [JsonPropertyName("method")]
        public string Method { get; set; } = "auto";

        [JsonPropertyName("npixels")]
        public int Npixels { get; set; } = 10;

        [JsonPropertyName("deblend")]
        public bool Deblend { get; set; } = true;
    }
}
