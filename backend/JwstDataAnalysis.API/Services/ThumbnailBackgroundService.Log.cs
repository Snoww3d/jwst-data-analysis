// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    public sealed partial class ThumbnailBackgroundService
    {
        [LoggerMessage(EventId = 8001, Level = LogLevel.Information,
            Message = "Thumbnail background service started")]
        private partial void LogServiceStarted();

        [LoggerMessage(EventId = 8002, Level = LogLevel.Information,
            Message = "Thumbnail batch received: {Count} ID(s) queued for processing")]
        private partial void LogBatchReceived(int count);

        [LoggerMessage(EventId = 8003, Level = LogLevel.Error,
            Message = "Thumbnail batch failed ({Count} IDs). Service will continue processing.")]
        private partial void LogBatchFailed(Exception ex, int count);

        [LoggerMessage(EventId = 8004, Level = LogLevel.Information,
            Message = "Thumbnail background service stopping")]
        private partial void LogServiceStopping();
    }
}
