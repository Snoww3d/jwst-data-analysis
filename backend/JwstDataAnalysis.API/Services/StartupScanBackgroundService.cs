// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Runs a single disk scan on startup to auto-recover any FITS files
    /// present on disk but missing from MongoDB (e.g. after a DB wipe).
    /// Also enqueues thumbnail generation for records that are missing thumbnails.
    /// </summary>
    public sealed partial class StartupScanBackgroundService(
        IServiceScopeFactory scopeFactory,
        IThumbnailQueue thumbnailQueue,
        ILogger<StartupScanBackgroundService> logger) : BackgroundService
    {
        private readonly IServiceScopeFactory scopeFactory = scopeFactory;
        private readonly IThumbnailQueue thumbnailQueue = thumbnailQueue;
        private readonly ILogger<StartupScanBackgroundService> logger = logger;

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            // Wait briefly for other services to initialize
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            LogStartupScanStarting();

            try
            {
                using var scope = scopeFactory.CreateScope();
                var dataScanService = scope.ServiceProvider.GetRequiredService<IDataScanService>();
                var mongoDBService = scope.ServiceProvider.GetRequiredService<IMongoDBService>();

                // Phase 1: Scan disk and import missing records
                var result = await dataScanService.ScanAndImportAsync();

                LogStartupScanCompleted(result.ImportedCount, result.SkippedCount, result.ErrorCount);

                if (stoppingToken.IsCancellationRequested)
                {
                    return;
                }

                // Phase 2: Enqueue thumbnail generation for records missing thumbnails
                var missingThumbnailIds = await mongoDBService.GetViewableWithoutThumbnailIdsAsync();
                if (missingThumbnailIds.Count > 0)
                {
                    thumbnailQueue.EnqueueBatch(missingThumbnailIds);
                    LogEnqueuedMissingThumbnails(missingThumbnailIds.Count);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                LogStartupScanFailed(ex);
            }
        }

        [LoggerMessage(EventId = 3801, Level = LogLevel.Information,
            Message = "Startup disk scan starting")]
        private partial void LogStartupScanStarting();

        [LoggerMessage(EventId = 3802, Level = LogLevel.Information,
            Message = "Startup disk scan completed: {Imported} imported, {Skipped} skipped, {Errors} errors")]
        private partial void LogStartupScanCompleted(int imported, int skipped, int errors);

        [LoggerMessage(EventId = 3803, Level = LogLevel.Information,
            Message = "Enqueued thumbnail generation for {Count} records missing thumbnails")]
        private partial void LogEnqueuedMissingThumbnails(int count);

        [LoggerMessage(EventId = 3804, Level = LogLevel.Error,
            Message = "Startup disk scan failed")]
        private partial void LogStartupScanFailed(Exception ex);
    }
}
