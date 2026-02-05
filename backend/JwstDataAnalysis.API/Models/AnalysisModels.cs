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
}
