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
        IMongoDBService mongoDBService,
        ILogger<AnalysisController> logger) : ControllerBase
    {
        private readonly IAnalysisService analysisService = analysisService;
        private readonly IMongoDBService mongoDBService = mongoDBService;
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

                var data = await mongoDBService.GetAsync(request.DataId);
                if (data == null)
                {
                    return NotFound(new { error = $"Data with ID {request.DataId} not found" });
                }

                if (!IsDataAccessible(data))
                {
                    return Forbid();
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

        /// <summary>
        /// Detect astronomical sources in a FITS image.
        /// </summary>
        /// <param name="request">Source detection parameters.</param>
        /// <returns>List of detected sources with properties.</returns>
        [HttpPost("detect-sources")]
        [ProducesResponseType(typeof(SourceDetectionResponseDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> DetectSources(
            [FromBody] SourceDetectionRequestDto request)
        {
            try
            {
                if (string.IsNullOrEmpty(request.DataId))
                {
                    return BadRequest(new { error = "DataId is required" });
                }

                var data = await mongoDBService.GetAsync(request.DataId);
                if (data == null)
                {
                    return NotFound(new { error = $"Data with ID {request.DataId} not found" });
                }

                if (!IsDataAccessible(data))
                {
                    return Forbid();
                }

                if (request.ThresholdSigma < 1.0 || request.ThresholdSigma > 50.0)
                {
                    return BadRequest(new { error = "ThresholdSigma must be between 1.0 and 50.0" });
                }

                if (request.Fwhm < 0.5 || request.Fwhm > 20.0)
                {
                    return BadRequest(new { error = "Fwhm must be between 0.5 and 20.0" });
                }

                if (request.Npixels < 1 || request.Npixels > 1000)
                {
                    return BadRequest(new { error = "Npixels must be between 1 and 1000" });
                }

                string[] validMethods = ["auto", "daofind", "iraf", "segmentation"];
                if (!validMethods.Contains(request.Method))
                {
                    return BadRequest(new { error = $"Invalid method '{request.Method}'. Valid: {string.Join(", ", validMethods)}" });
                }

                LogDetectingSources(request.DataId, request.Method);

                var result = await analysisService.DetectSourcesAsync(request);
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
                return StatusCode(500, new { error = "Source detection failed" });
            }
        }

        /// <summary>
        /// Get table HDU information from a FITS file.
        /// </summary>
        [HttpGet("table-info")]
        [ProducesResponseType(typeof(TableInfoResponseDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GetTableInfo([FromQuery] string dataId)
        {
            try
            {
                if (string.IsNullOrEmpty(dataId))
                {
                    return BadRequest(new { error = "dataId is required" });
                }

                var data = await mongoDBService.GetAsync(dataId);
                if (data == null)
                {
                    return NotFound(new { error = $"Data with ID {dataId} not found" });
                }

                if (!IsDataAccessible(data))
                {
                    return Forbid();
                }

                LogGettingTableInfo(dataId);

                var result = await analysisService.GetTableInfoAsync(dataId);
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
                return StatusCode(500, new { error = "Failed to get table info" });
            }
        }

        /// <summary>
        /// Get paginated table data from a specific HDU.
        /// </summary>
        [HttpGet("table-data")]
        [ProducesResponseType(typeof(TableDataResponseDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GetTableData(
            [FromQuery] string dataId,
            [FromQuery] int hduIndex = 0,
            [FromQuery] int page = 0,
            [FromQuery] int pageSize = 100,
            [FromQuery] string? sortColumn = null,
            [FromQuery] string? sortDirection = null,
            [FromQuery] string? search = null)
        {
            try
            {
                if (string.IsNullOrEmpty(dataId))
                {
                    return BadRequest(new { error = "dataId is required" });
                }

                if (pageSize < 1 || pageSize > 500)
                {
                    return BadRequest(new { error = "pageSize must be between 1 and 500" });
                }

                if (page < 0)
                {
                    return BadRequest(new { error = "page must be >= 0" });
                }

                if (hduIndex < 0)
                {
                    return BadRequest(new { error = "hduIndex must be >= 0" });
                }

                if (sortDirection != null)
                {
                    string[] validDirections = ["asc", "desc"];
                    if (!validDirections.Contains(sortDirection, StringComparer.OrdinalIgnoreCase))
                    {
                        return BadRequest(new { error = "sortDirection must be 'asc' or 'desc'" });
                    }
                }

                if (search != null && search.Length > 500)
                {
                    return BadRequest(new { error = "search term must be 500 characters or less" });
                }

                var data = await mongoDBService.GetAsync(dataId);
                if (data == null)
                {
                    return NotFound(new { error = $"Data with ID {dataId} not found" });
                }

                if (!IsDataAccessible(data))
                {
                    return Forbid();
                }

                LogGettingTableData(dataId, hduIndex);

                var result = await analysisService.GetTableDataAsync(
                    dataId, hduIndex, page, pageSize, sortColumn, sortDirection, search);
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
                return StatusCode(500, new { error = "Failed to get table data" });
            }
        }

        /// <summary>
        /// Get spectral data from a FITS file for plotting.
        /// </summary>
        [HttpGet("spectral-data")]
        [ProducesResponseType(typeof(SpectralDataResponseDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status404NotFound)]
        [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
        public async Task<IActionResult> GetSpectralData(
            [FromQuery] string dataId,
            [FromQuery] int hduIndex = 1)
        {
            try
            {
                if (string.IsNullOrEmpty(dataId))
                {
                    return BadRequest(new { error = "dataId is required" });
                }

                if (hduIndex < 0)
                {
                    return BadRequest(new { error = "hduIndex must be >= 0" });
                }

                var data = await mongoDBService.GetAsync(dataId);
                if (data == null)
                {
                    return NotFound(new { error = $"Data with ID {dataId} not found" });
                }

                if (!IsDataAccessible(data))
                {
                    return Forbid();
                }

                LogGettingSpectralData(dataId, hduIndex);

                var result = await analysisService.GetSpectralDataAsync(dataId, hduIndex);
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
                return StatusCode(500, new { error = "Failed to get spectral data" });
            }
        }

        private bool IsDataAccessible(JwstDataModel data)
        {
            var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
            if (!isAuthenticated)
            {
                return data.IsPublic;
            }

            if (User.IsInRole("Admin"))
            {
                return true;
            }

            var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            return data.IsPublic
                || data.UserId == userId
                || (userId != null && data.SharedWith.Contains(userId));
        }
    }
}
