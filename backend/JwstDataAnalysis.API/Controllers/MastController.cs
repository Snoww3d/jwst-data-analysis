using Microsoft.AspNetCore.Mvc;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

namespace JwstDataAnalysis.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class MastController : ControllerBase
    {
        private readonly MastService _mastService;
        private readonly MongoDBService _mongoDBService;
        private readonly ILogger<MastController> _logger;

        public MastController(
            MastService mastService,
            MongoDBService mongoDBService,
            ILogger<MastController> logger)
        {
            _mastService = mastService;
            _mongoDBService = mongoDBService;
            _logger = logger;
        }

        /// <summary>
        /// Search MAST by target name (e.g., "NGC 1234", "Carina Nebula")
        /// </summary>
        [HttpPost("search/target")]
        public async Task<ActionResult<MastSearchResponse>> SearchByTarget(
            [FromBody] MastTargetSearchRequest request)
        {
            try
            {
                var result = await _mastService.SearchByTargetAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "MAST target search failed for: {Target}", request.TargetName);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MAST target search failed for: {Target}", request.TargetName);
                return StatusCode(500, new { error = "MAST search failed", details = ex.Message });
            }
        }

        /// <summary>
        /// Search MAST by RA/Dec coordinates
        /// </summary>
        [HttpPost("search/coordinates")]
        public async Task<ActionResult<MastSearchResponse>> SearchByCoordinates(
            [FromBody] MastCoordinateSearchRequest request)
        {
            try
            {
                var result = await _mastService.SearchByCoordinatesAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "MAST coordinate search failed for RA:{Ra} Dec:{Dec}",
                    request.Ra, request.Dec);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MAST coordinate search failed for RA:{Ra} Dec:{Dec}",
                    request.Ra, request.Dec);
                return StatusCode(500, new { error = "MAST search failed", details = ex.Message });
            }
        }

        /// <summary>
        /// Search MAST by observation ID
        /// </summary>
        [HttpPost("search/observation")]
        public async Task<ActionResult<MastSearchResponse>> SearchByObservationId(
            [FromBody] MastObservationSearchRequest request)
        {
            try
            {
                var result = await _mastService.SearchByObservationIdAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "MAST observation search failed for: {ObsId}", request.ObsId);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MAST observation search failed for: {ObsId}", request.ObsId);
                return StatusCode(500, new { error = "MAST search failed", details = ex.Message });
            }
        }

        /// <summary>
        /// Search MAST by program/proposal ID
        /// </summary>
        [HttpPost("search/program")]
        public async Task<ActionResult<MastSearchResponse>> SearchByProgramId(
            [FromBody] MastProgramSearchRequest request)
        {
            try
            {
                var result = await _mastService.SearchByProgramIdAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "MAST program search failed for: {ProgramId}", request.ProgramId);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MAST program search failed for: {ProgramId}", request.ProgramId);
                return StatusCode(500, new { error = "MAST search failed", details = ex.Message });
            }
        }

        /// <summary>
        /// Get available data products for an observation
        /// </summary>
        [HttpPost("products")]
        public async Task<ActionResult<MastDataProductsResponse>> GetDataProducts(
            [FromBody] MastDataProductsRequest request)
        {
            try
            {
                var result = await _mastService.GetDataProductsAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Failed to get products for: {ObsId}", request.ObsId);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to get products for: {ObsId}", request.ObsId);
                return StatusCode(500, new { error = "Failed to get products", details = ex.Message });
            }
        }

        /// <summary>
        /// Download FITS files from MAST (does not create database records)
        /// </summary>
        [HttpPost("download")]
        public async Task<ActionResult<MastDownloadResponse>> Download(
            [FromBody] MastDownloadRequest request)
        {
            try
            {
                var result = await _mastService.DownloadObservationAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "MAST download failed for: {ObsId}", request.ObsId);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MAST download failed for: {ObsId}", request.ObsId);
                return StatusCode(500, new { error = "Download failed", details = ex.Message });
            }
        }

        /// <summary>
        /// Import MAST observation: download files and create database records
        /// </summary>
        [HttpPost("import")]
        public async Task<ActionResult<MastImportResponse>> Import(
            [FromBody] MastImportRequest request)
        {
            try
            {
                _logger.LogInformation("Starting MAST import for observation: {ObsId}", request.ObsId);

                // 1. Download files from MAST
                var downloadResult = await _mastService.DownloadObservationAsync(
                    new MastDownloadRequest
                    {
                        ObsId = request.ObsId,
                        ProductType = request.ProductType
                    });

                if (downloadResult.Status != "completed" || downloadResult.FileCount == 0)
                {
                    return Ok(new MastImportResponse
                    {
                        Status = "failed",
                        ObsId = request.ObsId,
                        Error = downloadResult.Error ?? "No files downloaded",
                        Timestamp = DateTime.UtcNow
                    });
                }

                // 2. Get observation metadata from MAST for enrichment
                MastSearchResponse? obsSearch = null;
                try
                {
                    obsSearch = await _mastService.SearchByObservationIdAsync(
                        new MastObservationSearchRequest { ObsId = request.ObsId });
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not fetch observation metadata for {ObsId}", request.ObsId);
                }

                var obsMeta = obsSearch?.Results.FirstOrDefault();

                // 3. Create database records for each downloaded file
                var importedIds = new List<string>();

                foreach (var filePath in downloadResult.Files)
                {
                    var fileName = Path.GetFileName(filePath);
                    long fileSize = 0;

                    // Try to get file size if accessible
                    try
                    {
                        var fileInfo = new FileInfo(filePath);
                        if (fileInfo.Exists)
                        {
                            fileSize = fileInfo.Length;
                        }
                    }
                    catch
                    {
                        // File might be in docker volume, size unknown
                    }

                    var jwstData = new JwstDataModel
                    {
                        FileName = fileName,
                        FilePath = filePath,
                        FileSize = fileSize,
                        FileFormat = FileFormats.FITS,
                        DataType = DetermineDataType(fileName, obsMeta),
                        Description = $"Imported from MAST - Observation: {request.ObsId}",
                        UploadDate = DateTime.UtcNow,
                        ProcessingStatus = ProcessingStatuses.Pending,
                        Tags = BuildTags(request),
                        UserId = request.UserId,
                        IsPublic = request.IsPublic,
                        Metadata = new Dictionary<string, object>
                        {
                            { "mast_obs_id", request.ObsId },
                            { "source", "MAST" },
                            { "import_date", DateTime.UtcNow.ToString("O") }
                        },
                        ImageInfo = CreateImageMetadata(obsMeta)
                    };

                    await _mongoDBService.CreateAsync(jwstData);
                    importedIds.Add(jwstData.Id);

                    _logger.LogInformation("Created database record {Id} for file {File}",
                        jwstData.Id, fileName);
                }

                return Ok(new MastImportResponse
                {
                    Status = "completed",
                    ObsId = request.ObsId,
                    ImportedDataIds = importedIds,
                    ImportedCount = importedIds.Count,
                    Timestamp = DateTime.UtcNow
                });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "MAST import failed for: {ObsId}", request.ObsId);
                return StatusCode(503, new MastImportResponse
                {
                    Status = "failed",
                    ObsId = request.ObsId,
                    Error = "Processing engine unavailable: " + ex.Message,
                    Timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MAST import failed for: {ObsId}", request.ObsId);
                return StatusCode(500, new MastImportResponse
                {
                    Status = "failed",
                    ObsId = request.ObsId,
                    Error = ex.Message,
                    Timestamp = DateTime.UtcNow
                });
            }
        }

        private static string DetermineDataType(string fileName, Dictionary<string, object?>? obsMeta)
        {
            var fileNameLower = fileName.ToLower();

            if (fileNameLower.Contains("_cal") || fileNameLower.Contains("_i2d"))
                return DataTypes.Image;
            if (fileNameLower.Contains("_spec") || fileNameLower.Contains("_x1d") || fileNameLower.Contains("_s2d"))
                return DataTypes.Spectral;
            if (fileNameLower.Contains("_rate") || fileNameLower.Contains("_rateints"))
                return DataTypes.Sensor;
            if (fileNameLower.Contains("_uncal"))
                return DataTypes.Raw;

            return DataTypes.Image; // Default
        }

        private static List<string> BuildTags(MastImportRequest request)
        {
            var tags = new List<string> { "mast-import", request.ObsId };
            if (request.Tags != null)
            {
                tags.AddRange(request.Tags);
            }
            return tags.Distinct().ToList();
        }

        private static ImageMetadata? CreateImageMetadata(Dictionary<string, object?>? obsMeta)
        {
            if (obsMeta == null) return null;

            var metadata = new ImageMetadata();

            if (obsMeta.TryGetValue("instrument_name", out var instrument) && instrument != null)
                metadata.Instrument = instrument.ToString();

            if (obsMeta.TryGetValue("filters", out var filter) && filter != null)
                metadata.Filter = filter.ToString();

            if (obsMeta.TryGetValue("t_exptime", out var expTime) && expTime != null)
            {
                if (double.TryParse(expTime.ToString(), out var expTimeValue))
                    metadata.ExposureTime = expTimeValue;
            }

            if (obsMeta.TryGetValue("t_obs_release", out var obsDate) && obsDate != null)
            {
                if (DateTime.TryParse(obsDate.ToString(), out var dateValue))
                    metadata.ObservationDate = dateValue;
            }

            metadata.CoordinateSystem = "ICRS";

            // Extract WCS coordinates if available
            if (obsMeta.TryGetValue("s_ra", out var ra) && ra != null &&
                obsMeta.TryGetValue("s_dec", out var dec) && dec != null)
            {
                if (double.TryParse(ra.ToString(), out var raValue) &&
                    double.TryParse(dec.ToString(), out var decValue))
                {
                    metadata.WCS = new Dictionary<string, double>
                    {
                        { "CRVAL1", raValue },
                        { "CRVAL2", decValue }
                    };
                }
            }

            return metadata;
        }
    }
}
