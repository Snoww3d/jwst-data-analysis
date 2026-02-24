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

        [LoggerMessage(
            EventId = 6,
            Level = LogLevel.Information,
            Message = "Detecting sources: DataId={DataId}, Method={Method}")]
        private partial void LogDetectingSources(string dataId, string method);

        [LoggerMessage(
            EventId = 7,
            Level = LogLevel.Information,
            Message = "Sources detected: {NSources} sources using {Method}")]
        private partial void LogSourcesDetected(int nSources, string method);

        [LoggerMessage(
            EventId = 8,
            Level = LogLevel.Information,
            Message = "Getting table info: DataId={DataId}")]
        private partial void LogGettingTableInfo(string dataId);

        [LoggerMessage(
            EventId = 9,
            Level = LogLevel.Information,
            Message = "Table info retrieved: {HduCount} table HDUs")]
        private partial void LogTableInfoRetrieved(int hduCount);

        [LoggerMessage(
            EventId = 10,
            Level = LogLevel.Information,
            Message = "Getting table data: DataId={DataId}, HDU={HduIndex}")]
        private partial void LogGettingTableData(string dataId, int hduIndex);

        [LoggerMessage(
            EventId = 11,
            Level = LogLevel.Information,
            Message = "Table data retrieved: {TotalRows} rows, page {Page}")]
        private partial void LogTableDataRetrieved(int totalRows, int page);

        [LoggerMessage(
            EventId = 12,
            Level = LogLevel.Information,
            Message = "Getting spectral data: FilePath={FilePath}, HDU={HduIndex}")]
        private partial void LogGettingSpectralData(string filePath, int hduIndex);

        [LoggerMessage(
            EventId = 13,
            Level = LogLevel.Information,
            Message = "Spectral data retrieved: {NPoints} points")]
        private partial void LogSpectralDataRetrieved(int nPoints);
    }
}
