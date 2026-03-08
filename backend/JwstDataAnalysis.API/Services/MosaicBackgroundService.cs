// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Services.Storage;

namespace JwstDataAnalysis.API.Services
{
    public sealed partial class MosaicBackgroundService(
        MosaicQueue queue,
        IMosaicService mosaicService,
        IJobTracker jobTracker,
        IStorageProvider storageProvider,
        ILogger<MosaicBackgroundService> logger) : BackgroundService
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

                    if (item.IsObservationMosaic)
                    {
                        await ProcessObservationMosaicAsync(item, stoppingToken);
                    }
                    else if (item.SaveToLibrary)
                    {
                        await ProcessSaveToLibraryAsync(item, stoppingToken);
                    }
                    else
                    {
                        await ProcessExportAsync(item, stoppingToken);
                    }
                }
                catch (Exception ex)
                {
                    LogJobFailed(ex, item.JobId);
                    await jobTracker.FailJobAsync(item.JobId, ProcessingErrorMessages.ToUserMessage(ex));
                }
            }

            LogServiceStopping();
        }

        /// <summary>
        /// Export flow: generate PNG/JPEG → write to blob storage → complete as blob job.
        /// </summary>
        private async Task ProcessExportAsync(MosaicJobItem item, CancellationToken stoppingToken)
        {
            await jobTracker.UpdateProgressAsync(item.JobId, 10, "generating", "Generating mosaic image...");

            var imageBytes = await mosaicService.GenerateMosaicAsync(
                item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin);

            if (jobTracker.IsCancelRequested(item.JobId))
            {
                await jobTracker.FailJobAsync(item.JobId, "Cancelled");
                return;
            }

            var format = item.Request.OutputFormat.Equals("jpeg", StringComparison.OrdinalIgnoreCase)
                ? "jpeg" : "png";
            var contentType = format == "jpeg" ? "image/jpeg" : "image/png";
            var filename = $"mosaic.{format}";
            var storageKey = $"tmp/jobs/{item.JobId}/mosaic.{format}";

            using var stream = new MemoryStream(imageBytes);
            await storageProvider.WriteAsync(storageKey, stream, stoppingToken);

            await jobTracker.CompleteBlobJobAsync(item.JobId, storageKey, contentType, filename);
            LogJobCompleted(item.JobId);
        }

        /// <summary>
        /// Observation mosaic flow: generate mosaic from per-detector files → persist as data record.
        /// </summary>
        private async Task ProcessObservationMosaicAsync(MosaicJobItem item, CancellationToken stoppingToken)
        {
            if (item.SourceDataIds == null || item.SourceDataIds.Count == 0 || item.ObservationBaseId == null)
            {
                LogJobFailed(new InvalidOperationException("Observation mosaic job missing source data IDs or observation base ID"), item.JobId);
                await jobTracker.FailJobAsync(item.JobId, "Missing source data for observation mosaic");
                return;
            }

            await jobTracker.UpdateProgressAsync(item.JobId, 10, "generating", "Generating observation mosaic...");

            var saved = await mosaicService.GenerateObservationMosaicAsync(
                item.SourceDataIds,
                item.ObservationBaseId,
                item.UserId,
                item.IsAuthenticated,
                item.IsAdmin,
                stoppingToken);

            if (jobTracker.IsCancelRequested(item.JobId))
            {
                await jobTracker.FailJobAsync(item.JobId, "Cancelled");
                return;
            }

            var message = $"{saved.FileName}|{saved.FileSize}";
            await jobTracker.CompleteDataIdJobAsync(item.JobId, saved.DataId, message);
            LogObservationMosaicCompleted(item.JobId, saved.DataId, item.SourceDataIds.Count);
        }

        /// <summary>
        /// Save-to-library flow: generate FITS → persist as data record → complete as data_id job.
        /// </summary>
        private async Task ProcessSaveToLibraryAsync(MosaicJobItem item, CancellationToken stoppingToken)
        {
            await jobTracker.UpdateProgressAsync(item.JobId, 10, "generating", "Generating FITS mosaic...");

            var saved = await mosaicService.GenerateAndSaveMosaicAsync(
                item.Request,
                item.UserId,
                item.IsAuthenticated,
                item.IsAdmin);

            if (jobTracker.IsCancelRequested(item.JobId))
            {
                await jobTracker.FailJobAsync(item.JobId, "Cancelled");
                return;
            }

            var message = $"{saved.FileName}|{saved.FileSize}";
            await jobTracker.CompleteDataIdJobAsync(item.JobId, saved.DataId, message);
            LogJobCompleted(item.JobId);
        }
    }
}
