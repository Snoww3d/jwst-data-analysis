// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// Controller for image analysis operations including region statistics.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public partial class AnalysisController(
        IAnalysisService analysisService,
        ILogger<AnalysisController> logger) : ControllerBase
    {
        private readonly IAnalysisService analysisService = analysisService;
        private readonly ILogger<AnalysisController> logger = logger;

        /// <summary>
        /// Compute statistics for a selected region within a FITS image.
        /// </summary>
        /// <param name="request">Region statistics request with data ID and region definition.</param>
        /// <returns>Computed statistics (mean, median, std, min, max, sum, pixel count).</returns>
        [HttpPost("region-statistics")]
        [ProducesResponseType(typeof(RegionStatisticsResponseDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GetRegionStatistics(
            [FromBody] RegionStatisticsRequestDto request)
        {
            try
            {
                if (string.IsNullOrEmpty(request.DataId))
                {
                    return BadRequest(new { error = "DataId is required" });
                }

                if (string.IsNullOrEmpty(request.RegionType))
                {
                    return BadRequest(new { error = "RegionType is required" });
                }

                LogComputingRegionStatistics(request.DataId, request.RegionType);

                var result = await analysisService.GetRegionStatisticsAsync(request);
                return Ok(result);
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
                return StatusCode(503, new { error = "Processing engine unavailable" });
            }
            catch (Exception ex)
            {
                LogUnexpectedError(ex);
                return StatusCode(500, new { error = "Region statistics computation failed" });
            }
        }
    }
}
