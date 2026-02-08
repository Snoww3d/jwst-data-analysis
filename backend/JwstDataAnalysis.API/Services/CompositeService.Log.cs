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
            EventId = 1,
            Level = LogLevel.Information,
            Message = "Generating composite: Red={RedId}, Green={GreenId}, Blue={BlueId}")]
        private partial void LogGeneratingComposite(string redId, string greenId, string blueId);

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
    }
}
