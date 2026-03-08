// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Services.Storage;

namespace JwstDataAnalysis.API.Services
{
    public sealed partial class CompositeBackgroundService(
        CompositeQueue queue,
        ICompositeService compositeService,
        IJobTracker jobTracker,
        IStorageProvider storageProvider,
        ILogger<CompositeBackgroundService> logger) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            LogServiceStarted();

            await foreach (var item in queue.Reader.ReadAllAsync(stoppingToken))
            {
                try
                {
                    if (jobTracker.IsCancelRequested(item.JobId))
                    {
                        await jobTracker.FailJobAsync(item.JobId, "Cancelled");
                        continue;
                    }

                    await jobTracker.StartJobAsync(item.JobId);
                    await jobTracker.UpdateProgressAsync(item.JobId, 10, "generating", "Generating composite image...");

                    var imageBytes = await compositeService.GenerateNChannelCompositeAsync(
                        item.Request,
                        item.UserId,
                        item.IsAuthenticated,
                        item.IsAdmin);

                    if (jobTracker.IsCancelRequested(item.JobId))
                    {
                        await jobTracker.FailJobAsync(item.JobId, "Cancelled");
                        continue;
                    }

                    var format = item.Request.OutputFormat.Equals("jpeg", StringComparison.OrdinalIgnoreCase)
                        ? "jpeg" : "png";
                    var contentType = format == "jpeg" ? "image/jpeg" : "image/png";
                    var filename = $"composite-nchannel.{format}";
                    var storageKey = $"tmp/jobs/{item.JobId}/composite.{format}";

                    using var stream = new MemoryStream(imageBytes);
                    await storageProvider.WriteAsync(storageKey, stream, stoppingToken);

                    await jobTracker.CompleteBlobJobAsync(item.JobId, storageKey, contentType, filename);
                    LogJobCompleted(item.JobId);
                }
                catch (Exception ex)
                {
                    LogJobFailed(ex, item.JobId);
                    await jobTracker.FailJobAsync(item.JobId, ToUserMessage(ex));
                }
            }

            LogServiceStopping();
        }

        private static string ToUserMessage(Exception ex) => ex switch
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
