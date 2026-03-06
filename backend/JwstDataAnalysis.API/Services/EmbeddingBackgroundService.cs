// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    public sealed partial class EmbeddingBackgroundService(
        EmbeddingQueue queue,
        ISemanticSearchService semanticSearchService,
        IJobTracker jobTracker,
        ILogger<EmbeddingBackgroundService> logger) : BackgroundService
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
                    await jobTracker.UpdateProgressAsync(item.JobId, 10, "embedding", "Building semantic index...");

                    Models.EmbedBatchResponse result;
                    if (item.IsFullReindex)
                    {
                        result = await semanticSearchService.ReindexAllAsync();
                    }
                    else
                    {
                        result = await semanticSearchService.EmbedBatchAsync(item.FileIds);
                    }

                    await jobTracker.UpdateProgressAsync(
                        item.JobId,
                        100,
                        "complete",
                        $"Indexed {result.EmbeddedCount} files ({result.TotalIndexed} total)");

                    await jobTracker.CompleteJobAsync(
                        item.JobId,
                        $"Embedded {result.EmbeddedCount} files. Total indexed: {result.TotalIndexed}");

                    LogJobCompleted(item.JobId, result.EmbeddedCount, result.TotalIndexed);
                }
                catch (Exception ex)
                {
                    LogJobFailed(ex, item.JobId);
                    await jobTracker.FailJobAsync(item.JobId, ex.Message);
                }
            }

            LogServiceStopping();
        }

        [LoggerMessage(Level = LogLevel.Information, Message = "Embedding background service started")]
        private partial void LogServiceStarted();

        [LoggerMessage(Level = LogLevel.Information,
            Message = "Embedding job {JobId} completed: {Embedded} embedded, {Total} total")]
        private partial void LogJobCompleted(string jobId, int embedded, int total);

        [LoggerMessage(Level = LogLevel.Error, Message = "Embedding job {JobId} failed")]
        private partial void LogJobFailed(Exception ex, string jobId);

        [LoggerMessage(Level = LogLevel.Information, Message = "Embedding background service stopping")]
        private partial void LogServiceStopping();
    }
}
