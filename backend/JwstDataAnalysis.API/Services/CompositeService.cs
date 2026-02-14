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
        public async Task<byte[]> GenerateCompositeAsync(
            CompositeRequestDto request,
            string? userId,
            bool isAuthenticated,
            bool isAdmin)
        {
            LogGeneratingComposite(request.Red.DataIds.Count, request.Green.DataIds.Count, request.Blue.DataIds.Count);

            // Resolve data IDs to file paths
            var redPaths = await ResolveDataIdsToFilePathsAsync(request.Red.DataIds, userId, isAuthenticated, isAdmin);
            var greenPaths = await ResolveDataIdsToFilePathsAsync(request.Green.DataIds, userId, isAuthenticated, isAdmin);
            var bluePaths = await ResolveDataIdsToFilePathsAsync(request.Blue.DataIds, userId, isAuthenticated, isAdmin);

            // Build processing engine request with file paths
            var processingRequest = new ProcessingCompositeRequest
            {
                Red = CreateProcessingChannelConfig(request.Red, redPaths),
                Green = CreateProcessingChannelConfig(request.Green, greenPaths),
                Blue = CreateProcessingChannelConfig(request.Blue, bluePaths),
                Overall = CreateProcessingOverallAdjustments(request.Overall),
                BackgroundNeutralization = request.BackgroundNeutralization,
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

        private static ProcessingChannelConfig CreateProcessingChannelConfig(
            ChannelConfigDto config,
            List<string> filePaths)
        {
            return new ProcessingChannelConfig
            {
                FilePaths = filePaths,
                Stretch = config.Stretch,
                BlackPoint = config.BlackPoint,
                WhitePoint = config.WhitePoint,
                Gamma = config.Gamma,
                AsinhA = config.AsinhA,
                Curve = config.Curve,
                Weight = config.Weight,
            };
        }

        private static ProcessingOverallAdjustments? CreateProcessingOverallAdjustments(
            OverallAdjustmentsDto? overall)
        {
            if (overall == null)
            {
                return null;
            }

            return new ProcessingOverallAdjustments
            {
                Stretch = overall.Stretch,
                BlackPoint = overall.BlackPoint,
                WhitePoint = overall.WhitePoint,
                Gamma = overall.Gamma,
                AsinhA = overall.AsinhA,
            };
        }

        private static bool CanAccessData(
            JwstDataModel data,
            string? userId,
            bool isAuthenticated,
            bool isAdmin)
        {
            if (isAdmin)
            {
                return true;
            }

            if (!isAuthenticated)
            {
                return data.IsPublic;
            }

            return data.IsPublic
                || data.UserId == userId
                || (userId != null && data.SharedWith.Contains(userId));
        }

        private async Task<string> ResolveDataIdToFilePathAsync(
            string dataId,
            string? userId,
            bool isAuthenticated,
            bool isAdmin)
        {
            var data = await mongoDBService.GetAsync(dataId);
            if (data == null)
            {
                LogDataNotFound(dataId);
                throw new KeyNotFoundException($"Data with ID {dataId} not found");
            }

            if (!CanAccessData(data, userId, isAuthenticated, isAdmin))
            {
                LogAccessDenied(dataId, isAuthenticated, userId, isAdmin);
                throw new UnauthorizedAccessException($"Access denied for data ID {dataId}");
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

        private async Task<List<string>> ResolveDataIdsToFilePathsAsync(
            List<string> dataIds,
            string? userId,
            bool isAuthenticated,
            bool isAdmin)
        {
            var filePaths = new List<string>();
            foreach (var dataId in dataIds)
            {
                var path = await ResolveDataIdToFilePathAsync(dataId, userId, isAuthenticated, isAdmin);
                filePaths.Add(path);
            }

            return filePaths;
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
