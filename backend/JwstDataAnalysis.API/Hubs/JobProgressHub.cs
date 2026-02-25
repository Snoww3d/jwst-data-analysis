// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using JwstDataAnalysis.API.Services;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace JwstDataAnalysis.API.Hubs
{
    /// <summary>
    /// SignalR hub for pushing job progress updates to connected clients.
    /// Clients subscribe to individual jobs by ID and receive progress, completion, and failure events.
    /// </summary>
    [Authorize]
    public partial class JobProgressHub(ILogger<JobProgressHub> logger, IJobTracker jobTracker) : Hub
    {
        private readonly ILogger<JobProgressHub> logger = logger;
        private readonly IJobTracker jobTracker = jobTracker;

        /// <summary>
        /// Subscribe to progress updates for a specific job.
        /// The caller must own the job — ownership is verified via IJobTracker.
        /// </summary>
        public async Task SubscribeToJob(string jobId)
        {
            var userId = GetUserId();
            if (userId is null)
            {
                throw new HubException("Authentication required.");
            }

            if (string.IsNullOrWhiteSpace(jobId))
            {
                throw new HubException("Job ID is required.");
            }

            // Verify the caller owns this job
            var job = await jobTracker.GetJobAsync(jobId, userId);
            if (job is null)
            {
                throw new HubException("Job not found or access denied.");
            }

            await Groups.AddToGroupAsync(Context.ConnectionId, $"job-{jobId}");
            LogSubscribed(jobId, userId);
        }

        /// <summary>
        /// Unsubscribe from progress updates for a specific job.
        /// </summary>
        public async Task UnsubscribeFromJob(string jobId)
        {
            if (string.IsNullOrWhiteSpace(jobId))
            {
                throw new HubException("Job ID is required.");
            }

            await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"job-{jobId}");
            var userId = GetUserId() ?? "unknown";
            LogUnsubscribed(jobId, userId);
        }

        public override Task OnConnectedAsync()
        {
            var userId = GetUserId() ?? "unknown";
            LogConnected(userId);
            return base.OnConnectedAsync();
        }

        public override Task OnDisconnectedAsync(Exception? exception)
        {
            var userId = GetUserId() ?? "unknown";
            var reason = exception?.Message;
            LogDisconnected(userId, reason);
            return base.OnDisconnectedAsync(exception);
        }

        private string? GetUserId() =>
            Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? Context.User?.FindFirst("sub")?.Value;

        [LoggerMessage(Level = LogLevel.Information, Message = "Client subscribed to job {JobId} (user: {UserId})")]
        private partial void LogSubscribed(string jobId, string userId);

        [LoggerMessage(Level = LogLevel.Information, Message = "Client unsubscribed from job {JobId} (user: {UserId})")]
        private partial void LogUnsubscribed(string jobId, string userId);

        [LoggerMessage(Level = LogLevel.Information, Message = "SignalR client connected (user: {UserId})")]
        private partial void LogConnected(string userId);

        [LoggerMessage(Level = LogLevel.Information, Message = "SignalR client disconnected (user: {UserId}, reason: {Reason})")]
        private partial void LogDisconnected(string userId, string? reason);
    }
}
