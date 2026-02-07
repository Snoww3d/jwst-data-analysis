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
    public partial class DataManagementController(
        IMongoDBService mongoDBService,
        IMastService mastService,
        ILogger<DataManagementController> logger) : ControllerBase
    {
        private static readonly System.Text.Json.JsonSerializerOptions JsonOptions = new()
        {
            WriteIndented = true,
        };

        private readonly IMongoDBService mongoDBService = mongoDBService;
        private readonly IMastService mastService = mastService;
        private readonly ILogger<DataManagementController> logger = logger;

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
        /// Export multiple data items to a JSON file.
        /// </summary>
        /// <param name="request">List of data IDs and export options (include metadata, processing results).</param>
        /// <returns>Export response with download URL.</returns>
        [HttpPost("export")]
        public async Task<ActionResult<ExportResponse>> ExportData([FromBody] ExportRequest request)
        {
            try
            {
                if (request.DataIds.Count == 0)
                {
                    return BadRequest("No data IDs provided");
                }

                var exportId = Guid.NewGuid().ToString();
                var exportPath = Path.Combine("exports", $"{exportId}.json");

                // Ensure exports directory exists
                var exportsDir = Path.Combine(Directory.GetCurrentDirectory(), "exports");
                Directory.CreateDirectory(exportsDir);

                // Get data for export (batch fetch to avoid N+1 queries)
                var dataToExport = await mongoDBService.GetManyAsync(request.DataIds);

                // Task #75: Filter to only accessible data
                dataToExport = FilterAccessibleData(dataToExport);

                // Create export data
                var exportData = new
                {
                    ExportId = exportId,
                    CreatedAt = DateTime.UtcNow,
                    TotalRecords = dataToExport.Count,
                    Data = dataToExport.Select(d => new
                    {
                        d.Id,
                        d.FileName,
                        d.DataType,
                        d.UploadDate,
                        d.Description,
                        d.FileSize,
                        d.ProcessingStatus,
                        d.Tags,
                        d.IsPublic,
                        d.IsValidated,
                        Metadata = request.IncludeMetadata ? d.Metadata : null,
                        ProcessingResults = request.IncludeProcessingResults ? d.ProcessingResults : null,
                    }).ToList(),
                };

                // Write to file
                var json = System.Text.Json.JsonSerializer.Serialize(exportData, JsonOptions);
                await System.IO.File.WriteAllTextAsync(Path.Combine(exportsDir, $"{exportId}.json"), json);

                return Ok(new ExportResponse
                {
                    ExportId = exportId,
                    Status = "completed",
                    DownloadUrl = $"/api/datamanagement/export/{exportId}",
                    CreatedAt = DateTime.UtcNow,
                    CompletedAt = DateTime.UtcNow,
                    TotalRecords = dataToExport.Count,
                    FileSize = json.Length,
                });
            }
            catch (Exception ex)
            {
                LogErrorExportingData(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Download a previously created export file.
        /// </summary>
        /// <param name="exportId">The export ID returned from the export endpoint.</param>
        /// <returns>JSON file download.</returns>
        [HttpGet("export/{exportId}")]
        public async Task<IActionResult> DownloadExport(string exportId)
        {
            try
            {
                // Security: Validate exportId is a valid GUID to prevent path traversal
                if (!Guid.TryParse(exportId, out _))
                {
                    LogInvalidExportIdFormat(exportId);
                    return BadRequest("Invalid export ID format");
                }

                // Build path using validated GUID and verify it's within exports directory
                var exportsDir = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "exports"));
                var exportPath = Path.GetFullPath(Path.Combine(exportsDir, $"{exportId}.json"));

                // Security: Ensure resolved path is within exports directory (defense in depth)
                if (!exportPath.StartsWith(exportsDir + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                {
                    LogPathTraversalAttemptBlocked(exportId);
                    return BadRequest("Invalid export ID");
                }

                if (!System.IO.File.Exists(exportPath))
                {
                    return NotFound("Export not found");
                }

                var fileBytes = await System.IO.File.ReadAllBytesAsync(exportPath);
                return File(fileBytes, "application/json", $"export_{exportId}.json");
            }
            catch (Exception ex)
            {
                LogErrorDownloadingExport(ex, exportId);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Scan MAST download directory and import files with full metadata from MAST.
        /// This fetches observation metadata from MAST for each observation group,
        /// populating both the Metadata dictionary and ImageInfo fields.
        /// </summary>
        [HttpPost("import/scan")]
        public async Task<ActionResult<BulkImportResponse>> ScanAndImportFiles([FromBody] BulkImportRequest? request = null)
        {
            try
            {
                var dataDir = Path.Combine(Directory.GetCurrentDirectory(), "data");
                var mastDir = Path.Combine(dataDir, "mast");

                var importedFiles = new List<string>();
                var skippedFiles = new List<string>();
                var errors = new List<string>();
                var metadataRefreshed = 0;

                // Get all existing file paths in database to avoid duplicates
                var existingData = await mongoDBService.GetAsync();
                var existingPaths = existingData
                    .Where(d => !string.IsNullOrEmpty(d.FilePath))
                    .Select(d => d.FilePath)
                    .ToHashSet();

                // Also track existing records by path for metadata refresh
                var existingByPath = existingData
                    .Where(d => !string.IsNullOrEmpty(d.FilePath))
                    .GroupBy(d => d.FilePath!)
                    .ToDictionary(g => g.Key, g => g.First());

                if (!Directory.Exists(mastDir))
                {
                    return Ok(new BulkImportResponse
                    {
                        ImportedCount = 0,
                        SkippedCount = 0,
                        ErrorCount = 0,
                        Message = "MAST directory not found",
                    });
                }

                // Scan and group files by observation ID (parent directory)
                var fitsFiles = Directory.GetFiles(mastDir, "*.fits", SearchOption.AllDirectories)
                    .Concat(Directory.GetFiles(mastDir, "*.fits.gz", SearchOption.AllDirectories))
                    .ToList();

                var filesByObservation = fitsFiles
                    .GroupBy(f => Path.GetFileName(Path.GetDirectoryName(f)) ?? "unknown")
                    .ToDictionary(g => g.Key, g => g.ToList());

                LogFoundFitsFiles(fitsFiles.Count, filesByObservation.Count);

                // Process each observation group
                foreach (var (obsId, files) in filesByObservation)
                {
                    // Try to fetch MAST metadata for this observation
                    Dictionary<string, object?>? obsMeta = null;
                    try
                    {
                        var obsSearch = await mastService.SearchByObservationIdAsync(
                            new MastObservationSearchRequest { ObsId = obsId });
                        obsMeta = obsSearch?.Results.FirstOrDefault();

                        if (obsMeta != null)
                        {
                            LogFetchedMastMetadata(obsId);
                        }
                    }
                    catch (Exception ex)
                    {
                        LogCouldNotFetchMastMetadata(ex, obsId);
                    }

                    // Process each file in the observation
                    foreach (var filePath in files)
                    {
                        try
                        {
                            var fileName = Path.GetFileName(filePath);
                            var fileInfo = new FileInfo(filePath);

                            // Check if file already exists in database
                            if (existingPaths.Contains(filePath))
                            {
                                // File exists - check if it needs metadata refresh
                                if (existingByPath.TryGetValue(filePath, out var existingRecord))
                                {
                                    // Refresh metadata if: no ImageInfo, no TargetName, or unknown processing level
                                    var needsRefresh = obsMeta != null && (
                                        existingRecord.ImageInfo?.TargetName == null ||
                                        string.IsNullOrEmpty(existingRecord.ProcessingLevel) ||
                                        existingRecord.ProcessingLevel == ProcessingLevels.Unknown);

                                    if (needsRefresh)
                                    {
                                        // Existing record lacks metadata - refresh it
                                        var fileInfo2 = ParseFileInfo(fileName, obsMeta);

                                        existingRecord.Metadata = BuildMastMetadata(obsMeta, obsId, fileInfo2.processingLevel);
                                        existingRecord.ImageInfo = CreateImageMetadata(obsMeta);
                                        existingRecord.ProcessingLevel = fileInfo2.processingLevel;
                                        existingRecord.ObservationBaseId = fileInfo2.observationBaseId ?? obsId;
                                        existingRecord.ExposureId = fileInfo2.exposureId;
                                        existingRecord.IsViewable = fileInfo2.isViewable;
                                        existingRecord.DataType = fileInfo2.dataType;

                                        await mongoDBService.UpdateAsync(existingRecord.Id, existingRecord);
                                        metadataRefreshed++;
                                    }
                                }

                                skippedFiles.Add(fileName);
                                continue;
                            }

                            // Parse file info using MAST metadata
                            var (dataType, processingLevel, observationBaseId, exposureId, isViewable) =
                                ParseFileInfo(fileName, obsMeta);

                            // Build tags
                            var tags = new List<string> { "mast-import", obsId };
                            if (filePath.Contains("nircam", StringComparison.OrdinalIgnoreCase))
                            {
                                tags.Add("NIRCam");
                            }

                            if (filePath.Contains("miri", StringComparison.OrdinalIgnoreCase))
                            {
                                tags.Add("MIRI");
                            }

                            if (filePath.Contains("nirspec", StringComparison.OrdinalIgnoreCase))
                            {
                                tags.Add("NIRSpec");
                            }

                            if (filePath.Contains("niriss", StringComparison.OrdinalIgnoreCase))
                            {
                                tags.Add("NIRISS");
                            }

                            var jwstData = new JwstDataModel
                            {
                                FileName = fileName,
                                FilePath = filePath,
                                FileSize = fileInfo.Length,
                                FileFormat = FileFormats.FITS,
                                DataType = dataType,
                                ProcessingLevel = processingLevel,
                                ObservationBaseId = observationBaseId ?? obsId,
                                ExposureId = exposureId,
                                IsViewable = isViewable,
                                Description = $"Imported from MAST - Observation: {obsId} - Level: {processingLevel}",
                                UploadDate = DateTime.UtcNow,
                                ProcessingStatus = ProcessingStatuses.Pending,
                                Tags = tags,
                                Metadata = BuildMastMetadata(obsMeta, obsId, processingLevel),
                                ImageInfo = CreateImageMetadata(obsMeta),
                            };

                            await mongoDBService.CreateAsync(jwstData);
                            importedFiles.Add(fileName);
                        }
                        catch (Exception ex)
                        {
                            errors.Add($"{Path.GetFileName(filePath)}: {ex.Message}");
                        }
                    }
                }

                var message = $"Imported {importedFiles.Count} files";
                if (metadataRefreshed > 0)
                {
                    message += $", refreshed metadata for {metadataRefreshed} existing files";
                }

                LogBulkImportCompleted(importedFiles.Count, skippedFiles.Count, metadataRefreshed, errors.Count);

                return Ok(new BulkImportResponse
                {
                    ImportedCount = importedFiles.Count,
                    SkippedCount = skippedFiles.Count,
                    ErrorCount = errors.Count,
                    ImportedFiles = [.. importedFiles.Take(50)],
                    SkippedFiles = [.. skippedFiles.Take(20)],
                    Errors = [.. errors.Take(10)],
                    Message = message,
                });
            }
            catch (Exception ex)
            {
                LogErrorBulkImport(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Claim ownership of all data files that have no owner.
        /// This is useful for files imported before authentication was added.
        /// </summary>
        [HttpPost("claim-orphaned")]
        public async Task<ActionResult<ClaimOrphanedResponse>> ClaimOrphanedData()
        {
            try
            {
                var userId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                    ?? User.FindFirst("sub")?.Value;

                if (string.IsNullOrEmpty(userId))
                {
                    return Unauthorized(new { error = "User ID not found in token" });
                }

                var claimedCount = await mongoDBService.ClaimOrphanedDataAsync(userId);

                return Ok(new ClaimOrphanedResponse
                {
                    ClaimedCount = claimedCount,
                    Message = claimedCount > 0
                        ? $"Successfully claimed ownership of {claimedCount} files"
                        : "No orphaned files found to claim",
                });
            }
            catch (Exception ex)
            {
                LogErrorClaimingOrphanedData(ex);
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Parse JWST filename to extract data type, processing level, and lineage info.
        /// </summary>
        private static (string dataType, string processingLevel, string? observationBaseId, string? exposureId, bool isViewable)
            ParseFileInfo(string fileName, Dictionary<string, object?>? obsMeta)
        {
            var fileNameLower = fileName.ToLowerInvariant();
            var dataType = DataTypes.Image;
            var processingLevel = ProcessingLevels.Unknown;
            string? observationBaseId = null;
            string? exposureId = null;
            var isViewable = true;

            // Determine processing level from filename suffix
            if (fileNameLower.Contains("_uncal.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level1;
                dataType = DataTypes.Raw;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_rate.fits", StringComparison.Ordinal) || fileNameLower.Contains("_rateints.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level2a;
                dataType = DataTypes.Sensor;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_cal.fits", StringComparison.Ordinal) || fileNameLower.Contains("_calints.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level2b;
                dataType = DataTypes.Image;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_i2d.fits", StringComparison.Ordinal) || fileNameLower.Contains("_s2d.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level3;
                dataType = DataTypes.Image;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_crf.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level2b;
                dataType = DataTypes.Image;
                isViewable = true;
            }

            // Table files - not viewable as images
            else if (fileNameLower.Contains("_asn.json", StringComparison.Ordinal) || fileNameLower.Contains("_asn.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Unknown;
                dataType = DataTypes.Metadata;
                isViewable = false;
            }
            else if (fileNameLower.Contains("_x1d.fits", StringComparison.Ordinal) || fileNameLower.Contains("_x1dints.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level3;
                dataType = DataTypes.Spectral;
                isViewable = false;
            }
            else if (fileNameLower.Contains("_cat.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level3;
                dataType = DataTypes.Metadata;
                isViewable = false;
            }
            else if (fileNameLower.Contains("_pool.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Unknown;
                dataType = DataTypes.Metadata;
                isViewable = false;
            }

            // Parse JWST filename pattern: jw{program}{obs}{visit}_{exposure}_{detector}_{suffix}.fits
            var match = MyRegex().Match(fileName);
            if (match.Success)
            {
                var program = match.Groups[1].Value;
                var obs = match.Groups[2].Value;
                var visit = match.Groups[3].Value;
                var exposure = match.Groups[4].Value;

                observationBaseId = $"jw{program}{obs}{visit}";
                exposureId = $"jw{program}{obs}{visit}_{exposure}";
            }

            return (dataType, processingLevel, observationBaseId, exposureId, isViewable);
        }

        /// <summary>
        /// Build metadata dictionary with all MAST fields prefixed with 'mast_'.
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
                foreach (var (key, value) in obsMeta)
                {
                    if (value != null)
                    {
                        var mastKey = key.StartsWith("mast_", StringComparison.Ordinal) ? key : $"mast_{key}";

                        // Convert JsonElement to basic types
                        if (value is System.Text.Json.JsonElement jsonElement)
                        {
                            metadata[mastKey] = ConvertJsonElement(jsonElement);
                        }
                        else
                        {
                            metadata[mastKey] = value;
                        }
                    }
                }
            }

            return metadata;
        }

        private static object ConvertJsonElement(System.Text.Json.JsonElement element)
        {
            return element.ValueKind switch
            {
                System.Text.Json.JsonValueKind.String => element.GetString() ?? string.Empty,
                System.Text.Json.JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
                System.Text.Json.JsonValueKind.True => true,
                System.Text.Json.JsonValueKind.False => false,
                System.Text.Json.JsonValueKind.Null => string.Empty,
                _ => element.ToString(),
            };
        }

        /// <summary>
        /// Create ImageMetadata from MAST observation data.
        /// </summary>
        private static ImageMetadata? CreateImageMetadata(Dictionary<string, object?>? obsMeta)
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

            if (obsMeta.TryGetValue("wavelength_region", out var wavelengthRegion) && wavelengthRegion != null)
            {
                metadata.WavelengthRange = wavelengthRegion.ToString();
            }

            if (obsMeta.TryGetValue("calib_level", out var calibLevel) && calibLevel != null)
            {
                if (int.TryParse(calibLevel.ToString(), out var calibLevelValue))
                {
                    metadata.CalibrationLevel = calibLevelValue;
                }
            }

            if (obsMeta.TryGetValue("proposal_id", out var proposalId) && proposalId != null)
            {
                metadata.ProposalId = proposalId.ToString();
            }

            if (obsMeta.TryGetValue("proposal_pi", out var proposalPi) && proposalPi != null)
            {
                metadata.ProposalPi = proposalPi.ToString();
            }

            if (obsMeta.TryGetValue("obs_title", out var obsTitle) && obsTitle != null)
            {
                metadata.ObservationTitle = obsTitle.ToString();
            }

            // Convert MJD to DateTime
            DateTime? observationDate = null;
            var dateFields = new[] { "t_min", "t_max", "t_obs_release" };
            foreach (var dateField in dateFields)
            {
                if (obsMeta.TryGetValue(dateField, out var dateValue) && dateValue != null)
                {
                    if (double.TryParse(dateValue.ToString(), out var mjd) && mjd > 0)
                    {
                        observationDate = new DateTime(1858, 11, 17, 0, 0, 0, DateTimeKind.Utc).AddDays(mjd);
                        break;
                    }
                }
            }

            if (observationDate.HasValue)
            {
                metadata.ObservationDate = observationDate.Value;
            }

            metadata.CoordinateSystem = "ICRS";

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

            return metadata;
        }

        [GeneratedRegex(@"jw(\d{5})(\d{3})(\d{3})_(\d{5})_(\d{5})_([a-z0-9]+)", RegexOptions.IgnoreCase, "en-US")]
        private static partial Regex MyRegex();

        private string? GetCurrentUserId()
        {
            return User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                ?? User.FindFirst("sub")?.Value;
        }

        private bool IsCurrentUserAdmin() => User.IsInRole("Admin");

        /// <summary>
        /// Filters a list of data items to only those accessible to the current user.
        /// Authenticated: own + public + shared. Admin: all.
        /// </summary>
        private List<JwstDataModel> FilterAccessibleData(List<JwstDataModel> data)
        {
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

        // Helper methods
        private DataResponse MapToDataResponse(JwstDataModel model)
        {
            return new DataResponse
            {
                Id = model.Id,
                FileName = model.FileName,
                DataType = model.DataType,
                UploadDate = model.UploadDate,
                Description = model.Description,
                FileSize = model.FileSize,
                ProcessingStatus = model.ProcessingStatus,
                Tags = model.Tags,
                UserId = model.UserId,
                IsPublic = model.IsPublic,
                Version = model.Version,
                FileFormat = model.FileFormat,
                IsValidated = model.IsValidated,
                LastAccessed = model.LastAccessed,
                ImageInfo = model.ImageInfo,
                SensorInfo = model.SensorInfo,
                SpectralInfo = model.SpectralInfo,
                CalibrationInfo = model.CalibrationInfo,
                ProcessingResultsCount = model.ProcessingResults.Count,
                LastProcessed = model.ProcessingResults.Count > 0 ?
                    model.ProcessingResults.Max(r => r.ProcessedDate) : null,
            };
        }
    }

    // Request models for bulk operations
    public class BulkTagsRequest
    {
        public List<string> DataIds { get; set; } = [];

        public List<string> Tags { get; set; } = [];

        public bool Append { get; set; } = true;
    }

    public class BulkStatusRequest
    {
        public List<string> DataIds { get; set; } = [];

        public string Status { get; set; } = string.Empty;
    }

    public class BulkImportRequest
    {
        public string? Directory { get; set; }

        public bool IncludeSubdirectories { get; set; } = true;
    }

    public class BulkImportResponse
    {
        public int ImportedCount { get; set; }

        public int SkippedCount { get; set; }

        public int ErrorCount { get; set; }

        public List<string> ImportedFiles { get; set; } = [];

        public List<string> SkippedFiles { get; set; } = [];

        public List<string> Errors { get; set; } = [];

        public string Message { get; set; } = string.Empty;
    }

    public class ClaimOrphanedResponse
    {
        public long ClaimedCount { get; set; }

        public string Message { get; set; } = string.Empty;
    }
}
