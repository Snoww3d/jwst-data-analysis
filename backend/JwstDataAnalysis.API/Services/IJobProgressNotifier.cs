// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Sends job progress notifications to connected clients via SignalR.
    /// </summary>
    public interface IJobProgressNotifier
    {
        /// <summary>
        /// Notify subscribers of a job's progress update.
        /// </summary>
        Task NotifyProgressAsync(JobProgressUpdate update);

        /// <summary>
        /// Notify subscribers that a job completed successfully.
        /// </summary>
        Task NotifyCompletedAsync(JobCompletionUpdate update);

        /// <summary>
        /// Notify subscribers that a job failed.
        /// </summary>
        Task NotifyFailedAsync(JobFailureUpdate update);

        /// <summary>
        /// Send a full job snapshot to a specific connection (used on reconnect).
        /// </summary>
        Task SendSnapshotAsync(string connectionId, JobSnapshotUpdate snapshot);
    }
}
