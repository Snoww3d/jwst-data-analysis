using System.Text;
using System.Text.Json;
using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    public class MastService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<MastService> _logger;
        private readonly string _processingEngineUrl;
        private readonly JsonSerializerOptions _jsonOptions;

        public MastService(
            HttpClient httpClient,
            ILogger<MastService> logger,
            IConfiguration configuration)
        {
            _httpClient = httpClient;
            _logger = logger;
            _processingEngineUrl = configuration["ProcessingEngine:BaseUrl"]
                ?? "http://localhost:8000";

            _jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                PropertyNameCaseInsensitive = true
            };
        }

        public async Task<MastSearchResponse> SearchByTargetAsync(MastTargetSearchRequest request)
        {
            _logger.LogInformation("Searching MAST for target: {Target}", request.TargetName);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/target",
                new { target_name = request.TargetName, radius = request.Radius }
            );
        }

        public async Task<MastSearchResponse> SearchByCoordinatesAsync(MastCoordinateSearchRequest request)
        {
            _logger.LogInformation("Searching MAST at RA={Ra}, Dec={Dec}", request.Ra, request.Dec);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/coordinates",
                new { ra = request.Ra, dec = request.Dec, radius = request.Radius }
            );
        }

        public async Task<MastSearchResponse> SearchByObservationIdAsync(MastObservationSearchRequest request)
        {
            _logger.LogInformation("Searching MAST for observation ID: {ObsId}", request.ObsId);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/observation",
                new { obs_id = request.ObsId }
            );
        }

        public async Task<MastSearchResponse> SearchByProgramIdAsync(MastProgramSearchRequest request)
        {
            _logger.LogInformation("Searching MAST for program ID: {ProgramId}", request.ProgramId);
            return await PostToProcessingEngineAsync<MastSearchResponse>(
                "/mast/search/program",
                new { program_id = request.ProgramId }
            );
        }

        public async Task<MastDataProductsResponse> GetDataProductsAsync(MastDataProductsRequest request)
        {
            _logger.LogInformation("Getting data products for observation: {ObsId}", request.ObsId);
            return await PostToProcessingEngineAsync<MastDataProductsResponse>(
                "/mast/products",
                new { obs_id = request.ObsId }
            );
        }

        public async Task<MastDownloadResponse> DownloadObservationAsync(MastDownloadRequest request)
        {
            _logger.LogInformation("Downloading observation: {ObsId}", request.ObsId);
            return await PostToProcessingEngineAsync<MastDownloadResponse>(
                "/mast/download",
                new
                {
                    obs_id = request.ObsId,
                    product_type = request.ProductType,
                    product_id = request.ProductId
                }
            );
        }

        private async Task<T> PostToProcessingEngineAsync<T>(string endpoint, object request)
        {
            try
            {
                var json = JsonSerializer.Serialize(request, _jsonOptions);
                _logger.LogDebug("Calling processing engine: {Endpoint} with body: {Body}", endpoint, json);

                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var response = await _httpClient.PostAsync(
                    $"{_processingEngineUrl}{endpoint}",
                    content
                );

                var responseJson = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError("Processing engine returned {StatusCode}: {Response}",
                        response.StatusCode, responseJson);
                    throw new HttpRequestException($"Processing engine error: {response.StatusCode} - {responseJson}");
                }

                var result = JsonSerializer.Deserialize<T>(responseJson, _jsonOptions);
                if (result == null)
                {
                    throw new InvalidOperationException("Failed to deserialize response from processing engine");
                }

                return result;
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "HTTP error calling processing engine at {Endpoint}", endpoint);
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error calling processing engine at {Endpoint}", endpoint);
                throw;
            }
        }
    }
}
