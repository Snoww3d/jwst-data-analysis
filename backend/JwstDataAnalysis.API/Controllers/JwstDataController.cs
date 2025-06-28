using Microsoft.AspNetCore.Mvc;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

namespace JwstDataAnalysis.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class JwstDataController : ControllerBase
    {
        private readonly MongoDBService _mongoDBService;
        private readonly ILogger<JwstDataController> _logger;

        public JwstDataController(MongoDBService mongoDBService, ILogger<JwstDataController> logger)
        {
            _mongoDBService = mongoDBService;
            _logger = logger;
        }

        [HttpGet]
        public async Task<ActionResult<List<JwstDataModel>>> Get()
        {
            try
            {
                var data = await _mongoDBService.GetAsync();
                return Ok(data);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving JWST data");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("{id:length(24)}")]
        public async Task<ActionResult<JwstDataModel>> Get(string id)
        {
            try
            {
                var data = await _mongoDBService.GetAsync(id);
                if (data == null)
                    return NotFound();

                return Ok(data);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving JWST data with id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("type/{dataType}")]
        public async Task<ActionResult<List<JwstDataModel>>> GetByType(string dataType)
        {
            try
            {
                var data = await _mongoDBService.GetByDataTypeAsync(dataType);
                return Ok(data);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving JWST data by type: {DataType}", dataType);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("status/{status}")]
        public async Task<ActionResult<List<JwstDataModel>>> GetByStatus(string status)
        {
            try
            {
                var data = await _mongoDBService.GetByStatusAsync(status);
                return Ok(data);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving JWST data by status: {Status}", status);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpGet("search/{searchTerm}")]
        public async Task<ActionResult<List<JwstDataModel>>> Search(string searchTerm)
        {
            try
            {
                var data = await _mongoDBService.SearchAsync(searchTerm);
                return Ok(data);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error searching JWST data with term: {SearchTerm}", searchTerm);
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPost]
        public async Task<ActionResult<JwstDataModel>> Create(JwstDataModel jwstData)
        {
            try
            {
                await _mongoDBService.CreateAsync(jwstData);
                return CreatedAtAction(nameof(Get), new { id = jwstData.Id }, jwstData);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating JWST data");
                return StatusCode(500, "Internal server error");
            }
        }

        [HttpPut("{id:length(24)}")]
        public async Task<IActionResult> Update(string id, JwstDataModel jwstData)
        {
            try
            {
                var existingData = await _mongoDBService.GetAsync(id);
                if (existingData == null)
                    return NotFound();

                jwstData.Id = id;
                await _mongoDBService.UpdateAsync(id, jwstData);
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
        public async Task<IActionResult> ProcessData(string id, [FromBody] ProcessingRequest request)
        {
            try
            {
                var existingData = await _mongoDBService.GetAsync(id);
                if (existingData == null)
                    return NotFound();

                // Update status to processing
                await _mongoDBService.UpdateProcessingStatusAsync(id, "processing");

                // TODO: Send to Python processing engine
                // This will be implemented in Phase 3

                return Accepted(new { message = "Processing started", dataId = id });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing JWST data with id: {Id}", id);
                return StatusCode(500, "Internal server error");
            }
        }
    }

    public class ProcessingRequest
    {
        public string Algorithm { get; set; } = string.Empty;
        public Dictionary<string, object> Parameters { get; set; } = new();
    }
} 