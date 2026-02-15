// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

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
        ILogger<CompositeController> logger) : ControllerBase
    {
        private readonly ICompositeService compositeService = compositeService;
        private readonly ILogger<CompositeController> logger = logger;

        /// <summary>
        /// Generate an N-channel composite image from arbitrary channels with color assignments.
        /// </summary>
        /// <param name="request">N-channel composite request with channel configurations and colors.</param>
        /// <returns>PNG or JPEG image data.</returns>
        /// <response code="200">Returns the generated composite image.</response>
        /// <response code="400">Invalid request parameters.</response>
        /// <response code="404">One or more data IDs not found.</response>
        /// <response code="503">Processing engine unavailable.</response>
        [HttpPost("generate-nchannel")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GenerateNChannelComposite([FromBody] NChannelCompositeRequestDto request)
        {
            try
            {
                if (request.Channels == null || request.Channels.Count == 0)
                {
                    return BadRequest(new { error = "At least one channel configuration is required" });
                }

                foreach (var channel in request.Channels)
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

                LogGeneratingNChannelComposite(request.Channels.Count);

                var userId = GetCurrentUserId();
                var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
                var isAdmin = IsCurrentUserAdmin();

                var imageBytes = await compositeService.GenerateNChannelCompositeAsync(
                    request,
                    userId,
                    isAuthenticated,
                    isAdmin);

                var contentType = request.OutputFormat.Equals("jpeg", StringComparison.OrdinalIgnoreCase)
                    ? "image/jpeg"
                    : "image/png";

                var fileName = $"composite-nchannel.{request.OutputFormat.ToLowerInvariant()}";

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
            catch (UnauthorizedAccessException ex)
            {
                LogInvalidOperation(ex.Message);
                var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
                return isAuthenticated ? Forbid() : NotFound(new { error = "Data not found" });
            }
            catch (HttpRequestException ex)
            {
                LogProcessingEngineError(ex);
                return StatusCode(503, new { error = "Processing engine unavailable" });
            }
            catch (Exception ex)
            {
                LogUnexpectedError(ex);
                return StatusCode(500, new { error = "N-channel composite generation failed" });
            }
        }

        private string? GetCurrentUserId()
        {
            return User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                ?? User.FindFirst("sub")?.Value;
        }

        private bool IsCurrentUserAdmin() => User.IsInRole("Admin");
    }
}
