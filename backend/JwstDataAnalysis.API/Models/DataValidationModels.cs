using System.ComponentModel.DataAnnotations;
using MongoDB.Bson;

namespace JwstDataAnalysis.API.Models
{
    // DTOs for API requests and responses
    public class CreateDataRequest
    {
        [Required]
        [StringLength(255)]
        public string FileName { get; set; } = string.Empty;

        [Required]
        [StringLength(50)]
        public string DataType { get; set; } = string.Empty;

        [StringLength(1000)]
        public string? Description { get; set; }

        public Dictionary<string, object>? Metadata { get; set; }

        public List<string>? Tags { get; set; }

        public string? UserId { get; set; }

        // Type-specific metadata
        public ImageMetadata? ImageInfo { get; set; }
        public SensorMetadata? SensorInfo { get; set; }
        public SpectralMetadata? SpectralInfo { get; set; }
        public CalibrationMetadata? CalibrationInfo { get; set; }
    }

    public class UpdateDataRequest
    {
        [StringLength(255)]
        public string? FileName { get; set; }

        [StringLength(1000)]
        public string? Description { get; set; }

        public Dictionary<string, object>? Metadata { get; set; }

        public List<string>? Tags { get; set; }

        public bool? IsPublic { get; set; }

        public List<string>? SharedWith { get; set; }

        // Type-specific metadata updates
        public ImageMetadata? ImageInfo { get; set; }
        public SensorMetadata? SensorInfo { get; set; }
        public SpectralMetadata? SpectralInfo { get; set; }
        public CalibrationMetadata? CalibrationInfo { get; set; }
    }

    public class DataResponse
    {
        public string Id { get; set; } = string.Empty;
        public string FileName { get; set; } = string.Empty;
        public string DataType { get; set; } = string.Empty;
        public DateTime UploadDate { get; set; }
        public string? Description { get; set; }
        public long FileSize { get; set; }
        public string? ProcessingStatus { get; set; }
        public List<string> Tags { get; set; } = new();
        public string? UserId { get; set; }
        public bool IsPublic { get; set; }
        public int Version { get; set; }
        public string? FileFormat { get; set; }
        public bool IsValidated { get; set; }
        public DateTime? LastAccessed { get; set; }
        
        // Metadata
        public ImageMetadata? ImageInfo { get; set; }
        public SensorMetadata? SensorInfo { get; set; }
        public SpectralMetadata? SpectralInfo { get; set; }
        public CalibrationMetadata? CalibrationInfo { get; set; }
        
        // Processing results summary
        public int ProcessingResultsCount { get; set; }
        public DateTime? LastProcessed { get; set; }
    }

    public class ProcessingRequest
    {
        [Required]
        [StringLength(100)]
        public string Algorithm { get; set; } = string.Empty;

        public Dictionary<string, object>? Parameters { get; set; }

        public string? Priority { get; set; } = "normal"; // "low", "normal", "high", "urgent"

        public bool? WaitForCompletion { get; set; } = false;

        public string? CallbackUrl { get; set; }
    }

    public class ProcessingResponse
    {
        public string JobId { get; set; } = string.Empty;
        public string DataId { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string? Message { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
        public double? Progress { get; set; }
        public Dictionary<string, object>? Results { get; set; }
    }

    public class SearchRequest
    {
        public string? SearchTerm { get; set; }
        public List<string>? DataTypes { get; set; }
        public List<string>? Statuses { get; set; }
        public List<string>? Tags { get; set; }
        public string? UserId { get; set; }
        public DateTime? DateFrom { get; set; }
        public DateTime? DateTo { get; set; }
        public long? MinFileSize { get; set; }
        public long? MaxFileSize { get; set; }
        public bool? IsPublic { get; set; }
        public bool? IsValidated { get; set; }
        public int Page { get; set; } = 1;
        public int PageSize { get; set; } = 20;
        public string? SortBy { get; set; } = "uploadDate";
        public string? SortOrder { get; set; } = "desc"; // "asc" or "desc"
    }

    public class SearchResponse
    {
        public List<DataResponse> Data { get; set; } = new();
        public int TotalCount { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public int TotalPages { get; set; }
        public Dictionary<string, int>? Facets { get; set; }
    }

    public class FileUploadRequest
    {
        [Required]
        public IFormFile File { get; set; } = null!;

        [Required]
        [StringLength(50)]
        public string DataType { get; set; } = string.Empty;

        [StringLength(1000)]
        public string? Description { get; set; }

        public List<string>? Tags { get; set; }

        public string? UserId { get; set; }

        public bool IsPublic { get; set; } = false;

        public Dictionary<string, object>? Metadata { get; set; }
    }

    public class FileUploadResponse
    {
        public string Id { get; set; } = string.Empty;
        public string FileName { get; set; } = string.Empty;
        public long FileSize { get; set; }
        public string? FileFormat { get; set; }
        public bool IsValidated { get; set; }
        public string? ValidationMessage { get; set; }
        public DateTime UploadDate { get; set; }
    }

    // Validation attributes for astronomical data
    public class AstronomicalDataValidationAttribute : ValidationAttribute
    {
        protected override ValidationResult? IsValid(object? value, ValidationContext validationContext)
        {
            if (value == null) return ValidationResult.Success;

            var dataType = value.ToString();
            if (string.IsNullOrEmpty(dataType)) return ValidationResult.Success;

            var validTypes = new[] { "image", "sensor", "spectral", "metadata", "calibration", "raw", "processed" };
            
            if (!validTypes.Contains(dataType.ToLower()))
            {
                return new ValidationResult($"Invalid data type. Must be one of: {string.Join(", ", validTypes)}");
            }

            return ValidationResult.Success;
        }
    }

    public class FileFormatValidationAttribute : ValidationAttribute
    {
        protected override ValidationResult? IsValid(object? value, ValidationContext validationContext)
        {
            if (value == null) return ValidationResult.Success;

            var format = value.ToString();
            if (string.IsNullOrEmpty(format)) return ValidationResult.Success;

            var validFormats = new[] { "fits", "csv", "json", "hdf5", "ascii", "binary" };
            
            if (!validFormats.Contains(format.ToLower()))
            {
                return new ValidationResult($"Invalid file format. Must be one of: {string.Join(", ", validFormats)}");
            }

            return ValidationResult.Success;
        }
    }

    // Statistics models for data analysis
    public class DataStatistics
    {
        public int TotalFiles { get; set; }
        public long TotalSize { get; set; }
        public Dictionary<string, int> DataTypeDistribution { get; set; } = new();
        public Dictionary<string, int> StatusDistribution { get; set; } = new();
        public Dictionary<string, int> FormatDistribution { get; set; } = new();
        public int ValidatedFiles { get; set; }
        public int PublicFiles { get; set; }
        public DateTime? OldestFile { get; set; }
        public DateTime? NewestFile { get; set; }
        public double AverageFileSize { get; set; }
        public List<string> MostCommonTags { get; set; } = new();
    }

    // Export models
    public class ExportRequest
    {
        public List<string> DataIds { get; set; } = new();
        public string Format { get; set; } = "json"; // "json", "csv", "xml"
        public bool IncludeMetadata { get; set; } = true;
        public bool IncludeProcessingResults { get; set; } = false;
        public List<string>? Fields { get; set; }
    }

    public class ExportResponse
    {
        public string ExportId { get; set; } = string.Empty;
        public string Status { get; set; } = string.Empty;
        public string? DownloadUrl { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
        public int TotalRecords { get; set; }
        public long FileSize { get; set; }
    }
} 