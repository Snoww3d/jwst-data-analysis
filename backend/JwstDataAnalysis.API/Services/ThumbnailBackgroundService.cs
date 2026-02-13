// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    public sealed partial class ThumbnailBackgroundService(
        ThumbnailQueue queue,
        IThumbnailService thumbnailService,
        ILogger<ThumbnailBackgroundService> logger) : BackgroundService
    {
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            LogServiceStarted();

            await foreach (var batch in queue.Reader.ReadAllAsync(stoppingToken))
            {
                LogBatchReceived(batch.Count);

                try
                {
                    await thumbnailService.GenerateThumbnailsForIdsAsync(batch);
                }
                catch (Exception ex)
                {
                    LogBatchFailed(ex, batch.Count);
                }
                finally
                {
                    queue.DecrementPending();
                }
            }

            LogServiceStopping();
        }
    }
}
