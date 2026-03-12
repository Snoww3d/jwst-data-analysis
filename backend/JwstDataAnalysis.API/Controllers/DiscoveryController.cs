// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// Controller for the guided discovery experience.
    /// Serves featured targets and proxies to the suggestion/recipe engine.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [AllowAnonymous]
    public partial class DiscoveryController(
        IDiscoveryService discoveryService,
        ILogger<DiscoveryController> logger) : ApiControllerBase
    {
        private readonly IDiscoveryService discoveryService = discoveryService;
        private readonly ILogger<DiscoveryController> logger = logger;

        /// <summary>
        /// Get the curated list of featured targets for the discovery home page.
        /// </summary>
        /// <returns>List of featured targets with metadata and MAST search params.</returns>
        /// <response code="200">Returns the featured targets list.</response>
        [HttpGet("featured")]
        [ProducesResponseType(typeof(List<FeaturedTarget>), StatusCodes.Status200OK)]
        public IActionResult GetFeaturedTargets()
        {
            LogFetchingFeaturedTargets();
            var targets = discoveryService.GetFeaturedTargets();
            return Ok(targets);
        }

        /// <summary>
        /// Generate composite recipe suggestions for a target.
        /// Proxies to the Python processing engine's suggestion endpoint.
        /// </summary>
        /// <param name="request">Target name or pre-fetched observations.</param>
        /// <returns>Ranked list of composite recipes.</returns>
        /// <response code="200">Returns recipe suggestions.</response>
        /// <response code="400">Invalid request (no target name or observations).</response>
        /// <response code="503">Processing engine unavailable.</response>
        [HttpPost("suggest-recipes")]
        [ProducesResponseType(typeof(SuggestRecipesResponseDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> SuggestRecipes([FromBody] SuggestRecipesRequestDto request)
        {
            if (string.IsNullOrWhiteSpace(request.TargetName)
                && (request.Observations == null || request.Observations.Count == 0))
            {
                return BadRequest(new { error = "Either targetName or observations must be provided" });
            }

            try
            {
                var target = request.TargetName ?? $"{request.Observations?.Count} observations";
                LogSuggestingRecipes(target);
                var result = await discoveryService.SuggestRecipesAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                LogRecipeEngineError(ex);
                return StatusCode(503, new { error = "Recipe engine unavailable" });
            }
            catch (InvalidOperationException ex)
            {
                LogInvalidOperation(ex.Message);
                return BadRequest(new { error = ex.Message });
            }
        }

        [LoggerMessage(Level = LogLevel.Information, Message = "Fetching featured targets")]
        private partial void LogFetchingFeaturedTargets();

        [LoggerMessage(Level = LogLevel.Information, Message = "Suggesting recipes for: {Target}")]
        private partial void LogSuggestingRecipes(string target);

        [LoggerMessage(Level = LogLevel.Error, Message = "Recipe engine error")]
        private partial void LogRecipeEngineError(Exception ex);

        [LoggerMessage(Level = LogLevel.Warning, Message = "Invalid operation: {Message}")]
        private partial void LogInvalidOperation(string message);
    }
}
