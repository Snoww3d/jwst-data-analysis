using System.Collections.Concurrent;
using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    public class ImportJobTracker
    {
        private readonly ConcurrentDictionary<string, ImportJobStatus> _jobs = new();
        private readonly ILogger<ImportJobTracker> _logger;
        private readonly TimeSpan _jobRetentionPeriod = TimeSpan.FromMinutes(30);

        public ImportJobTracker(ILogger<ImportJobTracker> logger)
        {
            _logger = logger;
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
                StartedAt = DateTime.UtcNow
            };

            _jobs[jobId] = job;
            _logger.LogInformation("Created import job {JobId} for observation {ObsId}", jobId, obsId);

            // Clean up old jobs
            CleanupOldJobs();

            return jobId;
        }

        public void UpdateProgress(string jobId, int progress, string stage, string message)
        {
            if (_jobs.TryGetValue(jobId, out var job))
            {
                job.Progress = Math.Clamp(progress, 0, 100);
                job.Stage = stage;
                job.Message = message;
                _logger.LogDebug("Job {JobId} progress: {Progress}% - {Stage}: {Message}",
                    jobId, progress, stage, message);
            }
        }

        public void CompleteJob(string jobId, MastImportResponse result)
        {
            if (_jobs.TryGetValue(jobId, out var job))
            {
                job.Progress = 100;
                job.Stage = ImportStages.Complete;
                job.Message = $"Successfully imported {result.ImportedCount} file(s)";
                job.IsComplete = true;
                job.CompletedAt = DateTime.UtcNow;
                job.Result = result;
                _logger.LogInformation("Job {JobId} completed: imported {Count} files",
                    jobId, result.ImportedCount);
            }
        }

        public void FailJob(string jobId, string error)
        {
            if (_jobs.TryGetValue(jobId, out var job))
            {
                job.Stage = ImportStages.Failed;
                job.Message = error;
                job.IsComplete = true;
                job.Error = error;
                job.CompletedAt = DateTime.UtcNow;
                _logger.LogError("Job {JobId} failed: {Error}", jobId, error);
            }
        }

        public ImportJobStatus? GetJob(string jobId)
        {
            _jobs.TryGetValue(jobId, out var job);
            return job;
        }

        public bool RemoveJob(string jobId)
        {
            return _jobs.TryRemove(jobId, out _);
        }

        private void CleanupOldJobs()
        {
            var cutoff = DateTime.UtcNow - _jobRetentionPeriod;
            var oldJobs = _jobs
                .Where(kvp => kvp.Value.IsComplete && kvp.Value.CompletedAt < cutoff)
                .Select(kvp => kvp.Key)
                .ToList();

            foreach (var jobId in oldJobs)
            {
                _jobs.TryRemove(jobId, out _);
                _logger.LogDebug("Cleaned up old job {JobId}", jobId);
            }
        }
    }
}
