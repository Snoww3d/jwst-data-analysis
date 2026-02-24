// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// High-performance logging methods for AnalysisController.
    /// </summary>
    public partial class AnalysisController
    {
        [LoggerMessage(
            EventId = 1,
            Level = LogLevel.Information,
            Message = "Computing region statistics: DataId={DataId}, RegionType={RegionType}")]
        private partial void LogComputingRegionStatistics(string dataId, string regionType);

        [LoggerMessage(
            EventId = 2,
            Level = LogLevel.Warning,
            Message = "Data not found: {Message}")]
        private partial void LogDataNotFound(string message);

        [LoggerMessage(
            EventId = 3,
            Level = LogLevel.Warning,
            Message = "Invalid operation: {Message}")]
        private partial void LogInvalidOperation(string message);

        [LoggerMessage(
            EventId = 4,
            Level = LogLevel.Error,
            Message = "Processing engine error")]
        private partial void LogProcessingEngineError(Exception ex);

        [LoggerMessage(
            EventId = 5,
            Level = LogLevel.Error,
            Message = "Unexpected error in analysis endpoint")]
        private partial void LogUnexpectedError(Exception ex);

        [LoggerMessage(
            EventId = 10,
            Level = LogLevel.Information,
            Message = "Detecting sources: DataId={DataId}, Method={Method}")]
        private partial void LogDetectingSources(string dataId, string method);

        [LoggerMessage(
            EventId = 11,
            Level = LogLevel.Information,
            Message = "Getting table info: DataId={DataId}")]
        private partial void LogGettingTableInfo(string dataId);

        [LoggerMessage(
            EventId = 12,
            Level = LogLevel.Information,
            Message = "Getting table data: DataId={DataId}, HDU={HduIndex}")]
        private partial void LogGettingTableData(string dataId, int hduIndex);

        [LoggerMessage(
            EventId = 13,
            Level = LogLevel.Information,
            Message = "Getting spectral data: DataId={DataId}, HDU={HduIndex}")]
        private partial void LogGettingSpectralData(string dataId, int hduIndex);
    }
}
