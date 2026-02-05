// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// High-performance logging methods for MosaicController.
    /// </summary>
    public partial class MosaicController
    {
        [LoggerMessage(
            EventId = 1,
            Level = LogLevel.Information,
            Message = "Generating mosaic from {FileCount} files, combine={CombineMethod}")]
        private partial void LogGeneratingMosaic(int fileCount, string combineMethod);

        [LoggerMessage(
            EventId = 2,
            Level = LogLevel.Information,
            Message = "Computing footprints for {FileCount} files")]
        private partial void LogComputingFootprints(int fileCount);

        [LoggerMessage(
            EventId = 3,
            Level = LogLevel.Warning,
            Message = "Data not found: {Message}")]
        private partial void LogDataNotFound(string message);

        [LoggerMessage(
            EventId = 4,
            Level = LogLevel.Warning,
            Message = "Invalid operation: {Message}")]
        private partial void LogInvalidOperation(string message);

        [LoggerMessage(
            EventId = 5,
            Level = LogLevel.Error,
            Message = "Processing engine error")]
        private partial void LogProcessingEngineError(Exception ex);

        [LoggerMessage(
            EventId = 6,
            Level = LogLevel.Error,
            Message = "Unexpected error in mosaic operation")]
        private partial void LogUnexpectedError(Exception ex);
    }
}
