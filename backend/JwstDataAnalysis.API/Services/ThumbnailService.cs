// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text.Json;

namespace JwstDataAnalysis.API.Services
{
    public interface IThumbnailService
    {
        Task GenerateThumbnailAsync(string dataId);

        Task GenerateThumbnailsForIdsAsync(List<string> dataIds);
    }

    public class ThumbnailService(
        IHttpClientFactory httpClientFactory,
        IMongoDBService mongoDBService,
        ILogger<ThumbnailService> logger) : IThumbnailService
    {
        private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

        public async Task GenerateThumbnailAsync(string dataId)
        {
            try
            {
                var record = await mongoDBService.GetAsync(dataId);
                if (record == null)
                {
                    logger.LogWarning("Thumbnail generation skipped: record {DataId} not found", dataId);
                    return;
                }

                if (!record.IsViewable)
                {
                    logger.LogDebug("Thumbnail generation skipped: record {DataId} is not viewable", dataId);
                    return;
                }

                if (string.IsNullOrEmpty(record.FilePath))
                {
                    logger.LogWarning("Thumbnail generation skipped: record {DataId} has no file path", dataId);
                    return;
                }

                var client = httpClientFactory.CreateClient("ThumbnailEngine");
                var requestBody = new { file_path = record.FilePath };
                var content = new StringContent(
                    JsonSerializer.Serialize(requestBody),
                    System.Text.Encoding.UTF8,
                    "application/json");

                var response = await client.PostAsync("/thumbnail", content);
                response.EnsureSuccessStatusCode();

                var json = await response.Content.ReadAsStringAsync();
                var result = JsonSerializer.Deserialize<ThumbnailResponse>(json, JsonOptions);

                if (result?.ThumbnailBase64 == null)
                {
                    logger.LogWarning("Thumbnail generation returned null for {DataId}", dataId);
                    return;
                }

                var thumbnailBytes = Convert.FromBase64String(result.ThumbnailBase64);
                await mongoDBService.UpdateThumbnailAsync(dataId, thumbnailBytes);

                logger.LogInformation("Thumbnail generated for {DataId} ({Size} bytes)", dataId, thumbnailBytes.Length);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to generate thumbnail for {DataId}", dataId);
            }
        }

        public async Task GenerateThumbnailsForIdsAsync(List<string> dataIds)
        {
            logger.LogInformation("Starting thumbnail generation for {Count} record(s)", dataIds.Count);

            var generated = 0;
            var skipped = 0;
            var failed = 0;

            foreach (var dataId in dataIds)
            {
                try
                {
                    var record = await mongoDBService.GetAsync(dataId);
                    if (record == null || !record.IsViewable || record.ThumbnailData != null)
                    {
                        skipped++;
                        continue;
                    }

                    await GenerateThumbnailAsync(dataId);
                    generated++;
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Failed to generate thumbnail for {DataId}", dataId);
                    failed++;
                }
            }

            logger.LogInformation(
                "Thumbnail generation complete: {Generated} generated, {Skipped} skipped, {Failed} failed",
                generated, skipped, failed);
        }

        private sealed class ThumbnailResponse
        {
            public string? ThumbnailBase64 { get; set; }
        }
    }
}
