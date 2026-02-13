// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.RegularExpressions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public partial class JwstDataController(IMongoDBService mongoDBService, ILogger<JwstDataController> logger, IHttpClientFactory httpClientFactory, IConfiguration configuration, IThumbnailService thumbnailService) : ControllerBase
    {
        private static readonly Regex ObsBaseIdPattern = new(@"^[a-zA-Z0-9._-]+$", RegexOptions.Compiled);

        private readonly IMongoDBService mongoDBService = mongoDBService;
        private readonly ILogger<JwstDataController> logger = logger;

        private readonly IHttpClientFactory httpClientFactory = httpClientFactory;
        private readonly IConfiguration configuration = configuration;
        private readonly IThumbnailService thumbnailService = thumbnailService;

        /// <summary>
        /// Get all JWST data items accessible to the current user.
        /// </summary>
        /// <param name="includeArchived">Include archived items in the response.</param>
        /// <returns>List of data items.</returns>
        [HttpGet]
        [AllowAnonymous]
        public async Task<ActionResult<List<DataResponse>>> Get([FromQuery] bool includeArchived = false)
        {
            try
            {
                var userId = GetCurrentUserId();
                var isAdmin = IsCurrentUserAdmin();
                var isAuthenticated = User.Identity?.IsAuthenticated ?? false;

                // Anonymous users: return only public data (Tasks #73, #74)
                if (!isAuthenticated)
                {
                    var publicData = await mongoDBService.GetPublicDataAsync();
                    if (!includeArchived)
                    {
                        publicData = [.. publicData.Where(d => !d.IsArchived)];
                    }

                    return Ok(publicData.Select(MapToDataResponse).ToList());
                }

                // Get data accessible to the current user
                var data = await mongoDBService.GetAccessibleDataAsync(userId ?? string.Empty, isAdmin);

                // Filter out archived data if not requested
                if (!includeArchived)
                {
                    data = [.. data.Where(d => !d.IsArchived)];
                }

                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingData(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get a specific JWST data item by ID.
        /// </summary>
        /// <param name="id">The 24-character MongoDB ObjectId.</param>
        /// <returns>The data item if found.</returns>
        [HttpGet("{id:length(24)}")]
        [AllowAnonymous]
        public async Task<ActionResult<DataResponse>> Get(string id)
        {
            try
            {
                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                // Check access permissions (Tasks #73, #74)
                if (!IsDataAccessible(data))
                {
                    var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
                    return isAuthenticated ? Forbid() : NotFound();
                }

                // Update last accessed time
                await mongoDBService.UpdateLastAccessedAsync(id);

                return Ok(MapToDataResponse(data));
            }
            catch (Exception ex)
            {
                LogErrorRetrievingDataById(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Generate a PNG preview for a FITS file using server-side rendering.
        /// Much faster than client-side parsing for large files.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <param name="cmap">Colormap name (inferno, magma, viridis, plasma, grayscale, hot, cool, rainbow).</param>
        /// <param name="width">Output image width in pixels.</param>
        /// <param name="height">Output image height in pixels.</param>
        /// <param name="stretch">Stretch algorithm (zscale, asinh, log, sqrt, power, histeq, linear).</param>
        /// <param name="gamma">Gamma correction factor (0.1 to 5.0).</param>
        /// <param name="blackPoint">Black point percentile (0.0 to 1.0).</param>
        /// <param name="whitePoint">White point percentile (0.0 to 1.0).</param>
        /// <param name="asinhA">Asinh softening parameter (only used when stretch=asinh).</param>
        /// <param name="sliceIndex">For 3D data cubes, which slice to show (-1 = middle).</param>
        /// <param name="format">Output format: png (default) or jpeg.</param>
        /// <param name="quality">JPEG quality 1-100 (only applies when format=jpeg).</param>
        /// <param name="embedAvm">Whether to embed AVM XMP metadata in the output image.</param>
        [HttpGet("{id:length(24)}/preview")]
        [AllowAnonymous]
        public async Task<IActionResult> GetPreview(
            string id,
            [FromQuery] string cmap = "inferno",
            [FromQuery] int width = 1000,
            [FromQuery] int height = 1000,
            [FromQuery] string stretch = "zscale",
            [FromQuery] double gamma = 1.0,
            [FromQuery] double blackPoint = 0.0,
            [FromQuery] double whitePoint = 1.0,
            [FromQuery] double asinhA = 0.1,
            [FromQuery] int sliceIndex = -1,
            [FromQuery] string format = "png",
            [FromQuery] int quality = 90,
            [FromQuery] bool embedAvm = false)
        {
            try
            {
                // Validate parameters
                if (width < 10 || width > 8000)
                {
                    return BadRequest("Width must be between 10 and 8000 pixels");
                }

                if (height < 10 || height > 8000)
                {
                    return BadRequest("Height must be between 10 and 8000 pixels");
                }

                if (gamma < 0.1 || gamma > 5.0)
                {
                    return BadRequest("Gamma must be between 0.1 and 5.0");
                }

                if (quality < 1 || quality > 100)
                {
                    return BadRequest("Quality must be between 1 and 100");
                }

                if (format != "png" && format != "jpeg")
                {
                    return BadRequest("Format must be 'png' or 'jpeg'");
                }

                string[] validStretches = ["zscale", "asinh", "log", "sqrt", "power", "histeq", "linear"];
                if (!validStretches.Contains(stretch))
                {
                    return BadRequest($"Invalid stretch '{stretch}'. Must be one of: {string.Join(", ", validStretches)}");
                }

                string[] validCmaps = ["grayscale", "gray", "inferno", "magma", "viridis", "plasma", "hot", "cool", "rainbow", "jet"];
                if (!validCmaps.Contains(cmap))
                {
                    return BadRequest($"Invalid colormap '{cmap}'. Must be one of: {string.Join(", ", validCmaps)}");
                }

                if (blackPoint < 0.0 || blackPoint > 1.0)
                {
                    return BadRequest("Black point must be between 0.0 and 1.0");
                }

                if (whitePoint < 0.0 || whitePoint > 1.0)
                {
                    return BadRequest("White point must be between 0.0 and 1.0");
                }

                if (blackPoint >= whitePoint)
                {
                    return BadRequest("Black point must be less than white point");
                }

                if (asinhA < 0.001 || asinhA > 1.0)
                {
                    return BadRequest("Asinh softening parameter must be between 0.001 and 1.0");
                }

                if (sliceIndex < -1)
                {
                    return BadRequest("Slice index must be -1 or greater");
                }

                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                // Check access permissions (Task #74)
                if (!IsDataAccessible(data))
                {
                    var isAuth = User.Identity?.IsAuthenticated ?? false;
                    return isAuth ? Forbid() : NotFound();
                }

                if (string.IsNullOrEmpty(data.FilePath))
                {
                    return BadRequest("File path not found for this data item");
                }

                // Get the relative path within the data directory for security
                // The processing engine validates paths are within /app/data
                var relativePath = data.FilePath;
                if (data.FilePath.StartsWith("/app/data/", StringComparison.Ordinal))
                {
                    relativePath = data.FilePath["/app/data/".Length..];
                }

                var client = httpClientFactory.CreateClient("ProcessingEngine");
                client.Timeout = TimeSpan.FromMinutes(2); // Allow time for large file processing

                // Build URL with all parameters
                var url = $"/preview/{id}?" +
                    $"file_path={Uri.EscapeDataString(relativePath)}" +
                    $"&cmap={Uri.EscapeDataString(cmap)}" +
                    $"&width={width}" +
                    $"&height={height}" +
                    $"&stretch={Uri.EscapeDataString(stretch)}" +
                    $"&gamma={gamma}" +
                    $"&black_point={blackPoint}" +
                    $"&white_point={whitePoint}" +
                    $"&asinh_a={asinhA}" +
                    $"&slice_index={sliceIndex}" +
                    $"&format={Uri.EscapeDataString(format)}" +
                    $"&quality={quality}" +
                    $"&embed_avm={embedAvm.ToString().ToLowerInvariant()}";

                // When AVM is requested, serialize observation metadata for embedding
                if (embedAvm)
                {
                    var avmMeta = new Dictionary<string, string>();
                    if (data.ImageInfo?.TargetName is not null)
                    {
                        avmMeta["target_name"] = data.ImageInfo.TargetName;
                    }

                    if (data.ImageInfo?.Instrument is not null)
                    {
                        avmMeta["instrument"] = data.ImageInfo.Instrument;
                    }

                    if (data.ImageInfo?.Filter is not null)
                    {
                        avmMeta["filter"] = data.ImageInfo.Filter;
                    }

                    if (!string.IsNullOrEmpty(data.Description))
                    {
                        avmMeta["description"] = data.Description;
                    }

                    avmMeta["facility"] = "JWST";

                    if (data.ImageInfo?.WavelengthRange is not null)
                    {
                        avmMeta["spectral_band"] = data.ImageInfo.WavelengthRange;
                    }

                    if (avmMeta.Count > 0)
                    {
                        var avmJson = System.Text.Json.JsonSerializer.Serialize(avmMeta);
                        url += $"&avm_metadata={Uri.EscapeDataString(avmJson)}";
                    }
                }

                // Call Python service to generate preview, forwarding all parameters
                var response = await client.GetAsync(url);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    LogPreviewGenerationFailed(response.StatusCode, errorContent);
                    return StatusCode((int)response.StatusCode, "Preview generation failed");
                }

                var imageBytes = await response.Content.ReadAsByteArrayAsync();

                // Forward cube info headers from processing engine
                var contentType = format == "jpeg" ? "image/jpeg" : "image/png";
                var result = File(imageBytes, contentType);
                if (response.Headers.TryGetValues("X-Cube-Slices", out var slices))
                {
                    Response.Headers["X-Cube-Slices"] = slices.FirstOrDefault();
                }

                if (response.Headers.TryGetValues("X-Cube-Current", out var current))
                {
                    Response.Headers["X-Cube-Current"] = current.FirstOrDefault();
                }

                return result;
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException || ex.CancellationToken.IsCancellationRequested)
            {
                LogPreviewTimedOut(ex, id);
                return StatusCode(504, "Preview generation timed out - file may be too large");
            }
            catch (HttpRequestException ex)
            {
                LogErrorConnectingForPreview(ex, id);
                return StatusCode(503, "Processing engine unavailable");
            }
            catch (Exception ex)
            {
                LogErrorRetrievingPreview(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get histogram data for a FITS file from the processing engine.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <param name="bins">Number of histogram bins (default: 256).</param>
        /// <param name="sliceIndex">For 3D data cubes, which slice to use (-1 = middle).</param>
        /// <param name="stretch">Stretch algorithm (zscale, asinh, log, sqrt, power, histeq, linear).</param>
        /// <param name="gamma">Gamma correction factor (0.1 to 5.0).</param>
        /// <param name="blackPoint">Black point as percentile (0.0 to 1.0).</param>
        /// <param name="whitePoint">White point as percentile (0.0 to 1.0).</param>
        /// <param name="asinhA">Asinh softening parameter (only used when stretch=asinh).</param>
        [HttpGet("{id:length(24)}/histogram")]
        [AllowAnonymous]
        public async Task<IActionResult> GetHistogram(
            string id,
            [FromQuery] int bins = 256,
            [FromQuery] int sliceIndex = -1,
            [FromQuery] string stretch = "zscale",
            [FromQuery] float gamma = 1.0f,
            [FromQuery] float blackPoint = 0.0f,
            [FromQuery] float whitePoint = 1.0f,
            [FromQuery] float asinhA = 0.1f)
        {
            try
            {
                // Validate parameters
                if (bins < 10 || bins > 10000)
                {
                    return BadRequest("Bins must be between 10 and 10000");
                }

                if (gamma < 0.1f || gamma > 5.0f)
                {
                    return BadRequest("Gamma must be between 0.1 and 5.0");
                }

                string[] validStretches = ["zscale", "asinh", "log", "sqrt", "power", "histeq", "linear"];
                if (!validStretches.Contains(stretch))
                {
                    return BadRequest($"Invalid stretch '{stretch}'. Must be one of: {string.Join(", ", validStretches)}");
                }

                if (blackPoint < 0.0f || blackPoint > 1.0f)
                {
                    return BadRequest("Black point must be between 0.0 and 1.0");
                }

                if (whitePoint < 0.0f || whitePoint > 1.0f)
                {
                    return BadRequest("White point must be between 0.0 and 1.0");
                }

                if (blackPoint >= whitePoint)
                {
                    return BadRequest("Black point must be less than white point");
                }

                if (asinhA < 0.001f || asinhA > 1.0f)
                {
                    return BadRequest("Asinh softening parameter must be between 0.001 and 1.0");
                }

                if (sliceIndex < -1)
                {
                    return BadRequest("Slice index must be -1 or greater");
                }

                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                // Check access permissions (Task #74)
                if (!IsDataAccessible(data))
                {
                    var isAuth = User.Identity?.IsAuthenticated ?? false;
                    return isAuth ? Forbid() : NotFound();
                }

                if (string.IsNullOrEmpty(data.FilePath))
                {
                    return BadRequest("File path not found for this data item");
                }

                // Get the relative path within the data directory for security
                var relativePath = data.FilePath;
                if (data.FilePath.StartsWith("/app/data/", StringComparison.Ordinal))
                {
                    relativePath = data.FilePath["/app/data/".Length..];
                }

                var client = httpClientFactory.CreateClient("ProcessingEngine");
                client.Timeout = TimeSpan.FromMinutes(1);

                // Build URL with parameters (including stretch settings)
                var url = $"/histogram/{id}?" +
                    $"file_path={Uri.EscapeDataString(relativePath)}" +
                    $"&bins={bins}" +
                    $"&slice_index={sliceIndex}" +
                    $"&stretch={Uri.EscapeDataString(stretch)}" +
                    $"&gamma={gamma}" +
                    $"&black_point={blackPoint}" +
                    $"&white_point={whitePoint}" +
                    $"&asinh_a={asinhA}";

                var response = await client.GetAsync(url);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    LogHistogramComputationFailed(response.StatusCode, errorContent);
                    return StatusCode((int)response.StatusCode, "Histogram computation failed");
                }

                var content = await response.Content.ReadAsStringAsync();
                return Content(content, "application/json");
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException || ex.CancellationToken.IsCancellationRequested)
            {
                LogHistogramTimedOut(ex, id);
                return StatusCode(504, "Histogram computation timed out");
            }
            catch (HttpRequestException ex)
            {
                LogErrorConnectingForHistogram(ex, id);
                return StatusCode(503, "Processing engine unavailable");
            }
            catch (Exception ex)
            {
                LogErrorComputingHistogram(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get pixel data array for hover coordinate display.
        /// Returns downsampled pixel array, dimensions, scale factor, WCS parameters, and units.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <param name="maxSize">Maximum dimension for downsampling (default: 1200).</param>
        /// <param name="sliceIndex">For 3D data cubes, which slice to use (-1 = middle).</param>
        [HttpGet("{id:length(24)}/pixeldata")]
        [AllowAnonymous]
        public async Task<IActionResult> GetPixelData(
            string id,
            [FromQuery] int maxSize = 1200,
            [FromQuery] int sliceIndex = -1)
        {
            try
            {
                if (maxSize < 100 || maxSize > 8000)
                {
                    return BadRequest("Max size must be between 100 and 8000");
                }

                if (sliceIndex < -1)
                {
                    return BadRequest("Slice index must be -1 or greater");
                }

                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                // Check access permissions (Task #74)
                if (!IsDataAccessible(data))
                {
                    var isAuth = User.Identity?.IsAuthenticated ?? false;
                    return isAuth ? Forbid() : NotFound();
                }

                if (string.IsNullOrEmpty(data.FilePath))
                {
                    return BadRequest("File path not found for this data item");
                }

                // Get the relative path within the data directory for security
                var relativePath = data.FilePath;
                if (data.FilePath.StartsWith("/app/data/", StringComparison.Ordinal))
                {
                    relativePath = data.FilePath["/app/data/".Length..];
                }

                var client = httpClientFactory.CreateClient("ProcessingEngine");
                client.Timeout = TimeSpan.FromMinutes(2);

                // Build URL with parameters
                var url = $"/pixeldata/{id}?" +
                    $"file_path={Uri.EscapeDataString(relativePath)}" +
                    $"&max_size={maxSize}" +
                    $"&slice_index={sliceIndex}";

                var response = await client.GetAsync(url);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    LogPixelDataRetrievalFailed(response.StatusCode, errorContent);
                    return StatusCode((int)response.StatusCode, "Pixel data retrieval failed");
                }

                var content = await response.Content.ReadAsStringAsync();
                return Content(content, "application/json");
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException || ex.CancellationToken.IsCancellationRequested)
            {
                LogPixelDataTimedOut(ex, id);
                return StatusCode(504, "Pixel data retrieval timed out");
            }
            catch (HttpRequestException ex)
            {
                LogErrorConnectingForPixelData(ex, id);
                return StatusCode(503, "Processing engine unavailable");
            }
            catch (Exception ex)
            {
                LogErrorRetrievingPixelData(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get 3D cube metadata for a FITS file.
        /// Returns information about data cube dimensions, slice count, and wavelength WCS.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        [HttpGet("{id:length(24)}/cubeinfo")]
        [AllowAnonymous]
        public async Task<IActionResult> GetCubeInfo(string id)
        {
            try
            {
                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                // Check access permissions (Task #74)
                if (!IsDataAccessible(data))
                {
                    var isAuth = User.Identity?.IsAuthenticated ?? false;
                    return isAuth ? Forbid() : NotFound();
                }

                if (string.IsNullOrEmpty(data.FilePath))
                {
                    return BadRequest("File path not found for this data item");
                }

                // Get the relative path within the data directory for security
                var relativePath = data.FilePath;
                if (data.FilePath.StartsWith("/app/data/", StringComparison.Ordinal))
                {
                    relativePath = data.FilePath["/app/data/".Length..];
                }

                var client = httpClientFactory.CreateClient("ProcessingEngine");
                client.Timeout = TimeSpan.FromSeconds(30);

                // Build URL with parameters
                var url = $"/cubeinfo/{id}?" +
                    $"file_path={Uri.EscapeDataString(relativePath)}";

                var response = await client.GetAsync(url);

                if (!response.IsSuccessStatusCode)
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    LogCubeInfoRetrievalFailed(response.StatusCode, errorContent);
                    return StatusCode((int)response.StatusCode, "Cube info retrieval failed");
                }

                var content = await response.Content.ReadAsStringAsync();
                return Content(content, "application/json");
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException || ex.CancellationToken.IsCancellationRequested)
            {
                LogCubeInfoTimedOut(ex, id);
                return StatusCode(504, "Cube info retrieval timed out");
            }
            catch (HttpRequestException ex)
            {
                LogErrorConnectingForCubeInfo(ex, id);
                return StatusCode(503, "Processing engine unavailable");
            }
            catch (Exception ex)
            {
                LogErrorRetrievingCubeInfo(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Download the original FITS file for a data item.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <returns>The file as a stream.</returns>
        [HttpGet("{id:length(24)}/file")]
        [AllowAnonymous]
        public async Task<IActionResult> GetFile(string id)
        {
            try
            {
                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                // Check access permissions (Task #74)
                if (!IsDataAccessible(data))
                {
                    var isAuth = User.Identity?.IsAuthenticated ?? false;
                    return isAuth ? Forbid() : NotFound();
                }

                if (string.IsNullOrEmpty(data.FilePath) || !System.IO.File.Exists(data.FilePath))
                {
                    return NotFound("File not found on server");
                }

                var contentType = "application/octet-stream";

                if (data.FileName.EndsWith(".fits", StringComparison.Ordinal) || data.FileName.EndsWith(".fits.gz", StringComparison.Ordinal))
                {
                    contentType = "application/fits";
                }

                // Stream the file instead of loading into memory to prevent exhaustion with large files
                var stream = new FileStream(
                    data.FilePath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    bufferSize: 81920,
                    useAsync: true);

                return File(stream, contentType, data.FileName);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingFile(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Filter data items by type (image, sensor, spectral, calibration, metadata).
        /// </summary>
        /// <param name="dataType">The data type to filter by.</param>
        /// <returns>List of matching data items.</returns>
        [HttpGet("type/{dataType}")]
        [AllowAnonymous]
        public async Task<ActionResult<List<DataResponse>>> GetByType(string dataType)
        {
            try
            {
                var data = await mongoDBService.GetByDataTypeAsync(dataType);
                data = FilterAccessibleData(data);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingByType(ex, dataType);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Filter data items by processing status (pending, processing, completed, failed).
        /// </summary>
        /// <param name="status">The processing status to filter by.</param>
        /// <returns>List of matching data items.</returns>
        [HttpGet("status/{status}")]
        [AllowAnonymous]
        public async Task<ActionResult<List<DataResponse>>> GetByStatus(string status)
        {
            try
            {
                var data = await mongoDBService.GetByStatusAsync(status);
                data = FilterAccessibleData(data);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingByStatus(ex, status);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get all data items belonging to a specific user.
        /// </summary>
        /// <param name="userId">The user ID to filter by.</param>
        /// <returns>List of user's data items.</returns>
        [HttpGet("user/{userId}")]
        public async Task<ActionResult<List<DataResponse>>> GetByUserId(string userId)
        {
            try
            {
                // Task #75: Non-admin users can only query their own data
                var currentUserId = GetCurrentUserId();
                if (!IsCurrentUserAdmin() && currentUserId != userId)
                {
                    return Forbid();
                }

                var data = await mongoDBService.GetByUserIdAsync(userId);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingByUser(ex, userId);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Filter data items by tags (comma-separated list).
        /// </summary>
        /// <param name="tags">Comma-separated list of tags to filter by.</param>
        /// <returns>List of matching data items.</returns>
        [HttpGet("tags/{tags}")]
        [AllowAnonymous]
        public async Task<ActionResult<List<DataResponse>>> GetByTags(string tags)
        {
            try
            {
                var tagList = tags.Split(',').Select(t => t.Trim()).ToList();
                var data = await mongoDBService.GetByTagsAsync(tagList);
                data = FilterAccessibleData(data);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingByTags(ex, tags);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Create a new JWST data entry (metadata only, no file upload).
        /// </summary>
        /// <param name="request">The data creation request.</param>
        /// <returns>The created data item.</returns>
        [HttpPost]
        public async Task<ActionResult<DataResponse>> Create([FromBody] CreateDataRequest request)
        {
            try
            {
                var jwstData = new JwstDataModel
                {
                    FileName = request.FileName,
                    DataType = request.DataType,
                    Description = request.Description,
                    Metadata = request.Metadata ?? [],
                    Tags = request.Tags ?? [],
                    UserId = request.UserId,
                    UploadDate = DateTime.UtcNow,
                    ProcessingStatus = ProcessingStatuses.Pending,
                    ImageInfo = request.ImageInfo,
                    SensorInfo = request.SensorInfo,
                    SpectralInfo = request.SpectralInfo,
                    CalibrationInfo = request.CalibrationInfo,
                };

                await mongoDBService.CreateAsync(jwstData);
                return CreatedAtAction(nameof(Get), new { id = jwstData.Id }, MapToDataResponse(jwstData));
            }
            catch (Exception ex)
            {
                LogErrorCreatingData(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Upload a JWST data file (FITS, images, CSV, JSON). Max 100MB.
        /// </summary>
        /// <param name="request">The file upload request with metadata.</param>
        /// <returns>The created data item.</returns>
        [HttpPost("upload")]
        [RequestSizeLimit(104857600)] // 100MB
        public async Task<ActionResult<DataResponse>> Upload([FromForm] FileUploadRequest request)
        {
            try
            {
                if (request.File == null || request.File.Length == 0)
                {
                    return BadRequest("No file uploaded");
                }

                // Validate extension
                var allowedExtensions = configuration.GetSection("FileStorage:AllowedExtensions").Get<string[]>()
                    ?? [".fits", ".fits.gz", ".jpg", ".png", ".tiff", ".csv", ".json"];

                var fileName = request.File.FileName.ToLowerInvariant();

                // Handle compound extensions like .fits.gz
                var extension = fileName.EndsWith(".fits.gz", StringComparison.Ordinal)
                    ? ".fits.gz"
                    : Path.GetExtension(fileName);

                if (!allowedExtensions.Contains(extension))
                {
                    return BadRequest($"File type {extension} is not allowed");
                }

                // Validate file content matches extension (security: prevent malicious files with renamed extensions)
                var (isValidContent, contentError) = await FileContentValidator.ValidateFileContentAsync(request.File);
                if (!isValidContent)
                {
                    LogFileValidationFailed(request.File.FileName, contentError ?? "Unknown error");
                    return BadRequest(contentError);
                }

                // Ensure uploads directory exists
                var uploadsDir = Path.Combine(Directory.GetCurrentDirectory(), "data", "uploads");
                Directory.CreateDirectory(uploadsDir);

                // Generate unique filename
                var uniqueFileName = $"{Guid.NewGuid()}{extension}";
                var filePath = Path.Combine(uploadsDir, uniqueFileName);

                // Save file
                using (var stream = new FileStream(filePath, FileMode.Create))
                {
                    await request.File.CopyToAsync(stream);
                }

                // Determine data type if not provided
                var dataType = request.DataType;
                if (string.IsNullOrEmpty(dataType))
                {
                    dataType = extension switch
                    {
                        ".fits" or ".fits.gz" => DataTypes.Image, // Could be spectral too, but default to image
                        ".jpg" or ".png" or ".tiff" => DataTypes.Image,
                        ".csv" => DataTypes.Sensor,
                        ".json" => DataTypes.Metadata,
                        _ => DataTypes.Raw,
                    };
                }

                // Create data model
                var jwstData = new JwstDataModel
                {
                    FileName = request.File.FileName,
                    DataType = dataType,
                    Description = request.Description,
                    Tags = request.Tags ?? [],
                    FilePath = filePath,
                    FileSize = request.File.Length,
                    UploadDate = DateTime.UtcNow,
                    ProcessingStatus = ProcessingStatuses.Pending,
                    FileFormat = extension.TrimStart('.'),

                    // Basic image metadata if it's an image
                    ImageInfo = (dataType == DataTypes.Image) ? new ImageMetadata { Format = extension.TrimStart('.') } : null,
                };

                await mongoDBService.CreateAsync(jwstData);

                // If it's a FITS file, trigger background processing (placeholder)
                if (extension.Contains("fits", StringComparison.Ordinal))
                {
                    // _backgroundQueue.QueueBackgroundWorkItem(async token => ...);
                    // For now just logging
                    LogFitsFileUploaded(jwstData.Id);
                }

                return CreatedAtAction(nameof(Get), new { id = jwstData.Id }, MapToDataResponse(jwstData));
            }
            catch (Exception ex)
            {
                LogErrorUploadingFile(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Update an existing data item's metadata.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <param name="request">The update request with fields to modify.</param>
        /// <returns>No content on success.</returns>
        [HttpPut("{id:length(24)}")]
        public async Task<IActionResult> Update(string id, [FromBody] UpdateDataRequest request)
        {
            try
            {
                var existingData = await mongoDBService.GetAsync(id);
                if (existingData == null)
                {
                    return NotFound();
                }

                // Check modification permissions (owner or admin only)
                if (!CanModifyData(existingData))
                {
                    return Forbid();
                }

                // Update only provided fields
                if (!string.IsNullOrEmpty(request.FileName))
                {
                    existingData.FileName = request.FileName;
                }

                if (!string.IsNullOrEmpty(request.Description))
                {
                    existingData.Description = request.Description;
                }

                if (request.Metadata != null)
                {
                    existingData.Metadata = request.Metadata;
                }

                if (request.Tags != null)
                {
                    existingData.Tags = request.Tags;
                }

                if (request.IsPublic.HasValue)
                {
                    existingData.IsPublic = request.IsPublic.Value;
                }

                if (request.SharedWith != null)
                {
                    existingData.SharedWith = request.SharedWith;
                }

                // Update type-specific metadata
                if (request.ImageInfo != null)
                {
                    existingData.ImageInfo = request.ImageInfo;
                }

                if (request.SensorInfo != null)
                {
                    existingData.SensorInfo = request.SensorInfo;
                }

                if (request.SpectralInfo != null)
                {
                    existingData.SpectralInfo = request.SpectralInfo;
                }

                if (request.CalibrationInfo != null)
                {
                    existingData.CalibrationInfo = request.CalibrationInfo;
                }

                await mongoDBService.UpdateAsync(id, existingData);
                return NoContent();
            }
            catch (Exception ex)
            {
                LogErrorUpdatingData(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Delete a data item. Only the owner or admin can delete.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <returns>No content on success.</returns>
        [HttpDelete("{id:length(24)}")]
        public async Task<IActionResult> Delete(string id)
        {
            try
            {
                var existingData = await mongoDBService.GetAsync(id);
                if (existingData == null)
                {
                    return NotFound();
                }

                // Check modification permissions (owner or admin only)
                if (!CanModifyData(existingData))
                {
                    return Forbid();
                }

                await mongoDBService.RemoveAsync(id);
                return NoContent();
            }
            catch (Exception ex)
            {
                LogErrorDeletingData(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Trigger processing on a data item using the Python processing engine.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <param name="request">The processing parameters.</param>
        /// <returns>Processing job status.</returns>
        [HttpPost("{id:length(24)}/process")]
        public async Task<ActionResult<ProcessingResponse>> ProcessData(string id, [FromBody] ProcessingRequest request)
        {
            try
            {
                var existingData = await mongoDBService.GetAsync(id);
                if (existingData == null)
                {
                    return NotFound();
                }

                // Update status to processing
                await mongoDBService.UpdateProcessingStatusAsync(id, ProcessingStatuses.Processing);

                // TODO: Send to Python processing engine
                // This will be implemented in Phase 3
                var jobId = Guid.NewGuid().ToString();
                return Accepted(new ProcessingResponse
                {
                    JobId = jobId,
                    DataId = id,
                    Status = "processing",
                    Message = "Processing job created successfully",
                    CreatedAt = DateTime.UtcNow,
                });
            }
            catch (Exception ex)
            {
                LogErrorProcessingData(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get processing results for a data item.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <returns>List of processing results.</returns>
        [HttpGet("{id:length(24)}/processing-results")]
        [AllowAnonymous]
        public async Task<ActionResult<List<ProcessingResult>>> GetProcessingResults(string id)
        {
            try
            {
                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                // Check access permissions (Task #74)
                if (!IsDataAccessible(data))
                {
                    var isAuth = User.Identity?.IsAuthenticated ?? false;
                    return isAuth ? Forbid() : NotFound();
                }

                return Ok(data.ProcessingResults);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingProcessingResults(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Run validation on a data item.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <returns>Validation result.</returns>
        [HttpPost("{id:length(24)}/validate")]
        public async Task<IActionResult> ValidateData(string id)
        {
            try
            {
                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                // TODO: Implement actual validation logic
                var isValid = true; // Placeholder
                var validationMessage = isValid ? null : "Validation failed";

                await mongoDBService.UpdateValidationStatusAsync(id, isValid, validationMessage);

                return Ok(new
                {
                    isValid,
                    validationMessage,
                    validatedAt = DateTime.UtcNow,
                });
            }
            catch (Exception ex)
            {
                LogErrorValidatingData(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Update sharing settings for a data item.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <param name="request">The sharing configuration.</param>
        /// <returns>Success message.</returns>
        [HttpPost("{id:length(24)}/share")]
        public async Task<IActionResult> ShareData(string id, [FromBody] ShareDataRequest request)
        {
            try
            {
                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                if (request.SharedWith != null)
                {
                    data.SharedWith = request.SharedWith;
                }

                if (request.IsPublic.HasValue)
                {
                    data.IsPublic = request.IsPublic.Value;
                }

                await mongoDBService.UpdateAsync(id, data);

                return Ok(new { message = "Data sharing updated successfully" });
            }
            catch (Exception ex)
            {
                LogErrorUpdatingSharing(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Archive a data item (soft delete).
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <returns>Success message.</returns>
        [HttpPost("{id:length(24)}/archive")]
        public async Task<IActionResult> ArchiveData(string id)
        {
            try
            {
                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                await mongoDBService.ArchiveAsync(id);
                return Ok(new { message = "Data archived successfully" });
            }
            catch (Exception ex)
            {
                LogErrorArchivingData(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Restore an archived data item.
        /// </summary>
        /// <param name="id">The data item ID.</param>
        /// <returns>Success message.</returns>
        [HttpPost("{id:length(24)}/unarchive")]
        public async Task<IActionResult> UnarchiveData(string id)
        {
            try
            {
                var data = await mongoDBService.GetAsync(id);
                if (data == null)
                {
                    return NotFound();
                }

                await mongoDBService.UnarchiveAsync(id);
                return Ok(new { message = "Data unarchived successfully" });
            }
            catch (Exception ex)
            {
                LogErrorUnarchivingData(ex, id);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get all archived data items.
        /// </summary>
        /// <returns>List of archived data items.</returns>
        [HttpGet("archived")]
        public async Task<ActionResult<List<DataResponse>>> GetArchivedData()
        {
            try
            {
                var data = await mongoDBService.GetArchivedAsync();
                data = FilterAccessibleData(data);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingArchivedData(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Advanced faceted search with filters and statistics.
        /// </summary>
        /// <param name="request">Search filters and pagination.</param>
        /// <returns>Search results with facet counts.</returns>
        [HttpPost("search")]
        public async Task<ActionResult<SearchResponse>> Search([FromBody] SearchRequest request)
        {
            try
            {
                var response = await mongoDBService.SearchWithFacetsAsync(request);

                // Task #75: Filter search results to accessible data
                if (!IsCurrentUserAdmin())
                {
                    var userId = GetCurrentUserId();
                    response.Data = [.. response.Data.Where(d =>
                        d.IsPublic || d.UserId == userId)];
                    response.TotalCount = response.Data.Count;
                    response.TotalPages = (int)Math.Ceiling((double)response.TotalCount / request.PageSize);
                }

                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorAdvancedSearch(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get aggregate statistics about the data collection.
        /// </summary>
        /// <returns>Statistics including counts by type, status, and common tags.</returns>
        [HttpGet("statistics")]
        [AllowAnonymous]
        public async Task<ActionResult<DataStatistics>> GetStatistics()
        {
            try
            {
                var stats = await mongoDBService.GetStatisticsAsync();
                return Ok(stats);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingStatistics(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get all publicly shared data items.
        /// </summary>
        /// <returns>List of public data items.</returns>
        [HttpGet("public")]
        [AllowAnonymous]
        public async Task<ActionResult<List<DataResponse>>> GetPublicData()
        {
            try
            {
                var data = await mongoDBService.GetPublicDataAsync();
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingPublicData(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get all validated data items.
        /// </summary>
        /// <returns>List of validated data items.</returns>
        [HttpGet("validated")]
        [AllowAnonymous]
        public async Task<ActionResult<List<DataResponse>>> GetValidatedData()
        {
            try
            {
                var data = await mongoDBService.GetValidatedDataAsync();
                data = FilterAccessibleData(data);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingValidatedData(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Filter data items by file format (fits, jpg, png, csv, json).
        /// </summary>
        /// <param name="fileFormat">The file format to filter by.</param>
        /// <returns>List of matching data items.</returns>
        [HttpGet("format/{fileFormat}")]
        [AllowAnonymous]
        public async Task<ActionResult<List<DataResponse>>> GetByFileFormat(string fileFormat)
        {
            try
            {
                var data = await mongoDBService.GetByFileFormatAsync(fileFormat);
                data = FilterAccessibleData(data);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingByFileFormat(ex, fileFormat);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get the most commonly used tags.
        /// </summary>
        /// <param name="limit">Maximum number of tags to return (default: 20).</param>
        /// <returns>List of common tags.</returns>
        [HttpGet("tags")]
        [AllowAnonymous]
        public async Task<ActionResult<List<string>>> GetCommonTags([FromQuery] int limit = 20)
        {
            try
            {
                var stats = await mongoDBService.GetStatisticsAsync();
                return Ok(stats.MostCommonTags.Take(limit).ToList());
            }
            catch (Exception ex)
            {
                LogErrorRetrievingTags(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Bulk update tags on multiple data items (admin only).
        /// </summary>
        /// <param name="request">List of data IDs and tags to apply.</param>
        /// <returns>Success message.</returns>
        [HttpPost("bulk/tags")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> BulkUpdateTags([FromBody] BulkTagsRequest request)
        {
            try
            {
                if (request.DataIds.Count == 0)
                {
                    return BadRequest("No data IDs provided");
                }

                await mongoDBService.BulkUpdateTagsAsync(request.DataIds, request.Tags, request.Append);
                return Ok(new { message = "Tags updated successfully" });
            }
            catch (Exception ex)
            {
                LogErrorBulkTagUpdate(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Bulk update processing status on multiple data items (admin only).
        /// </summary>
        /// <param name="request">List of data IDs and status to apply.</param>
        /// <returns>Success message.</returns>
        [HttpPost("bulk/status")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> BulkUpdateStatus([FromBody] BulkStatusRequest request)
        {
            try
            {
                if (request.DataIds.Count == 0)
                {
                    return BadRequest("No data IDs provided");
                }

                await mongoDBService.BulkUpdateStatusAsync(request.DataIds, request.Status);
                return Ok(new { message = "Status updated successfully" });
            }
            catch (Exception ex)
            {
                LogErrorBulkStatusUpdate(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get lineage tree for a specific observation (all processing levels).
        /// </summary>
        /// <param name="observationBaseId">The base observation ID.</param>
        /// <returns>Lineage tree with all related files.</returns>
        [HttpGet("lineage/{observationBaseId}")]
        [AllowAnonymous]
        public async Task<ActionResult<LineageResponse>> GetLineage(string observationBaseId)
        {
            try
            {
                var data = await mongoDBService.GetLineageTreeAsync(observationBaseId);
                data = FilterAccessibleData(data);
                if (data.Count == 0)
                {
                    return NotFound($"No data found for observation: {observationBaseId}");
                }

                var response = new LineageResponse
                {
                    ObservationBaseId = observationBaseId,
                    TotalFiles = data.Count,
                    LevelCounts = data
                        .GroupBy(d => d.ProcessingLevel ?? "unknown")
                        .ToDictionary(g => g.Key, g => g.Count()),
                    Files = [.. data.Select(d => new LineageFileInfo
                    {
                        Id = d.Id,
                        FileName = d.FileName,
                        ProcessingLevel = d.ProcessingLevel ?? "unknown",
                        DataType = d.DataType,
                        ParentId = d.ParentId,
                        FileSize = d.FileSize,
                        UploadDate = d.UploadDate,
                        TargetName = d.ImageInfo?.TargetName,
                        Instrument = d.ImageInfo?.Instrument,
                    })],
                };

                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingLineage(ex, observationBaseId);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Get all lineage groups in the database.
        /// </summary>
        /// <returns>Dictionary of observation IDs to their lineage trees.</returns>
        [HttpGet("lineage")]
        [AllowAnonymous]
        public async Task<ActionResult<Dictionary<string, LineageResponse>>> GetAllLineages()
        {
            try
            {
                var grouped = await mongoDBService.GetLineageGroupedAsync();

                // Task #74: Filter each lineage group to accessible data
                var filteredGrouped = grouped.ToDictionary(
                    kvp => kvp.Key,
                    kvp => FilterAccessibleData(kvp.Value));

                // Remove empty groups after filtering
                filteredGrouped = filteredGrouped
                    .Where(kvp => kvp.Value.Count > 0)
                    .ToDictionary(kvp => kvp.Key, kvp => kvp.Value);

                var response = filteredGrouped.ToDictionary(
                    kvp => kvp.Key,
                    kvp => new LineageResponse
                    {
                        ObservationBaseId = kvp.Key,
                        TotalFiles = kvp.Value.Count,
                        LevelCounts = kvp.Value
                            .GroupBy(d => d.ProcessingLevel ?? "unknown")
                            .ToDictionary(g => g.Key, g => g.Count()),
                        Files = [.. kvp.Value.Select(d => new LineageFileInfo
                        {
                            Id = d.Id,
                            FileName = d.FileName,
                            ProcessingLevel = d.ProcessingLevel ?? "unknown",
                            DataType = d.DataType,
                            ParentId = d.ParentId,
                            FileSize = d.FileSize,
                            UploadDate = d.UploadDate,
                            TargetName = d.ImageInfo?.TargetName,
                            Instrument = d.ImageInfo?.Instrument,
                        })],
                    });

                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorRetrievingAllLineages(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Delete an entire observation including all files and database records.
        /// </summary>
        [HttpDelete("observation/{observationBaseId}")]
        public async Task<ActionResult<DeleteObservationResponse>> DeleteObservation(
            string observationBaseId,
            [FromQuery] bool confirm = false)
        {
            if (string.IsNullOrWhiteSpace(observationBaseId) || !ObsBaseIdPattern.IsMatch(observationBaseId))
            {
                return BadRequest("Invalid observation base ID");
            }

            try
            {
                // Get all records for this observation
                var records = await mongoDBService.GetByObservationBaseIdAsync(observationBaseId);

                if (records.Count == 0)
                {
                    return NotFound(new DeleteObservationResponse
                    {
                        ObservationBaseId = observationBaseId,
                        FileCount = 0,
                        TotalSizeBytes = 0,
                        FileNames = [],
                        Deleted = false,
                        Message = $"No records found for observation: {observationBaseId}",
                    });
                }

                var response = new DeleteObservationResponse
                {
                    ObservationBaseId = observationBaseId,
                    FileCount = records.Count,
                    TotalSizeBytes = records.Sum(r => r.FileSize),
                    FileNames = [.. records.Select(r => r.FileName)],
                    Deleted = false,
                    Message = $"Found {records.Count} files ({FormatFileSize(records.Sum(r => r.FileSize))})",
                };

                // If not confirming, just return the preview
                if (!confirm)
                {
                    return Ok(response);
                }

                // Actually delete files and records
                var deletedFiles = 0;
                var failedFiles = new List<string>();

                // Collect unique file paths and directories
                var filePaths = records
                    .Where(r => !string.IsNullOrEmpty(r.FilePath))
                    .Select(r => r.FilePath!)
                    .Distinct()
                    .ToList();

                // Delete files from disk
                foreach (var filePath in filePaths)
                {
                    try
                    {
                        if (System.IO.File.Exists(filePath))
                        {
                            System.IO.File.Delete(filePath);
                            deletedFiles++;
                            LogDeletedFile(filePath);
                        }
                        else
                        {
                            LogFileNotFound(filePath);
                        }
                    }
                    catch (Exception ex)
                    {
                        LogFailedToDeleteFile(ex, filePath);
                        failedFiles.Add(filePath);
                    }
                }

                // Try to remove the observation directory if empty
                var observationDir = Path.Combine(
                    Directory.GetCurrentDirectory(),
                    "data",
                    "mast",
                    observationBaseId);

                try
                {
                    if (Directory.Exists(observationDir) && !Directory.EnumerateFileSystemEntries(observationDir).Any())
                    {
                        Directory.Delete(observationDir);
                        LogRemovedEmptyDirectory(observationDir);
                    }
                }
                catch (Exception ex)
                {
                    LogCouldNotRemoveDirectory(ex, observationDir);
                }

                // Delete all database records
                var deleteResult = await mongoDBService.RemoveByObservationBaseIdAsync(observationBaseId);
                LogDeletedDbRecords(deleteResult.DeletedCount, observationBaseId);

                response.Deleted = true;
                response.Message = failedFiles.Count > 0
                    ? $"Deleted {deleteResult.DeletedCount} records and {deletedFiles} files. Failed to delete {failedFiles.Count} files."
                    : $"Successfully deleted {deleteResult.DeletedCount} records and {deletedFiles} files";

                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorDeletingObservation(ex, observationBaseId);
                return StatusCode(500, new DeleteObservationResponse
                {
                    ObservationBaseId = observationBaseId,
                    Deleted = false,
                    Message = "Error deleting observation",
                });
            }
        }

        /// <summary>
        /// Delete or preview deletion of all files at a specific processing level within an observation.
        /// </summary>
        /// <param name="observationBaseId">The observation ID.</param>
        /// <param name="processingLevel">The processing level (L1, L2a, L2b, L3).</param>
        /// <param name="confirm">If false, returns preview; if true, executes deletion.</param>
        [HttpDelete("observation/{observationBaseId}/level/{processingLevel}")]
        public async Task<ActionResult<DeleteLevelResponse>> DeleteObservationLevel(
            string observationBaseId,
            string processingLevel,
            [FromQuery] bool confirm = false)
        {
            if (string.IsNullOrWhiteSpace(observationBaseId) || !ObsBaseIdPattern.IsMatch(observationBaseId))
            {
                return BadRequest("Invalid observation base ID");
            }

            try
            {
                // Get all records for this observation and level
                var records = await mongoDBService.GetByObservationAndLevelAsync(observationBaseId, processingLevel);

                if (records.Count == 0)
                {
                    return NotFound(new DeleteLevelResponse
                    {
                        ObservationBaseId = observationBaseId,
                        ProcessingLevel = processingLevel,
                        FileCount = 0,
                        TotalSizeBytes = 0,
                        FileNames = [],
                        Deleted = false,
                        Message = $"No {processingLevel} files found for observation: {observationBaseId}",
                    });
                }

                var response = new DeleteLevelResponse
                {
                    ObservationBaseId = observationBaseId,
                    ProcessingLevel = processingLevel,
                    FileCount = records.Count,
                    TotalSizeBytes = records.Sum(r => r.FileSize),
                    FileNames = [.. records.Select(r => r.FileName)],
                    Deleted = false,
                    Message = $"Found {records.Count} {processingLevel} files ({FormatFileSize(records.Sum(r => r.FileSize))})",
                };

                // If not confirming, just return the preview
                if (!confirm)
                {
                    return Ok(response);
                }

                // Actually delete files and records
                var deletedFiles = 0;
                var failedFiles = new List<string>();

                // Collect unique file paths
                var filePaths = records
                    .Where(r => !string.IsNullOrEmpty(r.FilePath))
                    .Select(r => r.FilePath!)
                    .Distinct()
                    .ToList();

                // Delete files from disk
                foreach (var filePath in filePaths)
                {
                    try
                    {
                        if (System.IO.File.Exists(filePath))
                        {
                            System.IO.File.Delete(filePath);
                            deletedFiles++;
                            LogDeletedFile(filePath);
                        }
                        else
                        {
                            LogFileNotFound(filePath);
                        }
                    }
                    catch (Exception ex)
                    {
                        LogFailedToDeleteFile(ex, filePath);
                        failedFiles.Add(filePath);
                    }
                }

                // Delete all database records for this level
                var deleteResult = await mongoDBService.RemoveByObservationAndLevelAsync(observationBaseId, processingLevel);
                LogDeletedLevelDbRecords(deleteResult.DeletedCount, processingLevel, observationBaseId);

                response.Deleted = true;
                response.Message = failedFiles.Count > 0
                    ? $"Deleted {deleteResult.DeletedCount} {processingLevel} records and {deletedFiles} files. Failed to delete {failedFiles.Count} files."
                    : $"Successfully deleted {deleteResult.DeletedCount} {processingLevel} records and {deletedFiles} files";

                return Ok(response);
            }
            catch (Exception ex)
            {
                LogErrorDeletingLevel(ex, processingLevel, observationBaseId);
                return StatusCode(500, new DeleteLevelResponse
                {
                    ObservationBaseId = observationBaseId,
                    ProcessingLevel = processingLevel,
                    Deleted = false,
                    Message = $"Error deleting {processingLevel} files",
                });
            }
        }

        /// <summary>
        /// Archive all files at a specific processing level within an observation.
        /// </summary>
        /// <param name="observationBaseId">The observation ID.</param>
        /// <param name="processingLevel">The processing level (L1, L2a, L2b, L3).</param>
        [HttpPost("observation/{observationBaseId}/level/{processingLevel}/archive")]
        public async Task<ActionResult<ArchiveLevelResponse>> ArchiveObservationLevel(
            string observationBaseId,
            string processingLevel)
        {
            try
            {
                // First check if files exist at this level
                var records = await mongoDBService.GetByObservationAndLevelAsync(observationBaseId, processingLevel);

                if (records.Count == 0)
                {
                    return NotFound(new ArchiveLevelResponse
                    {
                        ObservationBaseId = observationBaseId,
                        ProcessingLevel = processingLevel,
                        ArchivedCount = 0,
                        Message = $"No {processingLevel} files found for observation: {observationBaseId}",
                    });
                }

                // Archive all files at this level
                var archivedCount = await mongoDBService.ArchiveByObservationAndLevelAsync(observationBaseId, processingLevel);

                LogArchivedLevelFiles(archivedCount, processingLevel, observationBaseId);

                return Ok(new ArchiveLevelResponse
                {
                    ObservationBaseId = observationBaseId,
                    ProcessingLevel = processingLevel,
                    ArchivedCount = (int)archivedCount,
                    Message = $"Successfully archived {archivedCount} {processingLevel} files",
                });
            }
            catch (Exception ex)
            {
                LogErrorArchivingLevel(ex, processingLevel, observationBaseId);
                return StatusCode(500, new ArchiveLevelResponse
                {
                    ObservationBaseId = observationBaseId,
                    ProcessingLevel = processingLevel,
                    ArchivedCount = 0,
                    Message = $"Error archiving {processingLevel} files",
                });
            }
        }

        /// <summary>
        /// Migrate existing data to populate processing level fields.
        /// </summary>
        [HttpPost("migrate/processing-levels")]
        public async Task<IActionResult> MigrateProcessingLevels()
        {
            try
            {
                var allData = await mongoDBService.GetAsync();
                var updated = 0;

                foreach (var item in allData)
                {
                    // Skip if already migrated
                    if (!string.IsNullOrEmpty(item.ProcessingLevel) &&
                        !string.IsNullOrEmpty(item.ObservationBaseId))
                    {
                        continue;
                    }

                    var needsUpdate = false;

                    // Parse processing level from filename
                    if (string.IsNullOrEmpty(item.ProcessingLevel))
                    {
                        var fileNameLower = item.FileName.ToLowerInvariant();
                        foreach (var kvp in ProcessingLevels.SuffixToLevel)
                        {
                            if (fileNameLower.Contains(kvp.Key))
                            {
                                item.ProcessingLevel = kvp.Value;
                                needsUpdate = true;
                                break;
                            }
                        }

                        if (string.IsNullOrEmpty(item.ProcessingLevel))
                        {
                            item.ProcessingLevel = ProcessingLevels.Unknown;
                            needsUpdate = true;
                        }
                    }

                    // Parse observation base ID from filename or metadata
                    if (string.IsNullOrEmpty(item.ObservationBaseId))
                    {
                        var obsMatch = MyRegex().Match(item.FileName);

                        if (obsMatch.Success)
                        {
                            item.ObservationBaseId = obsMatch.Groups[1].Value.ToLowerInvariant();
                            needsUpdate = true;
                        }
                        else if (item.Metadata.TryGetValue("mast_obs_id", out var mastObsId) && mastObsId != null)
                        {
                            item.ObservationBaseId = mastObsId.ToString();
                            needsUpdate = true;
                        }
                    }

                    // Parse exposure ID from filename
                    if (string.IsNullOrEmpty(item.ExposureId))
                    {
                        var expMatch = System.Text.RegularExpressions.Regex.Match(
                            item.FileName,
                            @"(jw\d{5}\d{3}\d{3}_\d{5}_\d{5})",
                            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

                        if (expMatch.Success)
                        {
                            item.ExposureId = expMatch.Groups[1].Value.ToLowerInvariant();
                            needsUpdate = true;
                        }
                    }

                    if (needsUpdate)
                    {
                        await mongoDBService.UpdateAsync(item.Id, item);
                        updated++;
                    }
                }

                return Ok(new { message = $"Migration complete. Updated {updated} of {allData.Count} records." });
            }
            catch (Exception ex)
            {
                LogErrorDuringMigration(ex);
                return StatusCode(500, "Migration failed");
            }
        }

        /// <summary>
        /// Migrate existing data to reclassify data types and set IsViewable based on filename patterns.
        /// </summary>
        [HttpPost("migrate/data-types")]
        public async Task<IActionResult> MigrateDataTypes()
        {
            try
            {
                var allData = await mongoDBService.GetAsync();
                var updated = 0;

                foreach (var item in allData)
                {
                    var fileNameLower = item.FileName.ToLowerInvariant();
                    var needsUpdate = false;
                    var newDataType = item.DataType;
                    var newIsViewable = item.IsViewable;

                    // Determine data type and viewability based on suffix
                    // Non-viewable table/catalog files
                    if (fileNameLower.Contains("_asn", StringComparison.Ordinal) || fileNameLower.Contains("_pool", StringComparison.Ordinal))
                    {
                        newDataType = DataTypes.Metadata;
                        newIsViewable = false;
                    }
                    else if (fileNameLower.Contains("_cat", StringComparison.Ordinal) || fileNameLower.Contains("_phot", StringComparison.Ordinal))
                    {
                        newDataType = DataTypes.Metadata;
                        newIsViewable = false;
                    }
                    else if (fileNameLower.Contains("_x1d", StringComparison.Ordinal) || fileNameLower.Contains("_x1dints", StringComparison.Ordinal) || fileNameLower.Contains("_c1d", StringComparison.Ordinal))
                    {
                        newDataType = DataTypes.Spectral;
                        newIsViewable = false; // 1D extracted spectra are tables
                    }

                    // Viewable image files
                    else if (fileNameLower.Contains("_uncal", StringComparison.Ordinal))
                    {
                        newDataType = DataTypes.Raw;
                        newIsViewable = true;
                    }
                    else if (fileNameLower.Contains("_rate", StringComparison.Ordinal) || fileNameLower.Contains("_rateints", StringComparison.Ordinal))
                    {
                        newDataType = DataTypes.Sensor;
                        newIsViewable = true;
                    }
                    else if (fileNameLower.Contains("_s2d", StringComparison.Ordinal) || fileNameLower.Contains("_s3d", StringComparison.Ordinal))
                    {
                        newDataType = DataTypes.Spectral;
                        newIsViewable = true; // 2D/3D spectral images are viewable
                    }
                    else if (fileNameLower.Contains("_cal", StringComparison.Ordinal) || fileNameLower.Contains("_calints", StringComparison.Ordinal) ||
                             fileNameLower.Contains("_crf", StringComparison.Ordinal) || fileNameLower.Contains("_i2d", StringComparison.Ordinal))
                    {
                        newDataType = DataTypes.Image;
                        newIsViewable = true;
                    }
                    else if (fileNameLower.Contains("_flat", StringComparison.Ordinal) || fileNameLower.Contains("_dark", StringComparison.Ordinal) || fileNameLower.Contains("_bias", StringComparison.Ordinal))
                    {
                        newDataType = DataTypes.Calibration;
                        newIsViewable = true;
                    }

                    // Check if update is needed
                    if (item.DataType != newDataType || item.IsViewable != newIsViewable)
                    {
                        item.DataType = newDataType;
                        item.IsViewable = newIsViewable;
                        needsUpdate = true;
                    }

                    if (needsUpdate)
                    {
                        await mongoDBService.UpdateAsync(item.Id, item);
                        updated++;
                        LogMigratedDataType(item.FileName, item.DataType, item.IsViewable);
                    }
                }

                return Ok(new { message = $"Data type migration complete. Updated {updated} of {allData.Count} records." });
            }
            catch (Exception ex)
            {
                LogErrorDuringDataTypeMigration(ex);
                return StatusCode(500, "Data type migration failed");
            }
        }

        /// <summary>
        /// Get the thumbnail PNG for a data item.
        /// Returns the raw PNG bytes with cache headers.
        /// </summary>
        [HttpGet("{id:length(24)}/thumbnail")]
        [AllowAnonymous]
        public async Task<IActionResult> GetThumbnail(string id)
        {
            try
            {
                var thumbnailData = await mongoDBService.GetThumbnailAsync(id);
                if (thumbnailData == null)
                {
                    // Check if the record exists at all
                    var record = await mongoDBService.GetAsync(id);
                    if (record == null)
                    {
                        return NotFound();
                    }

                    // Record exists but no thumbnail yet
                    return NoContent();
                }

                Response.Headers["Cache-Control"] = "public, max-age=86400";
                return File(thumbnailData, "image/png");
            }
            catch (Exception ex)
            {
                LogErrorRetrievingThumbnail(ex, id);
                return StatusCode(500, "Failed to retrieve thumbnail");
            }
        }

        /// <summary>
        /// Generate thumbnails for all viewable records that don't have one yet.
        /// Runs in the background and returns immediately with a count of queued items.
        /// </summary>
        [HttpPost("generate-thumbnails")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<ActionResult> GenerateThumbnails()
        {
            try
            {
                var ids = await mongoDBService.GetViewableWithoutThumbnailIdsAsync();
                if (ids.Count == 0)
                {
                    return Ok(new { queued = 0, message = "All viewable records already have thumbnails" });
                }

                // Fire-and-forget background generation
                _ = Task.Run(() => thumbnailService.GenerateThumbnailsForIdsAsync(ids));

                return Ok(new { queued = ids.Count });
            }
            catch (Exception ex)
            {
                LogErrorStartingThumbnailGeneration(ex);
                return StatusCode(500, "Failed to start thumbnail generation");
            }
        }

        private static string FormatFileSize(long bytes)
        {
            if (bytes >= 1073741824)
            {
                return $"{bytes / 1073741824.0:F2} GB";
            }

            if (bytes >= 1048576)
            {
                return $"{bytes / 1048576.0:F2} MB";
            }

            if (bytes >= 1024)
            {
                return $"{bytes / 1024.0:F2} KB";
            }

            return $"{bytes} bytes";
        }

        [System.Text.RegularExpressions.GeneratedRegex(@"(jw\d{5}-o\d+_t\d+_[a-z]+)", System.Text.RegularExpressions.RegexOptions.IgnoreCase, "en-US")]
        private static partial System.Text.RegularExpressions.Regex MyRegex();

        /// <summary>
        /// Gets the current user ID from JWT claims.
        /// </summary>
        private string? GetCurrentUserId()
        {
            return User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                ?? User.FindFirst("sub")?.Value;
        }

        /// <summary>
        /// Checks if the current user has Admin role.
        /// </summary>
        private bool IsCurrentUserAdmin() => User.IsInRole("Admin");

        /// <summary>
        /// Checks if the current user can access a data item.
        /// </summary>
        private bool CanAccessData(JwstDataModel data)
        {
            if (IsCurrentUserAdmin())
            {
                return true;
            }

            var userId = GetCurrentUserId();
            return data.IsPublic
                || data.UserId == userId
                || (userId != null && data.SharedWith.Contains(userId));
        }

        /// <summary>
        /// Checks if the current user can modify a data item (owner or admin only).
        /// </summary>
        private bool CanModifyData(JwstDataModel data)
        {
            if (IsCurrentUserAdmin())
            {
                return true;
            }

            var userId = GetCurrentUserId();
            return data.UserId == userId;
        }

        /// <summary>
        /// Checks if the current user (authenticated or anonymous) can access a data item.
        /// Anonymous users can only access public data.
        /// Authenticated users can access their own, public, or shared data.
        /// Admins can access all data.
        /// </summary>
        private bool IsDataAccessible(JwstDataModel data)
        {
            var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
            if (!isAuthenticated)
            {
                return data.IsPublic;
            }

            return CanAccessData(data);
        }

        /// <summary>
        /// Filters a list of data items to only those accessible to the current user.
        /// Anonymous: public data only. Authenticated: own + public + shared. Admin: all.
        /// </summary>
        private List<JwstDataModel> FilterAccessibleData(List<JwstDataModel> data)
        {
            var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
            if (!isAuthenticated)
            {
                return [.. data.Where(d => d.IsPublic)];
            }

            if (IsCurrentUserAdmin())
            {
                return data;
            }

            var userId = GetCurrentUserId();
            return [.. data.Where(d =>
                d.IsPublic
                || d.UserId == userId
                || (userId != null && d.SharedWith.Contains(userId)))];
        }

        // Helper method to map to response DTO
        private DataResponse MapToDataResponse(JwstDataModel model)
        {
            return new DataResponse
            {
                Id = model.Id,
                FileName = model.FileName,
                DataType = model.DataType,
                UploadDate = model.UploadDate,
                Description = model.Description,
                Metadata = model.Metadata,
                FileSize = model.FileSize,
                ProcessingStatus = model.ProcessingStatus,
                Tags = model.Tags,
                UserId = model.UserId,
                IsPublic = model.IsPublic,
                Version = model.Version,
                FileFormat = model.FileFormat,
                IsValidated = model.IsValidated,
                LastAccessed = model.LastAccessed,
                IsArchived = model.IsArchived,
                ArchivedDate = model.ArchivedDate,
                ImageInfo = model.ImageInfo,
                SensorInfo = model.SensorInfo,
                SpectralInfo = model.SpectralInfo,
                CalibrationInfo = model.CalibrationInfo,
                ProcessingResultsCount = model.ProcessingResults.Count,
                LastProcessed = model.ProcessingResults.Count > 0 ?
                    model.ProcessingResults.Max(r => r.ProcessedDate) : null,

                // Lineage fields
                ProcessingLevel = model.ProcessingLevel,
                ObservationBaseId = model.ObservationBaseId,
                ExposureId = model.ExposureId,
                ParentId = model.ParentId,
                DerivedFrom = model.DerivedFrom,

                // Viewability
                IsViewable = model.IsViewable,

                // Thumbnail
                HasThumbnail = model.ThumbnailData != null,
            };
        }
    }

    public class ShareDataRequest
    {
        public List<string>? SharedWith { get; set; }

        public bool? IsPublic { get; set; }
    }

    public class FileUploadRequest
    {
        [Required]
        public required IFormFile File { get; set; }

        public string? Description { get; set; }

        public List<string>? Tags { get; set; }

        public string? DataType { get; set; }
    }
}
