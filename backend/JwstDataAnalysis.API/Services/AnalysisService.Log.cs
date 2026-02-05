// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// High-performance logging methods for AnalysisService.
    /// </summary>
    public partial class AnalysisService
    {
        [LoggerMessage(
            EventId = 1,
            Level = LogLevel.Information,
            Message = "Computing region statistics: DataId={DataId}, RegionType={RegionType}")]
        private partial void LogComputingRegionStatistics(string dataId, string regionType);

        [LoggerMessage(
            EventId = 2,
            Level = LogLevel.Error,
            Message = "Processing engine error: {StatusCode} - {ErrorBody}")]
        private partial void LogProcessingEngineError(HttpStatusCode statusCode, string errorBody);

        [LoggerMessage(
            EventId = 3,
            Level = LogLevel.Information,
            Message = "Region statistics computed: {PixelCount} pixels, mean={Mean}")]
        private partial void LogRegionStatisticsComputed(int pixelCount, double mean);

        [LoggerMessage(
            EventId = 4,
            Level = LogLevel.Warning,
            Message = "Data not found: {DataId}")]
        private partial void LogDataNotFound(string dataId);

        [LoggerMessage(
            EventId = 5,
            Level = LogLevel.Warning,
            Message = "Data {DataId} has no file path")]
        private partial void LogNoFilePath(string dataId);
    }
}
