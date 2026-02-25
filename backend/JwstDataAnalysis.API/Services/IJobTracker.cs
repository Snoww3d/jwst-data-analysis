// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Unified job tracker for all async operations (import, composite, mosaic).
    /// MongoDB-backed with in-memory cache. Ownership enforced on all reads.
    /// Pushes to SignalR on every state change.
    /// </summary>
    public interface IJobTracker
    {
        /// <summary>
        /// Create a new job. Returns the created job with its generated ID.
        /// </summary>
        /// <param name="jobType">Job type (import, composite, mosaic).</param>
        /// <param name="description">Human-readable description.</param>
        /// <param name="userId">Owner user ID.</param>
        /// <param name="jobId">Optional job ID. If null, a new ID is generated. Used by ImportJobTracker to share IDs.</param>
        /// <returns>The created job status.</returns>
        Task<JobStatus> CreateJobAsync(string jobType, string description, string userId, string? jobId = null);

        /// <summary>
        /// Update a job's progress. Pushes to SignalR.
        /// </summary>
        Task UpdateProgressAsync(string jobId, int progressPercent, string? stage = null, string? message = null);

        /// <summary>
        /// Update byte-level progress for import jobs. Pushes to SignalR.
        /// </summary>
        Task UpdateByteProgressAsync(
            string jobId,
            long downloadedBytes,
            long totalBytes,
            double speedBytesPerSec,
            double? etaSeconds,
            List<FileDownloadProgress>? fileProgress = null);

        /// <summary>
        /// Mark a job as running.
        /// </summary>
        Task StartJobAsync(string jobId);

        /// <summary>
        /// Mark a job as completed with a blob result.
        /// </summary>
        Task CompleteBlobJobAsync(
            string jobId,
            string storageKey,
            string contentType,
            string filename,
            string? message = null);

        /// <summary>
        /// Mark a job as completed with a data ID result.
        /// </summary>
        Task CompleteDataIdJobAsync(string jobId, string dataId, string? message = null);

        /// <summary>
        /// Mark a job as completed (no result, e.g., import jobs where result is in ImportJobStatus).
        /// </summary>
        Task CompleteJobAsync(string jobId, string? message = null);

        /// <summary>
        /// Mark a job as failed.
        /// </summary>
        Task FailJobAsync(string jobId, string errorMessage);

        /// <summary>
        /// Request cancellation of a job. Returns true if the request was accepted.
        /// </summary>
        Task<bool> CancelJobAsync(string jobId, string userId);

        /// <summary>
        /// Check if cancellation has been requested for a job.
        /// </summary>
        bool IsCancelRequested(string jobId);

        /// <summary>
        /// Get a job by ID with ownership check.
        /// Returns null if not found or not owned by the user.
        /// </summary>
        Task<JobStatus?> GetJobAsync(string jobId, string userId);

        /// <summary>
        /// Get a job by ID without ownership check (for internal use only).
        /// </summary>
        Task<JobStatus?> GetJobInternalAsync(string jobId);

        /// <summary>
        /// List jobs for a user, optionally filtered by status and/or type.
        /// </summary>
        Task<List<JobStatus>> GetJobsForUserAsync(string userId, string? status = null, string? type = null);

        /// <summary>
        /// Record a result access (extends TTL). Called when result is downloaded.
        /// </summary>
        Task RecordResultAccessAsync(string jobId);
    }
}
