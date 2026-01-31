//

namespace JwstDataAnalysis.API.Services
{
    public partial class ImportJobTracker
    {
        // Event IDs: 5xxx for Import tracking

        [LoggerMessage(EventId = 5001, Level = LogLevel.Information,
            Message = "Created import job {JobId} for observation {ObsId}")]
        private partial void LogJobCreated(string jobId, string obsId);

        [LoggerMessage(EventId = 5002, Level = LogLevel.Information,
            Message = "Cancellation requested for job {JobId}")]
        private partial void LogCancellationRequested(string jobId);

        [LoggerMessage(EventId = 5003, Level = LogLevel.Debug,
            Message = "Job {JobId} progress: {Progress}% - {Stage}: {Message}")]
        private partial void LogProgressUpdate(string jobId, int progress, string stage, string message);

        [LoggerMessage(EventId = 5004, Level = LogLevel.Debug,
            Message = "Job {JobId} byte progress: {Downloaded}/{Total} bytes ({Speed} B/s)")]
        private partial void LogByteProgress(string jobId, long downloaded, long total, double speed);

        [LoggerMessage(EventId = 5005, Level = LogLevel.Information,
            Message = "Job {JobId} completed: imported {Count} files")]
        private partial void LogJobCompleted(string jobId, int count);

        [LoggerMessage(EventId = 5006, Level = LogLevel.Error,
            Message = "Job {JobId} failed: {Error}")]
        private partial void LogJobFailed(string jobId, string error);

        [LoggerMessage(EventId = 5007, Level = LogLevel.Debug,
            Message = "Cleaned up old job {JobId}")]
        private partial void LogJobCleanedUp(string jobId);
    }
}
