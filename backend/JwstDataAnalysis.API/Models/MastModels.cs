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

    // Import Job Progress Tracking
    public class ImportJobStatus
    {
        public string JobId { get; set; } = string.Empty;
        public string ObsId { get; set; } = string.Empty;
        public int Progress { get; set; } // 0-100
        public string Stage { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public bool IsComplete { get; set; }
        public string? Error { get; set; }
        public DateTime StartedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
        public MastImportResponse? Result { get; set; }
        // Byte-level progress tracking
        public long TotalBytes { get; set; }
        public long DownloadedBytes { get; set; }
        public double DownloadProgressPercent { get; set; }
        public double SpeedBytesPerSec { get; set; }
        public double? EtaSeconds { get; set; }
        public List<FileDownloadProgress>? FileProgress { get; set; }
        public bool IsResumable { get; set; }
        public string? DownloadJobId { get; set; }
    }

    public class ImportJobStartResponse
    {
        public string JobId { get; set; } = string.Empty;
        public string ObsId { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
    }

    public static class ImportStages
    {
        public const string Starting = "Starting";
        public const string Downloading = "Downloading";
        public const string SavingRecords = "Saving records";
        public const string Complete = "Complete";
        public const string Failed = "Failed";
        public const string Cancelled = "Cancelled";
    }

    // Async Download Job DTOs (for processing engine communication)
    public class DownloadJobStartResponse
    {
        [JsonPropertyName("job_id")]
        public string JobId { get; set; } = string.Empty;

        [JsonPropertyName("obs_id")]
        public string ObsId { get; set; } = string.Empty;

        [JsonPropertyName("message")]
        public string Message { get; set; } = string.Empty;
    }

    public class DownloadJobProgress
    {
        [JsonPropertyName("job_id")]
        public string JobId { get; set; } = string.Empty;

        [JsonPropertyName("obs_id")]
        public string ObsId { get; set; } = string.Empty;

        [JsonPropertyName("stage")]
        public string Stage { get; set; } = string.Empty;

        [JsonPropertyName("message")]
        public string Message { get; set; } = string.Empty;

        [JsonPropertyName("progress")]
        public int Progress { get; set; }

        [JsonPropertyName("total_files")]
        public int TotalFiles { get; set; }

        [JsonPropertyName("downloaded_files")]
        public int DownloadedFiles { get; set; }

        [JsonPropertyName("current_file")]
        public string? CurrentFile { get; set; }

        [JsonPropertyName("files")]
        public List<string> Files { get; set; } = new();

        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("is_complete")]
        public bool IsComplete { get; set; }

        [JsonPropertyName("download_dir")]
        public string? DownloadDir { get; set; }

        // Byte-level progress fields
        [JsonPropertyName("total_bytes")]
        public long TotalBytes { get; set; }

        [JsonPropertyName("downloaded_bytes")]
        public long DownloadedBytes { get; set; }

        [JsonPropertyName("download_progress_percent")]
        public double DownloadProgressPercent { get; set; }

        [JsonPropertyName("speed_bytes_per_sec")]
        public double SpeedBytesPerSec { get; set; }

        [JsonPropertyName("eta_seconds")]
        public double? EtaSeconds { get; set; }

        [JsonPropertyName("file_progress")]
        public List<FileDownloadProgress>? FileProgress { get; set; }

        [JsonPropertyName("is_resumable")]
        public bool IsResumable { get; set; }
    }

    // Enhanced progress tracking for chunked downloads
    public class FileDownloadProgress
    {
        [JsonPropertyName("filename")]
        public string FileName { get; set; } = string.Empty;

        [JsonPropertyName("total_bytes")]
        public long TotalBytes { get; set; }

        [JsonPropertyName("downloaded_bytes")]
        public long DownloadedBytes { get; set; }

        [JsonPropertyName("progress_percent")]
        public double ProgressPercent { get; set; }

        [JsonPropertyName("status")]
        public string Status { get; set; } = "pending";
    }

    // Request to start chunked download
    public class ChunkedDownloadRequest
    {
        [Required]
        public string ObsId { get; set; } = string.Empty;

        public string ProductType { get; set; } = "SCIENCE";

        public string? ResumeJobId { get; set; }
    }

    // Response from starting chunked download
    public class ChunkedDownloadStartResponse
    {
        [JsonPropertyName("job_id")]
        public string JobId { get; set; } = string.Empty;

        [JsonPropertyName("obs_id")]
        public string ObsId { get; set; } = string.Empty;

        [JsonPropertyName("message")]
        public string Message { get; set; } = string.Empty;

        [JsonPropertyName("is_resume")]
        public bool IsResume { get; set; }
    }

    // Resumable job summary
    public class ResumableJobSummary
    {
        [JsonPropertyName("job_id")]
        public string JobId { get; set; } = string.Empty;

        [JsonPropertyName("obs_id")]
        public string ObsId { get; set; } = string.Empty;

        [JsonPropertyName("total_bytes")]
        public long TotalBytes { get; set; }

        [JsonPropertyName("downloaded_bytes")]
        public long DownloadedBytes { get; set; }

        [JsonPropertyName("progress_percent")]
        public double ProgressPercent { get; set; }

        [JsonPropertyName("status")]
        public string Status { get; set; } = string.Empty;

        [JsonPropertyName("total_files")]
        public int TotalFiles { get; set; }

        [JsonPropertyName("completed_files")]
        public int CompletedFiles { get; set; }

        [JsonPropertyName("started_at")]
        public string? StartedAt { get; set; }
    }

    // Response listing resumable jobs
    public class ResumableJobsResponse
    {
        [JsonPropertyName("jobs")]
        public List<ResumableJobSummary> Jobs { get; set; } = new();

        [JsonPropertyName("count")]
        public int Count { get; set; }
    }

    // Pause/resume response
    public class PauseResumeResponse
    {
        [JsonPropertyName("job_id")]
        public string JobId { get; set; } = string.Empty;

        [JsonPropertyName("status")]
        public string Status { get; set; } = string.Empty;

        [JsonPropertyName("message")]
        public string Message { get; set; } = string.Empty;
    }
}
