// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// High-performance logging methods for ThumbnailService.
    /// </summary>
    public partial class ThumbnailService
    {
        [LoggerMessage(EventId = 1, Level = LogLevel.Warning,
            Message = "Thumbnail generation skipped: record {DataId} not found")]
        private partial void LogRecordNotFound(string dataId);

        [LoggerMessage(EventId = 2, Level = LogLevel.Debug,
            Message = "Thumbnail generation skipped: record {DataId} is not viewable")]
        private partial void LogRecordNotViewable(string dataId);

        [LoggerMessage(EventId = 3, Level = LogLevel.Warning,
            Message = "Thumbnail generation skipped: record {DataId} has no file path")]
        private partial void LogNoFilePath(string dataId);

        [LoggerMessage(EventId = 4, Level = LogLevel.Warning,
            Message = "Thumbnail generation returned null for {DataId}")]
        private partial void LogThumbnailReturnedNull(string dataId);

        [LoggerMessage(EventId = 5, Level = LogLevel.Information,
            Message = "Thumbnail generated for {DataId} ({Size} bytes)")]
        private partial void LogThumbnailGenerated(string dataId, int size);

        [LoggerMessage(EventId = 6, Level = LogLevel.Error,
            Message = "Failed to generate thumbnail for {DataId}")]
        private partial void LogThumbnailFailed(Exception ex, string dataId);

        [LoggerMessage(EventId = 7, Level = LogLevel.Information,
            Message = "Starting thumbnail generation for {Count} record(s)")]
        private partial void LogBatchStarting(int count);

        [LoggerMessage(EventId = 8, Level = LogLevel.Information,
            Message = "Thumbnail generation complete: {Generated} generated, {Skipped} skipped, {Failed} failed")]
        private partial void LogBatchComplete(int generated, int skipped, int failed);
    }
}
