// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Hubs;
using JwstDataAnalysis.API.Models;

using Microsoft.AspNetCore.SignalR;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public class JobProgressNotifier(IHubContext<JobProgressHub> hubContext) : IJobProgressNotifier
    {
        private readonly IHubContext<JobProgressHub> hubContext = hubContext;

        public Task NotifyProgressAsync(JobProgressUpdate update) =>
            hubContext.Clients.Group($"job-{update.JobId}")
                .SendAsync("JobProgress", update);

        public Task NotifyCompletedAsync(JobCompletionUpdate update) =>
            hubContext.Clients.Group($"job-{update.JobId}")
                .SendAsync("JobCompleted", update);

        public Task NotifyFailedAsync(JobFailureUpdate update) =>
            hubContext.Clients.Group($"job-{update.JobId}")
                .SendAsync("JobFailed", update);

        public Task SendSnapshotAsync(string connectionId, JobSnapshotUpdate snapshot) =>
            hubContext.Clients.Client(connectionId)
                .SendAsync("JobSnapshot", snapshot);
    }
}
