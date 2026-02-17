// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;
using System.Text.RegularExpressions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Services.Storage;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public partial class MastController : ControllerBase
    {
        // Regex pattern for valid JWST observation IDs
        // Matches: jw12345-o001_t001_nircam (with optional additional suffixes like _clear-f090w)
        private static readonly Regex JwstObsIdPattern = MyRegex();

        private readonly IMastService mastService;
        private readonly IMongoDBService mongoDBService;
        private readonly IImportJobTracker jobTracker;
        private readonly IThumbnailQueue thumbnailQueue;
        private readonly IStorageProvider storageProvider;
        private readonly ILogger<MastController> logger;
        private readonly IConfiguration configuration;

        // Configurable download settings
        private readonly int pollIntervalMs;
        private readonly string downloadBasePath;

        public MastController(
            IMastService mastService,
            IMongoDBService mongoDBService,
            IImportJobTracker jobTracker,
            IThumbnailQueue thumbnailQueue,
            IStorageProvider storageProvider,
            ILogger<MastController> logger,
            IConfiguration configuration)
        {
            this.mastService = mastService;
            this.mongoDBService = mongoDBService;
            this.jobTracker = jobTracker;
            this.thumbnailQueue = thumbnailQueue;
            this.storageProvider = storageProvider;
            this.logger = logger;
            this.configuration = configuration;

            // Load configurable settings
            pollIntervalMs = this.configuration.GetValue("Downloads:PollIntervalMs", 500);
            downloadBasePath = this.configuration.GetValue<string>("Downloads:BasePath") ?? "/app/data/mast";
        }

        /// <summary>
        /// Search MAST by target name (e.g., "NGC 1234", "Carina Nebula").
        /// </summary>
        [HttpPost("search/target")]
        [AllowAnonymous]
        public async Task<ActionResult<MastSearchResponse>> SearchByTarget(
            [FromBody] MastTargetSearchRequest request)
        {
            try
            {
                var result = await mastService.SearchByTargetAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                LogTargetSearchFailed(ex, request.TargetName);
                return ProcessingEngineError(ex);
            }
            catch (Exception ex)
            {
                LogTargetSearchFailed(ex, request.TargetName);
                return StatusCode(500, new { error = "MAST search failed" });
            }
        }

        /// <summary>
        /// Search MAST by RA/Dec coordinates.
        /// </summary>
        [HttpPost("search/coordinates")]
        [AllowAnonymous]
        public async Task<ActionResult<MastSearchResponse>> SearchByCoordinates(
            [FromBody] MastCoordinateSearchRequest request)
        {
            try
            {
                var result = await mastService.SearchByCoordinatesAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                LogCoordinateSearchFailed(ex, request.Ra, request.Dec);
                return ProcessingEngineError(ex);
            }
            catch (Exception ex)
            {
                LogCoordinateSearchFailed(ex, request.Ra, request.Dec);
                return StatusCode(500, new { error = "MAST search failed" });
            }
        }

        /// <summary>
        /// Search MAST by observation ID.
        /// </summary>
        [HttpPost("search/observation")]
        [AllowAnonymous]
        public async Task<ActionResult<MastSearchResponse>> SearchByObservationId(
            [FromBody] MastObservationSearchRequest request)
        {
            try
            {
                var result = await mastService.SearchByObservationIdAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                LogObservationSearchFailed(ex, request.ObsId);
                return ProcessingEngineError(ex);
            }
            catch (Exception ex)
            {
                LogObservationSearchFailed(ex, request.ObsId);
                return StatusCode(500, new { error = "MAST search failed" });
            }
        }

        /// <summary>
        /// Search MAST by program/proposal ID.
        /// </summary>
        [HttpPost("search/program")]
        [AllowAnonymous]
        public async Task<ActionResult<MastSearchResponse>> SearchByProgramId(
            [FromBody] MastProgramSearchRequest request)
        {
            try
            {
                var result = await mastService.SearchByProgramIdAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                LogProgramSearchFailed(ex, request.ProgramId);
                return ProcessingEngineError(ex);
            }
            catch (Exception ex)
            {
                LogProgramSearchFailed(ex, request.ProgramId);
                return StatusCode(500, new { error = "MAST search failed" });
            }
        }

        /// <summary>
        /// Search MAST for recently released JWST observations ("What's New").
        /// </summary>
        [HttpPost("whats-new")]
        [AllowAnonymous]
        public async Task<ActionResult<MastSearchResponse>> GetWhatsNew(
            [FromBody] MastRecentReleasesRequest request)
        {
            try
            {
                var result = await mastService.SearchRecentReleasesAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                LogRecentReleasesSearchFailed(ex, request.DaysBack);
                return ProcessingEngineError(ex);
            }
            catch (Exception ex)
            {
                LogRecentReleasesSearchFailed(ex, request.DaysBack);
                return StatusCode(500, new { error = "MAST search failed" });
            }
        }

        /// <summary>
        /// Get available data products for an observation.
        /// </summary>
        [HttpPost("products")]
        [AllowAnonymous]
        public async Task<ActionResult<MastDataProductsResponse>> GetDataProducts(
            [FromBody] MastDataProductsRequest request)
        {
            try
            {
                var result = await mastService.GetDataProductsAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                LogFailedToGetProducts(ex, request.ObsId);
                return ProcessingEngineError(ex);
            }
            catch (Exception ex)
            {
                LogFailedToGetProducts(ex, request.ObsId);
                return StatusCode(500, new { error = "Failed to get products" });
            }
        }

        /// <summary>
        /// Download FITS files from MAST (does not create database records).
        /// </summary>
        [HttpPost("download")]
        public async Task<ActionResult<MastDownloadResponse>> Download(
            [FromBody] MastDownloadRequest request)
        {
            try
            {
                var result = await mastService.DownloadObservationAsync(request);
                return Ok(result);
            }
            catch (HttpRequestException ex)
            {
                LogDownloadFailed(ex, request.ObsId);
                return ProcessingEngineError(ex);
            }
            catch (Exception ex)
            {
                LogDownloadFailed(ex, request.ObsId);
                return StatusCode(500, new { error = "Download failed" });
            }
        }

        /// <summary>
        /// Import MAST observation: download files and create database records (async with progress tracking).
        /// </summary>
        [HttpPost("import")]
        public ActionResult<ImportJobStartResponse> Import(
            [FromBody] MastImportRequest request)
        {
            // Set the current user as the owner of imported files
            request.UserId = GetCurrentUserId();

            var jobId = jobTracker.CreateJob(request.ObsId);
            LogStartingImportJob(jobId, request.ObsId);

            // Start the import process in the background
            _ = Task.Run(async () => await ExecuteImportAsync(jobId, request));

            return Ok(new ImportJobStartResponse
            {
                JobId = jobId,
                ObsId = request.ObsId,
                Message = "Import started",
            });
        }

        /// <summary>
        /// Get import job progress.
        /// </summary>
        [HttpGet("import-progress/{jobId}")]
        public ActionResult<ImportJobStatus> GetImportProgress(string jobId)
        {
            var job = jobTracker.GetJob(jobId);
            if (job == null)
            {
                return NotFound(new { error = "Job not found", jobId });
            }

            return Ok(job);
        }

        /// <summary>
        /// Cancel an active import job.
        /// </summary>
        [HttpPost("import/cancel/{jobId}")]
        public async Task<ActionResult> CancelImport(string jobId)
        {
            var job = jobTracker.GetJob(jobId);
            if (job == null)
            {
                return NotFound(new { error = "Job not found", jobId });
            }

            if (job.IsComplete)
            {
                return BadRequest(new { error = "Job is already complete", jobId, stage = job.Stage });
            }

            // Cancel the job in the tracker (this signals the background task to stop)
            var cancelled = jobTracker.CancelJob(jobId);
            if (!cancelled)
            {
                return BadRequest(new { error = "Could not cancel job", jobId });
            }

            // Also try to pause the download in the processing engine if we have a download job ID
            if (!string.IsNullOrEmpty(job.DownloadJobId))
            {
                try
                {
                    await mastService.PauseDownloadAsync(job.DownloadJobId);
                    LogPausedDownloadForCancelled(job.DownloadJobId, jobId);
                }
                catch (Exception ex)
                {
                    LogCouldNotPauseDownload(ex, job.DownloadJobId);

                    // Continue anyway - the import job is still cancelled
                }
            }

            LogCancelledImportJob(jobId, job.ObsId);
            return Ok(new { message = "Import cancelled", jobId, obsId = job.ObsId });
        }

        /// <summary>
        /// Resume a paused or failed import job.
        /// </summary>
        [HttpPost("import/resume/{jobId}")]
        public async Task<ActionResult> ResumeImport(string jobId)
        {
            var job = jobTracker.GetJob(jobId);
            if (job == null)
            {
                // Job not in import tracker - this may be a processing engine download
                // job ID (e.g., from the resumable downloads panel after a backend restart).
                // Try to resume by looking up the download in the processing engine.
                return await ResumeFromDownloadJobId(jobId);
            }

            if (!job.IsResumable || string.IsNullOrEmpty(job.DownloadJobId))
            {
                return BadRequest(new { error = "Job is not resumable", jobId });
            }

            try
            {
                // Resume the download in the processing engine
                var resumeResult = await mastService.ResumeDownloadAsync(job.DownloadJobId);

                // Reset job status for resumed polling
                jobTracker.UpdateProgress(jobId, job.Progress, ImportStages.Downloading, "Resuming download...");
                jobTracker.SetResumable(jobId, true);

                LogResumedImportJob(jobId, job.DownloadJobId);

                // Start background task to continue polling and complete import
                _ = Task.Run(async () => await ExecuteResumedImportAsync(jobId, job.ObsId, job.DownloadJobId));

                return Ok(new { message = "Import resumed", jobId, downloadJobId = job.DownloadJobId });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                // 404 from processing engine - check if download actually completed
                // This can happen when the download completed but backend polling timed out
                LogProcessingEngine404(job.DownloadJobId);

                // Defense in depth: validate stored obsId before path operations
                if (!IsValidJwstObservationId(job.ObsId))
                {
                    LogPathTraversalAttemptBlocked(job.ObsId ?? "(null)");
                    jobTracker.FailJob(jobId, "Invalid observation ID in stored job");
                    return BadRequest(new { error = "Invalid observation ID in job" });
                }

                // Check if files exist on disk for this observation
                var downloadDir = Path.Combine(downloadBasePath, job.ObsId);

                // Defense in depth: verify resolved path is within allowed directory
                if (!IsPathWithinDownloadDirectory(downloadDir))
                {
                    LogPathTraversalAttemptBlocked(job.ObsId);
                    jobTracker.FailJob(jobId, "Invalid path in stored job");
                    return BadRequest(new { error = "Invalid observation ID" });
                }

                if (Directory.Exists(downloadDir))
                {
                    var existingFiles = Directory.GetFiles(downloadDir, "*.fits", SearchOption.AllDirectories)
                        .Concat(Directory.GetFiles(downloadDir, "*.FITS", SearchOption.AllDirectories))
                        .Distinct()
                        .ToList();

                    if (existingFiles.Count > 0)
                    {
                        LogFoundExistingFiles(existingFiles.Count, job.ObsId);

                        // Reset job status and complete the import from existing files
                        jobTracker.UpdateProgress(jobId, 40, ImportStages.SavingRecords,
                            $"Found {existingFiles.Count} downloaded files, creating records...");
                        jobTracker.SetResumable(jobId, false);

                        // Start background task to create database records
                        _ = Task.Run(async () => await CompleteImportFromExistingFilesAsync(
                            jobId, job.ObsId, existingFiles));

                        return Ok(new
                        {
                            message = "Download already completed, creating database records",
                            jobId,
                            filesFound = existingFiles.Count,
                        });
                    }
                }

                // No files found - the download really didn't complete
                LogNoFilesFoundCannotResume(job.ObsId);
                jobTracker.SetResumable(jobId, false);
                jobTracker.FailJob(jobId, "Download state lost and no files found. Please start a new import.");
                return BadRequest(new
                {
                    error = "Cannot resume - download state lost and no files found",
                    suggestion = "Please start a new import",
                });
            }
            catch (HttpRequestException ex)
            {
                LogFailedToResumeImport(ex, jobId);
                return ProcessingEngineError(ex);
            }
        }

        /// <summary>
        /// Import from existing downloaded files (use when download completed but import timed out).
        /// </summary>
        [HttpPost("import/from-existing/{obsId}")]
        public ActionResult<ImportJobStartResponse> ImportFromExistingFiles(string obsId)
        {
            // Security: Validate obsId format to prevent path traversal
            if (!IsValidJwstObservationId(obsId))
            {
                LogPathTraversalAttemptBlocked(obsId ?? "(null)");
                return BadRequest(new { error = "Invalid observation ID format" });
            }

            var downloadDir = Path.Combine(downloadBasePath, obsId);

            // Defense in depth: verify resolved path is within allowed directory
            if (!IsPathWithinDownloadDirectory(downloadDir))
            {
                LogPathTraversalAttemptBlocked(obsId);
                return BadRequest(new { error = "Invalid observation ID" });
            }

            // Check if files exist
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

            var jobId = jobTracker.CreateJob(obsId);
            LogStartingImportFromExisting(obsId, existingFiles.Count);

            // Start the import process in the background
            _ = Task.Run(async () => await CompleteImportFromExistingFilesAsync(jobId, obsId, existingFiles));

            return Ok(new ImportJobStartResponse
            {
                JobId = jobId,
                ObsId = obsId,
                Message = $"Importing {existingFiles.Count} existing files",
            });
        }

        /// <summary>
        /// Check if downloaded files exist for an observation.
        /// </summary>
        [HttpGet("import/check-files/{obsId}")]
        public ActionResult CheckExistingFiles(string obsId)
        {
            // Security: Validate obsId format to prevent path traversal
            if (!IsValidJwstObservationId(obsId))
            {
                LogPathTraversalAttemptBlocked(obsId ?? "(null)");
                return BadRequest(new { error = "Invalid observation ID format" });
            }

            var downloadDir = Path.Combine(downloadBasePath, obsId);

            // Defense in depth: verify resolved path is within allowed directory
            if (!IsPathWithinDownloadDirectory(downloadDir))
            {
                LogPathTraversalAttemptBlocked(obsId);
                return BadRequest(new { error = "Invalid observation ID" });
            }

            if (!Directory.Exists(downloadDir))
            {
                return Ok(new { exists = false, fileCount = 0, obsId });
            }

            var existingFiles = Directory.GetFiles(downloadDir, "*.fits", SearchOption.AllDirectories)
                .Concat(Directory.GetFiles(downloadDir, "*.FITS", SearchOption.AllDirectories))
                .Distinct()
                .ToList();

            return Ok(new
            {
                exists = existingFiles.Count > 0,
                fileCount = existingFiles.Count,
                obsId,
                downloadDir,
            });
        }

        /// <summary>
        /// List all resumable download jobs.
        /// </summary>
        [HttpGet("import/resumable")]
        public async Task<ActionResult<ResumableJobsResponse>> GetResumableImports()
        {
            try
            {
                var result = await mastService.GetResumableDownloadsAsync();
                return Ok(result ?? new ResumableJobsResponse { Jobs = [], Count = 0 });
            }
            catch (HttpRequestException ex)
            {
                LogFailedToGetResumableDownloads(ex);
                return ProcessingEngineError(ex);
            }
        }

        /// <summary>
        /// Dismiss a resumable download job, optionally deleting downloaded files.
        /// </summary>
        [HttpDelete("import/resumable/{jobId}")]
        public async Task<ActionResult> DismissResumableDownload(string jobId, [FromQuery] bool deleteFiles = false)
        {
            try
            {
                var success = await mastService.DismissResumableDownloadAsync(jobId, deleteFiles);
                if (!success)
                {
                    return NotFound(new { error = $"Job {jobId} not found or could not be dismissed" });
                }

                return Ok(new { jobId, dismissed = true, deleteFiles });
            }
            catch (HttpRequestException ex)
            {
                LogFailedToDismissDownload(ex, jobId);
                return ProcessingEngineError(ex);
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
                LogRefreshingMetadata(obsId);

                // Find all records with this MAST observation ID
                var allData = await mongoDBService.GetAsync();
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
                    obsSearch = await mastService.SearchByObservationIdAsync(
                        new MastObservationSearchRequest { ObsId = obsId });
                }
                catch (Exception ex)
                {
                    LogFailedToFetchMastMetadata(ex, obsId);
                    return StatusCode(503, new { error = "Failed to fetch MAST metadata" });
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
                    record.ImageInfo = CreateImageMetadata(obsMeta);

                    await mongoDBService.UpdateAsync(record.Id, record);
                    updatedCount++;

                    LogUpdatedMetadata(record.Id, record.FileName);
                }

                LogRefreshedMetadata(updatedCount, obsId);

                return Ok(new MetadataRefreshResponse
                {
                    ObsId = obsId,
                    UpdatedCount = updatedCount,
                    Message = $"Successfully refreshed metadata for {updatedCount} record(s)",
                });
            }
            catch (Exception ex)
            {
                LogFailedToRefreshMetadata(ex, obsId);
                return StatusCode(500, new { error = "Failed to refresh metadata" });
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
                LogStartingBulkMetadataRefresh();

                // Find all records with MAST source
                var allData = await mongoDBService.GetAsync();
                var mastRecords = allData.Where(d =>
                    d.Metadata.TryGetValue("source", out var source) &&
                    source?.ToString() == "MAST").ToList();

                if (mastRecords.Count == 0)
                {
                    return Ok(new MetadataRefreshResponse
                    {
                        ObsId = "all",
                        UpdatedCount = 0,
                        Message = "No MAST imports found to refresh",
                    });
                }

                // Group by observation ID for efficient MAST queries
                var groupedByObs = mastRecords
                    .GroupBy(d => d.Metadata.TryGetValue("mast_obs_id", out var id) ? id?.ToString() ?? string.Empty : string.Empty)
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
                        var obsSearch = await mastService.SearchByObservationIdAsync(
                            new MastObservationSearchRequest { ObsId = obsId });

                        var obsMeta = obsSearch?.Results.FirstOrDefault();
                        if (obsMeta == null)
                        {
                            LogObservationNotFoundInMast(obsId);
                            failedObs.Add(obsId);
                            continue;
                        }

                        // Update each record in this observation group
                        foreach (var record in group)
                        {
                            var processingLevel = record.ProcessingLevel ?? ProcessingLevels.Unknown;
                            record.Metadata = BuildMastMetadata(obsMeta, obsId, processingLevel);
                            record.ImageInfo = CreateImageMetadata(obsMeta);
                            await mongoDBService.UpdateAsync(record.Id, record);
                            totalUpdated++;
                        }
                    }
                    catch (Exception ex)
                    {
                        LogFailedToRefreshMetadataForObs(ex, obsId);
                        failedObs.Add(obsId);
                    }
                }

                var message = $"Refreshed metadata for {totalUpdated} record(s) across {groupedByObs.Count - failedObs.Count} observation(s)";
                if (failedObs.Count > 0)
                {
                    message += $". Failed for {failedObs.Count} observation(s): {string.Join(", ", failedObs.Take(5))}";
                    if (failedObs.Count > 5)
                    {
                        message += "...";
                    }
                }

                LogBulkRefreshResult(message);

                // Queue thumbnail generation for records that don't have thumbnails
                var thumbnailIds = await mongoDBService.GetViewableWithoutThumbnailIdsAsync();
                thumbnailQueue.EnqueueBatch(thumbnailIds);

                return Ok(new MetadataRefreshResponse
                {
                    ObsId = "all",
                    UpdatedCount = totalUpdated,
                    Message = message,
                });
            }
            catch (Exception ex)
            {
                LogFailedToRefreshAllMetadata(ex);
                return StatusCode(500, new { error = "Failed to refresh metadata" });
            }
        }

        // ===== Private static methods =====

        /// <summary>
        /// Validates that obsId matches expected JWST observation ID format.
        /// Prevents path traversal attacks via malicious obsId values.
        /// </summary>
        private static bool IsValidJwstObservationId(string? obsId)
        {
            if (string.IsNullOrWhiteSpace(obsId))
            {
                return false;
            }

            return JwstObsIdPattern.IsMatch(obsId);
        }

        private static (string dataType, string processingLevel, string? observationBaseId, string? exposureId, bool isViewable)
            ParseFileInfo(string fileName, Dictionary<string, object?>? obsMeta)
        {
            var fileNameLower = fileName.ToLowerInvariant();
            var dataType = DataTypes.Image;
            var processingLevel = ProcessingLevels.Unknown;
            string? observationBaseId = null;
            string? exposureId = null;
            var isViewable = true;

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
            if (fileNameLower.Contains("_asn", StringComparison.Ordinal) || fileNameLower.Contains("_pool", StringComparison.Ordinal))
            {
                dataType = DataTypes.Metadata;
                isViewable = false;
            }
            else if (fileNameLower.Contains("_cat", StringComparison.Ordinal) || fileNameLower.Contains("_phot", StringComparison.Ordinal))
            {
                dataType = DataTypes.Metadata;
                isViewable = false;
            }
            else if (fileNameLower.Contains("_x1d", StringComparison.Ordinal) || fileNameLower.Contains("_x1dints", StringComparison.Ordinal) || fileNameLower.Contains("_c1d", StringComparison.Ordinal))
            {
                dataType = DataTypes.Spectral;
                isViewable = false; // 1D extracted spectra are tables
            }

            // Viewable image files
            else if (fileNameLower.Contains("_uncal", StringComparison.Ordinal))
            {
                dataType = DataTypes.Raw;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_rate", StringComparison.Ordinal) || fileNameLower.Contains("_rateints", StringComparison.Ordinal))
            {
                dataType = DataTypes.Sensor;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_s2d", StringComparison.Ordinal) || fileNameLower.Contains("_s3d", StringComparison.Ordinal))
            {
                dataType = DataTypes.Spectral;
                isViewable = true; // 2D/3D spectral images are viewable
            }
            else if (fileNameLower.Contains("_cal", StringComparison.Ordinal) || fileNameLower.Contains("_calints", StringComparison.Ordinal) ||
                     fileNameLower.Contains("_crf", StringComparison.Ordinal) || fileNameLower.Contains("_i2d", StringComparison.Ordinal))
            {
                dataType = DataTypes.Image;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_flat", StringComparison.Ordinal) || fileNameLower.Contains("_dark", StringComparison.Ordinal) || fileNameLower.Contains("_bias", StringComparison.Ordinal))
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
                observationBaseId = obsMatch.Groups[1].Value.ToLowerInvariant();
            }

            // Parse exposure ID for finer-grained lineage
            // Example: jw02733001001_02101_00001
            var expMatch = Regex.Match(
                fileName,
                @"(jw\d{5}\d{3}\d{3}_\d{5}_\d{5})",
                RegexOptions.IgnoreCase);

            if (expMatch.Success)
            {
                exposureId = expMatch.Groups[1].Value.ToLowerInvariant();
            }

            return (dataType, processingLevel, observationBaseId, exposureId, isViewable);
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
                { "processing_level", processingLevel },
            };

            if (obsMeta != null)
            {
                foreach (var kvp in obsMeta)
                {
                    if (kvp.Value != null)
                    {
                        // Prefix all MAST fields with "mast_" for clear provenance
                        var key = kvp.Key.StartsWith("mast_", StringComparison.Ordinal) ? kvp.Key : $"mast_{kvp.Key}";

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
                    System.Text.Json.JsonValueKind.String => jsonElement.GetString() ?? string.Empty,
                    System.Text.Json.JsonValueKind.Number => jsonElement.TryGetInt64(out var l) ? l : jsonElement.GetDouble(),
                    System.Text.Json.JsonValueKind.True => true,
                    System.Text.Json.JsonValueKind.False => false,
                    System.Text.Json.JsonValueKind.Null => string.Empty,
                    System.Text.Json.JsonValueKind.Array => jsonElement.ToString(),
                    System.Text.Json.JsonValueKind.Object => jsonElement.ToString(),
                    _ => jsonElement.ToString(),
                };
            }

            return value;
        }

        [GeneratedRegex(@"^jw\d{5}-o\d+_t\d+[_a-z0-9\-]*$", RegexOptions.IgnoreCase | RegexOptions.Compiled, "en-US")]
        private static partial Regex MyRegex();

        // ===== Private instance methods =====

        /// <summary>
        /// Return an appropriate error response for a processing engine failure.
        /// If the engine responded with a status code, forward the actual error;
        /// otherwise treat it as a connectivity failure (503).
        /// </summary>
        private ObjectResult ProcessingEngineError(HttpRequestException ex)
        {
            if (ex.StatusCode.HasValue)
            {
                return StatusCode((int)ex.StatusCode, new { error = ex.Message });
            }

            return StatusCode(503, new { error = "Processing engine unavailable" });
        }

        /// <summary>
        /// Gets the current user ID from JWT claims.
        /// </summary>
        private string? GetCurrentUserId()
        {
            return User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                ?? User.FindFirst("sub")?.Value;
        }

        /// <summary>
        /// Validates that a resolved path is within the allowed base directory.
        /// Defense-in-depth against path traversal.
        /// </summary>
        private bool IsPathWithinDownloadDirectory(string resolvedPath)
        {
            var fullBasePath = Path.GetFullPath(downloadBasePath);
            var fullResolvedPath = Path.GetFullPath(resolvedPath);
            return fullResolvedPath.StartsWith(fullBasePath + Path.DirectorySeparatorChar, StringComparison.Ordinal)
                || fullResolvedPath.Equals(fullBasePath, StringComparison.Ordinal);
        }

        /// <summary>
        /// Resume an import using a processing engine download job ID.
        /// Creates a new import tracker job and resumes the download.
        /// Used when the original import tracker job is lost (e.g., after backend restart)
        /// but the processing engine still has download state on disk.
        /// </summary>
        private async Task<ActionResult> ResumeFromDownloadJobId(string downloadJobId)
        {
            try
            {
                // Look up the job from the resumable downloads list (reads from disk state files).
                // We cannot use GetDownloadProgressAsync here because that checks in-memory state
                // only, which is lost after a processing engine restart.
                var resumableJobs = await mastService.GetResumableDownloadsAsync();
                var jobSummary = resumableJobs?.Jobs?.FirstOrDefault(j => j.JobId == downloadJobId);

                if (jobSummary == null || string.IsNullOrEmpty(jobSummary.ObsId))
                {
                    return NotFound(new { error = "Job not found", jobId = downloadJobId });
                }

                var obsId = jobSummary.ObsId;

                // Create a new import tracker job
                var importJobId = jobTracker.CreateJob(obsId);
                jobTracker.SetDownloadJobId(importJobId, downloadJobId);
                jobTracker.SetResumable(importJobId, true);

                // Resume the download in the processing engine
                await mastService.ResumeDownloadAsync(downloadJobId);

                var progress = (int)Math.Round(jobSummary.ProgressPercent);
                jobTracker.UpdateProgress(importJobId, progress, ImportStages.Downloading, "Resuming download...");
                LogResumedImportJob(importJobId, downloadJobId);

                // Start background task to continue polling and complete import
                _ = Task.Run(async () => await ExecuteResumedImportAsync(importJobId, obsId, downloadJobId));

                return Ok(new { message = "Import resumed", jobId = importJobId, downloadJobId });
            }
            catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return NotFound(new { error = "Job not found", jobId = downloadJobId });
            }
            catch (HttpRequestException ex)
            {
                LogFailedToResumeImport(ex, downloadJobId);
                return ProcessingEngineError(ex);
            }
        }

        /// <summary>
        /// Complete an import from files that were already downloaded.
        /// </summary>
        private async Task CompleteImportFromExistingFilesAsync(string jobId, string obsId, List<string> files)
        {
            try
            {
                // Get observation metadata from MAST for enrichment
                jobTracker.UpdateProgress(jobId, 45, ImportStages.SavingRecords, "Fetching observation metadata...");

                MastSearchResponse? obsSearch = null;
                try
                {
                    obsSearch = await mastService.SearchByObservationIdAsync(
                        new MastObservationSearchRequest { ObsId = obsId });
                }
                catch (Exception ex)
                {
                    LogCouldNotFetchObservationMetadata(ex, obsId);
                }

                var obsMeta = obsSearch?.Results.FirstOrDefault();

                // Create database records using shared helper
                var (importedIds, lineageTree, commonObservationBaseId) = await CreateRecordsForFilesAsync(
                    jobId, obsId, files, obsMeta);

                // Establish lineage relationships between processing levels
                jobTracker.UpdateProgress(jobId, 95, ImportStages.SavingRecords, "Establishing lineage relationships...");
                await EstablishLineageRelationships(importedIds);

                var result = new MastImportResponse
                {
                    Status = "completed",
                    ObsId = obsId,
                    ImportedDataIds = importedIds,
                    ImportedCount = importedIds.Count,
                    LineageTree = lineageTree,
                    ObservationBaseId = commonObservationBaseId,
                    Timestamp = DateTime.UtcNow,
                };

                jobTracker.CompleteJob(jobId, result);
                LogCompletedImportFromExisting(jobId, importedIds.Count);
            }
            catch (Exception ex)
            {
                LogFailedToCompleteImportFromExisting(ex, jobId);
                jobTracker.FailJob(jobId, ex.Message);
            }
        }

        private async Task ExecuteImportAsync(string jobId, MastImportRequest request)
        {
            var cancellationToken = jobTracker.GetCancellationToken(jobId);

            try
            {
                jobTracker.UpdateProgress(jobId, 5, ImportStages.Starting, "Initializing import...");

                // 1. Start download in processing engine (S3 or HTTP based on DownloadSource)
                var downloadSource = (request.DownloadSource ?? "auto").ToLowerInvariant();
                var useS3 = downloadSource is "s3" or "auto";
                var useHttp = downloadSource is "http" or "auto";

                ChunkedDownloadStartResponse? downloadStartResult = null;
                var sourceLabel = "MAST";

                if (useS3)
                {
                    try
                    {
                        jobTracker.UpdateProgress(jobId, 10, ImportStages.Downloading, "Starting S3 download...");
                        downloadStartResult = await mastService.StartS3DownloadAsync(
                            new ChunkedDownloadRequest
                            {
                                ObsId = request.ObsId,
                                ProductType = request.ProductType,
                                CalibLevel = request.CalibLevel,
                            });
                        sourceLabel = "S3";
                    }
                    catch (Exception s3Ex) when (useHttp)
                    {
                        // Auto mode: S3 failed, fall back to HTTP
                        LogS3DownloadFallback(s3Ex, request.ObsId);
                        downloadStartResult = null;
                    }
                }

                if (downloadStartResult == null && useHttp)
                {
                    jobTracker.UpdateProgress(jobId, 10, ImportStages.Downloading, "Starting chunked download from MAST...");
                    downloadStartResult = await mastService.StartChunkedDownloadAsync(
                        new ChunkedDownloadRequest
                        {
                            ObsId = request.ObsId,
                            ProductType = request.ProductType,
                            CalibLevel = request.CalibLevel,
                        });
                    sourceLabel = "HTTP";
                }

                if (downloadStartResult == null)
                {
                    jobTracker.FailJob(jobId, "Failed to start download from any source");
                    return;
                }

                var downloadJobId = downloadStartResult.JobId;
                jobTracker.SetDownloadJobId(jobId, downloadJobId);
                jobTracker.SetResumable(jobId, sourceLabel == "HTTP"); // Only HTTP downloads support resume
                LogStartedChunkedDownload(downloadJobId, jobId);

                // 2. Poll for download progress with byte-level tracking (no timeout - runs until complete or cancelled)
                PollDownloadProgress:
                var downloadComplete = false;
                DownloadJobProgress? downloadProgress = null;

                while (!downloadComplete && !cancellationToken.IsCancellationRequested)
                {
                    await Task.Delay(pollIntervalMs, cancellationToken);

                    downloadProgress = await mastService.GetChunkedDownloadProgressAsync(downloadJobId);
                    if (downloadProgress == null)
                    {
                        LogCouldNotGetDownloadProgress(downloadJobId);
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

                    jobTracker.UpdateProgress(jobId, importProgress, ImportStages.Downloading, message);

                    // Update byte-level progress
                    jobTracker.UpdateByteProgress(
                        jobId,
                        downloadProgress.DownloadedBytes,
                        downloadProgress.TotalBytes,
                        downloadProgress.SpeedBytesPerSec,
                        downloadProgress.EtaSeconds,
                        downloadProgress.FileProgress);

                    if (downloadProgress.IsComplete)
                    {
                        downloadComplete = true;
                    }
                }

                // Check if cancelled
                if (cancellationToken.IsCancellationRequested)
                {
                    LogImportCancelledDuringDownload(jobId);
                    return; // Job status already set by CancelJob
                }

                if (downloadProgress?.Stage == "failed" || downloadProgress?.Error != null)
                {
                    // Auto mode: if S3 download failed during transfer, fall back to HTTP
                    if (sourceLabel == "S3" && useHttp)
                    {
                        LogS3DownloadFallback(
                            new InvalidOperationException(downloadProgress?.Error ?? "S3 download failed"),
                            request.ObsId);

                        jobTracker.UpdateProgress(jobId, 10, ImportStages.Downloading,
                            "S3 download failed, falling back to HTTP...");

                        var httpFallback = await mastService.StartChunkedDownloadAsync(
                            new ChunkedDownloadRequest
                            {
                                ObsId = request.ObsId,
                                ProductType = request.ProductType,
                                CalibLevel = request.CalibLevel,
                            });

                        downloadJobId = httpFallback.JobId;
                        jobTracker.SetDownloadJobId(jobId, downloadJobId);
                        sourceLabel = "HTTP";
                        jobTracker.SetResumable(jobId, true);
                        LogStartedChunkedDownload(downloadJobId, jobId);

                        goto PollDownloadProgress;
                    }

                    jobTracker.SetResumable(jobId, downloadProgress.IsResumable);
                    jobTracker.FailJob(jobId, downloadProgress.Error ?? "Download failed");
                    return;
                }

                if (downloadProgress?.Files == null || downloadProgress.Files.Count == 0)
                {
                    jobTracker.FailJob(jobId, "No files downloaded");
                    return;
                }

                var totalDownloadedMB = downloadProgress.DownloadedBytes / (1024.0 * 1024.0);
                jobTracker.UpdateProgress(jobId, 40, ImportStages.Downloading,
                    $"Downloaded {downloadProgress.Files.Count} file(s) ({totalDownloadedMB:F1} MB)");
                jobTracker.SetResumable(jobId, false);

                // Create a MastDownloadResponse-like object from the progress
                var downloadResult = new MastDownloadResponse
                {
                    Status = "completed",
                    ObsId = request.ObsId,
                    Files = downloadProgress.Files,
                    FileCount = downloadProgress.Files.Count,
                    DownloadDir = downloadProgress.DownloadDir,
                };

                // 2. Get observation metadata from MAST for enrichment
                jobTracker.UpdateProgress(jobId, 45, ImportStages.SavingRecords, "Fetching observation metadata...");

                MastSearchResponse? obsSearch = null;
                try
                {
                    obsSearch = await mastService.SearchByObservationIdAsync(
                        new MastObservationSearchRequest { ObsId = request.ObsId });
                }
                catch (Exception ex)
                {
                    LogCouldNotFetchObservationMetadata(ex, request.ObsId);
                }

                var obsMeta = obsSearch?.Results.FirstOrDefault();

                // 3. Create database records using shared helper
                var (importedIds, lineageTree, commonObservationBaseId) = await CreateRecordsForFilesAsync(
                    jobId, request.ObsId, downloadResult.Files, obsMeta,
                    request.Tags, request.UserId, request.IsPublic);

                // Establish lineage relationships between processing levels
                jobTracker.UpdateProgress(jobId, 95, ImportStages.SavingRecords, "Establishing lineage relationships...");
                await EstablishLineageRelationships(importedIds);

                thumbnailQueue.EnqueueBatch(importedIds);

                var result = new MastImportResponse
                {
                    Status = "completed",
                    ObsId = request.ObsId,
                    ImportedDataIds = importedIds,
                    ImportedCount = importedIds.Count,
                    LineageTree = lineageTree,
                    ObservationBaseId = commonObservationBaseId,
                    Timestamp = DateTime.UtcNow,
                };

                jobTracker.CompleteJob(jobId, result);
            }
            catch (OperationCanceledException)
            {
                LogImportJobCancelled(jobId);

                // Job status already set by CancelJob - no need to update
            }
            catch (HttpRequestException ex)
            {
                LogMastImportFailed(ex, jobId, request.ObsId);
                jobTracker.FailJob(jobId, "Processing engine unavailable: " + ex.Message);
            }
            catch (Exception ex)
            {
                LogMastImportFailed(ex, jobId, request.ObsId);
                jobTracker.FailJob(jobId, ex.Message);
            }
        }

        private async Task ExecuteResumedImportAsync(string jobId, string obsId, string downloadJobId)
        {
            var cancellationToken = jobTracker.GetCancellationToken(jobId);

            try
            {
                LogContinuingResumedImport(jobId, obsId);

                // Poll for download progress (no timeout - runs until complete or cancelled)
                var downloadComplete = false;
                DownloadJobProgress? downloadProgress = null;

                while (!downloadComplete && !cancellationToken.IsCancellationRequested)
                {
                    await Task.Delay(pollIntervalMs, cancellationToken);

                    downloadProgress = await mastService.GetChunkedDownloadProgressAsync(downloadJobId);
                    if (downloadProgress == null)
                    {
                        LogCouldNotGetDownloadProgress(downloadJobId);
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

                    jobTracker.UpdateProgress(jobId, importProgress, ImportStages.Downloading, message);

                    // Update byte-level progress
                    jobTracker.UpdateByteProgress(
                        jobId,
                        downloadProgress.DownloadedBytes,
                        downloadProgress.TotalBytes,
                        downloadProgress.SpeedBytesPerSec,
                        downloadProgress.EtaSeconds,
                        downloadProgress.FileProgress);

                    if (downloadProgress.IsComplete)
                    {
                        downloadComplete = true;
                    }
                }

                // Check if cancelled
                if (cancellationToken.IsCancellationRequested)
                {
                    LogResumedImportCancelledDuringDownload(jobId);
                    return; // Job status already set by CancelJob
                }

                if (downloadProgress?.Stage == "failed" || downloadProgress?.Error != null)
                {
                    jobTracker.SetResumable(jobId, downloadProgress.IsResumable);
                    jobTracker.FailJob(jobId, downloadProgress.Error ?? "Download failed");
                    return;
                }

                if (downloadProgress?.Files == null || downloadProgress.Files.Count == 0)
                {
                    jobTracker.FailJob(jobId, "No files downloaded");
                    return;
                }

                var totalDownloadedMB = downloadProgress.DownloadedBytes / (1024.0 * 1024.0);
                jobTracker.UpdateProgress(jobId, 40, ImportStages.Downloading,
                    $"Downloaded {downloadProgress.Files.Count} file(s) ({totalDownloadedMB:F1} MB)");
                jobTracker.SetResumable(jobId, false);

                // Get observation metadata from MAST for enrichment
                jobTracker.UpdateProgress(jobId, 45, ImportStages.SavingRecords, "Fetching observation metadata...");

                MastSearchResponse? obsSearch = null;
                try
                {
                    obsSearch = await mastService.SearchByObservationIdAsync(
                        new MastObservationSearchRequest { ObsId = obsId });
                }
                catch (Exception ex)
                {
                    LogCouldNotFetchObservationMetadata(ex, obsId);
                }

                var obsMeta = obsSearch?.Results.FirstOrDefault();

                // Create database records using shared helper
                var (importedIds, lineageTree, commonObservationBaseId) = await CreateRecordsForFilesAsync(
                    jobId, obsId, downloadProgress.Files, obsMeta);

                // Establish lineage relationships between processing levels
                jobTracker.UpdateProgress(jobId, 95, ImportStages.SavingRecords, "Establishing lineage relationships...");
                await EstablishLineageRelationships(importedIds);

                thumbnailQueue.EnqueueBatch(importedIds);

                var result = new MastImportResponse
                {
                    Status = "completed",
                    ObsId = obsId,
                    ImportedDataIds = importedIds,
                    ImportedCount = importedIds.Count,
                    LineageTree = lineageTree,
                    ObservationBaseId = commonObservationBaseId,
                    Timestamp = DateTime.UtcNow,
                };

                jobTracker.CompleteJob(jobId, result);
            }
            catch (OperationCanceledException)
            {
                LogResumedImportJobCancelled(jobId);

                // Job status already set by CancelJob - no need to update
            }
            catch (HttpRequestException ex)
            {
                LogResumedMastImportFailed(ex, jobId, obsId);
                jobTracker.SetResumable(jobId, true);
                jobTracker.FailJob(jobId, "Processing engine unavailable: " + ex.Message);
            }
            catch (Exception ex)
            {
                LogResumedMastImportFailed(ex, jobId, obsId);
                jobTracker.SetResumable(jobId, true);
                jobTracker.FailJob(jobId, ex.Message);
            }
        }

        /// <summary>
        /// Create ImageMetadata from MAST observation data with robust date extraction and logging.
        /// </summary>
        private ImageMetadata? CreateImageMetadata(Dictionary<string, object?>? obsMeta)
        {
            if (obsMeta == null)
            {
                return null;
            }

            var metadata = new ImageMetadata();

            if (obsMeta.TryGetValue("target_name", out var targetName) && targetName != null)
            {
                metadata.TargetName = targetName.ToString();
            }

            if (obsMeta.TryGetValue("instrument_name", out var instrument) && instrument != null)
            {
                metadata.Instrument = instrument.ToString();
            }

            if (obsMeta.TryGetValue("filters", out var filter) && filter != null)
            {
                metadata.Filter = filter.ToString();
            }

            if (obsMeta.TryGetValue("t_exptime", out var expTime) && expTime != null)
            {
                if (double.TryParse(expTime.ToString(), out var expTimeValue))
                {
                    metadata.ExposureTime = expTimeValue;
                }
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
                LogNoObservationDateFound(string.Join(", ", obsMeta.Keys));
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
                        { "CRVAL2", decValue },
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
        /// Create database records for a list of downloaded FITS files.
        /// This is the shared implementation used by Import, ResumeImport, and ImportFromExisting.
        /// </summary>
        private async Task<(List<string> importedIds, Dictionary<string, List<string>> lineageTree, string? observationBaseId)>
            CreateRecordsForFilesAsync(
                string jobId,
                string obsId,
                List<string> files,
                Dictionary<string, object?>? obsMeta,
                List<string>? tags = null,
                string? userId = null,
                bool isPublic = false)
        {
            var importedIds = new List<string>();
            var lineageTree = new Dictionary<string, List<string>>();
            string? commonObservationBaseId = null;

            var totalFiles = files.Count;
            for (var i = 0; i < totalFiles; i++)
            {
                var filePath = files[i];
                var fileName = Path.GetFileName(filePath);
                var (dataType, processingLevel, observationBaseId, exposureId, isViewable) = ParseFileInfo(fileName, obsMeta);

                // Update progress for each file (progress from 50% to 90%)
                var fileProgress = 50 + (int)((i + 1) / (double)totalFiles * 40);
                jobTracker.UpdateProgress(jobId, fileProgress, ImportStages.SavingRecords,
                    $"Saving record {i + 1}/{totalFiles}...");

                // Track common observation base ID
                if (observationBaseId != null)
                {
                    commonObservationBaseId = observationBaseId;
                }

                // Convert to relative storage key for DB and storage provider access
                var storageKey = StorageKeyHelper.ToRelativeKey(filePath);

                long fileSize = 0;
                try
                {
                    fileSize = await storageProvider.GetSizeAsync(storageKey);
                }
                catch (Exception ex)
                {
                    // File might not yet be accessible — log but continue
                    LogCouldNotGetFileSize(ex, storageKey);
                }

                // Build tags list
                var recordTags = new List<string> { "mast-import", obsId };
                if (tags != null)
                {
                    recordTags.AddRange(tags);
                    recordTags = [.. recordTags.Distinct()];
                }

                // Check for existing record with same filename to prevent duplicates
                var existingRecord = await mongoDBService.GetByFileNameAsync(fileName);
                if (existingRecord != null)
                {
                    LogSkippingDuplicateFile(fileName, existingRecord.Id);
                    importedIds.Add(existingRecord.Id);

                    // Track lineage by level even for existing records
                    if (!lineageTree.TryGetValue(processingLevel, out var existingValue))
                    {
                        existingValue = [];
                        lineageTree[processingLevel] = existingValue;
                    }

                    existingValue.Add(existingRecord.Id);
                    continue;
                }

                var jwstData = new JwstDataModel
                {
                    FileName = fileName,
                    FilePath = storageKey,
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
                    Tags = recordTags,
                    UserId = userId,
                    IsPublic = isPublic,
                    Metadata = BuildMastMetadata(obsMeta, obsId, processingLevel),
                    ImageInfo = CreateImageMetadata(obsMeta),
                };

                await mongoDBService.CreateAsync(jwstData);
                importedIds.Add(jwstData.Id);

                // Track lineage by level
                if (!lineageTree.TryGetValue(processingLevel, out var value))
                {
                    value = [];
                    lineageTree[processingLevel] = value;
                }

                value.Add(jwstData.Id);

                LogCreatedDbRecord(jwstData.Id, fileName, processingLevel);
            }

            return (importedIds, lineageTree, commonObservationBaseId);
        }

        /// <summary>
        /// Establish parent-child relationships between files at different processing levels.
        /// </summary>
        private async Task EstablishLineageRelationships(List<string> importedIds)
        {
            if (importedIds.Count <= 1)
            {
                return;
            }

            var importedData = new List<JwstDataModel>();
            foreach (var id in importedIds)
            {
                var data = await mongoDBService.GetAsync(id);
                if (data != null)
                {
                    importedData.Add(data);
                }
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
                for (var i = 1; i < ordered.Count; i++)
                {
                    var current = ordered[i];
                    var parent = ordered[i - 1];

                    current.ParentId = parent.Id;
                    current.DerivedFrom = [parent.Id];
                    await mongoDBService.UpdateAsync(current.Id, current);

                    LogLinkedLineage(current.FileName, current.ProcessingLevel, parent.FileName, parent.ProcessingLevel);
                }
            }
        }
    }
}
