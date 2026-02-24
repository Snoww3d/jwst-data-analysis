// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;
using System.Text.Json;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services.Storage;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class AnalysisService : IAnalysisService
    {
        private readonly HttpClient httpClient;
        private readonly IMongoDBService mongoDBService;
        private readonly ILogger<AnalysisService> logger;
        private readonly string processingEngineUrl;
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

        /// <inheritdoc/>
        public async Task<SourceDetectionResponseDto> DetectSourcesAsync(
            SourceDetectionRequestDto request)
        {
            LogDetectingSources(request.DataId, request.Method);

            // Resolve data ID to file path
            var filePath = await ResolveDataIdToFilePathAsync(request.DataId);

            // Build processing engine request
            var processingRequest = new ProcessingSourceDetectionRequest
            {
                FilePath = filePath,
                ThresholdSigma = request.ThresholdSigma,
                Fwhm = request.Fwhm,
                Method = request.Method,
                Npixels = request.Npixels,
                Deblend = request.Deblend,
            };

            // Call processing engine
            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/analysis/detect-sources",
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
            var result = JsonSerializer.Deserialize<SourceDetectionResponseDto>(
                responseJson, jsonOptions);

            if (result == null)
            {
                throw new InvalidOperationException("Failed to deserialize source detection response");
            }

            LogSourcesDetected(result.NSources, result.Method);
            return result;
        }

        /// <inheritdoc/>
        public async Task<TableInfoResponseDto> GetTableInfoAsync(string dataId)
        {
            LogGettingTableInfo(dataId);

            var filePath = await ResolveDataIdToFilePathAsync(dataId);

            var response = await httpClient.GetAsync(
                $"{processingEngineUrl}/analysis/table-info?file_path={Uri.EscapeDataString(filePath)}");

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
            var result = JsonSerializer.Deserialize<TableInfoResponseDto>(responseJson, jsonOptions);

            if (result == null)
            {
                throw new InvalidOperationException("Failed to deserialize table info response");
            }

            LogTableInfoRetrieved(result.TableHdus.Count);
            return result;
        }

        /// <inheritdoc/>
        public async Task<TableDataResponseDto> GetTableDataAsync(
            string dataId,
            int hduIndex = 0,
            int page = 0,
            int pageSize = 100,
            string? sortColumn = null,
            string? sortDirection = null,
            string? search = null)
        {
            LogGettingTableData(dataId, hduIndex);

            var filePath = await ResolveDataIdToFilePathAsync(dataId);

            var queryParams = $"file_path={Uri.EscapeDataString(filePath)}" +
                $"&hdu_index={hduIndex}" +
                $"&page={page}" +
                $"&page_size={pageSize}";

            if (!string.IsNullOrEmpty(sortColumn))
            {
                queryParams += $"&sort_column={Uri.EscapeDataString(sortColumn)}";
            }

            if (!string.IsNullOrEmpty(sortDirection))
            {
                queryParams += $"&sort_direction={Uri.EscapeDataString(sortDirection)}";
            }

            if (!string.IsNullOrEmpty(search))
            {
                queryParams += $"&search={Uri.EscapeDataString(search)}";
            }

            var response = await httpClient.GetAsync(
                $"{processingEngineUrl}/analysis/table-data?{queryParams}");

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
            var result = JsonSerializer.Deserialize<TableDataResponseDto>(responseJson, jsonOptions);

            if (result == null)
            {
                throw new InvalidOperationException("Failed to deserialize table data response");
            }

            LogTableDataRetrieved(result.TotalRows, result.Page);
            return result;
        }

        /// <inheritdoc/>
        public async Task<SpectralDataResponseDto> GetSpectralDataAsync(
            string dataId, int hduIndex = 1)
        {
            LogGettingSpectralData(dataId, hduIndex);

            var filePath = await ResolveDataIdToFilePathAsync(dataId);

            var response = await httpClient.GetAsync(
                $"{processingEngineUrl}/analysis/spectral-data?file_path={Uri.EscapeDataString(filePath)}&hdu_index={hduIndex}");

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
            var result = JsonSerializer.Deserialize<SpectralDataResponseDto>(responseJson, jsonOptions);

            if (result == null)
            {
                throw new InvalidOperationException("Failed to deserialize spectral data response");
            }

            LogSpectralDataRetrieved(result.NPoints);
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

            var relativePath = StorageKeyHelper.ToRelativeKey(data.FilePath);
            return relativePath;
        }
    }
}
