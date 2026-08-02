// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services.Storage;

using Microsoft.Extensions.Options;

using MongoDB.Driver;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Background service that periodically cleans up expired jobs and their
    /// associated storage artifacts (tmp/jobs/{jobId}/).
    /// </summary>
    public partial class JobReaperBackgroundService : BackgroundService
    {
        private static readonly TimeSpan ReapInterval = TimeSpan.FromMinutes(5);
        private readonly IMongoCollection<JobStatus> jobsCollection;
        private readonly IStorageProvider storageProvider;
        private readonly IJobTracker jobTracker;
        private readonly ILogger<JobReaperBackgroundService> logger;

        public JobReaperBackgroundService(
            IOptions<MongoDBSettings> mongoSettings,
            IStorageProvider storageProvider,
            IJobTracker jobTracker,
            ILogger<JobReaperBackgroundService> logger)
        {
            this.storageProvider = storageProvider;
            this.jobTracker = jobTracker;
            this.logger = logger;
            jobsCollection = new MongoClient(mongoSettings.Value.ConnectionString)
                .GetDatabase(mongoSettings.Value.DatabaseName)
                .GetCollection<JobStatus>("jobs");
        }

        /// <summary>
        /// Initializes a new instance of the <see cref="JobReaperBackgroundService"/> class.
        /// Internal constructor for testing — accepts a pre-configured collection.
        /// </summary>
        internal JobReaperBackgroundService(
            IMongoCollection<JobStatus> jobsCollection,
            IStorageProvider storageProvider,
            IJobTracker jobTracker,
            ILogger<JobReaperBackgroundService> logger)
        {
            this.jobsCollection = jobsCollection;
            this.storageProvider = storageProvider;
            this.jobTracker = jobTracker;
            this.logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(ReapInterval, stoppingToken);
                    await ReapExpiredJobs(stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // Graceful shutdown
                    break;
                }
                catch (Exception ex)
                {
                    LogReaperError(ex.Message);
                }
            }
        }

        private async Task ReapExpiredJobs(CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            var filter = Builders<JobStatus>.Filter.And(
                Builders<JobStatus>.Filter.Lt(j => j.ExpiresAt, now),
                Builders<JobStatus>.Filter.Ne(j => j.ExpiresAt, null));

            var findOptions = new FindOptions<JobStatus> { Limit = 100 };
            using var cursor = await jobsCollection.FindAsync(filter, findOptions, ct);
            var expiredJobs = await cursor.ToListAsync(ct);

            if (expiredJobs.Count == 0)
            {
                return;
            }

            LogReapingJobs(expiredJobs.Count);

            foreach (var job in expiredJobs)
            {
                try
                {
                    // Clean up storage artifacts. #1576: delete the job's whole
                    // tmp/jobs/{jobId}/ prefix, not just the result key — jobs write
                    // siblings there, and reaping only the one key left the rest
                    // behind forever, which is the opposite of the reaper's job.
                    try
                    {
                        await storageProvider.DeletePrefixAsync($"tmp/jobs/{job.JobId}/", ct);
                    }
                    catch (Exception ex)
                    {
                        LogStorageCleanupError(job.JobId, ex.Message);
                    }

                    // A result stored outside the job's own prefix (any provider or
                    // convention that predates it) still needs its own delete.
                    if (job.ResultStorageKey is not null
                        && !job.ResultStorageKey.StartsWith($"tmp/jobs/{job.JobId}/", StringComparison.Ordinal))
                    {
                        try
                        {
                            await storageProvider.DeleteAsync(job.ResultStorageKey, ct);
                        }
                        catch (Exception ex)
                        {
                            LogStorageCleanupError(job.JobId, ex.Message);
                        }
                    }

                    // Delete the job record
                    await jobsCollection.DeleteOneAsync(
                        Builders<JobStatus>.Filter.Eq(j => j.JobId, job.JobId), ct);

                    // #1577: and drop it from the tracker's cache, or a reaped
                    // job lives on in memory as a phantom the DB no longer has.
                    jobTracker.EvictFromCache(job.JobId);

                    LogJobReaped(job.JobId);
                }
                catch (Exception ex)
                {
                    LogReapJobError(job.JobId, ex.Message);
                }
            }
        }

        [LoggerMessage(Level = LogLevel.Information, Message = "Reaping {Count} expired jobs")]
        private partial void LogReapingJobs(int count);

        [LoggerMessage(Level = LogLevel.Debug, Message = "Reaped expired job {JobId}")]
        private partial void LogJobReaped(string jobId);

        [LoggerMessage(Level = LogLevel.Warning, Message = "Failed to clean storage for job {JobId}: {Error}")]
        private partial void LogStorageCleanupError(string jobId, string error);

        [LoggerMessage(Level = LogLevel.Warning, Message = "Failed to reap job {JobId}: {Error}")]
        private partial void LogReapJobError(string jobId, string error);

        [LoggerMessage(Level = LogLevel.Error, Message = "Job reaper error: {Error}")]
        private partial void LogReaperError(string error);
    }
}
