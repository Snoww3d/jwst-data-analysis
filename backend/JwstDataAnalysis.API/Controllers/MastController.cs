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
        private readonly IConfiguration _configuration;

        // Configurable download settings
        private readonly int _pollIntervalMs;
        private readonly string _downloadBasePath;

        public MastController(
            MastService mastService,
            MongoDBService mongoDBService,
            ImportJobTracker jobTracker,
            ILogger<MastController> logger,
            IConfiguration configuration)
        {
            _mastService = mastService;
            _mongoDBService = mongoDBService;
            _jobTracker = jobTracker;
            _logger = logger;
            _configuration = configuration;

            // Load configurable settings
            _pollIntervalMs = _configuration.GetValue<int>("Downloads:PollIntervalMs", 500);
            _downloadBasePath = _configuration.GetValue<string>("Downloads:BasePath") ?? "/app/data/mast";
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

        /// <summary>
        /// Cancel an active import job
        /// </summary>
        [HttpPost("import/cancel/{jobId}")]
        public async Task<ActionResult> CancelImport(string jobId)
        {
            var job = _jobTracker.GetJob(jobId);
            if (job == null)
            {
                return NotFound(new { error = "Job not found", jobId });
            }

            if (job.IsComplete)
            {
                return BadRequest(new { error = "Job is already complete", jobId, stage = job.Stage });
            }

            // Cancel the job in the tracker (this signals the background task to stop)
            var cancelled = _jobTracker.CancelJob(jobId);
            if (!cancelled)
            {
                return BadRequest(new { error = "Could not cancel job", jobId });
            }

            // Also try to pause the download in the processing engine if we have a download job ID
            if (!string.IsNullOrEmpty(job.DownloadJobId))
            {
                try
                {
                    await _mastService.PauseDownloadAsync(job.DownloadJobId);
                    _logger.LogInformation("Paused download job {DownloadJobId} for cancelled import {JobId}",
                        job.DownloadJobId, jobId);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not pause download job {DownloadJobId}", job.DownloadJobId);
                    // Continue anyway - the import job is still cancelled
                }
            }

            _logger.LogInformation("Cancelled import job {JobId} for observation {ObsId}", jobId, job.ObsId);
            return Ok(new { message = "Import cancelled", jobId, obsId = job.ObsId });
        }

        /// <summary>
        /// Resume a paused or failed import job
        /// </summary>
        [HttpPost("import/resume/{jobId}")]
        public async Task<ActionResult> ResumeImport(string jobId)
        {
            var job = _jobTracker.GetJob(jobId);
            if (job == null)
            {
                return NotFound(new { error = "Job not found", jobId });
            }

            if (!job.IsResumable || string.IsNullOrEmpty(job.DownloadJobId))
            {
                return BadRequest(new { error = "Job is not resumable", jobId });
            }

            try
            {
                // Resume the download in the processing engine
                var resumeResult = await _mastService.ResumeDownloadAsync(job.DownloadJobId);

                // Reset job status for resumed polling
                _jobTracker.UpdateProgress(jobId, job.Progress, ImportStages.Downloading, "Resuming download...");
                _jobTracker.SetResumable(jobId, true);

                _logger.LogInformation("Resumed import job {JobId} (download job {DownloadJobId})",
                    jobId, job.DownloadJobId);

                // Start background task to continue polling and complete import
                _ = Task.Run(async () => await ExecuteResumedImportAsync(jobId, job.ObsId, job.DownloadJobId));

                return Ok(new { message = "Import resumed", jobId, downloadJobId = job.DownloadJobId });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                // 404 from processing engine - check if download actually completed
                // This can happen when the download completed but backend polling timed out
                _logger.LogInformation("Processing engine returned 404 for job {DownloadJobId}, checking for completed files",
                    job.DownloadJobId);

                // Check if files exist on disk for this observation
                var downloadDir = Path.Combine(_downloadBasePath, job.ObsId);
                if (Directory.Exists(downloadDir))
                {
                    var existingFiles = Directory.GetFiles(downloadDir, "*.fits", SearchOption.AllDirectories)
                        .Concat(Directory.GetFiles(downloadDir, "*.FITS", SearchOption.AllDirectories))
                        .Distinct()
                        .ToList();

                    if (existingFiles.Count > 0)
                    {
                        _logger.LogInformation("Found {FileCount} existing files for observation {ObsId}, completing import",
                            existingFiles.Count, job.ObsId);

                        // Reset job status and complete the import from existing files
                        _jobTracker.UpdateProgress(jobId, 40, ImportStages.SavingRecords,
                            $"Found {existingFiles.Count} downloaded files, creating records...");
                        _jobTracker.SetResumable(jobId, false);

                        // Start background task to create database records
                        _ = Task.Run(async () => await CompleteImportFromExistingFilesAsync(
                            jobId, job.ObsId, existingFiles));

                        return Ok(new {
                            message = "Download already completed, creating database records",
                            jobId,
                            filesFound = existingFiles.Count
                        });
                    }
                }

                // No files found - the download really didn't complete
                _logger.LogWarning("No files found for observation {ObsId}, cannot resume", job.ObsId);
                _jobTracker.SetResumable(jobId, false);
                _jobTracker.FailJob(jobId, "Download state lost and no files found. Please start a new import.");
                return BadRequest(new {
                    error = "Cannot resume - download state lost and no files found",
                    suggestion = "Please start a new import"
                });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Failed to resume import job {JobId}", jobId);
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
        }

        /// <summary>
        /// Complete an import from files that were already downloaded
        /// </summary>
        private async Task CompleteImportFromExistingFilesAsync(string jobId, string obsId, List<string> files)
        {
            try
            {
                // Get observation metadata from MAST for enrichment
                _jobTracker.UpdateProgress(jobId, 45, ImportStages.SavingRecords, "Fetching observation metadata...");

                MastSearchResponse? obsSearch = null;
                try
                {
                    obsSearch = await _mastService.SearchByObservationIdAsync(
                        new MastObservationSearchRequest { ObsId = obsId });
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not fetch observation metadata for {ObsId}", obsId);
                }

                var obsMeta = obsSearch?.Results.FirstOrDefault();

                // Create database records for each downloaded file
                var importedIds = new List<string>();
                var lineageTree = new Dictionary<string, List<string>>();
                string? commonObservationBaseId = null;

                var totalFiles = files.Count;
                for (int i = 0; i < totalFiles; i++)
                {
                    var filePath = files[i];
                    var fileName = Path.GetFileName(filePath);
                    var (dataType, processingLevel, observationBaseId, exposureId, isViewable) = ParseFileInfo(fileName, obsMeta);

                    // Update progress for each file (progress from 50% to 90%)
                    var fileProgress = 50 + (int)((i + 1) / (double)totalFiles * 40);
                    _jobTracker.UpdateProgress(jobId, fileProgress, ImportStages.SavingRecords,
                        $"Saving record {i + 1}/{totalFiles}...");

                    // Track common observation base ID
                    if (observationBaseId != null)
                        commonObservationBaseId = observationBaseId;

                    long fileSize = 0;
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
                        // File size unknown
                    }

                    var jwstData = new JwstDataModel
                    {
                        FileName = fileName,
                        FilePath = filePath,
                        FileSize = fileSize,
                        FileFormat = FileFormats.FITS,
                        DataType = dataType,
                        ProcessingLevel = processingLevel,
                        ObservationBaseId = observationBaseId ?? obsId,
                        ExposureId = exposureId,
                        IsViewable = isViewable,
                        Description = $"Imported from MAST - Observation: {obsId} - Level: {processingLevel}",
                        UploadDate = DateTime.UtcNow,
                        ProcessingStatus = ProcessingStatuses.Pending,
                        Tags = new List<string> { "mast-import", obsId },
                        IsPublic = false,
                        Metadata = BuildMastMetadata(obsMeta, obsId, processingLevel),
                        ImageInfo = CreateImageMetadata(obsMeta, _logger)
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
                    ObsId = obsId,
                    ImportedDataIds = importedIds,
                    ImportedCount = importedIds.Count,
                    LineageTree = lineageTree,
                    ObservationBaseId = commonObservationBaseId,
                    Timestamp = DateTime.UtcNow
                };

                _jobTracker.CompleteJob(jobId, result);
                _logger.LogInformation("Completed import from existing files for job {JobId}: {Count} records created",
                    jobId, importedIds.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to complete import from existing files for job {JobId}", jobId);
                _jobTracker.FailJob(jobId, ex.Message);
            }
        }

        /// <summary>
        /// Import from existing downloaded files (use when download completed but import timed out)
        /// </summary>
        [HttpPost("import/from-existing/{obsId}")]
        public ActionResult<ImportJobStartResponse> ImportFromExistingFiles(string obsId)
        {
            // Check if files exist
            var downloadDir = Path.Combine(_downloadBasePath, obsId);
            if (!Directory.Exists(downloadDir))
            {
                return NotFound(new { error = "No downloaded files found", obsId });
            }

            var existingFiles = Directory.GetFiles(downloadDir, "*.fits", SearchOption.AllDirectories)
                .Concat(Directory.GetFiles(downloadDir, "*.FITS", SearchOption.AllDirectories))
                .Distinct()
                .ToList();

            if (existingFiles.Count == 0)
            {
                return NotFound(new { error = "No FITS files found in download directory", obsId });
            }

            var jobId = _jobTracker.CreateJob(obsId);
            _logger.LogInformation("Starting import from existing files for {ObsId}: {FileCount} files found",
                obsId, existingFiles.Count);

            // Start the import process in the background
            _ = Task.Run(async () => await CompleteImportFromExistingFilesAsync(jobId, obsId, existingFiles));

            return Ok(new ImportJobStartResponse
            {
                JobId = jobId,
                ObsId = obsId,
                Message = $"Importing {existingFiles.Count} existing files"
            });
        }

        /// <summary>
        /// Check if downloaded files exist for an observation
        /// </summary>
        [HttpGet("import/check-files/{obsId}")]
        public ActionResult CheckExistingFiles(string obsId)
        {
            var downloadDir = Path.Combine(_downloadBasePath, obsId);
            if (!Directory.Exists(downloadDir))
            {
                return Ok(new { exists = false, fileCount = 0, obsId });
            }

            var existingFiles = Directory.GetFiles(downloadDir, "*.fits", SearchOption.AllDirectories)
                .Concat(Directory.GetFiles(downloadDir, "*.FITS", SearchOption.AllDirectories))
                .Distinct()
                .ToList();

            return Ok(new {
                exists = existingFiles.Count > 0,
                fileCount = existingFiles.Count,
                obsId,
                downloadDir
            });
        }

        /// <summary>
        /// List all resumable download jobs
        /// </summary>
        [HttpGet("import/resumable")]
        public async Task<ActionResult<ResumableJobsResponse>> GetResumableImports()
        {
            try
            {
                var result = await _mastService.GetResumableDownloadsAsync();
                return Ok(result ?? new ResumableJobsResponse { Jobs = new(), Count = 0 });
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Failed to get resumable downloads");
                return StatusCode(503, new { error = "Processing engine unavailable", details = ex.Message });
            }
        }

        /// <summary>
        /// Refresh metadata for existing MAST imports by re-fetching from MAST.
        /// Use this to update records that were imported before metadata preservation was added.
        /// </summary>
        [HttpPost("refresh-metadata/{obsId}")]
        public async Task<ActionResult<MetadataRefreshResponse>> RefreshMetadata(string obsId)
        {
            try
            {
                _logger.LogInformation("Refreshing metadata for MAST observation: {ObsId}", obsId);

                // Find all records with this MAST observation ID
                var allData = await _mongoDBService.GetAsync();
                var matchingRecords = allData.Where(d =>
                    d.Metadata.TryGetValue("mast_obs_id", out var mastObsId) &&
                    mastObsId?.ToString() == obsId).ToList();

                if (matchingRecords.Count == 0)
                {
                    return NotFound(new { error = "No records found for this observation", obsId });
                }

                // Fetch fresh metadata from MAST
                MastSearchResponse? obsSearch = null;
                try
                {
                    obsSearch = await _mastService.SearchByObservationIdAsync(
                        new MastObservationSearchRequest { ObsId = obsId });
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to fetch MAST metadata for {ObsId}", obsId);
                    return StatusCode(503, new { error = "Failed to fetch MAST metadata", details = ex.Message });
                }

                var obsMeta = obsSearch?.Results.FirstOrDefault();
                if (obsMeta == null)
                {
                    return NotFound(new { error = "Observation not found in MAST", obsId });
                }

                // Update each record with refreshed metadata
                var updatedCount = 0;
                foreach (var record in matchingRecords)
                {
                    var processingLevel = record.ProcessingLevel ?? ProcessingLevels.Unknown;

                    // Update the generic metadata with all MAST fields
                    record.Metadata = BuildMastMetadata(obsMeta, obsId, processingLevel);

                    // Update ImageInfo with enhanced fields
                    record.ImageInfo = CreateImageMetadata(obsMeta, _logger);

                    await _mongoDBService.UpdateAsync(record.Id, record);
                    updatedCount++;

                    _logger.LogDebug("Updated metadata for record {Id} ({FileName})", record.Id, record.FileName);
                }

                _logger.LogInformation("Refreshed metadata for {Count} records of observation {ObsId}",
                    updatedCount, obsId);

                return Ok(new MetadataRefreshResponse
                {
                    ObsId = obsId,
                    UpdatedCount = updatedCount,
                    Message = $"Successfully refreshed metadata for {updatedCount} record(s)"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to refresh metadata for {ObsId}", obsId);
                return StatusCode(500, new { error = "Failed to refresh metadata", details = ex.Message });
            }
        }

        /// <summary>
        /// Refresh metadata for ALL existing MAST imports.
        /// Use this to bulk-update records imported before metadata preservation was added.
        /// </summary>
        [HttpPost("refresh-metadata-all")]
        public async Task<ActionResult<MetadataRefreshResponse>> RefreshAllMetadata()
        {
            try
            {
                _logger.LogInformation("Starting bulk metadata refresh for all MAST imports");

                // Find all records with MAST source
                var allData = await _mongoDBService.GetAsync();
                var mastRecords = allData.Where(d =>
                    d.Metadata.TryGetValue("source", out var source) &&
                    source?.ToString() == "MAST").ToList();

                if (mastRecords.Count == 0)
                {
                    return Ok(new MetadataRefreshResponse
                    {
                        ObsId = "all",
                        UpdatedCount = 0,
                        Message = "No MAST imports found to refresh"
                    });
                }

                // Group by observation ID for efficient MAST queries
                var groupedByObs = mastRecords
                    .GroupBy(d => d.Metadata.TryGetValue("mast_obs_id", out var id) ? id?.ToString() ?? "" : "")
                    .Where(g => !string.IsNullOrEmpty(g.Key))
                    .ToList();

                var totalUpdated = 0;
                var failedObs = new List<string>();

                foreach (var group in groupedByObs)
                {
                    var obsId = group.Key;
                    try
                    {
                        // Fetch fresh metadata from MAST
                        var obsSearch = await _mastService.SearchByObservationIdAsync(
                            new MastObservationSearchRequest { ObsId = obsId });

                        var obsMeta = obsSearch?.Results.FirstOrDefault();
                        if (obsMeta == null)
                        {
                            _logger.LogWarning("Observation {ObsId} not found in MAST, skipping", obsId);
                            failedObs.Add(obsId);
                            continue;
                        }

                        // Update each record in this observation group
                        foreach (var record in group)
                        {
                            var processingLevel = record.ProcessingLevel ?? ProcessingLevels.Unknown;
                            record.Metadata = BuildMastMetadata(obsMeta, obsId, processingLevel);
                            record.ImageInfo = CreateImageMetadata(obsMeta, _logger);
                            await _mongoDBService.UpdateAsync(record.Id, record);
                            totalUpdated++;
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to refresh metadata for observation {ObsId}", obsId);
                        failedObs.Add(obsId);
                    }
                }

                var message = $"Refreshed metadata for {totalUpdated} record(s) across {groupedByObs.Count - failedObs.Count} observation(s)";
                if (failedObs.Count > 0)
                {
                    message += $". Failed for {failedObs.Count} observation(s): {string.Join(", ", failedObs.Take(5))}";
                    if (failedObs.Count > 5) message += "...";
                }

                _logger.LogInformation(message);

                return Ok(new MetadataRefreshResponse
                {
                    ObsId = "all",
                    UpdatedCount = totalUpdated,
                    Message = message
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to refresh all MAST metadata");
                return StatusCode(500, new { error = "Failed to refresh metadata", details = ex.Message });
            }
        }

        private async Task ExecuteImportAsync(string jobId, MastImportRequest request)
        {
            var cancellationToken = _jobTracker.GetCancellationToken(jobId);

            try
            {
                _jobTracker.UpdateProgress(jobId, 5, ImportStages.Starting, "Initializing import...");

                // 1. Start chunked download in processing engine
                _jobTracker.UpdateProgress(jobId, 10, ImportStages.Downloading, "Starting chunked download from MAST...");

                var downloadStartResult = await _mastService.StartChunkedDownloadAsync(
                    new ChunkedDownloadRequest
                    {
                        ObsId = request.ObsId,
                        ProductType = request.ProductType
                    });

                var downloadJobId = downloadStartResult.JobId;
                _jobTracker.SetDownloadJobId(jobId, downloadJobId);
                _jobTracker.SetResumable(jobId, true);
                _logger.LogInformation("Started chunked download job {DownloadJobId} for import job {ImportJobId}",
                    downloadJobId, jobId);

                // 2. Poll for download progress with byte-level tracking (no timeout - runs until complete or cancelled)
                var downloadComplete = false;
                DownloadJobProgress? downloadProgress = null;

                while (!downloadComplete && !cancellationToken.IsCancellationRequested)
                {
                    await Task.Delay(_pollIntervalMs, cancellationToken);

                    downloadProgress = await _mastService.GetChunkedDownloadProgressAsync(downloadJobId);
                    if (downloadProgress == null)
                    {
                        _logger.LogWarning("Could not get download progress for job {DownloadJobId}", downloadJobId);
                        continue;
                    }

                    // Map download progress (0-100) to import progress (10-40)
                    var importProgress = 10 + (int)(downloadProgress.Progress * 0.3);

                    // Build detailed message with byte-level progress
                    string message;
                    if (downloadProgress.TotalBytes > 0)
                    {
                        var downloadedMB = downloadProgress.DownloadedBytes / (1024.0 * 1024.0);
                        var totalMB = downloadProgress.TotalBytes / (1024.0 * 1024.0);
                        var speedMBps = downloadProgress.SpeedBytesPerSec / (1024.0 * 1024.0);
                        message = $"Downloading: {downloadedMB:F1}/{totalMB:F1} MB ({speedMBps:F1} MB/s)";

                        if (downloadProgress.EtaSeconds.HasValue && downloadProgress.EtaSeconds > 0)
                        {
                            var eta = TimeSpan.FromSeconds(downloadProgress.EtaSeconds.Value);
                            message += $" - ETA: {eta:mm\\:ss}";
                        }
                    }
                    else if (downloadProgress.TotalFiles > 0)
                    {
                        message = $"Downloading file {downloadProgress.DownloadedFiles}/{downloadProgress.TotalFiles}...";
                    }
                    else
                    {
                        message = downloadProgress.Message;
                    }

                    _jobTracker.UpdateProgress(jobId, importProgress, ImportStages.Downloading, message);

                    // Update byte-level progress
                    _jobTracker.UpdateByteProgress(
                        jobId,
                        downloadProgress.DownloadedBytes,
                        downloadProgress.TotalBytes,
                        downloadProgress.SpeedBytesPerSec,
                        downloadProgress.EtaSeconds,
                        downloadProgress.FileProgress
                    );

                    if (downloadProgress.IsComplete)
                    {
                        downloadComplete = true;
                    }
                }

                // Check if cancelled
                if (cancellationToken.IsCancellationRequested)
                {
                    _logger.LogInformation("Import job {JobId} was cancelled during download", jobId);
                    return; // Job status already set by CancelJob
                }

                if (downloadProgress?.Stage == "failed" || downloadProgress?.Error != null)
                {
                    _jobTracker.SetResumable(jobId, downloadProgress.IsResumable);
                    _jobTracker.FailJob(jobId, downloadProgress.Error ?? "Download failed");
                    return;
                }

                if (downloadProgress?.Files == null || downloadProgress.Files.Count == 0)
                {
                    _jobTracker.FailJob(jobId, "No files downloaded");
                    return;
                }

                var totalDownloadedMB = downloadProgress.DownloadedBytes / (1024.0 * 1024.0);
                _jobTracker.UpdateProgress(jobId, 40, ImportStages.Downloading,
                    $"Downloaded {downloadProgress.Files.Count} file(s) ({totalDownloadedMB:F1} MB)");
                _jobTracker.SetResumable(jobId, false);

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
                    var (dataType, processingLevel, observationBaseId, exposureId, isViewable) = ParseFileInfo(fileName, obsMeta);

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
                        IsViewable = isViewable,
                        Description = $"Imported from MAST - Observation: {request.ObsId} - Level: {processingLevel}",
                        UploadDate = DateTime.UtcNow,
                        ProcessingStatus = ProcessingStatuses.Pending,
                        Tags = BuildTags(request),
                        UserId = request.UserId,
                        IsPublic = request.IsPublic,
                        Metadata = BuildMastMetadata(obsMeta, request.ObsId, processingLevel),
                        ImageInfo = CreateImageMetadata(obsMeta, _logger)
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
            catch (OperationCanceledException)
            {
                _logger.LogInformation("Import job {JobId} was cancelled", jobId);
                // Job status already set by CancelJob - no need to update
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

        private async Task ExecuteResumedImportAsync(string jobId, string obsId, string downloadJobId)
        {
            var cancellationToken = _jobTracker.GetCancellationToken(jobId);

            try
            {
                _logger.LogInformation("Continuing resumed import job {JobId} for observation {ObsId}", jobId, obsId);

                // Poll for download progress (no timeout - runs until complete or cancelled)
                var downloadComplete = false;
                DownloadJobProgress? downloadProgress = null;

                while (!downloadComplete && !cancellationToken.IsCancellationRequested)
                {
                    await Task.Delay(_pollIntervalMs, cancellationToken);

                    downloadProgress = await _mastService.GetChunkedDownloadProgressAsync(downloadJobId);
                    if (downloadProgress == null)
                    {
                        _logger.LogWarning("Could not get download progress for job {DownloadJobId}", downloadJobId);
                        continue;
                    }

                    // Map download progress (0-100) to import progress (10-40)
                    var importProgress = 10 + (int)(downloadProgress.Progress * 0.3);

                    // Build detailed message with byte-level progress
                    string message;
                    if (downloadProgress.TotalBytes > 0)
                    {
                        var downloadedMB = downloadProgress.DownloadedBytes / (1024.0 * 1024.0);
                        var totalMB = downloadProgress.TotalBytes / (1024.0 * 1024.0);
                        var speedMBps = downloadProgress.SpeedBytesPerSec / (1024.0 * 1024.0);
                        message = $"Downloading: {downloadedMB:F1}/{totalMB:F1} MB ({speedMBps:F1} MB/s)";

                        if (downloadProgress.EtaSeconds.HasValue && downloadProgress.EtaSeconds > 0)
                        {
                            var eta = TimeSpan.FromSeconds(downloadProgress.EtaSeconds.Value);
                            message += $" - ETA: {eta:mm\\:ss}";
                        }
                    }
                    else if (downloadProgress.TotalFiles > 0)
                    {
                        message = $"Downloading file {downloadProgress.DownloadedFiles}/{downloadProgress.TotalFiles}...";
                    }
                    else
                    {
                        message = downloadProgress.Message;
                    }

                    _jobTracker.UpdateProgress(jobId, importProgress, ImportStages.Downloading, message);

                    // Update byte-level progress
                    _jobTracker.UpdateByteProgress(
                        jobId,
                        downloadProgress.DownloadedBytes,
                        downloadProgress.TotalBytes,
                        downloadProgress.SpeedBytesPerSec,
                        downloadProgress.EtaSeconds,
                        downloadProgress.FileProgress
                    );

                    if (downloadProgress.IsComplete)
                    {
                        downloadComplete = true;
                    }
                }

                // Check if cancelled
                if (cancellationToken.IsCancellationRequested)
                {
                    _logger.LogInformation("Resumed import job {JobId} was cancelled during download", jobId);
                    return; // Job status already set by CancelJob
                }

                if (downloadProgress?.Stage == "failed" || downloadProgress?.Error != null)
                {
                    _jobTracker.SetResumable(jobId, downloadProgress.IsResumable);
                    _jobTracker.FailJob(jobId, downloadProgress.Error ?? "Download failed");
                    return;
                }

                if (downloadProgress?.Files == null || downloadProgress.Files.Count == 0)
                {
                    _jobTracker.FailJob(jobId, "No files downloaded");
                    return;
                }

                var totalDownloadedMB = downloadProgress.DownloadedBytes / (1024.0 * 1024.0);
                _jobTracker.UpdateProgress(jobId, 40, ImportStages.Downloading,
                    $"Downloaded {downloadProgress.Files.Count} file(s) ({totalDownloadedMB:F1} MB)");
                _jobTracker.SetResumable(jobId, false);

                // Get observation metadata from MAST for enrichment
                _jobTracker.UpdateProgress(jobId, 45, ImportStages.SavingRecords, "Fetching observation metadata...");

                MastSearchResponse? obsSearch = null;
                try
                {
                    obsSearch = await _mastService.SearchByObservationIdAsync(
                        new MastObservationSearchRequest { ObsId = obsId });
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not fetch observation metadata for {ObsId}", obsId);
                }

                var obsMeta = obsSearch?.Results.FirstOrDefault();

                // Create database records for each downloaded file
                var importedIds = new List<string>();
                var lineageTree = new Dictionary<string, List<string>>();
                string? commonObservationBaseId = null;

                var totalFiles = downloadProgress.Files.Count;
                for (int i = 0; i < totalFiles; i++)
                {
                    var filePath = downloadProgress.Files[i];
                    var fileName = Path.GetFileName(filePath);
                    var (dataType, processingLevel, observationBaseId, exposureId, isViewable) = ParseFileInfo(fileName, obsMeta);

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
                        ObservationBaseId = observationBaseId ?? obsId,
                        ExposureId = exposureId,
                        IsViewable = isViewable,
                        Description = $"Imported from MAST - Observation: {obsId} - Level: {processingLevel}",
                        UploadDate = DateTime.UtcNow,
                        ProcessingStatus = ProcessingStatuses.Pending,
                        Tags = new List<string> { "mast-import", obsId },
                        IsPublic = false,
                        Metadata = BuildMastMetadata(obsMeta, obsId, processingLevel),
                        ImageInfo = CreateImageMetadata(obsMeta, _logger)
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
                    ObsId = obsId,
                    ImportedDataIds = importedIds,
                    ImportedCount = importedIds.Count,
                    LineageTree = lineageTree,
                    ObservationBaseId = commonObservationBaseId,
                    Timestamp = DateTime.UtcNow
                };

                _jobTracker.CompleteJob(jobId, result);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("Resumed import job {JobId} was cancelled", jobId);
                // Job status already set by CancelJob - no need to update
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Resumed MAST import failed for job {JobId}: {ObsId}", jobId, obsId);
                _jobTracker.SetResumable(jobId, true);
                _jobTracker.FailJob(jobId, "Processing engine unavailable: " + ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Resumed MAST import failed for job {JobId}: {ObsId}", jobId, obsId);
                _jobTracker.SetResumable(jobId, true);
                _jobTracker.FailJob(jobId, ex.Message);
            }
        }

        private static (string dataType, string processingLevel, string? observationBaseId, string? exposureId, bool isViewable)
            ParseFileInfo(string fileName, Dictionary<string, object?>? obsMeta)
        {
            var fileNameLower = fileName.ToLower();
            string dataType = DataTypes.Image;
            string processingLevel = ProcessingLevels.Unknown;
            string? observationBaseId = null;
            string? exposureId = null;
            bool isViewable = true;

            // Determine processing level from suffix
            foreach (var kvp in ProcessingLevels.SuffixToLevel)
            {
                if (fileNameLower.Contains(kvp.Key))
                {
                    processingLevel = kvp.Value;
                    break;
                }
            }

            // Determine data type and viewability based on suffix
            // Non-viewable table/catalog files
            if (fileNameLower.Contains("_asn") || fileNameLower.Contains("_pool"))
            {
                dataType = DataTypes.Metadata;
                isViewable = false;
            }
            else if (fileNameLower.Contains("_cat") || fileNameLower.Contains("_phot"))
            {
                dataType = DataTypes.Metadata;
                isViewable = false;
            }
            else if (fileNameLower.Contains("_x1d") || fileNameLower.Contains("_x1dints") || fileNameLower.Contains("_c1d"))
            {
                dataType = DataTypes.Spectral;
                isViewable = false; // 1D extracted spectra are tables
            }
            // Viewable image files
            else if (fileNameLower.Contains("_uncal"))
            {
                dataType = DataTypes.Raw;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_rate") || fileNameLower.Contains("_rateints"))
            {
                dataType = DataTypes.Sensor;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_s2d") || fileNameLower.Contains("_s3d"))
            {
                dataType = DataTypes.Spectral;
                isViewable = true; // 2D/3D spectral images are viewable
            }
            else if (fileNameLower.Contains("_cal") || fileNameLower.Contains("_calints") ||
                     fileNameLower.Contains("_crf") || fileNameLower.Contains("_i2d"))
            {
                dataType = DataTypes.Image;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_flat") || fileNameLower.Contains("_dark") || fileNameLower.Contains("_bias"))
            {
                dataType = DataTypes.Calibration;
                isViewable = true;
            }

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

            return (dataType, processingLevel, observationBaseId, exposureId, isViewable);
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

        /// <summary>
        /// Build metadata dictionary preserving ALL available MAST fields with mast_ prefix.
        /// This ensures we don't lose any metadata from MAST observations.
        /// </summary>
        private static Dictionary<string, object> BuildMastMetadata(
            Dictionary<string, object?>? obsMeta,
            string obsId,
            string processingLevel)
        {
            var metadata = new Dictionary<string, object>
            {
                { "mast_obs_id", obsId },
                { "source", "MAST" },
                { "import_date", DateTime.UtcNow.ToString("O") },
                { "processing_level", processingLevel }
            };

            if (obsMeta != null)
            {
                foreach (var kvp in obsMeta)
                {
                    if (kvp.Value != null)
                    {
                        // Prefix all MAST fields with "mast_" for clear provenance
                        var key = kvp.Key.StartsWith("mast_") ? kvp.Key : $"mast_{kvp.Key}";
                        // Convert JsonElement to basic types for MongoDB serialization
                        metadata[key] = ConvertToBasicType(kvp.Value);
                    }
                }
            }

            return metadata;
        }

        /// <summary>
        /// Convert a value to a basic type that MongoDB can serialize.
        /// Handles System.Text.Json.JsonElement which comes from deserializing JSON responses.
        /// </summary>
        private static object ConvertToBasicType(object value)
        {
            if (value is System.Text.Json.JsonElement jsonElement)
            {
                return jsonElement.ValueKind switch
                {
                    System.Text.Json.JsonValueKind.String => jsonElement.GetString() ?? "",
                    System.Text.Json.JsonValueKind.Number => jsonElement.TryGetInt64(out var l) ? l : jsonElement.GetDouble(),
                    System.Text.Json.JsonValueKind.True => true,
                    System.Text.Json.JsonValueKind.False => false,
                    System.Text.Json.JsonValueKind.Null => "",
                    System.Text.Json.JsonValueKind.Array => jsonElement.ToString(),
                    System.Text.Json.JsonValueKind.Object => jsonElement.ToString(),
                    _ => jsonElement.ToString()
                };
            }
            return value;
        }

        /// <summary>
        /// Create ImageMetadata from MAST observation data with robust date extraction and logging.
        /// </summary>
        private static ImageMetadata? CreateImageMetadata(Dictionary<string, object?>? obsMeta, ILogger? logger = null)
        {
            if (obsMeta == null) return null;

            var metadata = new ImageMetadata();

            if (obsMeta.TryGetValue("target_name", out var targetName) && targetName != null)
                metadata.TargetName = targetName.ToString();

            if (obsMeta.TryGetValue("instrument_name", out var instrument) && instrument != null)
                metadata.Instrument = instrument.ToString();

            if (obsMeta.TryGetValue("filters", out var filter) && filter != null)
                metadata.Filter = filter.ToString();

            if (obsMeta.TryGetValue("t_exptime", out var expTime) && expTime != null)
            {
                if (double.TryParse(expTime.ToString(), out var expTimeValue))
                    metadata.ExposureTime = expTimeValue;
            }

            // Extract wavelength information if available
            if (obsMeta.TryGetValue("wavelength_region", out var wavelengthRegion) && wavelengthRegion != null)
            {
                metadata.WavelengthRange = wavelengthRegion.ToString();
            }

            // Extract calibration level
            if (obsMeta.TryGetValue("calib_level", out var calibLevel) && calibLevel != null)
            {
                if (int.TryParse(calibLevel.ToString(), out var calibLevelValue))
                {
                    metadata.CalibrationLevel = calibLevelValue;
                }
            }

            // Convert MJD (Modified Julian Date) to DateTime
            // Try t_min first (observation start time), then fallback to t_max or other date fields
            DateTime? observationDate = null;
            var dateFields = new[] { "t_min", "t_max", "t_obs_release" };

            foreach (var dateField in dateFields)
            {
                if (obsMeta.TryGetValue(dateField, out var dateValue) && dateValue != null)
                {
                    if (double.TryParse(dateValue.ToString(), out var mjd) && mjd > 0)
                    {
                        // MJD epoch is November 17, 1858
                        observationDate = new DateTime(1858, 11, 17, 0, 0, 0, DateTimeKind.Utc).AddDays(mjd);
                        break;
                    }
                }
            }

            if (observationDate.HasValue)
            {
                metadata.ObservationDate = observationDate.Value;
            }
            else
            {
                // Log warning if no date found
                logger?.LogWarning("No observation date found in MAST metadata. Available fields: {Fields}",
                    string.Join(", ", obsMeta.Keys));
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

            // Extract proposal information
            if (obsMeta.TryGetValue("proposal_id", out var proposalId) && proposalId != null)
            {
                metadata.ProposalId = proposalId.ToString();
            }

            if (obsMeta.TryGetValue("proposal_pi", out var proposalPi) && proposalPi != null)
            {
                metadata.ProposalPi = proposalPi.ToString();
            }

            // Extract observation title
            if (obsMeta.TryGetValue("obs_title", out var obsTitle) && obsTitle != null)
            {
                metadata.ObservationTitle = obsTitle.ToString();
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
