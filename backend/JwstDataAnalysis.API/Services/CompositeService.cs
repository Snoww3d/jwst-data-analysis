// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services.Storage;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class CompositeService : ICompositeService
    {
        private readonly HttpClient httpClient;
        private readonly IMongoDBService mongoDBService;
        private readonly IStorageProvider storageProvider;
        private readonly ILogger<CompositeService> logger;
        private readonly string processingEngineUrl;
        private readonly JsonSerializerOptions jsonOptions;

        public CompositeService(
            HttpClient httpClient,
            IMongoDBService mongoDBService,
            IStorageProvider storageProvider,
            ILogger<CompositeService> logger,
            IConfiguration configuration)
        {
            this.httpClient = httpClient;
            this.mongoDBService = mongoDBService;
            this.storageProvider = storageProvider;
            this.logger = logger;
            processingEngineUrl = configuration["ProcessingEngine:BaseUrl"]
                ?? "http://localhost:8000";

            jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                PropertyNameCaseInsensitive = true,
            };
        }

        /// <inheritdoc/>
        public async Task<byte[]> GenerateNChannelCompositeAsync(
            NChannelCompositeRequestDto request,
            string? userId,
            bool isAuthenticated,
            bool isAdmin)
        {
            LogGeneratingNChannelComposite(request.Channels.Count);

            var processingChannels = new List<ProcessingNChannelConfig>();

            foreach (var channel in request.Channels)
            {
                var filePaths = await ResolveDataIdsToFilePathsAsync(
                    channel.DataIds, userId, isAuthenticated, isAdmin);

                processingChannels.Add(new ProcessingNChannelConfig
                {
                    FilePaths = filePaths,
                    Stretch = channel.Stretch,
                    BlackPoint = channel.BlackPoint,
                    WhitePoint = channel.WhitePoint,
                    Gamma = channel.Gamma,
                    AsinhA = channel.AsinhA,
                    Curve = channel.Curve,
                    Weight = channel.Weight,
                    Color = new ProcessingChannelColor
                    {
                        Hue = channel.Color.Hue,
                        Rgb = channel.Color.Rgb,
                        Luminance = channel.Color.Luminance,
                    },
                    Label = channel.Label,
                    WavelengthUm = channel.WavelengthUm,
                });
            }

            var processingRequest = new ProcessingNChannelCompositeRequest
            {
                Channels = processingChannels,
                Overall = CreateProcessingOverallAdjustments(request.Overall),
                BackgroundNeutralization = request.BackgroundNeutralization,
                OutputFormat = request.OutputFormat,
                Quality = request.Quality,
                Width = request.Width,
                Height = request.Height,
            };

            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            LogCallingProcessingEngine(json);

            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/composite/generate-nchannel",
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
            var relativePath = StorageKeyHelper.ToRelativeKey(data.FilePath);
            LogResolvedPath(dataId, data.FilePath, relativePath);

            return relativePath;
        }

        private async Task<List<string>> ResolveDataIdsToFilePathsAsync(
            List<string> dataIds,
            string? userId,
            bool isAuthenticated,
            bool isAdmin)
        {
            // Batch-fetch all records in a single $in query instead of N sequential lookups
            var records = await mongoDBService.GetManyAsync(dataIds);
            var recordsById = records.ToDictionary(r => r.Id!);

            var allPaths = new List<(string Path, string Suffix)>(dataIds.Count);
            foreach (var dataId in dataIds)
            {
                if (!recordsById.TryGetValue(dataId, out var data))
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

                var relativePath = StorageKeyHelper.ToRelativeKey(data.FilePath);
                LogResolvedPath(dataId, data.FilePath, relativePath);

                // Extract JWST file type suffix (e.g. _i2d, _cal, _rate)
                var match = Regex.Match(relativePath, @"_(i2d|cal|rate|rateints|uncal|crf|s2d)\.fits$", RegexOptions.IgnoreCase);
                allPaths.Add((relativePath, match.Success ? match.Groups[1].Value.ToLowerInvariant() : string.Empty));
            }

            // For composite generation, prefer _i2d files (drizzle-combined, fully calibrated).
            // Fall back to _cal, then _s2d, then all files if no preferred types exist.
            // This prevents OOM from loading hundreds of intermediate calibration products.
            var preferredSuffixes = new[] { "i2d", "cal", "s2d" };
            foreach (var suffix in preferredSuffixes)
            {
                var filtered = allPaths.Where(p => p.Suffix == suffix).Select(p => p.Path).ToList();
                if (filtered.Count > 0)
                {
                    if (filtered.Count < allPaths.Count)
                    {
                        LogFilteredToPreferredFileType(suffix, filtered.Count, allPaths.Count);
                    }

                    return filtered;
                }
            }

            // No preferred types found — return all paths as-is
            return allPaths.Select(p => p.Path).ToList();
        }
    }
}
