// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Collections.Concurrent;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class ImportJobTracker(
        ILogger<ImportJobTracker> logger,
        IJobTracker unifiedTracker) : IImportJobTracker
    {
        private static readonly TimeSpan ByteProgressDualWriteInterval = TimeSpan.FromSeconds(2);

        private readonly ConcurrentDictionary<string, ImportJobStatus> jobs = new();
        private readonly ConcurrentDictionary<string, CancellationTokenSource> cancellationTokens = new();
        private readonly ConcurrentDictionary<string, DateTime> lastDualWriteTime = new();

        /// <summary>
        /// Reverse index: engine download job ID -> import job ID (#1782).
        /// The two are separate ID spaces, and <see cref="jobs"/> is keyed only by import
        /// job ID, so without this index every ownership check that starts from a download
        /// ID resolves to null and takes the wrong branch.
        /// </summary>
        private readonly ConcurrentDictionary<string, string> downloadJobIndex = new();
        private readonly ILogger<ImportJobTracker> logger = logger;
        private readonly IJobTracker unifiedTracker = unifiedTracker;
        private readonly TimeSpan jobRetentionPeriod = TimeSpan.FromMinutes(30);

        public string CreateJob(string obsId, string userId)
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

                // #1572: record the owner at creation. Previously this parameter was only
                // forwarded to the unified tracker's dual-write, leaving ImportJobStatus.UserId
                // null unless the caller remembered to assign it afterwards — which
                // ImportFromExisting did not, so its jobs were unowned and already failed the
                // ownership guards on GetImportProgress/ResumeImport.
                UserId = userId,
            };

            jobs[jobId] = job;

            // Create cancellation token for this job
            var cts = new CancellationTokenSource();
            cancellationTokens[jobId] = cts;

            LogJobCreated(jobId, obsId);

            // Dual-write: create job in unified tracker for SignalR push
            DualWrite(
                async () =>
                {
                    await unifiedTracker.CreateJobAsync("import", $"Import {obsId}", userId, jobId);
                    await unifiedTracker.StartJobAsync(jobId);
                },
                jobId,
                "CreateJob");

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

        public bool CancelJob(string jobId, string userId, bool isAdmin)
        {
            // #1572: enforce ownership BEFORE cancelling the token. Cancelling the CTS is
            // what actually stops the download, so an ownership check that runs after it
            // (or only on the dual-write below) is no check at all.
            //
            // A job with no recorded UserId is treated as unowned and cancellable only by
            // an admin — ImportJobStatus.UserId is nullable, and defaulting an unowned job
            // to "anyone may cancel" would reopen the hole this guard closes.
            jobs.TryGetValue(jobId, out var job);

            // Deny by default: a non-admin must find the job AND own it. Falling through when
            // the job is absent would leave the token cancellable by jobId alone, which is the
            // original defect.
            if (!isAdmin && (job is null || job.UserId != userId))
            {
                LogCancellationDenied(jobId, userId);
                return false;
            }

            if (cancellationTokens.TryGetValue(jobId, out var cts))
            {
                cts.Cancel();
                LogCancellationRequested(jobId);

                if (job is not null && !job.IsComplete)
                {
                    job.Stage = ImportStages.Cancelled;
                    job.Message = "Import cancelled by user";
                    job.IsComplete = true;
                    job.CompletedAt = DateTime.UtcNow;
                }

                // Dual-write as the job's OWNER, not the requester. JobTracker.CancelJobAsync
                // rejects a mismatch, so passing an admin's id here would silently no-op the
                // unified record: the owner's UI would never receive the cancelled SignalR
                // push and would hang at "running" until TTL.
                DualWrite(
                    () => unifiedTracker.CancelJobAsync(jobId, job?.UserId ?? userId),
                    jobId,
                    "CancelJob");

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
                LogProgressUpdate(jobId, progress, stage, message);

                // Dual-write: update progress in unified tracker
                DualWrite(
                    () => unifiedTracker.UpdateProgressAsync(jobId, Math.Clamp(progress, 0, 100), stage, message),
                    jobId,
                    "UpdateProgress");
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

                LogByteProgress(jobId, downloadedBytes, totalBytes, speedBytesPerSec);

                // Dual-write: throttled to every 2 seconds to avoid excessive MongoDB writes
                var now = DateTime.UtcNow;
                var shouldWrite = !lastDualWriteTime.TryGetValue(jobId, out var lastWrite)
                    || (now - lastWrite) >= ByteProgressDualWriteInterval;

                if (shouldWrite)
                {
                    lastDualWriteTime[jobId] = now;
                    DualWrite(
                        () => unifiedTracker.UpdateByteProgressAsync(
                            jobId,
                            downloadedBytes,
                            totalBytes,
                            speedBytesPerSec,
                            etaSeconds,
                            fileProgress),
                        jobId,
                        "UpdateByteProgress");
                }
            }
        }

        public void SetDownloadJobId(string jobId, string downloadJobId)
        {
            if (jobs.TryGetValue(jobId, out var job))
            {
                // Drop any stale reverse-index entry first, so re-pointing a job at a new
                // download does not leave the old download ID resolving to this job.
                if (!string.IsNullOrEmpty(job.DownloadJobId) && job.DownloadJobId != downloadJobId)
                {
                    downloadJobIndex.TryRemove(job.DownloadJobId, out _);
                }

                job.DownloadJobId = downloadJobId;

                if (!string.IsNullOrEmpty(downloadJobId))
                {
                    // Last writer wins. Two import jobs can legitimately point at one download
                    // (an admin resuming another user's interrupted download creates a second
                    // import job), and the most recent claim is the one that is actually polling.
                    downloadJobIndex[downloadJobId] = jobId;
                }
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
                LogJobCompleted(jobId, result.ImportedCount);

                // Dual-write: complete in unified tracker
                DualWrite(
                    () => unifiedTracker.CompleteJobAsync(jobId, $"Imported {result.ImportedCount} file(s)"),
                    jobId,
                    "CompleteJob");

                // Clean up throttle tracking
                lastDualWriteTime.TryRemove(jobId, out _);
            }
        }

        public void FailJob(string jobId, string errorMessage)
        {
            if (jobs.TryGetValue(jobId, out var job))
            {
                job.Stage = ImportStages.Failed;
                job.Message = errorMessage;
                job.IsComplete = true;
                job.Error = errorMessage;
                job.CompletedAt = DateTime.UtcNow;
                LogJobFailed(jobId, errorMessage);

                // Dual-write: fail in unified tracker
                DualWrite(
                    () => unifiedTracker.FailJobAsync(jobId, errorMessage),
                    jobId,
                    "FailJob");

                // Clean up throttle tracking
                lastDualWriteTime.TryRemove(jobId, out _);
            }
        }

        public ImportJobStatus? GetJob(string jobId)
        {
            jobs.TryGetValue(jobId, out var job);
            return job;
        }

        public ImportJobStatus? GetJobByDownloadId(string downloadJobId)
        {
            if (string.IsNullOrEmpty(downloadJobId))
            {
                return null;
            }

            if (!downloadJobIndex.TryGetValue(downloadJobId, out var importJobId))
            {
                return null;
            }

            var job = GetJob(importJobId);

            // The index can outlive the job it points at (a removal path that misses the
            // index, or a job re-pointed at another download). Confirm against the job's
            // own DownloadJobId rather than trusting the index alone.
            return job?.DownloadJobId == downloadJobId ? job : null;
        }

        public bool RemoveJob(string jobId)
        {
            lastDualWriteTime.TryRemove(jobId, out _);

            if (jobs.TryRemove(jobId, out var job))
            {
                if (!string.IsNullOrEmpty(job.DownloadJobId))
                {
                    downloadJobIndex.TryRemove(job.DownloadJobId, out _);
                }

                return true;
            }

            return false;
        }

        /// <summary>
        /// Fire-and-forget async call to the unified tracker.
        /// ImportJobTracker (in-memory) is the primary source — IJobTracker failures don't block imports.
        /// </summary>
        private void DualWrite(Func<Task> action, string jobId, string operation)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await action();
                }
                catch (Exception ex)
                {
                    LogDualWriteError(ex, jobId, operation);
                }
            });
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
                jobs.TryRemove(jobId, out var removed);
                lastDualWriteTime.TryRemove(jobId, out _);

                // Keep the reverse index in step with `jobs` — a stale entry would let a
                // recycled download ID resolve to a long-dead import job.
                if (removed is not null && !string.IsNullOrEmpty(removed.DownloadJobId))
                {
                    downloadJobIndex.TryRemove(removed.DownloadJobId, out _);
                }

                // Also clean up the cancellation token
                if (cancellationTokens.TryRemove(jobId, out var cts))
                {
                    cts.Dispose();
                }

                LogJobCleanedUp(jobId);
            }
        }
    }
}
