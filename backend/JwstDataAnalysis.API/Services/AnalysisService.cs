// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;
using System.Text.Json;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class AnalysisService : IAnalysisService
    {
        private readonly HttpClient httpClient;
        private readonly IMongoDBService mongoDBService;
        private readonly ILogger<AnalysisService> logger;
        private readonly string processingEngineUrl;
        private readonly string dataBasePath;
        private readonly JsonSerializerOptions jsonOptions;

        public AnalysisService(
            HttpClient httpClient,
            IMongoDBService mongoDBService,
            ILogger<AnalysisService> logger,
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
        public async Task<RegionStatisticsResponseDto> GetRegionStatisticsAsync(
            RegionStatisticsRequestDto request)
        {
            LogComputingRegionStatistics(request.DataId, request.RegionType);

            // Resolve data ID to file path
            var filePath = await ResolveDataIdToFilePathAsync(request.DataId);

            // Build processing engine request
            var processingRequest = new ProcessingRegionStatisticsRequest
            {
                FilePath = filePath,
                RegionType = request.RegionType,
                HduIndex = request.HduIndex,
            };

            if (request.Rectangle != null)
            {
                processingRequest.Rectangle = new ProcessingRectangleRegion
                {
                    X = request.Rectangle.X,
                    Y = request.Rectangle.Y,
                    Width = request.Rectangle.Width,
                    Height = request.Rectangle.Height,
                };
            }

            if (request.Ellipse != null)
            {
                processingRequest.Ellipse = new ProcessingEllipseRegion
                {
                    Cx = request.Ellipse.CenterX,
                    Cy = request.Ellipse.CenterY,
                    Rx = request.Ellipse.RadiusX,
                    Ry = request.Ellipse.RadiusY,
                };
            }

            // Call processing engine
            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/analysis/region-statistics",
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

            var responseJson = await response.Content.ReadAsStringAsync();
            var result = JsonSerializer.Deserialize<RegionStatisticsResponseDto>(
                responseJson, jsonOptions);

            if (result == null)
            {
                throw new InvalidOperationException("Failed to deserialize region statistics response");
            }

            LogRegionStatisticsComputed(result.PixelCount, result.Mean);
            return result;
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

            var relativePath = ConvertToRelativePath(data.FilePath);
            return relativePath;
        }

        private string ConvertToRelativePath(string absolutePath)
        {
            const string dataPrefix = "/app/data/";
            if (absolutePath.StartsWith(dataPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return absolutePath[dataPrefix.Length..];
            }

            if (absolutePath.StartsWith(dataBasePath, StringComparison.OrdinalIgnoreCase))
            {
                var relative = absolutePath[dataBasePath.Length..].TrimStart('/');
                return $"mast/{relative}";
            }

            return absolutePath;
        }
    }
}
