// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

using JwstDataAnalysis.API.Configuration;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services.Storage;
using Microsoft.Extensions.Options;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class CompositeService : ICompositeService
    {
        private readonly HttpClient httpClient;
        private readonly IMongoDBService mongoDBService;
        private readonly IStorageProvider storageProvider;
        private readonly IMosaicService mosaicService;
        private readonly ObservationMosaicTracker observationMosaicTracker;
        private readonly ILogger<CompositeService> logger;
        private readonly string processingEngineUrl;
        private readonly JsonSerializerOptions jsonOptions;
        private readonly ObservationMosaicSettings observationMosaicSettings;

        public CompositeService(
            HttpClient httpClient,
            IMongoDBService mongoDBService,
            IStorageProvider storageProvider,
            IMosaicService mosaicService,
            ObservationMosaicTracker observationMosaicTracker,
            ILogger<CompositeService> logger,
            IConfiguration configuration,
            IOptions<ObservationMosaicSettings> observationMosaicOptions)
        {
            this.httpClient = httpClient;
            this.mongoDBService = mongoDBService;
            this.storageProvider = storageProvider;
            this.mosaicService = mosaicService;
            this.observationMosaicTracker = observationMosaicTracker;
            this.logger = logger;
            processingEngineUrl = configuration["ProcessingEngine:BaseUrl"]
                ?? "http://localhost:8000";
            observationMosaicSettings = observationMosaicOptions.Value;

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
            bool isAdmin,
            bool allowInlineMosaic = false,
            CancellationToken cancellationToken = default)
        {
            LogGeneratingNChannelComposite(request.Channels.Count);

            var processingChannels = new List<ProcessingNChannelConfig>();

            foreach (var channel in request.Channels)
            {
                var filePaths = await ResolveDataIdsToFilePathsAsync(
                    channel.DataIds,
                    userId,
                    isAuthenticated,
                    isAdmin,
                    allowInlineMosaic,
                    cancellationToken);

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
                content,
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
                LogProcessingEngineError(response.StatusCode, errorBody);
                throw new HttpRequestException(
                    $"Processing engine error: {response.StatusCode} - {errorBody}",
                    null,
                    response.StatusCode);
            }

            var imageBytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
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
            bool isAdmin,
            bool allowInlineMosaic = false,
            CancellationToken cancellationToken = default)
        {
            // Batch-fetch all records in a single $in query instead of N sequential lookups
            var records = await mongoDBService.GetManyAsync(dataIds);
            var recordsById = records.ToDictionary(r => r.Id!);

            var allPaths = new List<(string Path, string Suffix, JwstDataModel Record)>(dataIds.Count);
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
                allPaths.Add((relativePath, match.Success ? match.Groups[1].Value.ToLowerInvariant() : string.Empty, data));
            }

            // For composite generation, prefer _i2d files (drizzle-combined, fully calibrated).
            // Fall back to _cal, then _s2d, then all files if no preferred types exist.
            // This prevents OOM from loading hundreds of intermediate calibration products.
            var preferredSuffixes = new[] { "i2d", "cal", "s2d" };
            List<(string Path, string Suffix, JwstDataModel Record)> filtered = allPaths;
            foreach (var suffix in preferredSuffixes)
            {
                var candidates = allPaths.Where(p => p.Suffix == suffix).ToList();
                if (candidates.Count > 0)
                {
                    if (candidates.Count < allPaths.Count)
                    {
                        LogFilteredToPreferredFileType(suffix, candidates.Count, allPaths.Count);
                    }

                    filtered = candidates;
                    break;
                }
            }

            // Phase 3: Substitute observation mosaics for large per-detector groups
            var resolvedPaths = await SubstituteObservationMosaicsAsync(
                filtered,
                userId,
                isAuthenticated,
                isAdmin,
                allowInlineMosaic,
                cancellationToken);

            return resolvedPaths;
        }

        /// <summary>
        /// For groups of per-detector files exceeding the threshold, substitute
        /// a pre-computed observation mosaic if one exists and is accessible to the user.
        /// When no mosaic exists:
        /// - Async export path (allowInlineMosaic=true): generate the mosaic inline, persist it, then use it.
        /// - Sync preview path: if a background mosaic job is running, throw <see cref="ObservationMosaicInProgressException"/>
        ///   so the controller can return 409. Otherwise fall back to per-detector files.
        /// </summary>
        private async Task<List<string>> SubstituteObservationMosaicsAsync(
            List<(string Path, string Suffix, JwstDataModel Record)> pathsWithRecords,
            string? userId,
            bool isAuthenticated,
            bool isAdmin,
            bool allowInlineMosaic = false,
            CancellationToken cancellationToken = default)
        {
            if (!observationMosaicSettings.Enabled)
            {
                return pathsWithRecords.Select(p => p.Path).ToList();
            }

            // Group by ObservationBaseId
            var groups = pathsWithRecords
                .GroupBy(p => p.Record.ObservationBaseId ?? string.Empty)
                .ToList();

            var result = new List<string>();
            foreach (var group in groups)
            {
                var observationBaseId = group.Key;
                var groupItems = group.ToList();

                // Only substitute for groups exceeding threshold
                if (string.IsNullOrEmpty(observationBaseId) ||
                    groupItems.Count <= observationMosaicSettings.FileThreshold)
                {
                    result.AddRange(groupItems.Select(g => g.Path));
                    continue;
                }

                // Look for a pre-computed observation mosaic
                var obsRecords = await mongoDBService.GetByObservationAndLevelAsync(
                    observationBaseId, ProcessingLevels.Level3);

                var mosaicRecord = obsRecords
                    .Where(r => r.Tags.Contains("observation-mosaic")
                        && !string.IsNullOrEmpty(r.FilePath)
                        && CanAccessData(r, userId, isAuthenticated, isAdmin))
                    .OrderByDescending(r => r.UploadDate)
                    .FirstOrDefault();

                if (mosaicRecord != null)
                {
                    var mosaicPath = StorageKeyHelper.ToRelativeKey(mosaicRecord.FilePath!);
                    LogSubstitutedObservationMosaic(observationBaseId, groupItems.Count, mosaicRecord.Id);
                    result.Add(mosaicPath);
                }
                else if (allowInlineMosaic)
                {
                    // Async export path: generate the mosaic inline and persist it
                    var sourceDataIds = groupItems.Select(g => g.Record.Id!).ToList();
                    LogInlineMosaicStarted(observationBaseId, sourceDataIds.Count);

                    var saved = await mosaicService.GenerateObservationMosaicAsync(
                        sourceDataIds,
                        observationBaseId,
                        userId,
                        isAuthenticated,
                        isAdmin,
                        cancellationToken);

                    // Fetch the saved record to get its file path
                    var savedRecord = await mongoDBService.GetAsync(saved.DataId);
                    if (savedRecord?.FilePath != null)
                    {
                        var inlinePath = StorageKeyHelper.ToRelativeKey(savedRecord.FilePath);
                        LogInlineMosaicCompleted(observationBaseId, saved.DataId);
                        result.Add(inlinePath);
                    }
                    else
                    {
                        // Fallback if record fetch fails unexpectedly
                        result.AddRange(groupItems.Select(g => g.Path));
                    }
                }
                else if (observationMosaicTracker.TryGetActiveJobId(observationBaseId, out var activeJobId))
                {
                    // Sync preview path: mosaic job is running — tell client to retry
                    throw new ObservationMosaicInProgressException(observationBaseId, activeJobId!);
                }
                else
                {
                    // No mosaic available and no job running — use original paths
                    result.AddRange(groupItems.Select(g => g.Path));
                }
            }

            return result;
        }
    }
}
