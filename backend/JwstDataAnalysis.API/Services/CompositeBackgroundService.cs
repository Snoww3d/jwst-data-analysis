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

                    var jobId = item.JobId;
                    var compositeResult = await compositeService.GenerateNChannelCompositeAsync(
                        item.Request,
                        item.UserId,
                        item.IsAuthenticated,
                        item.IsAdmin,
                        allowInlineMosaic: true,
                        onProgress: (pct, stage, msg) =>
                            jobTracker.UpdateProgressAsync(jobId, pct, stage, msg),
                        cancellationToken: stoppingToken);

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

                    // Async export path drops X-Composite-* warning headers — surfacing them via
                    // SignalR job completion would need a different shape. Tracked as follow-up.
                    using var stream = new MemoryStream(compositeResult.Bytes);
                    await storageProvider.WriteAsync(storageKey, stream, stoppingToken);

                    await jobTracker.CompleteBlobJobAsync(item.JobId, storageKey, contentType, filename);
                    LogJobCompleted(item.JobId);
                }
                catch (Exception ex)
                {
                    LogJobFailed(ex, item.JobId);
                    await jobTracker.FailJobAsync(item.JobId, ProcessingErrorMessages.ToUserMessage(ex));
                }
            }

            LogServiceStopping();
        }
    }
}
