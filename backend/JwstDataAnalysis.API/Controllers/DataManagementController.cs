using Microsoft.AspNetCore.Mvc;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using System.ComponentModel.DataAnnotations;

namespace JwstDataAnalysis.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class DataManagementController : ControllerBase
    {
        private readonly MongoDBService _mongoDBService;
        private readonly ILogger<DataManagementController> _logger;

        public DataManagementController(MongoDBService mongoDBService, ILogger<DataManagementController> logger)
        {
            _mongoDBService = mongoDBService;
            _logger = logger;
        }

        [HttpPost("search")]
        public async Task<ActionResult<SearchResponse>> Search([FromBody] SearchRequest request)
        {
            try
            {
                var response = await _mongoDBService.SearchWithFacetsAsync(request);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error performing advanced search");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("statistics")]
        public async Task<ActionResult<DataStatistics>> GetStatistics()
        {
            try
            {
                var stats = await _mongoDBService.GetStatisticsAsync();
                return Ok(stats);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving statistics");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("public")]
        public async Task<ActionResult<List<DataResponse>>> GetPublicData()
        {
            try
            {
                var data = await _mongoDBService.GetPublicDataAsync();
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving public data");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("validated")]
        public async Task<ActionResult<List<DataResponse>>> GetValidatedData()
        {
            try
            {
                var data = await _mongoDBService.GetValidatedDataAsync();
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving validated data");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("format/{fileFormat}")]
        public async Task<ActionResult<List<DataResponse>>> GetByFileFormat(string fileFormat)
        {
            try
            {
                var data = await _mongoDBService.GetByFileFormatAsync(fileFormat);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving data by file format: {FileFormat}", fileFormat);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("tags")]
        public async Task<ActionResult<List<string>>> GetCommonTags([FromQuery] int limit = 20)
        {
            try
            {
                var stats = await _mongoDBService.GetStatisticsAsync();
                return Ok(stats.MostCommonTags.Take(limit).ToList());
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving common tags");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost("bulk/tags")]
        public async Task<IActionResult> BulkUpdateTags([FromBody] BulkTagsRequest request)
        {
            try
            {
                if (!request.DataIds.Any())
                    return BadRequest("No data IDs provided");

                await _mongoDBService.BulkUpdateTagsAsync(request.DataIds, request.Tags, request.Append);
                return Ok(new { message = "Tags updated successfully" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error performing bulk tag update");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost("bulk/status")]
        public async Task<IActionResult> BulkUpdateStatus([FromBody] BulkStatusRequest request)
        {
            try
            {
                if (request.DataIds.Count == 0)
                    return BadRequest("No data IDs provided");

                await _mongoDBService.BulkUpdateStatusAsync(request.DataIds, request.Status);
                return Ok(new { message = "Status updated successfully" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error performing bulk status update");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost("export")]
        public async Task<ActionResult<ExportResponse>> ExportData([FromBody] ExportRequest request)
        {
            try
            {
                if (request.DataIds.Count == 0)
                    return BadRequest("No data IDs provided");

                var exportId = Guid.NewGuid().ToString();
                var exportPath = Path.Combine("exports", $"{exportId}.json");

                // Ensure exports directory exists
                var exportsDir = Path.Combine(Directory.GetCurrentDirectory(), "exports");
                Directory.CreateDirectory(exportsDir);

                // Get data for export
                var dataToExport = new List<JwstDataModel>();
                foreach (var id in request.DataIds)
                {
                    var data = await _mongoDBService.GetAsync(id);
                    if (data != null)
                    {
                        dataToExport.Add(data);
                    }
                }

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
                        ProcessingResults = request.IncludeProcessingResults ? d.ProcessingResults : null
                    }).ToList()
                };

                // Write to file
                var json = System.Text.Json.JsonSerializer.Serialize(exportData, new System.Text.Json.JsonSerializerOptions
                {
                    WriteIndented = true
                });
                await System.IO.File.WriteAllTextAsync(Path.Combine(exportsDir, $"{exportId}.json"), json);

                return Ok(new ExportResponse
                {
                    ExportId = exportId,
                    Status = "completed",
                    DownloadUrl = $"/api/datamanagement/export/{exportId}",
                    CreatedAt = DateTime.UtcNow,
                    CompletedAt = DateTime.UtcNow,
                    TotalRecords = dataToExport.Count,
                    FileSize = json.Length
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error exporting data");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("export/{exportId}")]
        public async Task<IActionResult> DownloadExport(string exportId)
        {
            try
            {
                // Security: Validate exportId is a valid GUID to prevent path traversal
                if (!Guid.TryParse(exportId, out _))
                {
                    _logger.LogWarning("Invalid export ID format attempted: {ExportId}", exportId);
                    return BadRequest("Invalid export ID format");
                }

                // Build path using validated GUID and verify it's within exports directory
                var exportsDir = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "exports"));
                var exportPath = Path.GetFullPath(Path.Combine(exportsDir, $"{exportId}.json"));

                // Security: Ensure resolved path is within exports directory (defense in depth)
                if (!exportPath.StartsWith(exportsDir + Path.DirectorySeparatorChar))
                {
                    _logger.LogWarning("Path traversal attempt blocked for export: {ExportId}", exportId);
                    return BadRequest("Invalid export ID");
                }

                if (!System.IO.File.Exists(exportPath))
                    return NotFound("Export not found");

                var fileBytes = await System.IO.File.ReadAllBytesAsync(exportPath);
                return File(fileBytes, "application/json", $"export_{exportId}.json");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error downloading export: {ExportId}", exportId);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost("import/scan")]
        public async Task<ActionResult<BulkImportResponse>> ScanAndImportFiles([FromBody] BulkImportRequest? request = null)
        {
            try
            {
                var dataDir = Path.Combine(Directory.GetCurrentDirectory(), "data");
                var mastDir = Path.Combine(dataDir, "mast");
                var uploadsDir = Path.Combine(dataDir, "uploads");

                var importedFiles = new List<string>();
                var skippedFiles = new List<string>();
                var errors = new List<string>();

                // Get all existing file paths in database to avoid duplicates
                var existingData = await _mongoDBService.GetAsync();
                var existingPaths = existingData
                    .Where(d => !string.IsNullOrEmpty(d.FilePath))
                    .Select(d => d.FilePath)
                    .ToHashSet();

                // Scan MAST directory for FITS files
                if (Directory.Exists(mastDir))
                {
                    var fitsFiles = Directory.GetFiles(mastDir, "*.fits", SearchOption.AllDirectories)
                        .Concat(Directory.GetFiles(mastDir, "*.fits.gz", SearchOption.AllDirectories));

                    foreach (var filePath in fitsFiles)
                    {
                        try
                        {
                            // Skip if already in database
                            if (existingPaths.Contains(filePath))
                            {
                                skippedFiles.Add(Path.GetFileName(filePath));
                                continue;
                            }

                            var fileInfo = new FileInfo(filePath);
                            var fileName = fileInfo.Name;

                            // Determine data type from filename
                            var dataType = fileName.Contains("_cal") || fileName.Contains("_i2d") ? DataTypes.Image :
                                          fileName.Contains("_rate") ? DataTypes.Sensor :
                                          fileName.Contains("_uncal") ? DataTypes.Raw :
                                          DataTypes.Image;

                            // Extract tags from path
                            var tags = new List<string> { "MAST", "JWST" };
                            if (filePath.Contains("nircam")) tags.Add("NIRCam");
                            if (filePath.Contains("miri")) tags.Add("MIRI");
                            if (filePath.Contains("nirspec")) tags.Add("NIRSpec");

                            // Extract observation/exposure ID from the immediate parent directory
                            // MAST downloads organize files by exposure: .../mastDownload/JWST/{exposure_id}/{file}.fits
                            var parentDir = Path.GetDirectoryName(filePath);
                            var mastObsId = !string.IsNullOrEmpty(parentDir)
                                ? Path.GetFileName(parentDir)
                                : "unknown";

                            var jwstData = new JwstDataModel
                            {
                                FileName = fileName,
                                DataType = dataType,
                                FilePath = filePath,
                                FileSize = fileInfo.Length,
                                UploadDate = fileInfo.CreationTimeUtc,
                                ProcessingStatus = ProcessingStatuses.Pending,
                                FileFormat = "fits",
                                Tags = tags,
                                Description = $"Imported from MAST: {Path.GetDirectoryName(filePath)?.Replace(mastDir, "")}",
                                Metadata = new Dictionary<string, object>
                                {
                                    { "mast_obs_id", mastObsId ?? "unknown" },
                                    { "source", "MAST" },
                                    { "import_date", DateTime.UtcNow.ToString("O") }
                                }
                            };

                            await _mongoDBService.CreateAsync(jwstData);
                            importedFiles.Add(fileName);
                        }
                        catch (Exception ex)
                        {
                            errors.Add($"{Path.GetFileName(filePath)}: {ex.Message}");
                        }
                    }
                }

                _logger.LogInformation("Bulk import completed: {Imported} imported, {Skipped} skipped, {Errors} errors",
                    importedFiles.Count, skippedFiles.Count, errors.Count);

                return Ok(new BulkImportResponse
                {
                    ImportedCount = importedFiles.Count,
                    SkippedCount = skippedFiles.Count,
                    ErrorCount = errors.Count,
                    ImportedFiles = importedFiles.Take(50).ToList(),
                    SkippedFiles = skippedFiles.Take(20).ToList(),
                    Errors = errors.Take(10).ToList(),
                    Message = $"Successfully imported {importedFiles.Count} files"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during bulk import");
                return StatusCode(500, "Internal server error");
            }
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
                LastProcessed = model.ProcessingResults.Any() ? 
                    model.ProcessingResults.Max(r => r.ProcessedDate) : null
            };
        }
    }

    // Request models for bulk operations
    public class BulkTagsRequest
    {
        public List<string> DataIds { get; set; } = new();
        public List<string> Tags { get; set; } = new();
        public bool Append { get; set; } = true;
    }

    public class BulkStatusRequest
    {
        public List<string> DataIds { get; set; } = new();
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
        public List<string> ImportedFiles { get; set; } = new();
        public List<string> SkippedFiles { get; set; } = new();
        public List<string> Errors { get; set; } = new();
        public string Message { get; set; } = string.Empty;
    }
} 