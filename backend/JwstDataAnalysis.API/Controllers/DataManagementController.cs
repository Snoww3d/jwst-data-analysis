// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

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
        IDataScanService dataScanService,
        ILogger<DataManagementController> logger) : ApiControllerBase
    {
        private static readonly System.Text.Json.JsonSerializerOptions JsonOptions = new()
        {
            WriteIndented = true,
        };

        private readonly IMongoDBService mongoDBService = mongoDBService;
        private readonly IDataScanService dataScanService = dataScanService;
        private readonly ILogger<DataManagementController> logger = logger;

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

                // Write ownership metadata for download authorization
                var meta = new ExportMetadata { UserId = GetRequiredUserId(), CreatedAt = DateTime.UtcNow };
                await System.IO.File.WriteAllTextAsync(
                    Path.Combine(exportsDir, $"{exportId}.meta.json"),
                    System.Text.Json.JsonSerializer.Serialize(meta));

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

                // Verify ownership: only the export creator or admin can download
                var metaPath = Path.Combine(exportsDir, $"{exportId}.meta.json");
                if (System.IO.File.Exists(metaPath))
                {
                    var metaJson = await System.IO.File.ReadAllTextAsync(metaPath);
                    var exportMeta = System.Text.Json.JsonSerializer.Deserialize<ExportMetadata>(metaJson);
                    if (!IsCurrentUserAdmin() && exportMeta?.UserId != GetRequiredUserId())
                    {
                        return NotFound("Export not found");
                    }
                }
                else
                {
                    // Legacy exports without metadata are accessible (logged as warning)
                    LogLegacyExportNoMetadata(exportId);
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
                var result = await dataScanService.ScanAndImportAsync();
                return Ok(result);
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
                var userId = GetCurrentUserId();

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
        /// One-time migration: strip /app/data/ prefix from FilePath and ProcessingResult.OutputFilePath
        /// so all stored paths become relative storage keys.
        /// Idempotent -- records that are already relative are skipped.
        /// </summary>
        [HttpPost("migrate-storage-keys")]
        [Authorize(Policy = "AdminOnly")]
        public async Task<IActionResult> MigrateStorageKeys()
        {
            const string prefix = "/app/data/";

            try
            {
                var allData = await mongoDBService.GetAsync();
                var migrated = 0;
                var skipped = 0;

                foreach (var record in allData)
                {
                    var changed = false;

                    if (!string.IsNullOrEmpty(record.FilePath)
                        && record.FilePath.StartsWith(prefix, StringComparison.Ordinal))
                    {
                        record.FilePath = record.FilePath[prefix.Length..];
                        changed = true;
                    }

                    foreach (var result in record.ProcessingResults)
                    {
                        if (!string.IsNullOrEmpty(result.OutputFilePath)
                            && result.OutputFilePath.StartsWith(prefix, StringComparison.Ordinal))
                        {
                            result.OutputFilePath = result.OutputFilePath[prefix.Length..];
                            changed = true;
                        }
                    }

                    if (changed)
                    {
                        await mongoDBService.UpdateAsync(record.Id, record);
                        migrated++;
                    }
                    else
                    {
                        skipped++;
                    }
                }

                LogMigratedStorageKeys(migrated, skipped);
                return Ok(new { migrated, skipped, message = $"Migrated {migrated} records, skipped {skipped} (already relative)." });
            }
            catch (Exception ex)
            {
                LogErrorMigratingStorageKeys(ex);
                return StatusCode(500, "Storage key migration failed");
            }
        }

        /// <summary>
        /// Filters a list of data items to only those accessible to the current user.
        /// Anonymous: public only. Authenticated: own + public + shared. Admin: all.
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

        private sealed class ExportMetadata
        {
            public string UserId { get; set; } = string.Empty;

            public DateTime CreatedAt { get; set; }
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
