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
                var exportPath = Path.Combine(Directory.GetCurrentDirectory(), "exports", $"{exportId}.json");
                
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
} 