// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Interface for tracking import job progress and status.
    /// </summary>
    public interface IImportJobTracker
    {
        /// <summary>
        /// Create a new import job for an observation.
        /// </summary>
        /// <param name="obsId">The observation ID.</param>
        /// <returns>The job ID.</returns>
        string CreateJob(string obsId);

        /// <summary>
        /// Get the cancellation token for a job.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <returns>The cancellation token, or CancellationToken.None if not found.</returns>
        CancellationToken GetCancellationToken(string jobId);

        /// <summary>
        /// Cancel a job.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <returns>True if cancellation was requested, false if job not found.</returns>
        bool CancelJob(string jobId);

        /// <summary>
        /// Update the progress of a job.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <param name="progress">Progress percentage (0-100).</param>
        /// <param name="stage">Current stage name.</param>
        /// <param name="message">Progress message.</param>
        void UpdateProgress(string jobId, int progress, string stage, string message);

        /// <summary>
        /// Update byte-level download progress.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <param name="downloadedBytes">Bytes downloaded.</param>
        /// <param name="totalBytes">Total bytes to download.</param>
        /// <param name="speedBytesPerSec">Download speed in bytes/sec.</param>
        /// <param name="etaSeconds">Estimated time remaining in seconds.</param>
        /// <param name="fileProgress">Per-file progress details.</param>
        void UpdateByteProgress(
            string jobId,
            long downloadedBytes,
            long totalBytes,
            double speedBytesPerSec,
            double? etaSeconds,
            List<FileDownloadProgress>? fileProgress = null);

        /// <summary>
        /// Set the download job ID from the processing engine.
        /// </summary>
        /// <param name="jobId">The import job ID.</param>
        /// <param name="downloadJobId">The download job ID from processing engine.</param>
        void SetDownloadJobId(string jobId, string downloadJobId);

        /// <summary>
        /// Set whether the job is resumable.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <param name="isResumable">Whether the job can be resumed.</param>
        void SetResumable(string jobId, bool isResumable);

        /// <summary>
        /// Mark a job as completed.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <param name="result">The import result.</param>
        void CompleteJob(string jobId, MastImportResponse result);

        /// <summary>
        /// Mark a job as failed.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <param name="errorMessage">The error message.</param>
        void FailJob(string jobId, string errorMessage);

        /// <summary>
        /// Get a job by ID.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <returns>The job status, or null if not found.</returns>
        ImportJobStatus? GetJob(string jobId);

        /// <summary>
        /// Remove a job.
        /// </summary>
        /// <param name="jobId">The job ID.</param>
        /// <returns>True if removed, false if not found.</returns>
        bool RemoveJob(string jobId);
    }
}
