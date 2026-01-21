using Microsoft.AspNetCore.Mvc;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using System.Text.RegularExpressions;

namespace JwstDataAnalysis.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class MastController : ControllerBase
    {
        private readonly MastService _mastService;
        private readonly MongoDBService _mongoDBService;
        private readonly ImportJobTracker _jobTracker;
        private readonly ILogger<MastController> _logger;

        public MastController(
            MastService mastService,
            MongoDBService mongoDBService,
            ImportJobTracker jobTracker,
            ILogger<MastController> logger)
        {
            _mastService = mastService;
            _mongoDBService = mongoDBService;
            _jobTracker = jobTracker;
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
        /// Import MAST observation: download files and create database records (async with progress tracking)
        /// </summary>
        [HttpPost("import")]
        public ActionResult<ImportJobStartResponse> Import(
            [FromBody] MastImportRequest request)
        {
            var jobId = _jobTracker.CreateJob(request.ObsId);
            _logger.LogInformation("Starting MAST import job {JobId} for observation: {ObsId}", jobId, request.ObsId);

            // Start the import process in the background
            _ = Task.Run(async () => await ExecuteImportAsync(jobId, request));

            return Ok(new ImportJobStartResponse
            {
                JobId = jobId,
                ObsId = request.ObsId,
                Message = "Import started"
            });
        }

        /// <summary>
        /// Get import job progress
        /// </summary>
        [HttpGet("import-progress/{jobId}")]
        public ActionResult<ImportJobStatus> GetImportProgress(string jobId)
        {
            var job = _jobTracker.GetJob(jobId);
            if (job == null)
            {
                return NotFound(new { error = "Job not found", jobId });
            }
            return Ok(job);
        }

        private async Task ExecuteImportAsync(string jobId, MastImportRequest request)
        {
            try
            {
                _jobTracker.UpdateProgress(jobId, 5, ImportStages.Starting, "Initializing import...");

                // 1. Start async download in processing engine
                _jobTracker.UpdateProgress(jobId, 10, ImportStages.Downloading, "Starting download from MAST...");

                var downloadStartResult = await _mastService.StartAsyncDownloadAsync(
                    new MastDownloadRequest
                    {
                        ObsId = request.ObsId,
                        ProductType = request.ProductType
                    });

                var downloadJobId = downloadStartResult.JobId;
                _logger.LogInformation("Started download job {DownloadJobId} for import job {ImportJobId}",
                    downloadJobId, jobId);

                // 2. Poll for download progress
                var downloadComplete = false;
                DownloadJobProgress? downloadProgress = null;
                var pollCount = 0;
                var maxPolls = 1200; // 10 minutes at 500ms intervals

                while (!downloadComplete && pollCount < maxPolls)
                {
                    await Task.Delay(500);
                    pollCount++;

                    downloadProgress = await _mastService.GetDownloadProgressAsync(downloadJobId);
                    if (downloadProgress == null)
                    {
                        _logger.LogWarning("Could not get download progress for job {DownloadJobId}", downloadJobId);
                        continue;
                    }

                    // Map download progress (0-100) to import progress (10-40)
                    var importProgress = 10 + (int)(downloadProgress.Progress * 0.3);
                    var message = downloadProgress.TotalFiles > 0
                        ? $"Downloading file {downloadProgress.DownloadedFiles}/{downloadProgress.TotalFiles}..."
                        : downloadProgress.Message;

                    _jobTracker.UpdateProgress(jobId, importProgress, ImportStages.Downloading, message);

                    if (downloadProgress.IsComplete)
                    {
                        downloadComplete = true;
                    }
                }

                if (!downloadComplete)
                {
                    _jobTracker.FailJob(jobId, "Download timed out after 10 minutes");
                    return;
                }

                if (downloadProgress?.Stage == "failed" || downloadProgress?.Error != null)
                {
                    _jobTracker.FailJob(jobId, downloadProgress.Error ?? "Download failed");
                    return;
                }

                if (downloadProgress?.Files == null || downloadProgress.Files.Count == 0)
                {
                    _jobTracker.FailJob(jobId, "No files downloaded");
                    return;
                }

                _jobTracker.UpdateProgress(jobId, 40, ImportStages.Downloading,
                    $"Downloaded {downloadProgress.Files.Count} file(s)");

                // Create a MastDownloadResponse-like object from the progress
                var downloadResult = new MastDownloadResponse
                {
                    Status = "completed",
                    ObsId = request.ObsId,
                    Files = downloadProgress.Files,
                    FileCount = downloadProgress.Files.Count,
                    DownloadDir = downloadProgress.DownloadDir
                };

                // 2. Get observation metadata from MAST for enrichment
                _jobTracker.UpdateProgress(jobId, 45, ImportStages.SavingRecords, "Fetching observation metadata...");

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
                var lineageTree = new Dictionary<string, List<string>>();
                string? commonObservationBaseId = null;

                var totalFiles = downloadResult.Files.Count;
                for (int i = 0; i < totalFiles; i++)
                {
                    var filePath = downloadResult.Files[i];
                    var fileName = Path.GetFileName(filePath);
                    var (dataType, processingLevel, observationBaseId, exposureId) = ParseFileInfo(fileName, obsMeta);

                    // Update progress for each file (progress from 50% to 90%)
                    var fileProgress = 50 + (int)((i + 1) / (double)totalFiles * 40);
                    _jobTracker.UpdateProgress(jobId, fileProgress, ImportStages.SavingRecords,
                        $"Saving record {i + 1}/{totalFiles}...");

                    // Track common observation base ID
                    if (observationBaseId != null)
                        commonObservationBaseId = observationBaseId;

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
                        DataType = dataType,
                        ProcessingLevel = processingLevel,
                        ObservationBaseId = observationBaseId ?? request.ObsId,
                        ExposureId = exposureId,
                        Description = $"Imported from MAST - Observation: {request.ObsId} - Level: {processingLevel}",
                        UploadDate = DateTime.UtcNow,
                        ProcessingStatus = ProcessingStatuses.Pending,
                        Tags = BuildTags(request),
                        UserId = request.UserId,
                        IsPublic = request.IsPublic,
                        Metadata = new Dictionary<string, object>
                        {
                            { "mast_obs_id", request.ObsId },
                            { "source", "MAST" },
                            { "import_date", DateTime.UtcNow.ToString("O") },
                            { "processing_level", processingLevel }
                        },
                        ImageInfo = CreateImageMetadata(obsMeta)
                    };

                    await _mongoDBService.CreateAsync(jwstData);
                    importedIds.Add(jwstData.Id);

                    // Track lineage by level
                    if (!lineageTree.ContainsKey(processingLevel))
                        lineageTree[processingLevel] = new List<string>();
                    lineageTree[processingLevel].Add(jwstData.Id);

                    _logger.LogInformation("Created database record {Id} for file {File} at level {Level}",
                        jwstData.Id, fileName, processingLevel);
                }

                // Establish lineage relationships between processing levels
                _jobTracker.UpdateProgress(jobId, 95, ImportStages.SavingRecords, "Establishing lineage relationships...");
                await EstablishLineageRelationships(importedIds);

                var result = new MastImportResponse
                {
                    Status = "completed",
                    ObsId = request.ObsId,
                    ImportedDataIds = importedIds,
                    ImportedCount = importedIds.Count,
                    LineageTree = lineageTree,
                    ObservationBaseId = commonObservationBaseId,
                    Timestamp = DateTime.UtcNow
                };

                _jobTracker.CompleteJob(jobId, result);
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "MAST import failed for job {JobId}: {ObsId}", jobId, request.ObsId);
                _jobTracker.FailJob(jobId, "Processing engine unavailable: " + ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MAST import failed for job {JobId}: {ObsId}", jobId, request.ObsId);
                _jobTracker.FailJob(jobId, ex.Message);
            }
        }

        private static (string dataType, string processingLevel, string? observationBaseId, string? exposureId)
            ParseFileInfo(string fileName, Dictionary<string, object?>? obsMeta)
        {
            var fileNameLower = fileName.ToLower();
            string dataType = DataTypes.Image;
            string processingLevel = ProcessingLevels.Unknown;
            string? observationBaseId = null;
            string? exposureId = null;

            // Determine processing level from suffix
            foreach (var kvp in ProcessingLevels.SuffixToLevel)
            {
                if (fileNameLower.Contains(kvp.Key))
                {
                    processingLevel = kvp.Value;
                    break;
                }
            }

            // Determine data type based on suffix
            if (fileNameLower.Contains("_uncal"))
                dataType = DataTypes.Raw;
            else if (fileNameLower.Contains("_rate") || fileNameLower.Contains("_rateints"))
                dataType = DataTypes.Sensor;
            else if (fileNameLower.Contains("_spec") || fileNameLower.Contains("_x1d") || fileNameLower.Contains("_s2d"))
                dataType = DataTypes.Spectral;
            else if (fileNameLower.Contains("_cal") || fileNameLower.Contains("_crf") || fileNameLower.Contains("_i2d"))
                dataType = DataTypes.Image;

            // Parse observation base ID from JWST filename pattern
            // Example: jw02733-o001_t001_nircam_clear-f090w_i2d.fits
            var obsMatch = Regex.Match(
                fileName,
                @"(jw\d{5}-o\d+_t\d+_[a-z]+)",
                RegexOptions.IgnoreCase);

            if (obsMatch.Success)
            {
                observationBaseId = obsMatch.Groups[1].Value.ToLower();
            }

            // Parse exposure ID for finer-grained lineage
            // Example: jw02733001001_02101_00001
            var expMatch = Regex.Match(
                fileName,
                @"(jw\d{5}\d{3}\d{3}_\d{5}_\d{5})",
                RegexOptions.IgnoreCase);

            if (expMatch.Success)
            {
                exposureId = expMatch.Groups[1].Value.ToLower();
            }

            return (dataType, processingLevel, observationBaseId, exposureId);
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

        /// <summary>
        /// Establish parent-child relationships between files at different processing levels
        /// </summary>
        private async Task EstablishLineageRelationships(List<string> importedIds)
        {
            if (importedIds.Count <= 1) return;

            var importedData = new List<JwstDataModel>();
            foreach (var id in importedIds)
            {
                var data = await _mongoDBService.GetAsync(id);
                if (data != null) importedData.Add(data);
            }

            // Define level order for lineage (L1 -> L2a -> L2b -> L3)
            var levelOrder = new[] { ProcessingLevels.Level1, ProcessingLevels.Level2a, ProcessingLevels.Level2b, ProcessingLevels.Level3 };

            // Group by exposure ID for fine-grained lineage
            var groups = importedData
                .Where(d => !string.IsNullOrEmpty(d.ExposureId))
                .GroupBy(d => d.ExposureId);

            foreach (var group in groups)
            {
                var filesInGroup = group.ToList();

                // Sort by processing level order
                var ordered = filesInGroup
                    .OrderBy(d => Array.IndexOf(levelOrder, d.ProcessingLevel ?? ProcessingLevels.Unknown))
                    .ToList();

                // Link each file to its predecessor in the processing chain
                for (int i = 1; i < ordered.Count; i++)
                {
                    var current = ordered[i];
                    var parent = ordered[i - 1];

                    current.ParentId = parent.Id;
                    current.DerivedFrom = new List<string> { parent.Id };
                    await _mongoDBService.UpdateAsync(current.Id, current);

                    _logger.LogDebug("Linked {CurrentFile} (L{CurrentLevel}) -> {ParentFile} (L{ParentLevel})",
                        current.FileName, current.ProcessingLevel,
                        parent.FileName, parent.ProcessingLevel);
                }
            }
        }
    }
}
