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
        internal static string ToUserMessage(Exception ex) => ex switch
        {
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
