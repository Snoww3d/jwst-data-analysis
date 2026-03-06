// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;
using System.Text.Json;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public sealed partial class SemanticSearchService : ISemanticSearchService
    {
        private readonly HttpClient httpClient;
        private readonly IMongoDBService mongoDBService;
        private readonly ILogger<SemanticSearchService> logger;
        private readonly string processingEngineUrl;

        private readonly JsonSerializerOptions jsonOptions = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            PropertyNameCaseInsensitive = true,
        };

        public SemanticSearchService(
            HttpClient httpClient,
            IMongoDBService mongoDBService,
            ILogger<SemanticSearchService> logger,
            IConfiguration configuration)
        {
            this.httpClient = httpClient;
            this.mongoDBService = mongoDBService;
            this.logger = logger;
            processingEngineUrl = configuration["ProcessingEngine:BaseUrl"]
                ?? "http://localhost:8000";
        }

        /// <inheritdoc/>
        public async Task<SemanticSearchResponse> SearchAsync(
            string query, int topK, double minScore, string? userId, bool isAdmin)
        {
            LogSearching(query, topK);

            var searchBody = new { query, top_k = topK, min_score = minScore };
            var json = JsonSerializer.Serialize(searchBody, jsonOptions);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/semantic/search", content);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                LogPythonError("search", response.StatusCode, errorBody);
                throw new HttpRequestException(
                    $"Semantic search error: {response.StatusCode}",
                    null,
                    response.StatusCode);
            }

            var responseJson = await response.Content.ReadAsStringAsync();
            var pythonResponse = JsonSerializer.Deserialize<PythonSearchResponse>(responseJson, jsonOptions)
                ?? throw new InvalidOperationException("Python returned null search response");

            // Enrich results from MongoDB with access control
            var enriched = new List<SemanticSearchResult>();
            foreach (var result in pythonResponse.Results)
            {
                try
                {
                    var doc = await mongoDBService.GetAsync(result.FileId);
                    if (doc == null)
                    {
                        continue;
                    }

                    // Access control: skip files the user can't see
                    if (!isAdmin && !doc.IsPublic && doc.UserId != userId
                        && (userId == null || !doc.SharedWith.Contains(userId)))
                    {
                        continue;
                    }

                    enriched.Add(new SemanticSearchResult
                    {
                        Id = doc.Id,
                        FileName = doc.FileName,
                        Score = result.Score,
                        MatchedText = result.MatchedText,
                        TargetName = doc.ImageInfo?.TargetName,
                        Instrument = doc.ImageInfo?.Instrument,
                        Filter = doc.ImageInfo?.Filter,
                        ProcessingLevel = doc.ProcessingLevel,
                        WavelengthRange = doc.ImageInfo?.WavelengthRange,
                        ExposureTime = doc.ImageInfo?.ExposureTime,
                        ThumbnailData = doc.ThumbnailData,
                    });
                }
                catch (Exception ex)
                {
                    LogEnrichmentError(result.FileId, ex.Message);
                }
            }

            LogSearchComplete(query, enriched.Count, pythonResponse.EmbedTimeMs, pythonResponse.SearchTimeMs);

            return new SemanticSearchResponse
            {
                Results = enriched,
                Query = pythonResponse.Query,
                EmbedTimeMs = pythonResponse.EmbedTimeMs,
                SearchTimeMs = pythonResponse.SearchTimeMs,
                TotalIndexed = pythonResponse.TotalIndexed,
                ResultCount = enriched.Count,
            };
        }

        /// <inheritdoc/>
        public async Task<IndexStatusResponse> GetIndexStatusAsync()
        {
            var response = await httpClient.GetAsync(
                $"{processingEngineUrl}/semantic/index-status");

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                LogPythonError("index-status", response.StatusCode, errorBody);
                throw new HttpRequestException(
                    $"Index status error: {response.StatusCode}",
                    null,
                    response.StatusCode);
            }

            var json = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<IndexStatusResponse>(json, jsonOptions)
                ?? throw new InvalidOperationException("Python returned null index status");
        }

        /// <inheritdoc/>
        public async Task<EmbedBatchResponse> EmbedBatchAsync(List<string> fileIds)
        {
            LogEmbeddingBatch(fileIds.Count);

            // Fetch documents from MongoDB
            var metadataList = new List<FileEmbeddingMetadata>();
            foreach (var fileId in fileIds)
            {
                try
                {
                    var doc = await mongoDBService.GetAsync(fileId);
                    if (doc != null)
                    {
                        metadataList.Add(MapToEmbeddingMetadata(doc));
                    }
                }
                catch (Exception ex)
                {
                    LogEnrichmentError(fileId, ex.Message);
                }
            }

            if (metadataList.Count == 0)
            {
                return new EmbedBatchResponse { EmbeddedCount = 0, TotalIndexed = 0 };
            }

            return await SendBatchToEngine(metadataList);
        }

        /// <inheritdoc/>
        public async Task<EmbedBatchResponse> ReindexAllAsync()
        {
            LogReindexStarted();

            var allDocs = await mongoDBService.GetAsync();
            var metadataList = allDocs
                .Select(MapToEmbeddingMetadata)
                .ToList();

            if (metadataList.Count == 0)
            {
                return new EmbedBatchResponse { EmbeddedCount = 0, TotalIndexed = 0 };
            }

            var result = await SendBatchToEngine(metadataList);
            LogReindexComplete(result.EmbeddedCount, result.TotalIndexed);
            return result;
        }

        private async Task<EmbedBatchResponse> SendBatchToEngine(List<FileEmbeddingMetadata> items)
        {
            var body = new { items };
            var json = JsonSerializer.Serialize(body, jsonOptions);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/semantic/embed-batch", content);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                LogPythonError("embed-batch", response.StatusCode, errorBody);
                throw new HttpRequestException(
                    $"Embed batch error: {response.StatusCode}",
                    null,
                    response.StatusCode);
            }

            var responseJson = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<EmbedBatchResponse>(responseJson, jsonOptions)
                ?? throw new InvalidOperationException("Python returned null embed response");
        }

        private FileEmbeddingMetadata MapToEmbeddingMetadata(JwstDataModel doc)
        {
            return new FileEmbeddingMetadata
            {
                FileId = doc.Id,
                TargetName = doc.ImageInfo?.TargetName,
                Instrument = doc.ImageInfo?.Instrument,
                FilterName = doc.ImageInfo?.Filter,
                ExposureTime = doc.ImageInfo?.ExposureTime,
                WavelengthRange = doc.ImageInfo?.WavelengthRange,
                ProcessingLevel = doc.ProcessingLevel,
                CalibrationLevel = doc.ImageInfo?.CalibrationLevel,
                ObservationDate = doc.ImageInfo?.ObservationDate?.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                ProposalPi = doc.ImageInfo?.ProposalPi,
                ProposalId = doc.ImageInfo?.ProposalId,
                ObservationTitle = doc.ImageInfo?.ObservationTitle,
                DataType = doc.DataType,
                FileName = doc.FileName,
            };
        }

        [LoggerMessage(Level = LogLevel.Debug, Message = "Semantic search: '{Query}' (topK={TopK})")]
        private partial void LogSearching(string query, int topK);

        [LoggerMessage(Level = LogLevel.Debug,
            Message = "Search complete: '{Query}' returned {Count} results (embed: {EmbedMs}ms, search: {SearchMs}ms)")]
        private partial void LogSearchComplete(string query, int count, double embedMs, double searchMs);

        [LoggerMessage(Level = LogLevel.Error,
            Message = "Python semantic engine error on {Endpoint}: {StatusCode} - {ErrorBody}")]
        private partial void LogPythonError(string endpoint, System.Net.HttpStatusCode statusCode, string errorBody);

        [LoggerMessage(Level = LogLevel.Warning, Message = "Failed to enrich result {FileId}: {Error}")]
        private partial void LogEnrichmentError(string fileId, string error);

        [LoggerMessage(Level = LogLevel.Information, Message = "Embedding batch of {Count} files")]
        private partial void LogEmbeddingBatch(int count);

        [LoggerMessage(Level = LogLevel.Information, Message = "Full re-index started")]
        private partial void LogReindexStarted();

        [LoggerMessage(Level = LogLevel.Information,
            Message = "Re-index complete: {Embedded} embedded, {Total} total in index")]
        private partial void LogReindexComplete(int embedded, int total);
    }
}
