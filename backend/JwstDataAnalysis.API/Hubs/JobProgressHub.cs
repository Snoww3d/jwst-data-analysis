// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace JwstDataAnalysis.API.Hubs
{
    /// <summary>
    /// SignalR hub for pushing job progress updates to connected clients.
    /// Clients subscribe to individual jobs by ID and receive progress, completion, and failure events.
    /// </summary>
    [Authorize]
    public partial class JobProgressHub(ILogger<JobProgressHub> logger) : Hub
    {
        private readonly ILogger<JobProgressHub> logger = logger;

        /// <summary>
        /// Subscribe to progress updates for a specific job.
        /// The caller must own the job (ownership checked when IJobTracker is available in Phase 2).
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

            // Phase 2 will inject IJobTracker and verify job ownership here.
            // For now, any authenticated user can subscribe to any job ID.
            // This is safe because no jobs are pushed via SignalR until Phase 2.
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
