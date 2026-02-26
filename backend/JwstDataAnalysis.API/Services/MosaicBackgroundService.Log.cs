// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// High-performance logging methods for MosaicBackgroundService.
    /// </summary>
    public partial class MosaicBackgroundService
    {
        [LoggerMessage(
            EventId = 1,
            Level = LogLevel.Information,
            Message = "Mosaic background service started")]
        private partial void LogServiceStarted();

        [LoggerMessage(
            EventId = 2,
            Level = LogLevel.Information,
            Message = "Mosaic background service stopping")]
        private partial void LogServiceStopping();

        [LoggerMessage(
            EventId = 3,
            Level = LogLevel.Information,
            Message = "Mosaic job {JobId} completed")]
        private partial void LogJobCompleted(string jobId);

        [LoggerMessage(
            EventId = 4,
            Level = LogLevel.Error,
            Message = "Mosaic job {JobId} failed")]
        private partial void LogJobFailed(Exception ex, string jobId);
    }
}
