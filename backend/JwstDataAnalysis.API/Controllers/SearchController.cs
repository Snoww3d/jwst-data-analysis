// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// Controller for semantic search over FITS file metadata.
    /// Proxies queries to the Python embedding engine and enriches results from MongoDB.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public sealed partial class SearchController(
        ISemanticSearchService searchService,
        EmbeddingQueue embeddingQueue,
        IJobTracker jobTracker,
        ILogger<SearchController> logger) : ApiControllerBase
    {
        /// <summary>
        /// Search FITS files using natural language queries.
        /// Returns results ranked by semantic similarity with enriched metadata.
        /// </summary>
        /// <param name="q">Natural language search query.</param>
        /// <param name="topK">Maximum number of results (default 20, max 100).</param>
        /// <param name="minScore">Minimum similarity score 0-1 (default 0.3).</param>
        /// <response code="200">Search results with relevance scores.</response>
        /// <response code="400">Missing or invalid query.</response>
        /// <response code="503">Python processing engine unavailable.</response>
        [HttpGet("semantic")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(SemanticSearchResponse), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> SemanticSearch(
            [FromQuery] string q,
            [FromQuery] int topK = 20,
            [FromQuery] double minScore = 0.3)
        {
            if (string.IsNullOrWhiteSpace(q))
            {
                return BadRequest(new { error = "Query parameter 'q' is required" });
            }

            if (q.Length > 500)
            {
                return BadRequest(new { error = "Query must be 500 characters or less" });
            }

            topK = Math.Clamp(topK, 1, 100);
            minScore = Math.Clamp(minScore, 0.0, 1.0);

            try
            {
                var userId = GetCurrentUserId();
                var isAdmin = IsCurrentUserAdmin();

                LogSearchRequested(q, topK);
                var result = await searchService.SearchAsync(q, topK, minScore, userId, isAdmin);
                return Ok(result);
            }
            catch (HttpRequestException)
            {
                LogEngineUnavailable("search");
                return StatusCode(503, new { error = "Semantic search engine unavailable" });
            }
        }

        /// <summary>
        /// Trigger a full re-index of all FITS files in the semantic search index.
        /// Admin only.
        /// </summary>
        /// <response code="202">Re-index job queued.</response>
        /// <response code="403">Not an admin.</response>
        /// <response code="429">Queue is full.</response>
        [HttpPost("reindex")]
        [Authorize(Policy = "AdminOnly")]
        [ProducesResponseType(StatusCodes.Status202Accepted)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public async Task<IActionResult> TriggerReindex()
        {
            var userId = GetRequiredUserId();
            var job = await jobTracker.CreateJobAsync("semantic-reindex", "Semantic search re-index", userId);
            var jobId = job.JobId;

            var enqueued = embeddingQueue.TryEnqueue(new EmbeddingJobItem
            {
                JobId = jobId,
                FileIds = [],
                IsFullReindex = true,
            });

            if (!enqueued)
            {
                await jobTracker.FailJobAsync(jobId, "Queue is full");
                LogQueueFull();
                return StatusCode(429, new { error = "Embedding queue is full. Try again later." });
            }

            LogReindexQueued(jobId);
            return Accepted(new { jobId, message = "Re-index job queued" });
        }

        /// <summary>
        /// Get the current status of the semantic search index.
        /// </summary>
        /// <response code="200">Index status.</response>
        /// <response code="503">Python processing engine unavailable.</response>
        [HttpGet("index-status")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(IndexStatusResponse), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GetIndexStatus()
        {
            try
            {
                var status = await searchService.GetIndexStatusAsync();
                return Ok(status);
            }
            catch (HttpRequestException)
            {
                LogEngineUnavailable("index-status");
                return StatusCode(503, new { error = "Semantic search engine unavailable" });
            }
        }

        [LoggerMessage(Level = LogLevel.Information, Message = "Semantic search requested: '{Query}' (topK={TopK})")]
        private partial void LogSearchRequested(string query, int topK);

        [LoggerMessage(Level = LogLevel.Warning, Message = "Semantic engine unavailable for {Endpoint}")]
        private partial void LogEngineUnavailable(string endpoint);

        [LoggerMessage(Level = LogLevel.Information, Message = "Re-index job queued: {JobId}")]
        private partial void LogReindexQueued(string jobId);

        [LoggerMessage(Level = LogLevel.Warning, Message = "Embedding queue full, rejecting re-index request")]
        private partial void LogQueueFull();
    }
}
