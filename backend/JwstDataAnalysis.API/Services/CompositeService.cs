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
        /// <summary>
        /// Header name prefixes that the controller forwards from the engine
        /// to the HTTP client. Anything not matching one of these is dropped.
        /// </summary>
        private static readonly string[] ForwardableHeaderPrefixes = ["X-Composite-", "X-Quality-"];

        // #1471 — Stage-to-progress-pct map for the streaming consumer. Mirrors
        // the engine's pipeline order so the SignalR progress bar advances
        // monotonically across stages. Per-channel events within reproject /
        // stretch interpolate between the start and end of their stage window
        // using index/total.
        private static readonly Dictionary<string, (int Start, int End)> StageProgressWindows =
            new(StringComparer.OrdinalIgnoreCase)
            {
                ["queued"] = (0, 5),
                ["mosaic"] = (5, 10),
                ["reproject"] = (10, 50),
                ["background_neutralize"] = (52, 55),
                ["stretch"] = (60, 80),
                ["combine"] = (82, 88),
                ["encode"] = (90, 95),
            };

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
        public async Task<CompositeResult> GenerateNChannelCompositeAsync(
            NChannelCompositeRequestDto request,
            string? userId,
            bool isAuthenticated,
            bool isAdmin,
            bool allowInlineMosaic = false,
            Func<int, string, string, Task>? onProgress = null,
            CancellationToken cancellationToken = default)
        {
            LogGeneratingNChannelComposite(request.Channels.Count);

            var processingRequest = await BuildProcessingRequestAsync(
                request, userId, isAuthenticated, isAdmin, allowInlineMosaic, onProgress, cancellationToken);

            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            LogCallingProcessingEngine(json);

            // #1471 — when an onProgress callback is wired, route through the
            // engine's streaming endpoint so per-channel events flow back to
            // SignalR during the long composite call. Sync callers (no
            // callback) keep the original buffered path — same engine
            // behavior, simpler client code, no b64 overhead.
            if (onProgress != null)
            {
                return await StreamNChannelCompositeAsync(
                    json, onProgress, request.OutputFormat, cancellationToken);
            }

            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/composite/generate-nchannel",
                content,
                cancellationToken);

            if (response.StatusCode == System.Net.HttpStatusCode.RequestEntityTooLarge)
            {
                var detail = await ReadEngineDetailAsync(response, cancellationToken);
                LogProcessingEngineError(response.StatusCode, detail);
                throw new CompositeBudgetExceededException(detail);
            }

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

            return new CompositeResult(imageBytes, ExtractForwardableHeaders(response));
        }

        /// <inheritdoc/>
        public async Task<CompositeEstimateResponseDto> EstimateCompositeAsync(
            NChannelCompositeRequestDto request,
            string? userId,
            bool isAuthenticated,
            bool isAdmin,
            CancellationToken cancellationToken = default)
        {
            var processingRequest = await BuildProcessingRequestAsync(
                request, userId, isAuthenticated, isAdmin, allowInlineMosaic: false, onProgress: null, cancellationToken);

            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/composite/estimate",
                content,
                cancellationToken);

            if (response.StatusCode == System.Net.HttpStatusCode.RequestEntityTooLarge)
            {
                // /composite/estimate returns 413 only when the input file count
                // exceeds MAX_COMPOSITE_ESTIMATE_FILES. The verdict-fail path
                // (status="fail") returns 200; this branch is the soft-cap.
                var detail = await ReadEngineDetailAsync(response, cancellationToken);
                LogProcessingEngineError(response.StatusCode, detail);
                throw new CompositeBudgetExceededException(detail);
            }

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
                LogProcessingEngineError(response.StatusCode, errorBody);
                throw new HttpRequestException(
                    $"Processing engine error: {response.StatusCode} - {errorBody}",
                    null,
                    response.StatusCode);
            }

            var verdictJson = await response.Content.ReadAsStringAsync(cancellationToken);
            var verdict = JsonSerializer.Deserialize<CompositeEstimateResponseDto>(verdictJson, jsonOptions)
                ?? throw new HttpRequestException("Empty verdict from processing engine /composite/estimate");

            return verdict;
        }

        /// <inheritdoc/>
        public async Task<JsonElement> AnalyzeChannelsAsync(
            AnalyzeChannelsRequestDto request,
            string? userId,
            bool isAuthenticated,
            bool isAdmin,
            CancellationToken cancellationToken = default)
        {
            LogAnalyzingChannels(request.Channels.Count);

            var processingChannels = await ResolveAndMapChannelsAsync(
                request.Channels,
                userId,
                isAuthenticated,
                isAdmin,
                allowInlineMosaic: false,
                onProgress: null,
                cancellationToken);

            var processingRequest = new ProcessingAnalyzeChannelsRequest
            {
                Channels = processingChannels,
                BackgroundNeutralization = request.BackgroundNeutralization,
            };

            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            LogCallingProcessingEngine(json);

            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/composite/analyze-channels",
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

            var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
            LogChannelAnalysisComplete(request.Channels.Count);

            return JsonSerializer.Deserialize<JsonElement>(responseBody);
        }

        /// <summary>
        /// Pull the engine's `{"detail": "..."}` body off a 413 response.
        /// Falls back to the raw body if JSON parse fails.
        /// </summary>
        private static async Task<string> ReadEngineDetailAsync(
            HttpResponseMessage response,
            CancellationToken cancellationToken)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("detail", out var detail) && detail.ValueKind == JsonValueKind.String)
                {
                    return detail.GetString() ?? body;
                }
            }
            catch (JsonException)
            {
                // Not JSON — fall through
            }

            return body;
        }

        /// <summary>
        /// Capture only the X-Composite-* and X-Quality-* response headers
        /// from the processing-engine response. Other headers (Content-Type,
        /// Server, etc.) are framework concerns and stay with the bytes.
        /// </summary>
        private static Dictionary<string, string> ExtractForwardableHeaders(HttpResponseMessage response)
        {
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (name, values) in response.Headers)
            {
                if (ForwardableHeaderPrefixes.Any(p => name.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
                {
                    headers[name] = string.Join(", ", values);
                }
            }

            return headers;
        }

        // #1471 — Streaming consumer for /composite/generate-nchannel-stream.
        // Stays in this private region to keep StyleCop happy (public methods
        // first, then privates grouped by concern, statics before instances).
        private static async Task HandleProgressEventAsync(
            JsonElement root,
            Func<int, string, string, Task> onProgress)
        {
            var stage = root.TryGetProperty("stage", out var stageProp) ? stageProp.GetString() ?? string.Empty : string.Empty;
            var message = root.TryGetProperty("message", out var msgProp) ? msgProp.GetString() ?? string.Empty : string.Empty;
            var pct = ComputeProgressPct(root, stage);
            await onProgress(pct, stage, message);
        }

        private static int ComputeProgressPct(JsonElement root, string stage)
        {
            if (!StageProgressWindows.TryGetValue(stage, out var window))
            {
                return 50; // Unknown stage — pin to mid-progress as a safe default.
            }

            // Interpolate within the stage window using index/total when present.
            if (root.TryGetProperty("index", out var indexProp)
                && root.TryGetProperty("total", out var totalProp)
                && indexProp.ValueKind == JsonValueKind.Number
                && totalProp.ValueKind == JsonValueKind.Number
                && totalProp.GetInt32() > 0)
            {
                var index = indexProp.GetInt32();
                var total = totalProp.GetInt32();
                var span = window.End - window.Start;
                return window.Start + (int)Math.Round((double)index / total * span);
            }

            return window.Start;
        }

        private static void ThrowFromErrorEvent(JsonElement root)
        {
            var detail = root.TryGetProperty("detail", out var detailProp)
                ? detailProp.GetString() ?? "Unknown engine error"
                : "Unknown engine error";

            var statusCode = root.TryGetProperty("status_code", out var statusProp)
                && statusProp.ValueKind == JsonValueKind.Number
                ? statusProp.GetInt32()
                : 500;

            // Match the exception types the buffered path raises so the
            // controller's exception-mapping logic (CompositeBudgetExceeded,
            // ObservationMosaicInProgress, etc.) keeps working unchanged.
            if (statusCode == 413)
            {
                throw new CompositeBudgetExceededException(detail);
            }

            throw new HttpRequestException(
                $"Processing engine error: {statusCode} - {detail}",
                null,
                (System.Net.HttpStatusCode)statusCode);
        }

        /// <summary>
        /// Consume the engine's NDJSON streaming response. Each progress event
        /// fires onProgress; the terminal `complete` event yields the image
        /// bytes; an `error` event throws so the caller's catch handlers can
        /// translate it like a buffered failure.
        /// </summary>
        private async Task<CompositeResult> StreamNChannelCompositeAsync(
            string requestJson,
            Func<int, string, string, Task> onProgress,
            string outputFormat,
            CancellationToken cancellationToken)
        {
            using var content = new StringContent(requestJson, Encoding.UTF8, "application/json");
            using var requestMsg = new HttpRequestMessage(
                HttpMethod.Post,
                $"{processingEngineUrl}/composite/generate-nchannel-stream")
            {
                Content = content,
            };

            using var response = await httpClient.SendAsync(
                requestMsg,
                HttpCompletionOption.ResponseHeadersRead,
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

            using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var reader = new StreamReader(stream, Encoding.UTF8);

            string? line;
            while ((line = await reader.ReadLineAsync(cancellationToken)) != null)
            {
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                JsonDocument? doc;
                try
                {
                    doc = JsonDocument.Parse(line);
                }
                catch (JsonException)
                {
                    // Engine should only emit valid JSON lines. A malformed
                    // line is unrecoverable — abort rather than silently
                    // dropping it (which would mask a real engine bug).
                    LogProcessingEngineError(System.Net.HttpStatusCode.OK, $"Malformed event line: {line}");
                    throw new HttpRequestException(
                        "Processing engine emitted a malformed event line on the streaming endpoint.");
                }

                using (doc)
                {
                    var root = doc.RootElement;
                    if (!root.TryGetProperty("event", out var eventTypeProp))
                    {
                        continue;
                    }

                    var eventType = eventTypeProp.GetString();
                    switch (eventType)
                    {
                        case "progress":
                            await HandleProgressEventAsync(root, onProgress);
                            break;

                        case "complete":
                            return DecodeCompleteEvent(root, outputFormat);

                        case "error":
                            ThrowFromErrorEvent(root);
                            break;
                    }
                }
            }

            throw new HttpRequestException(
                "Processing engine stream ended without a terminal complete or error event.");
        }

        private CompositeResult DecodeCompleteEvent(JsonElement root, string outputFormat)
        {
            if (!root.TryGetProperty("image_b64", out var b64Prop)
                || b64Prop.ValueKind != JsonValueKind.String)
            {
                throw new HttpRequestException("Streaming complete event missing or non-string image_b64 field.");
            }

            var b64 = b64Prop.GetString();
            if (string.IsNullOrEmpty(b64))
            {
                throw new HttpRequestException("Streaming complete event has empty image_b64 field.");
            }

            byte[] imageBytes;
            try
            {
                imageBytes = Convert.FromBase64String(b64);
            }
            catch (FormatException ex)
            {
                throw new HttpRequestException(
                    "Streaming complete event has invalid base64-encoded image data.",
                    ex);
            }

            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (root.TryGetProperty("headers", out var headersProp)
                && headersProp.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in headersProp.EnumerateObject())
                {
                    if (ForwardableHeaderPrefixes.Any(p =>
                            prop.Name.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
                    {
                        headers[prop.Name] = prop.Value.GetString() ?? string.Empty;
                    }
                }
            }

            LogCompositeGenerated(imageBytes.Length, outputFormat);
            return new CompositeResult(imageBytes, headers);
        }

        /// <summary>
        /// Build the processing-engine request payload — DTO mapping plus
        /// data-ID → file-path resolution. Shared by Generate and Estimate so
        /// auth and inline-mosaic semantics are identical.
        /// </summary>
        private async Task<ProcessingNChannelCompositeRequest> BuildProcessingRequestAsync(
            NChannelCompositeRequestDto request,
            string? userId,
            bool isAuthenticated,
            bool isAdmin,
            bool allowInlineMosaic,
            Func<int, string, string, Task>? onProgress,
            CancellationToken cancellationToken)
        {
            var processingChannels = await ResolveAndMapChannelsAsync(
                request.Channels,
                userId,
                isAuthenticated,
                isAdmin,
                allowInlineMosaic,
                onProgress,
                cancellationToken);

            return new ProcessingNChannelCompositeRequest
            {
                Channels = processingChannels,
                Overall = CreateProcessingOverallAdjustments(request.Overall),
                Sharpening = CreateProcessingSharpening(request.Sharpening),
                Saturation = CreateProcessingSaturation(request.Saturation),
                BackgroundNeutralization = request.BackgroundNeutralization,
                FeatherStrength = request.FeatherStrength,
                RotationDegrees = request.RotationDegrees,
                CropCenterX = request.CropCenterX,
                CropCenterY = request.CropCenterY,
                CropZoom = request.CropZoom,
                OutputFormat = request.OutputFormat,
                Quality = request.Quality,
                Width = request.Width,
                Height = request.Height,
                AllowForceDownscale = request.AllowForceDownscale,
            };
        }

        /// <summary>
        /// Resolve data IDs to file paths and map DTO fields to processing
        /// channel configs. Shared by Generate, Estimate, and Analyze paths
        /// so a new field on NChannelConfigDto can't drift between callers.
        /// </summary>
        private async Task<List<ProcessingNChannelConfig>> ResolveAndMapChannelsAsync(
            List<NChannelConfigDto> channels,
            string? userId,
            bool isAuthenticated,
            bool isAdmin,
            bool allowInlineMosaic,
            Func<int, string, string, Task>? onProgress,
            CancellationToken cancellationToken)
        {
            var processingChannels = new List<ProcessingNChannelConfig>(channels.Count);

            foreach (var channel in channels)
            {
                var filePaths = await ResolveDataIdsToFilePathsAsync(
                    channel.DataIds,
                    userId,
                    isAuthenticated,
                    isAdmin,
                    allowInlineMosaic,
                    onProgress,
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
                    AutoStretch = channel.AutoStretch,
                });
            }

            return processingChannels;
        }

        // Static helpers below intentionally interleave with the instance
        // BuildProcessingRequestAsync above — the helpers are grouped by
        // purpose (DTO mapping) rather than by static vs instance.
#pragma warning disable SA1204
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

        private static ProcessingSharpeningConfig? CreateProcessingSharpening(
            SharpeningConfigDto? sharpening)
        {
            if (sharpening == null)
            {
                return null;
            }

            return new ProcessingSharpeningConfig
            {
                Radius = sharpening.Radius,
                Amount = sharpening.Amount,
                Threshold = sharpening.Threshold,
            };
        }

        private static ProcessingSaturationConfig? CreateProcessingSaturation(
            SaturationConfigDto? saturation)
        {
            if (saturation == null)
            {
                return null;
            }

            return new ProcessingSaturationConfig
            {
                Saturation = saturation.Saturation,
                Vibrancy = saturation.Vibrancy,
                HueRotation = saturation.HueRotation,
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
            Func<int, string, string, Task>? onProgress = null,
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
                onProgress,
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
            Func<int, string, string, Task>? onProgress = null,
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
                    if (onProgress != null)
                    {
                        await onProgress(
                            10,
                            "mosaic",
                            $"Building observation mosaic ({sourceDataIds.Count} files)...");
                    }

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
                        if (onProgress != null)
                        {
                            await onProgress(50, "generating", "Observation mosaic ready, generating composite...");
                        }

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
#pragma warning restore SA1204
    }
}
