//

using System.Text;
using System.Text.Json;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    public class MastService
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
            logger.LogInformation("Searching MAST for target: {Target}", request.TargetName);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/target",
                new { target_name = request.TargetName, radius = request.Radius });
        }

        public async Task<MastSearchResponse> SearchByCoordinatesAsync(MastCoordinateSearchRequest request)
        {
            logger.LogInformation("Searching MAST at RA={Ra}, Dec={Dec}", request.Ra, request.Dec);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/coordinates",
                new { ra = request.Ra, dec = request.Dec, radius = request.Radius });
        }

        public async Task<MastSearchResponse> SearchByObservationIdAsync(MastObservationSearchRequest request)
        {
            logger.LogInformation("Searching MAST for observation ID: {ObsId}", request.ObsId);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/observation",
                new { obs_id = request.ObsId });
        }

        public async Task<MastSearchResponse> SearchByProgramIdAsync(MastProgramSearchRequest request)
        {
            logger.LogInformation("Searching MAST for program ID: {ProgramId}", request.ProgramId);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/program",
                new { program_id = request.ProgramId });
        }

        public async Task<MastSearchResponse> SearchRecentReleasesAsync(MastRecentReleasesRequest request)
        {
            logger.LogInformation(
                "Searching MAST for recent releases: {DaysBack} days, instrument: {Instrument}",
                request.DaysBack, request.Instrument ?? "all");
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
            logger.LogInformation("Getting data products for observation: {ObsId}", request.ObsId);
            return await PostToProcessingEngineAsync<MastDataProductsResponse>(
                "/mast/products",
                new { obs_id = request.ObsId });
        }

        public async Task<MastDownloadResponse> DownloadObservationAsync(MastDownloadRequest request)
        {
            logger.LogInformation("Downloading observation: {ObsId}", request.ObsId);
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
            logger.LogInformation("Starting async download for observation: {ObsId}", request.ObsId);
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
                    logger.LogWarning(
                        "Failed to get download progress for job {JobId}: {Status}",
                        jobId, response.StatusCode);
                    return null;
                }

                return JsonSerializer.Deserialize<DownloadJobProgress>(responseJson, jsonOptions);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error getting download progress for job {JobId}", jobId);
                return null;
            }
        }

        /// <summary>
        /// Start a chunked download job with byte-level progress tracking.
        /// </summary>
        public async Task<ChunkedDownloadStartResponse> StartChunkedDownloadAsync(ChunkedDownloadRequest request)
        {
            logger.LogInformation("Starting chunked download for observation: {ObsId}", request.ObsId);
            return await PostToProcessingEngineAsync<ChunkedDownloadStartResponse>(
                "/mast/download/start-chunked",
                new
                {
                    obs_id = request.ObsId,
                    product_type = request.ProductType,
                    resume_job_id = request.ResumeJobId,
                });
        }

        /// <summary>
        /// Resume a paused or failed download job.
        /// </summary>
        public async Task<PauseResumeResponse> ResumeDownloadAsync(string jobId)
        {
            logger.LogInformation("Resuming download for job: {JobId}", jobId);
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/mast/download/resume/{jobId}",
                new StringContent("{}", Encoding.UTF8, "application/json"));

            var responseJson = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                logger.LogError(
                    "Failed to resume download for job {JobId}: {Status}",
                    jobId, response.StatusCode);
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
            logger.LogInformation("Pausing download for job: {JobId}", jobId);
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/mast/download/pause/{jobId}",
                new StringContent("{}", Encoding.UTF8, "application/json"));

            var responseJson = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                logger.LogError(
                    "Failed to pause download for job {JobId}: {Status}",
                    jobId, response.StatusCode);
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
                    logger.LogWarning(
                        "Failed to get chunked download progress for job {JobId}: {Status}",
                        jobId, response.StatusCode);
                    return null;
                }

                return JsonSerializer.Deserialize<DownloadJobProgress>(responseJson, jsonOptions);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error getting chunked download progress for job {JobId}", jobId);
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
                    logger.LogWarning("Failed to get resumable downloads: {Status}", response.StatusCode);
                    return null;
                }

                return JsonSerializer.Deserialize<ResumableJobsResponse>(responseJson, jsonOptions);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error getting resumable downloads");
                return null;
            }
        }

        private async Task<T> PostToProcessingEngineAsync<T>(string endpoint, object request)
        {
            try
            {
                var json = JsonSerializer.Serialize(request, jsonOptions);
                logger.LogDebug("Calling processing engine: {Endpoint} with body: {Body}", endpoint, json);

                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var response = await httpClient.PostAsync(
                    $"{processingEngineUrl}{endpoint}",
                    content);

                var responseJson = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    logger.LogError(
                        "Processing engine returned {StatusCode}: {Response}",
                        response.StatusCode, responseJson);
                    throw new HttpRequestException($"Processing engine error: {response.StatusCode} - {responseJson}");
                }

                var result = JsonSerializer.Deserialize<T>(responseJson, jsonOptions);
                if (result == null)
                {
                    throw new InvalidOperationException("Failed to deserialize response from processing engine");
                }

                return result;
            }
            catch (HttpRequestException ex)
            {
                logger.LogError(ex, "HTTP error calling processing engine at {Endpoint}", endpoint);
                throw;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error calling processing engine at {Endpoint}", endpoint);
                throw;
            }
        }
    }
}
