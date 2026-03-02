// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Diagnostics;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// Controller for WCS mosaic image generation.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public partial class MosaicController(
        IMosaicService mosaicService,
        IJobTracker jobTracker,
        MosaicQueue mosaicQueue,
        ILogger<MosaicController> logger,
        IConfiguration configuration) : ApiControllerBase
    {
        private readonly IMosaicService mosaicService = mosaicService;
        private readonly IJobTracker jobTracker = jobTracker;
        private readonly MosaicQueue mosaicQueue = mosaicQueue;
        private readonly ILogger<MosaicController> logger = logger;
        private readonly IConfiguration configuration = configuration;

        /// <summary>
        /// Generate a WCS-aware mosaic image from 2+ FITS files.
        /// </summary>
        /// <param name="request">Mosaic request with file configurations and output settings.</param>
        /// <returns>PNG, JPEG, or FITS image data.</returns>
        /// <response code="200">Returns the generated mosaic image.</response>
        /// <response code="400">Invalid request parameters or incompatible files.</response>
        /// <response code="404">One or more data IDs not found.</response>
        /// <response code="413">File or mosaic output too large.</response>
        /// <response code="503">Processing engine unavailable.</response>
        [HttpPost("generate")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GenerateMosaic([FromBody] MosaicRequestDto request)
        {
            var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
            try
            {
                var validationResult = ValidateMosaicRequest(request);
                if (validationResult is not null)
                {
                    return validationResult;
                }

                // Cap preview resolution to keep synchronous generation fast.
                // The async export/save endpoints are uncapped for full resolution.
                var maxPreviewDimension = configuration.GetValue("Mosaic:MaxPreviewDimension", 2048);
                var resolutionCapped = false;
                if (request.Width is null && request.Height is null
                    && !request.OutputFormat.Equals("fits", StringComparison.OrdinalIgnoreCase))
                {
                    request.Width = maxPreviewDimension;
                    resolutionCapped = true;
                }

                LogGeneratingMosaic(request.Files.Count, request.CombineMethod);

                var userId = GetCurrentUserId();
                var isAdmin = IsCurrentUserAdmin();

                var stopwatch = Stopwatch.StartNew();
                var imageBytes = await mosaicService.GenerateMosaicAsync(
                    request, userId, isAuthenticated, isAdmin);
                stopwatch.Stop();

                LogMosaicPreviewCompleted(
                    request.Files.Count,
                    request.Width,
                    request.Height,
                    resolutionCapped,
                    imageBytes.Length,
                    stopwatch.ElapsedMilliseconds);

                var outputFormat = request.OutputFormat.ToLowerInvariant();
                var contentType = outputFormat switch
                {
                    "jpeg" => "image/jpeg",
                    "fits" => "application/fits",
                    _ => "image/png",
                };

                var fileName = $"mosaic.{outputFormat}";

                return File(imageBytes, contentType, fileName);
            }
            catch (UnauthorizedAccessException)
            {
                return isAuthenticated ? Forbid() : NotFound(new { error = "Data not found" });
            }
            catch (KeyNotFoundException ex)
            {
                LogDataNotFound(ex.Message);
                return NotFound(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                LogInvalidOperation(ex.Message);
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.RequestEntityTooLarge)
            {
                LogProcessingEngineError(ex);
                return StatusCode(413, new { error = "File too large for processing", details = ex.Message });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.BadRequest)
            {
                LogProcessingEngineError(ex);
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                LogProcessingEngineError(ex);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
            catch (Exception ex)
            {
                LogUnexpectedError(ex);
                return StatusCode(500, new { error = "Mosaic generation failed", details = ex.Message });
            }
        }

        /// <summary>
        /// Generate a WCS-aware mosaic FITS and persist it as a data record.
        /// </summary>
        /// <param name="request">Mosaic request with file configurations.</param>
        /// <returns>Created data ID and metadata for the saved FITS mosaic.</returns>
        /// <response code="201">Returns metadata for the saved mosaic file.</response>
        /// <response code="400">Invalid request parameters.</response>
        /// <response code="403">Source file access denied.</response>
        /// <response code="404">One or more data IDs not found.</response>
        /// <response code="503">Processing engine unavailable.</response>
        [HttpPost("generate-and-save")]
        [ProducesResponseType(typeof(SavedMosaicResponseDto), StatusCodes.Status201Created)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GenerateAndSaveMosaic([FromBody] MosaicRequestDto request)
        {
            try
            {
                var validationResult = ValidateMosaicRequest(request);
                if (validationResult is not null)
                {
                    return validationResult;
                }

                var userId = GetCurrentUserId();
                var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
                var isAdmin = IsCurrentUserAdmin();

                var saved = await mosaicService.GenerateAndSaveMosaicAsync(
                    request,
                    userId,
                    isAuthenticated,
                    isAdmin);

                return StatusCode(StatusCodes.Status201Created, saved);
            }
            catch (KeyNotFoundException ex)
            {
                LogDataNotFound(ex.Message);
                return NotFound(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                LogInvalidOperation(ex.Message);
                return BadRequest(new { error = ex.Message });
            }
            catch (UnauthorizedAccessException ex)
            {
                LogInvalidOperation(ex.Message);
                return Forbid();
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.RequestEntityTooLarge)
            {
                LogProcessingEngineError(ex);
                return StatusCode(413, new { error = "File too large for processing", details = ex.Message });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.BadRequest)
            {
                LogProcessingEngineError(ex);
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                LogProcessingEngineError(ex);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
            catch (Exception ex)
            {
                LogUnexpectedError(ex);
                return StatusCode(500, new { error = "Mosaic generation failed", details = ex.Message });
            }
        }

        /// <summary>
        /// Get WCS footprint polygons for FITS files (preview coverage before generating).
        /// </summary>
        /// <param name="request">Footprint request with data IDs.</param>
        /// <returns>JSON with footprints, bounding box, and file count.</returns>
        /// <response code="200">Returns footprint data.</response>
        /// <response code="400">Invalid request or files without WCS.</response>
        /// <response code="404">One or more data IDs not found.</response>
        /// <response code="503">Processing engine unavailable.</response>
        [HttpPost("footprint")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(FootprintResponseDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GetFootprint([FromBody] FootprintRequestDto request)
        {
            var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
            try
            {
                if (request.DataIds == null || request.DataIds.Count == 0)
                {
                    return BadRequest(new { error = "At least 1 data ID is required" });
                }

                if (request.DataIds.Any(string.IsNullOrEmpty))
                {
                    return BadRequest(new { error = "DataId cannot be empty" });
                }

                LogComputingFootprints(request.DataIds.Count);

                var userId = GetCurrentUserId();
                var isAdmin = IsCurrentUserAdmin();

                var footprints = await mosaicService.GetFootprintsAsync(
                    request, userId, isAuthenticated, isAdmin);

                return Ok(footprints);
            }
            catch (UnauthorizedAccessException)
            {
                return isAuthenticated ? Forbid() : NotFound(new { error = "Data not found" });
            }
            catch (KeyNotFoundException ex)
            {
                LogDataNotFound(ex.Message);
                return NotFound(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                LogInvalidOperation(ex.Message);
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.RequestEntityTooLarge)
            {
                LogProcessingEngineError(ex);
                return StatusCode(413, new { error = "File too large for processing", details = ex.Message });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.BadRequest)
            {
                LogProcessingEngineError(ex);
                return BadRequest(new { error = ex.Message });
            }
            catch (HttpRequestException ex)
            {
                LogProcessingEngineError(ex);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
            catch (Exception ex)
            {
                LogUnexpectedError(ex);
                return StatusCode(500, new { error = "Footprint computation failed", details = ex.Message });
            }
        }

        /// <summary>
        /// Export a mosaic image asynchronously via the background queue.
        /// Returns a job ID for tracking progress via SignalR or polling.
        /// </summary>
        /// <param name="request">Mosaic request with file configurations and output settings.</param>
        /// <returns>Job ID for tracking progress.</returns>
        /// <response code="202">Export job queued successfully.</response>
        /// <response code="400">Invalid request parameters.</response>
        /// <response code="429">Queue is full, try again later.</response>
        [HttpPost("export")]
        [ProducesResponseType(StatusCodes.Status202Accepted)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public async Task<IActionResult> ExportMosaic([FromBody] MosaicRequestDto request)
        {
            var validationResult = ValidateMosaicRequest(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            if (request.OutputFormat.Equals("fits", StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest(new { error = "FITS format is not supported for export. Use /api/mosaic/save for FITS output." });
            }

            var userId = GetCurrentUserId();
            if (userId is null)
            {
                return Unauthorized();
            }

            var fileCount = request.Files.Count;
            var description = $"Mosaic export ({fileCount} file{(fileCount == 1 ? string.Empty : "s")})";

            var job = await jobTracker.CreateJobAsync(JobTypes.Mosaic, description, userId);

            var item = new MosaicJobItem
            {
                JobId = job.JobId,
                Request = request,
                UserId = userId,
                IsAuthenticated = User.Identity?.IsAuthenticated ?? false,
                IsAdmin = IsCurrentUserAdmin(),
                SaveToLibrary = false,
            };

            if (!mosaicQueue.TryEnqueue(item))
            {
                await jobTracker.FailJobAsync(job.JobId, "Queue full");
                Response.Headers["Retry-After"] = "5";
                return StatusCode(StatusCodes.Status429TooManyRequests, new { error = "Mosaic export queue is full. Please try again shortly." });
            }

            LogExportQueued(job.JobId, fileCount);

            return Accepted(new { jobId = job.JobId, status = "queued" });
        }

        /// <summary>
        /// Generate and save a FITS mosaic asynchronously via the background queue.
        /// Returns a job ID for tracking progress via SignalR or polling.
        /// On completion the job result contains the saved data record ID.
        /// </summary>
        /// <param name="request">Mosaic request with file configurations.</param>
        /// <returns>Job ID for tracking progress.</returns>
        /// <response code="202">Save job queued successfully.</response>
        /// <response code="400">Invalid request parameters.</response>
        /// <response code="429">Queue is full, try again later.</response>
        [HttpPost("save")]
        [ProducesResponseType(StatusCodes.Status202Accepted)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
        public async Task<IActionResult> SaveMosaic([FromBody] MosaicRequestDto request)
        {
            var validationResult = ValidateMosaicRequest(request);
            if (validationResult is not null)
            {
                return validationResult;
            }

            var userId = GetCurrentUserId();
            if (userId is null)
            {
                return Unauthorized();
            }

            var fileCount = request.Files.Count;
            var description = $"Mosaic save to library ({fileCount} file{(fileCount == 1 ? string.Empty : "s")})";

            var job = await jobTracker.CreateJobAsync(JobTypes.Mosaic, description, userId);

            var item = new MosaicJobItem
            {
                JobId = job.JobId,
                Request = request,
                UserId = userId,
                IsAuthenticated = User.Identity?.IsAuthenticated ?? false,
                IsAdmin = IsCurrentUserAdmin(),
                SaveToLibrary = true,
            };

            if (!mosaicQueue.TryEnqueue(item))
            {
                await jobTracker.FailJobAsync(job.JobId, "Queue full");
                Response.Headers["Retry-After"] = "5";
                return StatusCode(StatusCodes.Status429TooManyRequests, new { error = "Mosaic save queue is full. Please try again shortly." });
            }

            LogSaveQueued(job.JobId, fileCount);

            return Accepted(new { jobId = job.JobId, status = "queued" });
        }

        /// <summary>
        /// Get mosaic processing limits for the current user.
        /// Limits may vary by user role (anonymous, registered, admin).
        /// </summary>
        /// <returns>Processing limits including max file size.</returns>
        [HttpGet("limits")]
        [AllowAnonymous]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public IActionResult GetLimits()
        {
            // Default from processing engine's MAX_FITS_FILE_SIZE_MB env var
            var mosaicMaxMb = configuration.GetValue("Mosaic:MaxFileSizeMB", 2048);
            var compositeMaxMb = configuration.GetValue("Composite:MaxFileSizeMB", 4096);

            return Ok(new { mosaicMaxFileSizeMB = mosaicMaxMb, compositeMaxFileSizeMB = compositeMaxMb });
        }

        /// <summary>
        /// Validate a mosaic request. Returns an error result, or null if valid.
        /// </summary>
        private BadRequestObjectResult? ValidateMosaicRequest(MosaicRequestDto request)
        {
            if (request.Files == null || request.Files.Count < 2)
            {
                return BadRequest(new { error = "At least 2 files are required for mosaic generation" });
            }

            if (request.Files.Any(f => string.IsNullOrEmpty(f.DataId)))
            {
                return BadRequest(new { error = "DataId is required for all files" });
            }

            return null;
        }
    }
}
