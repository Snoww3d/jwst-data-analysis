using Microsoft.AspNetCore.Mvc;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using System.ComponentModel.DataAnnotations;

namespace JwstDataAnalysis.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class JwstDataController : ControllerBase
    {
        private readonly MongoDBService _mongoDBService;
        private readonly ILogger<JwstDataController> _logger;

        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;

        public JwstDataController(MongoDBService mongoDBService, ILogger<JwstDataController> logger, IHttpClientFactory httpClientFactory, IConfiguration configuration)
        {
            _mongoDBService = mongoDBService;
            _logger = logger;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
        }

        [HttpGet]
        public async Task<ActionResult<List<DataResponse>>> Get([FromQuery] bool includeArchived = false)
        {
            try
            {
                var data = includeArchived 
                    ? await _mongoDBService.GetAsync()
                    : await _mongoDBService.GetNonArchivedAsync();
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving JWST data");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("{id:length(24)}")]
        public async Task<ActionResult<DataResponse>> Get(string id)
        {
            try
            {
                var data = await _mongoDBService.GetAsync(id);
                if (data == null)
                    return NotFound();

                // Update last accessed time
                await _mongoDBService.UpdateLastAccessedAsync(id);

                return Ok(MapToDataResponse(data));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving JWST data with id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("{id:length(24)}/preview")]
        public async Task<IActionResult> GetPreview(string id)
        {
            try
            {
                var data = await _mongoDBService.GetAsync(id);
                if (data == null)
                    return NotFound();

                if (string.IsNullOrEmpty(data.FilePath))
                    return BadRequest("File path not found for this data item");

                var client = _httpClientFactory.CreateClient("ProcessingEngine");
                
                // Call Python service to generate preview
                // Encode file path to ensure safety in URL
                var response = await client.GetAsync($"/preview/{id}?file_path={System.Net.WebUtility.UrlEncode(data.FilePath)}");
                
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError("Error getting preview from processing engine: {StatusCode}", response.StatusCode);
                    return StatusCode((int)response.StatusCode, "Error generating preview");
                }

                var imageBytes = await response.Content.ReadAsByteArrayAsync();
                return File(imageBytes, "image/png");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving preview for id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("{id:length(24)}/file")]
        public async Task<IActionResult> GetFile(string id)
        {
            try
            {
                var data = await _mongoDBService.GetAsync(id);
                if (data == null)
                    return NotFound();

                if (string.IsNullOrEmpty(data.FilePath) || !System.IO.File.Exists(data.FilePath))
                    return NotFound("File not found on server");

                var fileBytes = await System.IO.File.ReadAllBytesAsync(data.FilePath);
                var contentType = "application/octet-stream";
                
                if(data.FileName.EndsWith(".fits") || data.FileName.EndsWith(".fits.gz"))
                {
                    contentType = "application/fits";
                }

                return File(fileBytes, contentType, data.FileName);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving file for id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("type/{dataType}")]
        public async Task<ActionResult<List<DataResponse>>> GetByType(string dataType)
        {
            try
            {
                var data = await _mongoDBService.GetByDataTypeAsync(dataType);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving JWST data by type: {DataType}", dataType);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("status/{status}")]
        public async Task<ActionResult<List<DataResponse>>> GetByStatus(string status)
        {
            try
            {
                var data = await _mongoDBService.GetByStatusAsync(status);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving JWST data by status: {Status}", status);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("user/{userId}")]
        public async Task<ActionResult<List<DataResponse>>> GetByUserId(string userId)
        {
            try
            {
                var data = await _mongoDBService.GetByUserIdAsync(userId);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving JWST data for user: {UserId}", userId);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("tags/{tags}")]
        public async Task<ActionResult<List<DataResponse>>> GetByTags(string tags)
        {
            try
            {
                var tagList = tags.Split(',').Select(t => t.Trim()).ToList();
                var data = await _mongoDBService.GetByTagsAsync(tagList);
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving JWST data by tags: {Tags}", tags);
                return StatusCode(500, "Internal server error");
            }
        }

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
                    Metadata = request.Metadata ?? new Dictionary<string, object>(),
                    Tags = request.Tags ?? new List<string>(),
                    UserId = request.UserId,
                    UploadDate = DateTime.UtcNow,
                    ProcessingStatus = ProcessingStatuses.Pending,
                    ImageInfo = request.ImageInfo,
                    SensorInfo = request.SensorInfo,
                    SpectralInfo = request.SpectralInfo,
                    CalibrationInfo = request.CalibrationInfo
                };

                await _mongoDBService.CreateAsync(jwstData);
                return CreatedAtAction(nameof(Get), new { id = jwstData.Id }, MapToDataResponse(jwstData));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating JWST data");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost("upload")]
        [RequestSizeLimit(104857600)] // 100MB
        public async Task<ActionResult<DataResponse>> Upload([FromForm] FileUploadRequest request)
        {
            try
            {
                if (request.File == null || request.File.Length == 0)
                    return BadRequest("No file uploaded");

                // Validate extension
                var allowedExtensions = _configuration.GetSection("FileStorage:AllowedExtensions").Get<string[]>() 
                    ?? new[] { ".fits", ".fits.gz", ".jpg", ".png", ".tiff", ".csv", ".json" };
                
                var extension = Path.GetExtension(request.File.FileName).ToLowerInvariant();
                if (!allowedExtensions.Contains(extension))
                    return BadRequest($"File type {extension} is not allowed");

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
                        _ => DataTypes.Raw
                    };
                }

                // Create data model
                var jwstData = new JwstDataModel
                {
                    FileName = request.File.FileName,
                    DataType = dataType,
                    Description = request.Description,
                    Tags = request.Tags ?? new List<string>(),
                    FilePath = filePath,
                    FileSize = request.File.Length,
                    UploadDate = DateTime.UtcNow,
                    ProcessingStatus = ProcessingStatuses.Pending,
                    FileFormat = extension.TrimStart('.'),
                    // Basic image metadata if it's an image
                    ImageInfo = (dataType == DataTypes.Image) ? new ImageMetadata { Format = extension.TrimStart('.') } : null
                };

                await _mongoDBService.CreateAsync(jwstData);
                
                // If it's a FITS file, trigger background processing (placeholder)
                if (extension.Contains("fits")) 
                {
                   // _backgroundQueue.QueueBackgroundWorkItem(async token => ...);
                   // For now just logging
                   _logger.LogInformation("FITS file uploaded: {Id}", jwstData.Id);
                }

                return CreatedAtAction(nameof(Get), new { id = jwstData.Id }, MapToDataResponse(jwstData));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error uploading file");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPut("{id:length(24)}")]
        public async Task<IActionResult> Update(string id, [FromBody] UpdateDataRequest request)
        {
            try
            {
                var existingData = await _mongoDBService.GetAsync(id);
                if (existingData == null)
                    return NotFound();

                // Update only provided fields
                if (!string.IsNullOrEmpty(request.FileName))
                    existingData.FileName = request.FileName;
                
                if (!string.IsNullOrEmpty(request.Description))
                    existingData.Description = request.Description;
                
                if (request.Metadata != null)
                    existingData.Metadata = request.Metadata;
                
                if (request.Tags != null)
                    existingData.Tags = request.Tags;
                
                if (request.IsPublic.HasValue)
                    existingData.IsPublic = request.IsPublic.Value;
                
                if (request.SharedWith != null)
                    existingData.SharedWith = request.SharedWith;

                // Update type-specific metadata
                if (request.ImageInfo != null)
                    existingData.ImageInfo = request.ImageInfo;
                
                if (request.SensorInfo != null)
                    existingData.SensorInfo = request.SensorInfo;
                
                if (request.SpectralInfo != null)
                    existingData.SpectralInfo = request.SpectralInfo;
                
                if (request.CalibrationInfo != null)
                    existingData.CalibrationInfo = request.CalibrationInfo;

                await _mongoDBService.UpdateAsync(id, existingData);
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating JWST data with id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpDelete("{id:length(24)}")]
        public async Task<IActionResult> Delete(string id)
        {
            try
            {
                var existingData = await _mongoDBService.GetAsync(id);
                if (existingData == null)
                    return NotFound();

                await _mongoDBService.RemoveAsync(id);
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting JWST data with id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost("{id:length(24)}/process")]
        public async Task<ActionResult<ProcessingResponse>> ProcessData(string id, [FromBody] ProcessingRequest request)
        {
            try
            {
                var existingData = await _mongoDBService.GetAsync(id);
                if (existingData == null)
                    return NotFound();

                // Update status to processing
                await _mongoDBService.UpdateProcessingStatusAsync(id, ProcessingStatuses.Processing);

                // TODO: Send to Python processing engine
                // This will be implemented in Phase 3

                var jobId = Guid.NewGuid().ToString();
                return Accepted(new ProcessingResponse
                {
                    JobId = jobId,
                    DataId = id,
                    Status = "processing",
                    Message = "Processing job created successfully",
                    CreatedAt = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing JWST data with id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("{id:length(24)}/processing-results")]
        public async Task<ActionResult<List<ProcessingResult>>> GetProcessingResults(string id)
        {
            try
            {
                var data = await _mongoDBService.GetAsync(id);
                if (data == null)
                    return NotFound();

                return Ok(data.ProcessingResults);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving processing results for id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost("{id:length(24)}/validate")]
        public async Task<IActionResult> ValidateData(string id)
        {
            try
            {
                var data = await _mongoDBService.GetAsync(id);
                if (data == null)
                    return NotFound();

                // TODO: Implement actual validation logic
                var isValid = true; // Placeholder
                var validationMessage = isValid ? null : "Validation failed";

                await _mongoDBService.UpdateValidationStatusAsync(id, isValid, validationMessage);

                return Ok(new { 
                    isValid, 
                    validationMessage,
                    validatedAt = DateTime.UtcNow 
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error validating data with id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost("{id:length(24)}/share")]
        public async Task<IActionResult> ShareData(string id, [FromBody] ShareDataRequest request)
        {
            try
            {
                var data = await _mongoDBService.GetAsync(id);
                if (data == null)
                    return NotFound();

                if (request.SharedWith != null)
                {
                    data.SharedWith = request.SharedWith;
                }

                if (request.IsPublic.HasValue)
                {
                    data.IsPublic = request.IsPublic.Value;
                }

                await _mongoDBService.UpdateAsync(id, data);

                return Ok(new { message = "Data sharing updated successfully" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating sharing for data with id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost("{id:length(24)}/archive")]
        public async Task<IActionResult> ArchiveData(string id)
        {
            try
            {
                var data = await _mongoDBService.GetAsync(id);
                if (data == null)
                    return NotFound();

                await _mongoDBService.ArchiveAsync(id);
                return Ok(new { message = "Data archived successfully" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error archiving data with id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost("{id:length(24)}/unarchive")]
        public async Task<IActionResult> UnarchiveData(string id)
        {
            try
            {
                var data = await _mongoDBService.GetAsync(id);
                if (data == null)
                    return NotFound();

                await _mongoDBService.UnarchiveAsync(id);
                return Ok(new { message = "Data unarchived successfully" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error unarchiving data with id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("archived")]
        public async Task<ActionResult<List<DataResponse>>> GetArchivedData()
        {
            try
            {
                var data = await _mongoDBService.GetArchivedAsync();
                var response = data.Select(MapToDataResponse).ToList();
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving archived data");
                return StatusCode(500, "Internal server error");
            }
        }

        // Enhanced data management endpoints
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
                if (!request.DataIds.Any())
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

        // Lineage endpoints
        [HttpGet("lineage/{observationBaseId}")]
        public async Task<ActionResult<LineageResponse>> GetLineage(string observationBaseId)
        {
            try
            {
                var data = await _mongoDBService.GetLineageTreeAsync(observationBaseId);
                if (!data.Any())
                    return NotFound($"No data found for observation: {observationBaseId}");

                var response = new LineageResponse
                {
                    ObservationBaseId = observationBaseId,
                    TotalFiles = data.Count,
                    LevelCounts = data
                        .GroupBy(d => d.ProcessingLevel ?? "unknown")
                        .ToDictionary(g => g.Key, g => g.Count()),
                    Files = data.Select(d => new LineageFileInfo
                    {
                        Id = d.Id,
                        FileName = d.FileName,
                        ProcessingLevel = d.ProcessingLevel ?? "unknown",
                        DataType = d.DataType,
                        ParentId = d.ParentId,
                        FileSize = d.FileSize,
                        UploadDate = d.UploadDate,
                        TargetName = d.ImageInfo?.TargetName,
                        Instrument = d.ImageInfo?.Instrument
                    }).ToList()
                };

                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving lineage for: {ObservationBaseId}", observationBaseId);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("lineage")]
        public async Task<ActionResult<Dictionary<string, LineageResponse>>> GetAllLineages()
        {
            try
            {
                var grouped = await _mongoDBService.GetLineageGroupedAsync();
                var response = grouped.ToDictionary(
                    kvp => kvp.Key,
                    kvp => new LineageResponse
                    {
                        ObservationBaseId = kvp.Key,
                        TotalFiles = kvp.Value.Count,
                        LevelCounts = kvp.Value
                            .GroupBy(d => d.ProcessingLevel ?? "unknown")
                            .ToDictionary(g => g.Key, g => g.Count()),
                        Files = kvp.Value.Select(d => new LineageFileInfo
                        {
                            Id = d.Id,
                            FileName = d.FileName,
                            ProcessingLevel = d.ProcessingLevel ?? "unknown",
                            DataType = d.DataType,
                            ParentId = d.ParentId,
                            FileSize = d.FileSize,
                            UploadDate = d.UploadDate,
                            TargetName = d.ImageInfo?.TargetName,
                            Instrument = d.ImageInfo?.Instrument
                        }).ToList()
                    });

                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving all lineages");
                return StatusCode(500, "Internal server error");
            }
        }

        /// <summary>
        /// Delete an entire observation including all files and database records
        /// </summary>
        [HttpDelete("observation/{observationBaseId}")]
        public async Task<ActionResult<DeleteObservationResponse>> DeleteObservation(
            string observationBaseId,
            [FromQuery] bool confirm = false)
        {
            try
            {
                // Get all records for this observation
                var records = await _mongoDBService.GetByObservationBaseIdAsync(observationBaseId);

                if (!records.Any())
                {
                    return NotFound(new DeleteObservationResponse
                    {
                        ObservationBaseId = observationBaseId,
                        FileCount = 0,
                        TotalSizeBytes = 0,
                        FileNames = new List<string>(),
                        Deleted = false,
                        Message = $"No records found for observation: {observationBaseId}"
                    });
                }

                var response = new DeleteObservationResponse
                {
                    ObservationBaseId = observationBaseId,
                    FileCount = records.Count,
                    TotalSizeBytes = records.Sum(r => r.FileSize),
                    FileNames = records.Select(r => r.FileName).ToList(),
                    Deleted = false,
                    Message = $"Found {records.Count} files ({FormatFileSize(records.Sum(r => r.FileSize))})"
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
                            _logger.LogInformation("Deleted file: {FilePath}", filePath);
                        }
                        else
                        {
                            _logger.LogWarning("File not found (may already be deleted): {FilePath}", filePath);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Failed to delete file: {FilePath}", filePath);
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
                        _logger.LogInformation("Removed empty directory: {Directory}", observationDir);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not remove directory: {Directory}", observationDir);
                }

                // Delete all database records
                var deleteResult = await _mongoDBService.RemoveByObservationBaseIdAsync(observationBaseId);
                _logger.LogInformation(
                    "Deleted {Count} database records for observation: {ObservationBaseId}",
                    deleteResult.DeletedCount,
                    observationBaseId);

                response.Deleted = true;
                response.Message = failedFiles.Any()
                    ? $"Deleted {deleteResult.DeletedCount} records and {deletedFiles} files. Failed to delete {failedFiles.Count} files."
                    : $"Successfully deleted {deleteResult.DeletedCount} records and {deletedFiles} files";

                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting observation: {ObservationBaseId}", observationBaseId);
                return StatusCode(500, new DeleteObservationResponse
                {
                    ObservationBaseId = observationBaseId,
                    Deleted = false,
                    Message = $"Error deleting observation: {ex.Message}"
                });
            }
        }

        private static string FormatFileSize(long bytes)
        {
            if (bytes >= 1073741824)
                return $"{bytes / 1073741824.0:F2} GB";
            if (bytes >= 1048576)
                return $"{bytes / 1048576.0:F2} MB";
            if (bytes >= 1024)
                return $"{bytes / 1024.0:F2} KB";
            return $"{bytes} bytes";
        }

        /// <summary>
        /// Migrate existing data to populate processing level fields
        /// </summary>
        [HttpPost("migrate/processing-levels")]
        public async Task<IActionResult> MigrateProcessingLevels()
        {
            try
            {
                var allData = await _mongoDBService.GetAsync();
                int updated = 0;

                foreach (var item in allData)
                {
                    // Skip if already migrated
                    if (!string.IsNullOrEmpty(item.ProcessingLevel) &&
                        !string.IsNullOrEmpty(item.ObservationBaseId))
                    {
                        continue;
                    }

                    bool needsUpdate = false;

                    // Parse processing level from filename
                    if (string.IsNullOrEmpty(item.ProcessingLevel))
                    {
                        var fileNameLower = item.FileName.ToLower();
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
                        var obsMatch = System.Text.RegularExpressions.Regex.Match(
                            item.FileName,
                            @"(jw\d{5}-o\d+_t\d+_[a-z]+)",
                            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

                        if (obsMatch.Success)
                        {
                            item.ObservationBaseId = obsMatch.Groups[1].Value.ToLower();
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
                            item.ExposureId = expMatch.Groups[1].Value.ToLower();
                            needsUpdate = true;
                        }
                    }

                    if (needsUpdate)
                    {
                        await _mongoDBService.UpdateAsync(item.Id, item);
                        updated++;
                    }
                }

                return Ok(new { message = $"Migration complete. Updated {updated} of {allData.Count} records." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during migration");
                return StatusCode(500, "Migration failed: " + ex.Message);
            }
        }

        /// <summary>
        /// Migrate existing data to reclassify data types and set IsViewable based on filename patterns
        /// </summary>
        [HttpPost("migrate/data-types")]
        public async Task<IActionResult> MigrateDataTypes()
        {
            try
            {
                var allData = await _mongoDBService.GetAsync();
                int updated = 0;

                foreach (var item in allData)
                {
                    var fileNameLower = item.FileName.ToLower();
                    bool needsUpdate = false;
                    string newDataType = item.DataType;
                    bool newIsViewable = item.IsViewable;

                    // Determine data type and viewability based on suffix
                    // Non-viewable table/catalog files
                    if (fileNameLower.Contains("_asn") || fileNameLower.Contains("_pool"))
                    {
                        newDataType = DataTypes.Metadata;
                        newIsViewable = false;
                    }
                    else if (fileNameLower.Contains("_cat") || fileNameLower.Contains("_phot"))
                    {
                        newDataType = DataTypes.Metadata;
                        newIsViewable = false;
                    }
                    else if (fileNameLower.Contains("_x1d") || fileNameLower.Contains("_x1dints") || fileNameLower.Contains("_c1d"))
                    {
                        newDataType = DataTypes.Spectral;
                        newIsViewable = false; // 1D extracted spectra are tables
                    }
                    // Viewable image files
                    else if (fileNameLower.Contains("_uncal"))
                    {
                        newDataType = DataTypes.Raw;
                        newIsViewable = true;
                    }
                    else if (fileNameLower.Contains("_rate") || fileNameLower.Contains("_rateints"))
                    {
                        newDataType = DataTypes.Sensor;
                        newIsViewable = true;
                    }
                    else if (fileNameLower.Contains("_s2d") || fileNameLower.Contains("_s3d"))
                    {
                        newDataType = DataTypes.Spectral;
                        newIsViewable = true; // 2D/3D spectral images are viewable
                    }
                    else if (fileNameLower.Contains("_cal") || fileNameLower.Contains("_calints") ||
                             fileNameLower.Contains("_crf") || fileNameLower.Contains("_i2d"))
                    {
                        newDataType = DataTypes.Image;
                        newIsViewable = true;
                    }
                    else if (fileNameLower.Contains("_flat") || fileNameLower.Contains("_dark") || fileNameLower.Contains("_bias"))
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
                        await _mongoDBService.UpdateAsync(item.Id, item);
                        updated++;
                        _logger.LogInformation(
                            "Migrated {FileName}: DataType={DataType}, IsViewable={IsViewable}",
                            item.FileName, item.DataType, item.IsViewable);
                    }
                }

                return Ok(new { message = $"Data type migration complete. Updated {updated} of {allData.Count} records." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during data type migration");
                return StatusCode(500, "Data type migration failed: " + ex.Message);
            }
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
                LastProcessed = model.ProcessingResults.Any() ?
                    model.ProcessingResults.Max(r => r.ProcessedDate) : null,
                // Lineage fields
                ProcessingLevel = model.ProcessingLevel,
                ObservationBaseId = model.ObservationBaseId,
                ExposureId = model.ExposureId,
                ParentId = model.ParentId,
                DerivedFrom = model.DerivedFrom,
                // Viewability
                IsViewable = model.IsViewable
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