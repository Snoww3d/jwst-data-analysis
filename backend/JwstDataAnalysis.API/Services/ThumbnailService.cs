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

    public partial class ThumbnailService(
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
                    LogRecordNotFound(dataId);
                    return;
                }

                if (!record.IsViewable)
                {
                    LogRecordNotViewable(dataId);
                    return;
                }

                if (string.IsNullOrEmpty(record.FilePath))
                {
                    LogNoFilePath(dataId);
                    return;
                }

                // FilePath is a relative storage key (e.g. "mast/obs_id/file.fits").
                // Backward compat: strip /app/data/ if present from pre-migration records.
                var filePath = record.FilePath;
                if (filePath.StartsWith("/app/data/", StringComparison.Ordinal))
                {
                    filePath = filePath["/app/data/".Length..];
                }

                var client = httpClientFactory.CreateClient("ThumbnailEngine");
                var requestBody = new { file_path = filePath };
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
                    LogThumbnailReturnedNull(dataId);
                    return;
                }

                var thumbnailBytes = Convert.FromBase64String(result.ThumbnailBase64);
                await mongoDBService.UpdateThumbnailAsync(dataId, thumbnailBytes);

                LogThumbnailGenerated(dataId, thumbnailBytes.Length);
            }
            catch (Exception ex)
            {
                LogThumbnailFailed(ex, dataId);
            }
        }

        public async Task GenerateThumbnailsForIdsAsync(List<string> dataIds)
        {
            LogBatchStarting(dataIds.Count);

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

                    // Verify thumbnail was actually stored (GenerateThumbnailAsync catches its own exceptions)
                    var updated = await mongoDBService.GetThumbnailAsync(dataId);
                    if (updated != null)
                    {
                        generated++;
                    }
                    else
                    {
                        failed++;
                    }
                }
                catch (Exception ex)
                {
                    LogThumbnailFailed(ex, dataId);
                    failed++;
                }
            }

            LogBatchComplete(generated, skipped, failed);
        }

        private sealed class ThumbnailResponse
        {
            [System.Text.Json.Serialization.JsonPropertyName("thumbnail_base64")]
            public string? ThumbnailBase64 { get; set; }
        }
    }
}
