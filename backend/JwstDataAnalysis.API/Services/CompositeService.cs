// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;
using System.Text.Json;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class CompositeService : ICompositeService
    {
        private readonly HttpClient httpClient;
        private readonly IMongoDBService mongoDBService;
        private readonly ILogger<CompositeService> logger;
        private readonly string processingEngineUrl;
        private readonly string dataBasePath;
        private readonly JsonSerializerOptions jsonOptions;

        public CompositeService(
            HttpClient httpClient,
            IMongoDBService mongoDBService,
            ILogger<CompositeService> logger,
            IConfiguration configuration)
        {
            this.httpClient = httpClient;
            this.mongoDBService = mongoDBService;
            this.logger = logger;
            processingEngineUrl = configuration["ProcessingEngine:BaseUrl"]
                ?? "http://localhost:8000";
            dataBasePath = configuration["Downloads:BasePath"] ?? "/app/data/mast";

            jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                PropertyNameCaseInsensitive = true,
            };
        }

        /// <inheritdoc/>
        public async Task<byte[]> GenerateCompositeAsync(CompositeRequestDto request)
        {
            LogGeneratingComposite(request.Red.DataId, request.Green.DataId, request.Blue.DataId);

            // Resolve data IDs to file paths
            var redPath = await ResolveDataIdToFilePathAsync(request.Red.DataId);
            var greenPath = await ResolveDataIdToFilePathAsync(request.Green.DataId);
            var bluePath = await ResolveDataIdToFilePathAsync(request.Blue.DataId);

            // Build processing engine request with file paths
            var processingRequest = new ProcessingCompositeRequest
            {
                Red = CreateProcessingChannelConfig(request.Red, redPath),
                Green = CreateProcessingChannelConfig(request.Green, greenPath),
                Blue = CreateProcessingChannelConfig(request.Blue, bluePath),
                OutputFormat = request.OutputFormat,
                Quality = request.Quality,
                Width = request.Width,
                Height = request.Height,
            };

            // Call processing engine
            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            LogCallingProcessingEngine(json);

            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/composite/generate",
                content);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                LogProcessingEngineError(response.StatusCode, errorBody);
                throw new HttpRequestException(
                    $"Processing engine error: {response.StatusCode} - {errorBody}",
                    null,
                    response.StatusCode);
            }

            var imageBytes = await response.Content.ReadAsByteArrayAsync();
            LogCompositeGenerated(imageBytes.Length, request.OutputFormat);

            return imageBytes;
        }

        private async Task<string> ResolveDataIdToFilePathAsync(string dataId)
        {
            var data = await mongoDBService.GetAsync(dataId);
            if (data == null)
            {
                LogDataNotFound(dataId);
                throw new KeyNotFoundException($"Data with ID {dataId} not found");
            }

            if (string.IsNullOrEmpty(data.FilePath))
            {
                LogNoFilePath(dataId);
                throw new InvalidOperationException($"Data {dataId} has no file path");
            }

            // Convert absolute path to relative path for processing engine
            // The processing engine expects paths relative to /app/data
            var relativePath = ConvertToRelativePath(data.FilePath);
            LogResolvedPath(dataId, data.FilePath, relativePath);

            return relativePath;
        }

        private string ConvertToRelativePath(string absolutePath)
        {
            // The processing engine's DATA_DIR is /app/data
            // File paths in DB are like /app/data/mast/obs_id/file.fits
            // We need to strip /app/data/ prefix

            const string dataPrefix = "/app/data/";
            if (absolutePath.StartsWith(dataPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return absolutePath[dataPrefix.Length..];
            }

            // If path doesn't start with expected prefix, try stripping the configured base path
            if (absolutePath.StartsWith(dataBasePath, StringComparison.OrdinalIgnoreCase))
            {
                var relative = absolutePath[dataBasePath.Length..].TrimStart('/');
                return $"mast/{relative}";
            }

            // Return as-is if already relative or has unexpected format
            return absolutePath;
        }

        private static ProcessingChannelConfig CreateProcessingChannelConfig(
            ChannelConfigDto config,
            string filePath)
        {
            return new ProcessingChannelConfig
            {
                FilePath = filePath,
                Stretch = config.Stretch,
                BlackPoint = config.BlackPoint,
                WhitePoint = config.WhitePoint,
                Gamma = config.Gamma,
                AsinhA = config.AsinhA,
            };
        }
    }
}
