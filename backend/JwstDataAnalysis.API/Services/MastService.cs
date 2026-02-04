// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;
using System.Text.Json;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class MastService : IMastService
    {
        private readonly HttpClient httpClient;
        private readonly ILogger<MastService> logger;
        private readonly string processingEngineUrl;
        private readonly JsonSerializerOptions jsonOptions;

        public MastService(
            HttpClient httpClient,
            ILogger<MastService> logger,
            IConfiguration configuration)
        {
            this.httpClient = httpClient;
            this.logger = logger;
            processingEngineUrl = configuration["ProcessingEngine:BaseUrl"]
                ?? "http://localhost:8000";

            jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                PropertyNameCaseInsensitive = true,
            };
        }

        public async Task<MastSearchResponse> SearchByTargetAsync(MastTargetSearchRequest request)
        {
            LogSearchingTarget(request.TargetName);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/target",
                new { target_name = request.TargetName, radius = request.Radius, calib_level = request.CalibLevel });
        }

        public async Task<MastSearchResponse> SearchByCoordinatesAsync(MastCoordinateSearchRequest request)
        {
            LogSearchingCoordinates(request.Ra, request.Dec);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/coordinates",
                new { ra = request.Ra, dec = request.Dec, radius = request.Radius, calib_level = request.CalibLevel });
        }

        public async Task<MastSearchResponse> SearchByObservationIdAsync(MastObservationSearchRequest request)
        {
            LogSearchingObservation(request.ObsId);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/observation",
                new { obs_id = request.ObsId, calib_level = request.CalibLevel });
        }

        public async Task<MastSearchResponse> SearchByProgramIdAsync(MastProgramSearchRequest request)
        {
            LogSearchingProgram(request.ProgramId);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/program",
                new { program_id = request.ProgramId, calib_level = request.CalibLevel });
        }

        public async Task<MastSearchResponse> SearchRecentReleasesAsync(MastRecentReleasesRequest request)
        {
            LogSearchingRecentReleases(request.DaysBack, request.Instrument ?? "all");
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/recent",
                new
                {
                    days_back = request.DaysBack,
                    instrument = request.Instrument,
                    limit = request.Limit,
                    offset = request.Offset,
                });
        }

        public async Task<MastDataProductsResponse> GetDataProductsAsync(MastDataProductsRequest request)
        {
            LogGettingDataProducts(request.ObsId);
            return await PostToProcessingEngineAsync<MastDataProductsResponse>(
                "/mast/products",
                new { obs_id = request.ObsId });
        }

        public async Task<MastDownloadResponse> DownloadObservationAsync(MastDownloadRequest request)
        {
            LogDownloadingObservation(request.ObsId);
            return await PostToProcessingEngineAsync<MastDownloadResponse>(
                "/mast/download",
                new
                {
                    obs_id = request.ObsId,
                    product_type = request.ProductType,
                    product_id = request.ProductId,
                });
        }

        /// <summary>
        /// Start an async download job in the processing engine.
        /// Returns immediately with a job ID for progress polling.
        /// </summary>
        public async Task<DownloadJobStartResponse> StartAsyncDownloadAsync(MastDownloadRequest request)
        {
            LogStartingAsyncDownload(request.ObsId);
            return await PostToProcessingEngineAsync<DownloadJobStartResponse>(
                "/mast/download/start",
                new
                {
                    obs_id = request.ObsId,
                    product_type = request.ProductType,
                });
        }

        /// <summary>
        /// Get the progress of an async download job from the processing engine.
        /// </summary>
        public async Task<DownloadJobProgress?> GetDownloadProgressAsync(string jobId)
        {
            try
            {
                var response = await httpClient.GetAsync($"{processingEngineUrl}/mast/download/progress/{jobId}");
                var responseJson = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    LogFailedToGetDownloadProgress(jobId, response.StatusCode);
                    return null;
                }

                return JsonSerializer.Deserialize<DownloadJobProgress>(responseJson, jsonOptions);
            }
            catch (Exception ex)
            {
                LogErrorGettingDownloadProgress(ex, jobId);
                return null;
            }
        }

        /// <summary>
        /// Start a chunked download job with byte-level progress tracking.
        /// </summary>
        public async Task<ChunkedDownloadStartResponse> StartChunkedDownloadAsync(ChunkedDownloadRequest request)
        {
            LogStartingChunkedDownload(request.ObsId);
            return await PostToProcessingEngineAsync<ChunkedDownloadStartResponse>(
                "/mast/download/start-chunked",
                new
                {
                    obs_id = request.ObsId,
                    product_type = request.ProductType,
                    resume_job_id = request.ResumeJobId,
                    calib_level = request.CalibLevel,
                });
        }

        /// <summary>
        /// Resume a paused or failed download job.
        /// </summary>
        public async Task<PauseResumeResponse> ResumeDownloadAsync(string jobId)
        {
            LogResumingDownload(jobId);
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/mast/download/resume/{jobId}",
                new StringContent("{}", Encoding.UTF8, "application/json"));

            var responseJson = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                LogFailedToResumeDownload(jobId, response.StatusCode);
                throw new HttpRequestException(
                    $"Failed to resume download: {response.StatusCode} - {responseJson}",
                    null,
                    response.StatusCode);
            }

            return JsonSerializer.Deserialize<PauseResumeResponse>(responseJson, jsonOptions)
                ?? throw new InvalidOperationException("Failed to deserialize response");
        }

        /// <summary>
        /// Pause an active download job.
        /// </summary>
        public async Task<PauseResumeResponse> PauseDownloadAsync(string jobId)
        {
            LogPausingDownload(jobId);
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/mast/download/pause/{jobId}",
                new StringContent("{}", Encoding.UTF8, "application/json"));

            var responseJson = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                LogFailedToPauseDownload(jobId, response.StatusCode);
                throw new HttpRequestException($"Failed to pause download: {response.StatusCode} - {responseJson}");
            }

            return JsonSerializer.Deserialize<PauseResumeResponse>(responseJson, jsonOptions)
                ?? throw new InvalidOperationException("Failed to deserialize response");
        }

        /// <summary>
        /// Get detailed byte-level progress for a chunked download job.
        /// </summary>
        public async Task<DownloadJobProgress?> GetChunkedDownloadProgressAsync(string jobId)
        {
            try
            {
                var response = await httpClient.GetAsync($"{processingEngineUrl}/mast/download/progress-chunked/{jobId}");
                var responseJson = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    LogFailedToGetChunkedProgress(jobId, response.StatusCode);
                    return null;
                }

                return JsonSerializer.Deserialize<DownloadJobProgress>(responseJson, jsonOptions);
            }
            catch (Exception ex)
            {
                LogErrorGettingChunkedProgress(ex, jobId);
                return null;
            }
        }

        /// <summary>
        /// List all downloads that can be resumed.
        /// </summary>
        public async Task<ResumableJobsResponse?> GetResumableDownloadsAsync()
        {
            try
            {
                var response = await httpClient.GetAsync($"{processingEngineUrl}/mast/download/resumable");
                var responseJson = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    LogFailedToGetResumableDownloads(response.StatusCode);
                    return null;
                }

                return JsonSerializer.Deserialize<ResumableJobsResponse>(responseJson, jsonOptions);
            }
            catch (Exception ex)
            {
                LogErrorGettingResumableDownloads(ex);
                return null;
            }
        }

        private async Task<T> PostToProcessingEngineAsync<T>(string endpoint, object request)
        {
            try
            {
                var json = JsonSerializer.Serialize(request, jsonOptions);
                LogCallingProcessingEngine(endpoint, json);

                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var response = await httpClient.PostAsync(
                    $"{processingEngineUrl}{endpoint}",
                    content);

                var responseJson = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    LogProcessingEngineError(response.StatusCode, responseJson);
                    throw new HttpRequestException($"Processing engine error: {response.StatusCode} - {responseJson}");
                }

                var result = JsonSerializer.Deserialize<T>(responseJson, jsonOptions) ?? throw new InvalidOperationException("Failed to deserialize response from processing engine");

                return result;
            }
            catch (HttpRequestException ex)
            {
                LogHttpErrorCallingEngine(ex, endpoint);
                throw;
            }
            catch (Exception ex)
            {
                LogErrorCallingEngine(ex, endpoint);
                throw;
            }
        }
    }
}
