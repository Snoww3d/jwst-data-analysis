// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    public partial class MastService
    {
        // Event IDs: 4xxx for MAST service operations

        // Search operations (41xx)
        [LoggerMessage(EventId = 4101, Level = LogLevel.Information,
            Message = "Searching MAST for target: {Target}")]
        private partial void LogSearchingTarget(string target);

        [LoggerMessage(EventId = 4102, Level = LogLevel.Information,
            Message = "Searching MAST at RA={Ra}, Dec={Dec}")]
        private partial void LogSearchingCoordinates(double ra, double dec);

        [LoggerMessage(EventId = 4103, Level = LogLevel.Information,
            Message = "Searching MAST for observation ID: {ObsId}")]
        private partial void LogSearchingObservation(string obsId);

        [LoggerMessage(EventId = 4104, Level = LogLevel.Information,
            Message = "Searching MAST for program ID: {ProgramId}")]
        private partial void LogSearchingProgram(string programId);

        [LoggerMessage(EventId = 4105, Level = LogLevel.Information,
            Message = "Searching MAST for recent releases: {DaysBack} days, instrument: {Instrument}")]
        private partial void LogSearchingRecentReleases(int daysBack, string instrument);

        [LoggerMessage(EventId = 4106, Level = LogLevel.Information,
            Message = "Getting data products for observation: {ObsId}")]
        private partial void LogGettingDataProducts(string obsId);

        // Download operations (42xx)
        [LoggerMessage(EventId = 4201, Level = LogLevel.Information,
            Message = "Downloading observation: {ObsId}")]
        private partial void LogDownloadingObservation(string obsId);

        [LoggerMessage(EventId = 4202, Level = LogLevel.Information,
            Message = "Starting async download for observation: {ObsId}")]
        private partial void LogStartingAsyncDownload(string obsId);

        [LoggerMessage(EventId = 4203, Level = LogLevel.Warning,
            Message = "Failed to get download progress for job {JobId}: {Status}")]
        private partial void LogFailedToGetDownloadProgress(string jobId, System.Net.HttpStatusCode status);

        [LoggerMessage(EventId = 4204, Level = LogLevel.Error,
            Message = "Error getting download progress for job {JobId}")]
        private partial void LogErrorGettingDownloadProgress(Exception ex, string jobId);

        [LoggerMessage(EventId = 4205, Level = LogLevel.Information,
            Message = "Starting chunked download for observation: {ObsId}")]
        private partial void LogStartingChunkedDownload(string obsId);

        [LoggerMessage(EventId = 4206, Level = LogLevel.Information,
            Message = "Resuming download for job: {JobId}")]
        private partial void LogResumingDownload(string jobId);

        [LoggerMessage(EventId = 4207, Level = LogLevel.Error,
            Message = "Failed to resume download for job {JobId}: {Status}")]
        private partial void LogFailedToResumeDownload(string jobId, System.Net.HttpStatusCode status);

        [LoggerMessage(EventId = 4208, Level = LogLevel.Information,
            Message = "Pausing download for job: {JobId}")]
        private partial void LogPausingDownload(string jobId);

        [LoggerMessage(EventId = 4209, Level = LogLevel.Error,
            Message = "Failed to pause download for job {JobId}: {Status}")]
        private partial void LogFailedToPauseDownload(string jobId, System.Net.HttpStatusCode status);

        [LoggerMessage(EventId = 4210, Level = LogLevel.Warning,
            Message = "Failed to get chunked download progress for job {JobId}: {Status}")]
        private partial void LogFailedToGetChunkedProgress(string jobId, System.Net.HttpStatusCode status);

        [LoggerMessage(EventId = 4211, Level = LogLevel.Error,
            Message = "Error getting chunked download progress for job {JobId}")]
        private partial void LogErrorGettingChunkedProgress(Exception ex, string jobId);

        [LoggerMessage(EventId = 4212, Level = LogLevel.Warning,
            Message = "Failed to get resumable downloads: {Status}")]
        private partial void LogFailedToGetResumableDownloads(System.Net.HttpStatusCode status);

        [LoggerMessage(EventId = 4213, Level = LogLevel.Error,
            Message = "Error getting resumable downloads")]
        private partial void LogErrorGettingResumableDownloads(Exception ex);

        [LoggerMessage(EventId = 4214, Level = LogLevel.Error,
            Message = "Failed to dismiss download {JobId}")]
        private partial void LogFailedToDismissDownload(Exception ex, string jobId);

        // Processing engine communication (43xx)
        [LoggerMessage(EventId = 4301, Level = LogLevel.Debug,
            Message = "Calling processing engine: {Endpoint} with body: {Body}")]
        private partial void LogCallingProcessingEngine(string endpoint, string body);

        [LoggerMessage(EventId = 4302, Level = LogLevel.Error,
            Message = "Processing engine returned {StatusCode}: {Response}")]
        private partial void LogProcessingEngineError(System.Net.HttpStatusCode statusCode, string response);

        [LoggerMessage(EventId = 4303, Level = LogLevel.Error,
            Message = "HTTP error calling processing engine at {Endpoint}")]
        private partial void LogHttpErrorCallingEngine(Exception ex, string endpoint);

        [LoggerMessage(EventId = 4304, Level = LogLevel.Error,
            Message = "Error calling processing engine at {Endpoint}")]
        private partial void LogErrorCallingEngine(Exception ex, string endpoint);
    }
}
