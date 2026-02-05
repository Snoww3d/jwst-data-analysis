// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

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
        ILogger<MosaicController> logger) : ControllerBase
    {
        private readonly IMosaicService mosaicService = mosaicService;
        private readonly ILogger<MosaicController> logger = logger;

        /// <summary>
        /// Generate a WCS-aware mosaic image from 2+ FITS files.
        /// </summary>
        /// <param name="request">Mosaic request with file configurations and output settings.</param>
        /// <returns>PNG or JPEG image data.</returns>
        /// <response code="200">Returns the generated mosaic image.</response>
        /// <response code="400">Invalid request parameters or incompatible files.</response>
        /// <response code="404">One or more data IDs not found.</response>
        /// <response code="413">File or mosaic output too large.</response>
        /// <response code="503">Processing engine unavailable.</response>
        [HttpPost("generate")]
        [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GenerateMosaic([FromBody] MosaicRequestDto request)
        {
            try
            {
                if (request.Files == null || request.Files.Count < 2)
                {
                    return BadRequest(new { error = "At least 2 files are required for mosaic generation" });
                }

                if (request.Files.Any(f => string.IsNullOrEmpty(f.DataId)))
                {
                    return BadRequest(new { error = "DataId is required for all files" });
                }

                LogGeneratingMosaic(request.Files.Count, request.CombineMethod);

                var imageBytes = await mosaicService.GenerateMosaicAsync(request);

                var contentType = request.OutputFormat.Equals("jpeg", StringComparison.OrdinalIgnoreCase)
                    ? "image/jpeg"
                    : "image/png";

                var fileName = $"mosaic.{request.OutputFormat.ToLowerInvariant()}";

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
        [ProducesResponseType(typeof(FootprintResponseDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GetFootprint([FromBody] FootprintRequestDto request)
        {
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

                var footprints = await mosaicService.GetFootprintsAsync(request);

                return Ok(footprints);
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
                return StatusCode(500, new { error = "Footprint computation failed", details = ex.Message });
            }
        }
    }
}
