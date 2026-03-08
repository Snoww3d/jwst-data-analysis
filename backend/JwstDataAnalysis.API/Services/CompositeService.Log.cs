// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// High-performance logging methods for CompositeService.
    /// </summary>
    public partial class CompositeService
    {
        [LoggerMessage(
            EventId = 2,
            Level = LogLevel.Debug,
            Message = "Calling processing engine: {RequestJson}")]
        private partial void LogCallingProcessingEngine(string requestJson);

        [LoggerMessage(
            EventId = 3,
            Level = LogLevel.Error,
            Message = "Processing engine error: {StatusCode} - {ErrorBody}")]
        private partial void LogProcessingEngineError(HttpStatusCode statusCode, string errorBody);

        [LoggerMessage(
            EventId = 4,
            Level = LogLevel.Information,
            Message = "Composite generated: {Size} bytes, format={Format}")]
        private partial void LogCompositeGenerated(int size, string format);

        [LoggerMessage(
            EventId = 5,
            Level = LogLevel.Warning,
            Message = "Data not found: {DataId}")]
        private partial void LogDataNotFound(string dataId);

        [LoggerMessage(
            EventId = 6,
            Level = LogLevel.Warning,
            Message = "Data {DataId} has no file path")]
        private partial void LogNoFilePath(string dataId);

        [LoggerMessage(
            EventId = 7,
            Level = LogLevel.Debug,
            Message = "Resolved {DataId}: {AbsolutePath} -> {RelativePath}")]
        private partial void LogResolvedPath(string dataId, string absolutePath, string relativePath);

        [LoggerMessage(
            EventId = 8,
            Level = LogLevel.Warning,
            Message = "Access denied for composite source data {DataId}. Authenticated={IsAuthenticated}, UserId={UserId}, IsAdmin={IsAdmin}")]
        private partial void LogAccessDenied(string dataId, bool isAuthenticated, string? userId, bool isAdmin);

        [LoggerMessage(
            EventId = 9,
            Level = LogLevel.Information,
            Message = "Generating N-channel composite: {ChannelCount} channel(s)")]
        private partial void LogGeneratingNChannelComposite(int channelCount);

        [LoggerMessage(
            EventId = 10,
            Level = LogLevel.Information,
            Message = "Filtered to {Suffix} files: {FilteredCount} of {TotalCount} total")]
        private partial void LogFilteredToPreferredFileType(string suffix, int filteredCount, int totalCount);

        [LoggerMessage(
            EventId = 11,
            Level = LogLevel.Information,
            Message = "Substituted observation mosaic for {ObservationBaseId}: {OriginalCount} files -> 1 mosaic (dataId={MosaicDataId})")]
        private partial void LogSubstitutedObservationMosaic(string observationBaseId, int originalCount, string mosaicDataId);

        [LoggerMessage(
            EventId = 12,
            Level = LogLevel.Information,
            Message = "Generating inline observation mosaic for {ObservationBaseId}: {SourceCount} source files")]
        private partial void LogInlineMosaicStarted(string observationBaseId, int sourceCount);

        [LoggerMessage(
            EventId = 13,
            Level = LogLevel.Information,
            Message = "Inline observation mosaic completed for {ObservationBaseId}: dataId={MosaicDataId}")]
        private partial void LogInlineMosaicCompleted(string observationBaseId, string mosaicDataId);
    }
}
