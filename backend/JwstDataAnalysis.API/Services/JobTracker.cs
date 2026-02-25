// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Collections.Concurrent;

using JwstDataAnalysis.API.Models;

using Microsoft.Extensions.Options;

using MongoDB.Driver;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class JobTracker : IJobTracker
    {
        private readonly ConcurrentDictionary<string, JobStatus> cache = new();
        private readonly IMongoCollection<JobStatus> jobsCollection;
        private readonly IJobProgressNotifier notifier;
        private readonly ILogger<JobTracker> logger;
        private readonly TimeSpan resultTtl = TimeSpan.FromMinutes(30);

        public JobTracker(
            IOptions<MongoDBSettings> mongoSettings,
            IJobProgressNotifier notifier,
            ILogger<JobTracker> logger)
        {
            this.notifier = notifier;
            this.logger = logger;

            var client = new MongoClient(mongoSettings.Value.ConnectionString);
            var database = client.GetDatabase(mongoSettings.Value.DatabaseName);
            jobsCollection = database.GetCollection<JobStatus>("jobs");

            EnsureIndexes();
        }

        /// <summary>
        /// Initializes a new instance of the <see cref="JobTracker"/> class.
        /// Internal constructor for testing — accepts a pre-configured collection.
        /// </summary>
        internal JobTracker(
            IMongoCollection<JobStatus> jobsCollection,
            IJobProgressNotifier notifier,
            ILogger<JobTracker> logger)
        {
            this.jobsCollection = jobsCollection;
            this.notifier = notifier;
            this.logger = logger;
        }

        public async Task<JobStatus> CreateJobAsync(string jobType, string description, string userId)
        {
            var job = new JobStatus
            {
                JobId = Guid.NewGuid().ToString("N")[..12],
                JobType = jobType,
                State = JobStates.Queued,
                Description = description,
                OwnerUserId = userId,
                ProgressPercent = 0,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };

            cache[job.JobId] = job;
            await jobsCollection.InsertOneAsync(job);

            LogJobCreated(job.JobId, jobType, userId);
            return job;
        }

        public async Task UpdateProgressAsync(string jobId, int progressPercent, string? stage = null, string? message = null)
        {
            var job = await GetFromCacheOrDb(jobId);
            if (job is null || IsTerminal(job.State))
            {
                return;
            }

            job.ProgressPercent = Math.Clamp(progressPercent, 0, 100);
            if (stage is not null)
            {
                job.Stage = stage;
            }

            if (message is not null)
            {
                job.Message = message;
            }

            job.UpdatedAt = DateTime.UtcNow;
            if (job.State == JobStates.Queued)
            {
                job.State = JobStates.Running;
                job.StartedAt = DateTime.UtcNow;
            }

            await PersistAndNotifyProgress(job);
        }

        public async Task UpdateByteProgressAsync(
            string jobId,
            long downloadedBytes,
            long totalBytes,
            double speedBytesPerSec,
            double? etaSeconds,
            List<FileDownloadProgress>? fileProgress = null)
        {
            var job = await GetFromCacheOrDb(jobId);
            if (job is null || IsTerminal(job.State))
            {
                return;
            }

            job.Metadata ??= [];
            job.Metadata["DownloadedBytes"] = downloadedBytes;
            job.Metadata["TotalBytes"] = totalBytes;
            job.Metadata["SpeedBytesPerSec"] = speedBytesPerSec;
            if (etaSeconds.HasValue)
            {
                job.Metadata["EtaSeconds"] = etaSeconds.Value;
            }

            if (fileProgress is not null)
            {
                job.Metadata["FileProgress"] = fileProgress;
            }

            job.ProgressPercent = totalBytes > 0 ? (int)((downloadedBytes * 100) / totalBytes) : 0;
            job.UpdatedAt = DateTime.UtcNow;

            await PersistAndNotifyProgress(job);
        }

        public async Task StartJobAsync(string jobId)
        {
            var job = await GetFromCacheOrDb(jobId);
            if (job is null)
            {
                return;
            }

            job.State = JobStates.Running;
            job.StartedAt = DateTime.UtcNow;
            job.UpdatedAt = DateTime.UtcNow;

            await PersistAndNotifyProgress(job);
        }

        public async Task CompleteBlobJobAsync(
            string jobId,
            string storageKey,
            string contentType,
            string filename,
            string? message = null)
        {
            var job = await GetFromCacheOrDb(jobId);
            if (job is null)
            {
                return;
            }

            var now = DateTime.UtcNow;
            job.State = JobStates.Completed;
            job.ProgressPercent = 100;
            job.Message = message ?? "Completed";
            job.CompletedAt = now;
            job.UpdatedAt = now;
            job.LastAccessedAt = now;
            job.ExpiresAt = now + resultTtl;
            job.ResultKind = ResultKinds.Blob;
            job.ResultStorageKey = storageKey;
            job.ResultContentType = contentType;
            job.ResultFilename = filename;

            await PersistJob(job);
            await NotifyCompleted(job);
            LogJobCompleted(jobId, (now - job.CreatedAt).TotalMilliseconds);
        }

        public async Task CompleteDataIdJobAsync(string jobId, string dataId, string? message = null)
        {
            var job = await GetFromCacheOrDb(jobId);
            if (job is null)
            {
                return;
            }

            var now = DateTime.UtcNow;
            job.State = JobStates.Completed;
            job.ProgressPercent = 100;
            job.Message = message ?? "Completed";
            job.CompletedAt = now;
            job.UpdatedAt = now;
            job.LastAccessedAt = now;
            job.ExpiresAt = now + resultTtl;
            job.ResultKind = ResultKinds.DataId;
            job.ResultDataId = dataId;

            await PersistJob(job);
            await NotifyCompleted(job);
            LogJobCompleted(jobId, (now - job.CreatedAt).TotalMilliseconds);
        }

        public async Task CompleteJobAsync(string jobId, string? message = null)
        {
            var job = await GetFromCacheOrDb(jobId);
            if (job is null)
            {
                return;
            }

            var now = DateTime.UtcNow;
            job.State = JobStates.Completed;
            job.ProgressPercent = 100;
            job.Message = message ?? "Completed";
            job.CompletedAt = now;
            job.UpdatedAt = now;
            job.LastAccessedAt = now;
            job.ExpiresAt = now + resultTtl;

            await PersistJob(job);
            await NotifyCompleted(job);
            LogJobCompleted(jobId, (now - job.CreatedAt).TotalMilliseconds);
        }

        public async Task FailJobAsync(string jobId, string errorMessage)
        {
            var job = await GetFromCacheOrDb(jobId);
            if (job is null)
            {
                return;
            }

            var now = DateTime.UtcNow;
            job.State = JobStates.Failed;
            job.Error = errorMessage;
            job.CompletedAt = now;
            job.UpdatedAt = now;
            job.ExpiresAt = now + resultTtl;

            await PersistJob(job);

            await notifier.NotifyFailedAsync(new JobFailureUpdate
            {
                JobId = job.JobId,
                JobType = job.JobType,
                Error = errorMessage,
                FailedAt = now,
            });

            LogJobFailed(jobId, errorMessage);
        }

        public async Task<bool> CancelJobAsync(string jobId, string userId)
        {
            var job = await GetFromCacheOrDb(jobId);
            if (job is null || job.OwnerUserId != userId || IsTerminal(job.State))
            {
                return false;
            }

            var now = DateTime.UtcNow;
            job.CancelRequested = true;
            job.State = JobStates.Cancelled;
            job.CompletedAt = now;
            job.UpdatedAt = now;
            job.ExpiresAt = now + resultTtl;

            await PersistJob(job);

            await notifier.NotifyFailedAsync(new JobFailureUpdate
            {
                JobId = job.JobId,
                JobType = job.JobType,
                State = "cancelled",
                Error = "Cancelled by user",
                FailedAt = now,
            });

            LogJobCancelled(jobId);
            return true;
        }

        public bool IsCancelRequested(string jobId)
        {
            return cache.TryGetValue(jobId, out var job) && job.CancelRequested;
        }

        public async Task<JobStatus?> GetJobAsync(string jobId, string userId)
        {
            var job = await GetFromCacheOrDb(jobId);
            if (job is null || job.OwnerUserId != userId)
            {
                return null;
            }

            return job;
        }

        public async Task<JobStatus?> GetJobInternalAsync(string jobId)
        {
            return await GetFromCacheOrDb(jobId);
        }

        public async Task<List<JobStatus>> GetJobsForUserAsync(string userId, string? status = null, string? type = null)
        {
            var filterBuilder = Builders<JobStatus>.Filter;
            var filter = filterBuilder.Eq(j => j.OwnerUserId, userId);

            if (status is not null)
            {
                filter &= filterBuilder.Eq(j => j.State, status);
            }

            if (type is not null)
            {
                filter &= filterBuilder.Eq(j => j.JobType, type);
            }

            return await jobsCollection
                .Find(filter)
                .SortByDescending(j => j.CreatedAt)
                .Limit(100)
                .ToListAsync();
        }

        public async Task RecordResultAccessAsync(string jobId)
        {
            var job = await GetFromCacheOrDb(jobId);
            if (job is null)
            {
                return;
            }

            var now = DateTime.UtcNow;
            job.LastAccessedAt = now;
            job.ExpiresAt = now + resultTtl;
            job.UpdatedAt = now;

            await PersistJob(job);
        }

        private static bool IsTerminal(string state) =>
            state is JobStates.Completed or JobStates.Failed or JobStates.Cancelled;

        private async Task<JobStatus?> GetFromCacheOrDb(string jobId)
        {
            if (cache.TryGetValue(jobId, out var cached))
            {
                return cached;
            }

            var fromDb = await jobsCollection
                .Find(Builders<JobStatus>.Filter.Eq(j => j.JobId, jobId))
                .FirstOrDefaultAsync();

            if (fromDb is not null)
            {
                cache[jobId] = fromDb;
            }

            return fromDb;
        }

        private async Task PersistJob(JobStatus job)
        {
            cache[job.JobId] = job;
            await jobsCollection.ReplaceOneAsync(
                Builders<JobStatus>.Filter.Eq(j => j.JobId, job.JobId),
                job,
                new ReplaceOptions { IsUpsert = true });
        }

        private async Task PersistAndNotifyProgress(JobStatus job)
        {
            await PersistJob(job);

            await notifier.NotifyProgressAsync(new JobProgressUpdate
            {
                JobId = job.JobId,
                JobType = job.JobType,
                State = job.State,
                ProgressPercent = job.ProgressPercent,
                Stage = job.Stage,
                Message = job.Message,
                UpdatedAt = job.UpdatedAt,
                Metadata = job.Metadata,
            });
        }

        private async Task NotifyCompleted(JobStatus job)
        {
            await notifier.NotifyCompletedAsync(new JobCompletionUpdate
            {
                JobId = job.JobId,
                JobType = job.JobType,
                Message = job.Message,
                CompletedAt = job.CompletedAt ?? DateTime.UtcNow,
                ExpiresAt = job.ExpiresAt ?? DateTime.UtcNow.Add(resultTtl),
                ResultKind = job.ResultKind,
                ResultContentType = job.ResultContentType,
                ResultFilename = job.ResultFilename,
                ResultDataId = job.ResultDataId,
            });
        }

        private void EnsureIndexes()
        {
            var indexes = new List<CreateIndexModel<JobStatus>>
            {
                new(Builders<JobStatus>.IndexKeys.Ascending(j => j.OwnerUserId)),
                new(Builders<JobStatus>.IndexKeys.Ascending(j => j.State)),
                new(Builders<JobStatus>.IndexKeys.Ascending(j => j.ExpiresAt)),
                new(Builders<JobStatus>.IndexKeys
                    .Ascending(j => j.OwnerUserId)
                    .Ascending(j => j.State)
                    .Descending(j => j.CreatedAt)),
            };

            jobsCollection.Indexes.CreateMany(indexes);
        }

        [LoggerMessage(Level = LogLevel.Information, Message = "Job {JobId} created: type={JobType}, user={UserId}")]
        private partial void LogJobCreated(string jobId, string jobType, string userId);

        [LoggerMessage(Level = LogLevel.Information, Message = "Job {JobId} completed in {DurationMs}ms")]
        private partial void LogJobCompleted(string jobId, double durationMs);

        [LoggerMessage(Level = LogLevel.Warning, Message = "Job {JobId} failed: {Error}")]
        private partial void LogJobFailed(string jobId, string error);

        [LoggerMessage(Level = LogLevel.Information, Message = "Job {JobId} cancelled by user")]
        private partial void LogJobCancelled(string jobId);
    }
}
