// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;
using System.Text.Json;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class DiscoveryService : IDiscoveryService
    {
        private readonly HttpClient httpClient;
        private readonly ILogger<DiscoveryService> logger;
        private readonly string processingEngineUrl;
        private readonly List<FeaturedTarget> featuredTargets;
        private readonly JsonSerializerOptions jsonOptions;

        public DiscoveryService(
            HttpClient httpClient,
            ILogger<DiscoveryService> logger,
            IConfiguration configuration,
            IWebHostEnvironment environment)
        {
            this.httpClient = httpClient;
            this.logger = logger;
            processingEngineUrl = configuration["ProcessingEngine:BaseUrl"]
                ?? "http://localhost:8000";

            jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                PropertyNameCaseInsensitive = true,
            };

            // Load featured targets from embedded JSON config
            var configPath = Path.Combine(
                environment.ContentRootPath,
                "Configuration",
                "featured-targets.json");

            if (File.Exists(configPath))
            {
                var json = File.ReadAllText(configPath);
                featuredTargets = JsonSerializer.Deserialize<List<FeaturedTarget>>(json, jsonOptions) ?? [];
                LogFeaturedTargetsLoaded(featuredTargets.Count);
            }
            else
            {
                LogFeaturedTargetsNotFound(configPath);
                featuredTargets = [];
            }
        }

        /// <inheritdoc/>
        public List<FeaturedTarget> GetFeaturedTargets() => featuredTargets;

        /// <inheritdoc/>
        public async Task<SuggestRecipesResponseDto> SuggestRecipesAsync(SuggestRecipesRequestDto request)
        {
            LogSuggestingRecipes(request.TargetName ?? "from observations");

            var proxyOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                PropertyNameCaseInsensitive = true,
            };

            var json = JsonSerializer.Serialize(request, proxyOptions);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/discovery/suggest-recipes",
                content);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                LogRecipeEngineError(response.StatusCode, errorBody);
                throw new HttpRequestException(
                    $"Recipe engine error: {response.StatusCode} - {errorBody}",
                    null,
                    response.StatusCode);
            }

            var responseJson = await response.Content.ReadAsStringAsync();
            var result = JsonSerializer.Deserialize<SuggestRecipesResponseDto>(responseJson, proxyOptions)
                ?? throw new InvalidOperationException("Recipe engine returned null response");

            LogRecipesGenerated(result.Recipes.Count);
            return result;
        }

        [LoggerMessage(Level = LogLevel.Information, Message = "Loaded {Count} featured targets from config")]
        private partial void LogFeaturedTargetsLoaded(int count);

        [LoggerMessage(Level = LogLevel.Warning, Message = "Featured targets config not found at {Path}")]
        private partial void LogFeaturedTargetsNotFound(string path);

        [LoggerMessage(Level = LogLevel.Information, Message = "Suggesting recipes for target: {TargetName}")]
        private partial void LogSuggestingRecipes(string targetName);

        [LoggerMessage(Level = LogLevel.Error, Message = "Recipe engine error: {StatusCode} - {ErrorBody}")]
        private partial void LogRecipeEngineError(System.Net.HttpStatusCode statusCode, string errorBody);

        [LoggerMessage(Level = LogLevel.Information, Message = "Recipe engine returned {Count} recipes")]
        private partial void LogRecipesGenerated(int count);
    }
}
