// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// Controller for RGB composite image generation.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public partial class CompositeController(
        ICompositeService compositeService,
        ILogger<CompositeController> logger) : ControllerBase
    {
        private readonly ICompositeService compositeService = compositeService;
        private readonly ILogger<CompositeController> logger = logger;

        /// <summary>
        /// Generate an RGB composite image from 3 FITS files.
        /// </summary>
        /// <param name="request">Composite request with red, green, and blue channel configurations.</param>
        /// <returns>PNG or JPEG image data.</returns>
        /// <response code="200">Returns the generated composite image.</response>
        /// <response code="400">Invalid request parameters.</response>
        /// <response code="404">One or more data IDs not found.</response>
        /// <response code="503">Processing engine unavailable.</response>
        [HttpPost("generate")]
        [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GenerateComposite([FromBody] CompositeRequestDto request)
        {
            try
            {
                // Validate request
                if (request.Red == null || request.Green == null || request.Blue == null)
                {
                    return BadRequest(new { error = "Red, green, and blue channel configurations are required" });
                }

                if (string.IsNullOrEmpty(request.Red.DataId) ||
                    string.IsNullOrEmpty(request.Green.DataId) ||
                    string.IsNullOrEmpty(request.Blue.DataId))
                {
                    return BadRequest(new { error = "DataId is required for all channels" });
                }

                LogGeneratingComposite(request.Red.DataId, request.Green.DataId, request.Blue.DataId);

                var imageBytes = await compositeService.GenerateCompositeAsync(request);

                var contentType = request.OutputFormat.Equals("jpeg", StringComparison.OrdinalIgnoreCase)
                    ? "image/jpeg"
                    : "image/png";

                var fileName = $"composite.{request.OutputFormat.ToLowerInvariant()}";

                return File(imageBytes, contentType, fileName);
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
            catch (HttpRequestException ex)
            {
                LogProcessingEngineError(ex);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
            catch (Exception ex)
            {
                LogUnexpectedError(ex);
                return StatusCode(500, new { error = "Composite generation failed", details = ex.Message });
            }
        }
    }
}
