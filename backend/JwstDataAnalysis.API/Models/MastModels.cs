using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace JwstDataAnalysis.API.Models
{
    // Search Request DTOs
    public class MastTargetSearchRequest
    {
        [Required]
        [StringLength(200)]
        public string TargetName { get; set; } = string.Empty;

        [Range(0.01, 10.0)]
        public double Radius { get; set; } = 0.2; // degrees
    }

    public class MastCoordinateSearchRequest
    {
        [Required]
        [Range(-360, 360)]
        public double Ra { get; set; }

        [Required]
        [Range(-90, 90)]
        public double Dec { get; set; }

        [Range(0.01, 10.0)]
        public double Radius { get; set; } = 0.2; // degrees
    }

    public class MastObservationSearchRequest
    {
        [Required]
        [StringLength(100)]
        public string ObsId { get; set; } = string.Empty;
    }

    public class MastProgramSearchRequest
    {
        [Required]
        [StringLength(50)]
        public string ProgramId { get; set; } = string.Empty;
    }

    // Response DTOs
    public class MastSearchResponse
    {
        [JsonPropertyName("search_type")]
        public string SearchType { get; set; } = string.Empty;

        [JsonPropertyName("query_params")]
        public Dictionary<string, object> QueryParams { get; set; } = new();

        [JsonPropertyName("results")]
        public List<Dictionary<string, object?>> Results { get; set; } = new();

        [JsonPropertyName("result_count")]
        public int ResultCount { get; set; }

        [JsonPropertyName("timestamp")]
        public string Timestamp { get; set; } = string.Empty;
    }

    public class MastObservationResult
    {
        public string? ObsId { get; set; }
        public string? TargetName { get; set; }
        public double? Ra { get; set; }
        public double? Dec { get; set; }
        public string? Instrument { get; set; }
        public string? Filter { get; set; }
        public double? ExposureTime { get; set; }
        public string? DataProductType { get; set; }
        public string? CalibrationLevel { get; set; }
        public DateTime? ObservationDate { get; set; }
        public string? ProposalId { get; set; }
        public string? ProposalPi { get; set; }
        public Dictionary<string, object>? AdditionalFields { get; set; }
    }

    // Download Request/Response
    public class MastDownloadRequest
    {
        [Required]
        public string ObsId { get; set; } = string.Empty;

        public string ProductType { get; set; } = "SCIENCE";

        public string? ProductId { get; set; }
    }

    public class MastDownloadResponse
    {
        [JsonPropertyName("status")]
        public string Status { get; set; } = string.Empty;

        [JsonPropertyName("obs_id")]
        public string ObsId { get; set; } = string.Empty;

        [JsonPropertyName("files")]
        public List<string> Files { get; set; } = new();

        [JsonPropertyName("file_count")]
        public int FileCount { get; set; }

        [JsonPropertyName("download_dir")]
        public string? DownloadDir { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("timestamp")]
        public string Timestamp { get; set; } = string.Empty;
    }

    // Import to local database
    public class MastImportRequest
    {
        [Required]
        public string ObsId { get; set; } = string.Empty;

        public string ProductType { get; set; } = "SCIENCE";

        public string? UserId { get; set; }

        public List<string>? Tags { get; set; }

        public bool IsPublic { get; set; } = false;
    }

    public class MastImportResponse
    {
        public string Status { get; set; } = string.Empty;
        public string ObsId { get; set; } = string.Empty;
        public List<string> ImportedDataIds { get; set; } = new();
        public int ImportedCount { get; set; }
        public string? Error { get; set; }
        public DateTime Timestamp { get; set; }
        // Lineage summary
        public Dictionary<string, List<string>>? LineageTree { get; set; } // level -> list of IDs
        public string? ObservationBaseId { get; set; }
    }

    // Data Products
    public class MastDataProductsRequest
    {
        [Required]
        public string ObsId { get; set; } = string.Empty;
    }

    public class MastDataProductsResponse
    {
        [JsonPropertyName("obs_id")]
        public string ObsId { get; set; } = string.Empty;

        [JsonPropertyName("products")]
        public List<Dictionary<string, object?>> Products { get; set; } = new();

        [JsonPropertyName("product_count")]
        public int ProductCount { get; set; }
    }

    public class MastDataProduct
    {
        public string? ProductId { get; set; }
        public string? FileName { get; set; }
        public string? ProductType { get; set; }
        public string? Description { get; set; }
        public long? Size { get; set; }
        public string? DataUri { get; set; }
    }
}
