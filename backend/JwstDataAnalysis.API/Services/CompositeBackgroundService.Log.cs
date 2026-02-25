// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// High-performance logging methods for CompositeBackgroundService.
    /// </summary>
    public partial class CompositeBackgroundService
    {
        [LoggerMessage(
            EventId = 1,
            Level = LogLevel.Information,
            Message = "Composite background service started")]
        private partial void LogServiceStarted();

        [LoggerMessage(
            EventId = 2,
            Level = LogLevel.Information,
            Message = "Composite background service stopping")]
        private partial void LogServiceStopping();

        [LoggerMessage(
            EventId = 3,
            Level = LogLevel.Information,
            Message = "Composite job {JobId} completed")]
        private partial void LogJobCompleted(string jobId);

        [LoggerMessage(
            EventId = 4,
            Level = LogLevel.Error,
            Message = "Composite job {JobId} failed")]
        private partial void LogJobFailed(Exception ex, string jobId);
    }
}
