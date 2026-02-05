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
            Message = "Unexpected error computing region statistics")]
        private partial void LogUnexpectedError(Exception ex);
    }
}
