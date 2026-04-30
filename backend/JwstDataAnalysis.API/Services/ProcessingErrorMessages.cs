// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Translates raw processing engine exceptions into user-friendly messages.
    /// Used by background services to sanitize error text before sending via SignalR.
    /// </summary>
    internal static class ProcessingErrorMessages
    {
        /// <summary>
        /// Prefix applied to <see cref="CompositeBudgetExceededException"/> messages
        /// so the frontend can detect a memory-budget refusal in the SignalR
        /// failure channel (which loses the HTTP 413 status crossing the boundary)
        /// and show the "Continue anyway" override. Matches the existing
        /// <c>NO_PRODUCTS:</c> / <c>S3_UNAVAILABLE:</c> convention used by the
        /// download flow.
        /// </summary>
        internal const string MemoryBudgetPrefix = "MEMORY_BUDGET:";

        internal static string ToUserMessage(Exception ex) => ex switch
        {
            CompositeBudgetExceededException cbex
                => $"{MemoryBudgetPrefix}{cbex.Message}",
            HttpRequestException { StatusCode: System.Net.HttpStatusCode.ServiceUnavailable }
                => "Processing engine is temporarily unavailable. Please retry.",
            HttpRequestException hre when hre.InnerException is System.Net.Sockets.SocketException
                => "Processing engine is not reachable. It may be restarting — please retry in a moment.",
            HttpRequestException
                => "Processing engine error. Please retry.",
            TaskCanceledException or OperationCanceledException
                => "Processing timed out. The image may be too large — try a smaller export size.",
            KeyNotFoundException
                => ex.Message,
            _ => "An unexpected error occurred during processing. Please retry.",
        };
    }
}
