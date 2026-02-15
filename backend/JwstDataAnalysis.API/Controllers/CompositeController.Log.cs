// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// High-performance logging methods for CompositeController.
    /// </summary>
    public partial class CompositeController
    {
        [LoggerMessage(
            EventId = 1,
            Level = LogLevel.Information,
            Message = "Generating composite: Red={RedCount} file(s), Green={GreenCount} file(s), Blue={BlueCount} file(s)")]
        private partial void LogGeneratingComposite(int redCount, int greenCount, int blueCount);

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
            Message = "Unexpected error generating composite")]
        private partial void LogUnexpectedError(Exception ex);

        [LoggerMessage(
            EventId = 6,
            Level = LogLevel.Information,
            Message = "Generating N-channel composite: {ChannelCount} channel(s)")]
        private partial void LogGeneratingNChannelComposite(int channelCount);
    }
}
