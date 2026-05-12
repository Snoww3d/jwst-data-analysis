// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// Controller for composite image generation.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public partial class CompositeController(
        ICompositeService compositeService,
        IJobTracker jobTracker,
        CompositeQueue compositeQueue,
        ILogger<CompositeController> logger) : ApiControllerBase
    {
        private readonly ICompositeService compositeService = compositeService;
        private readonly IJobTracker jobTracker = jobTracker;
        private readonly CompositeQueue compositeQueue = compositeQueue;
        private readonly ILogger<CompositeController> logger = logger;

        /// <summary>
        /// Generate an N-channel composite image from arbitrary channels with color assignments.
        /// </summary>
        /// <param name="request">N-channel composite request with channel configurations and colors.</param>
        /// <returns>PNG or JPEG image data.</returns>
        /// <response code="200">Returns the generated composite image.</response>
        /// <response code="400">Invalid request parameters.</response>
        /// <response code="404">One or more data IDs not found.</response>
        /// <response code="413">Composite would shrink below COMPOSITE_DOWNSCALE_FAIL_THRESHOLD; tune env vars or reduce inputs.</response>
        /// <response code="503">Processing engine unavailable.</response>
        [HttpPost("generate-nchannel")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GenerateNChannelComposite([FromBody] NChannelCompositeRequestDto request)
        {
            try
            {
                var validationResult = ValidateNChannelRequest(request);
                if (validationResult is not null)
                {
                    return validationResult;
                }

                LogGeneratingNChannelComposite(request.Channels.Count);

                var userId = GetCurrentUserId();
                var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
                var isAdmin = IsCurrentUserAdmin();

                var compositeResult = await compositeService.GenerateNChannelCompositeAsync(
                    request,
                    userId,
                    isAuthenticated,
                    isAdmin,
                    cancellationToken: HttpContext.RequestAborted);

                foreach (var (name, value) in compositeResult.Headers)
                {
                    Response.Headers[name] = value;
                }

                var contentType = request.OutputFormat.Equals("jpeg", StringComparison.OrdinalIgnoreCase)
                    ? "image/jpeg"
                    : "image/png";

                var fileName = $"composite-nchannel.{request.OutputFormat.ToLowerInvariant()}";

                return File(compositeResult.Bytes, contentType, fileName);
            }
            catch (CompositeBudgetExceededException ex)
            {
                LogBudgetExceeded(ex.Message);
                return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = ex.Message });
            }
            catch (ObservationMosaicInProgressException ex)
            {
                LogMosaicInProgress(ex.ObservationBaseId, ex.JobId);
                Response.Headers["Retry-After"] = "30";
                return StatusCode(StatusCodes.Status409Conflict, new
                {
                    error = "An observation mosaic is being generated. Please retry shortly.",
                    retryAfterSeconds = 30,
                });
            }
            catch (KeyNotFoundException ex)
            {
                LogDataNotFound(ex.Message);
                return NotFound(new { error = "The requested data was not found." });
            }
            catch (InvalidOperationException ex)
            {
                LogInvalidOperation(ex.Message);
                return BadRequest(new { error = "The request could not be processed." });
            }
            catch (UnauthorizedAccessException ex)
            {
                LogInvalidOperation(ex.Message);
                var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
                return isAuthenticated ? Forbid() : NotFound(new { error = "The requested data was not found." });
            }
            catch (HttpRequestException ex)
            {
                LogProcessingEngineError(ex);
                return StatusCode(503, new { error = "Processing engine is temporarily unavailable. Please retry." });
            }
            catch (TaskCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested)
            {
                // Client disconnected — not an error, response will be discarded anyway.
                // Suppress to avoid noisy 504s in logs for normal user navigation. (#1372)
                return new EmptyResult();
            }
            catch (TaskCanceledException)
            {
                return StatusCode(504, new { error = "Processing timed out. The image may be too large — try a smaller size." });
            }
            catch (Exception ex)
            {
                LogUnexpectedError(ex);
                return StatusCode(500, new { error = "Composite generation failed. Please retry." });
            }
        }

        /// <summary>
        /// Pre-flight memory feasibility check. Calls the engine's
        /// /composite/estimate endpoint, which reads file WCS headers but
        /// skips reproject + combine. Returns a verdict (ok | warn | fail)
        /// so callers (recipe walkthroughs, UI flows) can avoid submitting
        /// requests that would HTTP 413.
        /// </summary>
        /// <param name="request">N-channel composite request to evaluate.</param>
        /// <response code="200">Verdict (ok | warn | fail).</response>
        /// <response code="400">Invalid request parameters.</response>
        /// <response code="404">One or more data IDs not found.</response>
        /// <response code="413">Total input file count exceeds the engine's soft cap.</response>
        /// <response code="503">Processing engine unavailable.</response>
        [HttpPost("estimate")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(CompositeEstimateResponseDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> Estimate([FromBody] NChannelCompositeRequestDto request)
        {
            try
            {
                var validationResult = ValidateNChannelRequest(request);
                if (validationResult is not null)
                {
                    return validationResult;
                }

                LogEstimateRequested(request.Channels.Count);

                var userId = GetCurrentUserId();
                var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
                var isAdmin = IsCurrentUserAdmin();

                var verdict = await compositeService.EstimateCompositeAsync(
                    request, userId, isAuthenticated, isAdmin, HttpContext.RequestAborted);

                return Ok(verdict);
            }
            catch (CompositeBudgetExceededException ex)
            {
                // Engine returns 413 on /composite/estimate when the soft file-count
                // cap is exceeded (MAX_COMPOSITE_ESTIMATE_FILES). Surface verbatim.
                LogBudgetExceeded(ex.Message);
                return StatusCode(StatusCodes.Status413PayloadTooLarge, new { error = ex.Message });
            }
            catch (KeyNotFoundException ex)
            {
                LogDataNotFound(ex.Message);
                return NotFound(new { error = "The requested data was not found." });
            }
            catch (InvalidOperationException ex)
            {
                LogInvalidOperation(ex.Message);
                return BadRequest(new { error = "The request could not be processed." });
            }
            catch (UnauthorizedAccessException ex)
            {
                LogInvalidOperation(ex.Message);
                var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
                return isAuthenticated ? Forbid() : NotFound(new { error = "The requested data was not found." });
            }
            catch (HttpRequestException ex)
            {
                LogProcessingEngineError(ex);
                return StatusCode(503, new { error = "Processing engine is temporarily unavailable. Please retry." });
            }
            catch (TaskCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested)
            {
                return new EmptyResult();
            }
            catch (TaskCanceledException)
            {
                return StatusCode(504, new { error = "Estimate timed out." });
            }
            catch (Exception ex)
            {
                LogUnexpectedError(ex);
                return StatusCode(500, new { error = "Composite estimate failed. Please retry." });
            }
        }

        /// <summary>
        /// Export an N-channel composite image asynchronously via the background queue.
        /// Returns a job ID for tracking progress via SignalR or polling.
        /// </summary>
        /// <param name="request">N-channel composite request with channel configurations and colors.</param>
        /// <returns>Job ID for tracking progress.</returns>
        /// <response code="202">Export job queued successfully.</response>
        /// <response code="400">Invalid request parameters.</response>
        /// <response code="429">Queue is full, try again later.</response>
        [HttpPost("export-nchannel")]
        [ProducesResponseType(StatusCodes.Status202Accepted)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public async Task<IActionResult> ExportNChannelComposite([FromBody] NChannelCompositeRequestDto request)
        {
            // Reuse same validation as sync endpoint
            var validationResult = ValidateNChannelRequest(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            var userId = GetCurrentUserId();
            if (userId is null)
            {
                return Unauthorized();
            }

            var channelCount = request.Channels.Count;
            var description = $"N-channel composite export ({channelCount} channel{(channelCount == 1 ? string.Empty : "s")})";

            var job = await jobTracker.CreateJobAsync(JobTypes.Composite, description, userId);

            var item = new CompositeJobItem
            {
                JobId = job.JobId,
                Request = request,
                UserId = userId,
                IsAuthenticated = User.Identity?.IsAuthenticated ?? false,
                IsAdmin = IsCurrentUserAdmin(),
            };

            if (!compositeQueue.TryEnqueue(item))
            {
                await jobTracker.FailJobAsync(job.JobId, "Queue full");
                Response.Headers["Retry-After"] = "5";
                return StatusCode(StatusCodes.Status429TooManyRequests, new { error = "Composite export queue is full. Please try again shortly." });
            }

            LogExportQueued(job.JobId, channelCount);

            return Accepted(new { jobId = job.JobId, status = "queued" });
        }

        /// <summary>
        /// Generate an N-channel composite preview asynchronously via the background queue.
        /// Returns a job ID for tracking progress via SignalR. Used by the wizard preview
        /// step so authenticated users see live progress (stage, elapsed time) instead of
        /// blocking on the long sync endpoint. Anonymous users continue to use the sync
        /// endpoint because <c>JobProgressHub</c> requires authentication.
        /// </summary>
        /// <param name="request">N-channel composite request with channel configurations and colors.</param>
        /// <returns>Job ID for tracking progress.</returns>
        /// <response code="202">Preview job queued successfully.</response>
        /// <response code="400">Invalid request parameters.</response>
        /// <response code="401">Authentication required.</response>
        /// <response code="429">Queue is full, try again later.</response>
        [HttpPost("generate-nchannel-async")]
        [ProducesResponseType(StatusCodes.Status202Accepted)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public async Task<IActionResult> GenerateNChannelCompositeAsync([FromBody] NChannelCompositeRequestDto request)
        {
            var validationResult = ValidateNChannelRequest(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            var userId = GetCurrentUserId();
            if (userId is null)
            {
                return Unauthorized();
            }

            var channelCount = request.Channels.Count;
            var description = $"N-channel composite preview ({channelCount} channel{(channelCount == 1 ? string.Empty : "s")})";

            var job = await jobTracker.CreateJobAsync(JobTypes.CompositePreview, description, userId);

            var item = new CompositeJobItem
            {
                JobId = job.JobId,
                Request = request,
                UserId = userId,
                IsAuthenticated = User.Identity?.IsAuthenticated ?? false,
                IsAdmin = IsCurrentUserAdmin(),
            };

            if (!compositeQueue.TryEnqueue(item))
            {
                await jobTracker.FailJobAsync(job.JobId, "Queue full");
                Response.Headers["Retry-After"] = "5";
                return StatusCode(StatusCodes.Status429TooManyRequests, new { error = "Composite preview queue is full. Please try again shortly." });
            }

            LogPreviewQueued(job.JobId, channelCount);

            return Accepted(new { jobId = job.JobId, status = "queued" });
        }

        /// <summary>
        /// Analyze channels — returns auto-stretch parameters, histograms, and detection metadata.
        /// </summary>
        /// <param name="request">Channel configurations to analyze.</param>
        /// <returns>JSON analysis results per channel.</returns>
        /// <response code="200">Returns analysis results for each channel.</response>
        /// <response code="400">Invalid request parameters.</response>
        /// <response code="404">One or more data IDs not found.</response>
        /// <response code="503">Processing engine unavailable.</response>
        [HttpPost("analyze-channels")]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> AnalyzeChannels([FromBody] AnalyzeChannelsRequestDto request)
        {
            try
            {
                var validationResult = ValidateChannelConfigs(request.Channels);
                if (validationResult is not null)
                {
                    return validationResult;
                }

                LogAnalyzingChannels(request.Channels.Count);

                var userId = GetCurrentUserId();
                var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
                var isAdmin = IsCurrentUserAdmin();

                var result = await compositeService.AnalyzeChannelsAsync(
                    request,
                    userId,
                    isAuthenticated,
                    isAdmin,
                    HttpContext.RequestAborted);

                return Ok(result);
            }
            catch (KeyNotFoundException ex)
            {
                LogDataNotFound(ex.Message);
                return NotFound(new { error = "The requested data was not found." });
            }
            catch (UnauthorizedAccessException ex)
            {
                LogInvalidOperation(ex.Message);
                var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
                return isAuthenticated ? Forbid() : NotFound(new { error = "The requested data was not found." });
            }
            catch (HttpRequestException ex)
            {
                LogProcessingEngineError(ex);
                return StatusCode(503, new { error = "Processing engine is temporarily unavailable. Please retry." });
            }
            catch (TaskCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested)
            {
                return new EmptyResult();
            }
            catch (TaskCanceledException)
            {
                return StatusCode(504, new { error = "Analysis timed out. Try with fewer channels." });
            }
            catch (Exception ex)
            {
                LogUnexpectedError(ex);
                return StatusCode(500, new { error = "Channel analysis failed. Please retry." });
            }
        }

        /// <summary>
        /// Validate an N-channel composite request. Returns an error result, or null if valid.
        /// </summary>
        private BadRequestObjectResult? ValidateNChannelRequest(NChannelCompositeRequestDto request)
        {
            return ValidateChannelConfigs(request.Channels);
        }

        /// <summary>
        /// Validate a list of channel configurations. Returns an error result, or null if valid.
        /// Shared by generate-nchannel, export-nchannel, and analyze-channels endpoints.
        /// </summary>
        private BadRequestObjectResult? ValidateChannelConfigs(List<NChannelConfigDto>? channels)
        {
            if (channels == null || channels.Count == 0)
            {
                return BadRequest(new { error = "At least one channel configuration is required" });
            }

            foreach (var channel in channels)
            {
                if (channel.DataIds == null || channel.DataIds.Count == 0)
                {
                    return BadRequest(new { error = "At least one DataId is required for each channel" });
                }

                if (channel.Color == null)
                {
                    return BadRequest(new { error = "Color specification is required for each channel" });
                }

                if (channel.Color.Hue == null && channel.Color.Rgb == null && !channel.Color.Luminance)
                {
                    return BadRequest(new { error = "Either Hue, Rgb, or Luminance must be specified for each channel color" });
                }

                if (channel.Color.Hue != null && channel.Color.Rgb != null)
                {
                    return BadRequest(new { error = "Provide either Hue or Rgb, not both" });
                }

                if (channel.Color.Luminance && (channel.Color.Hue != null || channel.Color.Rgb != null))
                {
                    return BadRequest(new { error = "Luminance channel must not have Hue or Rgb" });
                }

                if (channel.Color.Rgb != null)
                {
                    if (channel.Color.Rgb.Length != 3)
                    {
                        return BadRequest(new { error = "Rgb must have exactly 3 values" });
                    }

                    for (int i = 0; i < 3; i++)
                    {
                        if (channel.Color.Rgb[i] < 0.0 || channel.Color.Rgb[i] > 1.0)
                        {
                            return BadRequest(new { error = $"RGB component {i} value {channel.Color.Rgb[i]} outside [0, 1]" });
                        }
                    }
                }
            }

            return null;
        }
    }
}
