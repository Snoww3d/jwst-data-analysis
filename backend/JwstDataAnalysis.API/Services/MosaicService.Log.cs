// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// High-performance logging methods for MosaicService.
    /// </summary>
    public partial class MosaicService
    {
        [LoggerMessage(
            EventId = 1,
            Level = LogLevel.Information,
            Message = "Generating mosaic from {FileCount} files, combine={CombineMethod}")]
        private partial void LogGeneratingMosaic(int fileCount, string combineMethod);

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
            Message = "Mosaic generated: {Size} bytes, format={Format}")]
        private partial void LogMosaicGenerated(int size, string format);

        [LoggerMessage(
            EventId = 5,
            Level = LogLevel.Information,
            Message = "Computing footprints for {FileCount} files")]
        private partial void LogComputingFootprints(int fileCount);

        [LoggerMessage(
            EventId = 6,
            Level = LogLevel.Debug,
            Message = "Calling footprint endpoint: {RequestJson}")]
        private partial void LogCallingFootprintEndpoint(string requestJson);

        [LoggerMessage(
            EventId = 7,
            Level = LogLevel.Information,
            Message = "Footprints computed for {FileCount} files")]
        private partial void LogFootprintsComputed(int fileCount);

        [LoggerMessage(
            EventId = 8,
            Level = LogLevel.Warning,
            Message = "Data not found: {DataId}")]
        private partial void LogDataNotFound(string dataId);

        [LoggerMessage(
            EventId = 9,
            Level = LogLevel.Warning,
            Message = "Data {DataId} has no file path")]
        private partial void LogNoFilePath(string dataId);

        [LoggerMessage(
            EventId = 10,
            Level = LogLevel.Debug,
            Message = "Resolved {DataId}: {AbsolutePath} -> {RelativePath}")]
        private partial void LogResolvedPath(string dataId, string absolutePath, string relativePath);
    }
}
