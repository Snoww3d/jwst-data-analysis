//

using System.Collections.Concurrent;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    public class ImportJobTracker
    {
        private readonly ConcurrentDictionary<string, ImportJobStatus> jobs = new();
        private readonly ConcurrentDictionary<string, CancellationTokenSource> cancellationTokens = new();
        private readonly ILogger<ImportJobTracker> logger;
        private readonly TimeSpan jobRetentionPeriod = TimeSpan.FromMinutes(30);

        public ImportJobTracker(ILogger<ImportJobTracker> logger)
        {
            this.logger = logger;
        }

        public string CreateJob(string obsId)
        {
            var jobId = Guid.NewGuid().ToString("N")[..12];
            var job = new ImportJobStatus
            {
                JobId = jobId,
                ObsId = obsId,
                Progress = 0,
                Stage = ImportStages.Starting,
                Message = "Initializing import...",
                IsComplete = false,
                StartedAt = DateTime.UtcNow,
            };

            jobs[jobId] = job;

            // Create cancellation token for this job
            var cts = new CancellationTokenSource();
            cancellationTokens[jobId] = cts;

            logger.LogInformation("Created import job {JobId} for observation {ObsId}", jobId, obsId);

            // Clean up old jobs
            CleanupOldJobs();

            return jobId;
        }

        public CancellationToken GetCancellationToken(string jobId)
        {
            if (cancellationTokens.TryGetValue(jobId, out var cts))
            {
                return cts.Token;
            }

            return CancellationToken.None;
        }

        public bool CancelJob(string jobId)
        {
            if (cancellationTokens.TryGetValue(jobId, out var cts))
            {
                cts.Cancel();
                logger.LogInformation("Cancellation requested for job {JobId}", jobId);

                if (jobs.TryGetValue(jobId, out var job) && !job.IsComplete)
                {
                    job.Stage = ImportStages.Cancelled;
                    job.Message = "Import cancelled by user";
                    job.IsComplete = true;
                    job.CompletedAt = DateTime.UtcNow;
                }

                return true;
            }

            return false;
        }

        public void UpdateProgress(string jobId, int progress, string stage, string message)
        {
            if (jobs.TryGetValue(jobId, out var job))
            {
                job.Progress = Math.Clamp(progress, 0, 100);
                job.Stage = stage;
                job.Message = message;
                logger.LogDebug(
                    "Job {JobId} progress: {Progress}% - {Stage}: {Message}",
                    jobId, progress, stage, message);
            }
        }

        public void UpdateByteProgress(
            string jobId,
            long downloadedBytes,
            long totalBytes,
            double speedBytesPerSec,
            double? etaSeconds,
            List<FileDownloadProgress>? fileProgress = null)
        {
            if (jobs.TryGetValue(jobId, out var job))
            {
                job.DownloadedBytes = downloadedBytes;
                job.TotalBytes = totalBytes;
                job.SpeedBytesPerSec = speedBytesPerSec;
                job.EtaSeconds = etaSeconds;
                job.DownloadProgressPercent = totalBytes > 0 ? (downloadedBytes / (double)totalBytes) * 100 : 0;
                if (fileProgress != null)
                {
                    job.FileProgress = fileProgress;
                }

                logger.LogDebug(
                    "Job {JobId} byte progress: {Downloaded}/{Total} bytes ({Speed} B/s)",
                    jobId, downloadedBytes, totalBytes, speedBytesPerSec);
            }
        }

        public void SetDownloadJobId(string jobId, string downloadJobId)
        {
            if (jobs.TryGetValue(jobId, out var job))
            {
                job.DownloadJobId = downloadJobId;
            }
        }

        public void SetResumable(string jobId, bool isResumable)
        {
            if (jobs.TryGetValue(jobId, out var job))
            {
                job.IsResumable = isResumable;
            }
        }

        public void CompleteJob(string jobId, MastImportResponse result)
        {
            if (jobs.TryGetValue(jobId, out var job))
            {
                job.Progress = 100;
                job.Stage = ImportStages.Complete;
                job.Message = $"Successfully imported {result.ImportedCount} file(s)";
                job.IsComplete = true;
                job.CompletedAt = DateTime.UtcNow;
                job.Result = result;
                logger.LogInformation(
                    "Job {JobId} completed: imported {Count} files",
                    jobId, result.ImportedCount);
            }
        }

        public void FailJob(string jobId, string error)
        {
            if (jobs.TryGetValue(jobId, out var job))
            {
                job.Stage = ImportStages.Failed;
                job.Message = error;
                job.IsComplete = true;
                job.Error = error;
                job.CompletedAt = DateTime.UtcNow;
                logger.LogError("Job {JobId} failed: {Error}", jobId, error);
            }
        }

        public ImportJobStatus? GetJob(string jobId)
        {
            jobs.TryGetValue(jobId, out var job);
            return job;
        }

        public bool RemoveJob(string jobId)
        {
            return jobs.TryRemove(jobId, out _);
        }

        private void CleanupOldJobs()
        {
            var cutoff = DateTime.UtcNow - jobRetentionPeriod;
            var oldJobs = jobs
                .Where(kvp => kvp.Value.IsComplete && kvp.Value.CompletedAt < cutoff)
                .Select(kvp => kvp.Key)
                .ToList();

            foreach (var jobId in oldJobs)
            {
                jobs.TryRemove(jobId, out _);

                // Also clean up the cancellation token
                if (cancellationTokens.TryRemove(jobId, out var cts))
                {
                    cts.Dispose();
                }

                logger.LogDebug("Cleaned up old job {JobId}", jobId);
            }
        }
    }
}
