// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;
using System.Text.Json;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class MosaicService : IMosaicService
    {
        private readonly HttpClient httpClient;
        private readonly IMongoDBService mongoDBService;
        private readonly ILogger<MosaicService> logger;
        private readonly string processingEngineUrl;
        private readonly string dataBasePath;
        private readonly JsonSerializerOptions jsonOptions;

        public MosaicService(
            HttpClient httpClient,
            IMongoDBService mongoDBService,
            ILogger<MosaicService> logger,
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
        public async Task<byte[]> GenerateMosaicAsync(MosaicRequestDto request)
        {
            LogGeneratingMosaic(request.Files.Count, request.CombineMethod);

            // Resolve all data IDs to file paths
            var processingFiles = new List<ProcessingMosaicFileConfig>();
            foreach (var fileConfig in request.Files)
            {
                var filePath = await ResolveDataIdToFilePathAsync(fileConfig.DataId);
                processingFiles.Add(new ProcessingMosaicFileConfig
                {
                    FilePath = filePath,
                    Stretch = fileConfig.Stretch,
                    BlackPoint = fileConfig.BlackPoint,
                    WhitePoint = fileConfig.WhitePoint,
                    Gamma = fileConfig.Gamma,
                    AsinhA = fileConfig.AsinhA,
                });
            }

            // Build processing engine request
            var processingRequest = new ProcessingMosaicRequest
            {
                Files = processingFiles,
                OutputFormat = request.OutputFormat,
                Quality = request.Quality,
                Width = request.Width,
                Height = request.Height,
                CombineMethod = request.CombineMethod,
                Cmap = request.Cmap,
            };

            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            LogCallingProcessingEngine(json);

            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/mosaic/generate",
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
            LogMosaicGenerated(imageBytes.Length, request.OutputFormat);

            return imageBytes;
        }

        /// <inheritdoc/>
        public async Task<FootprintResponseDto> GetFootprintsAsync(FootprintRequestDto request)
        {
            LogComputingFootprints(request.DataIds.Count);

            // Resolve data IDs to file paths
            var filePaths = new List<string>();
            foreach (var dataId in request.DataIds)
            {
                var filePath = await ResolveDataIdToFilePathAsync(dataId);
                filePaths.Add(filePath);
            }

            // Build processing engine request
            var processingRequest = new ProcessingFootprintRequest
            {
                FilePaths = filePaths,
            };

            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            LogCallingFootprintEndpoint(json);

            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/mosaic/footprint",
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

            var responseBody = await response.Content.ReadAsStringAsync();
            var footprintResponse = JsonSerializer.Deserialize<FootprintResponseDto>(
                responseBody, jsonOptions)
                ?? throw new InvalidOperationException("Failed to deserialize footprint response");

            LogFootprintsComputed(footprintResponse.NFiles);

            return footprintResponse;
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
    }
}
