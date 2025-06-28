using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System.ComponentModel.DataAnnotations;

namespace JwstDataAnalysis.API.Models
{
    public class JwstDataModel
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string Id { get; set; } = string.Empty;

        [Required]
        public string FileName { get; set; } = string.Empty;

        [Required]
        public string DataType { get; set; } = string.Empty; // "image", "sensor", "spectral", "metadata"

        [Required]
        public DateTime UploadDate { get; set; } = DateTime.UtcNow;

        public string? Description { get; set; }

        public Dictionary<string, object> Metadata { get; set; } = new();

        public string? FilePath { get; set; }

        public long FileSize { get; set; }

        public string? ProcessingStatus { get; set; } = "pending"; // "pending", "processing", "completed", "failed"

        public List<string> Tags { get; set; } = new();

        public string? UserId { get; set; }

        // For image data
        public ImageMetadata? ImageInfo { get; set; }

        // For sensor/spectral data
        public SensorMetadata? SensorInfo { get; set; }

        // Processing results
        public List<ProcessingResult> ProcessingResults { get; set; } = new();
    }

    public class ImageMetadata
    {
        public int Width { get; set; }
        public int Height { get; set; }
        public string? Format { get; set; }
        public int? BitDepth { get; set; }
        public List<string>? Channels { get; set; }
        public Dictionary<string, double>? Statistics { get; set; } // min, max, mean, std
    }

    public class SensorMetadata
    {
        public string? Instrument { get; set; }
        public string? Wavelength { get; set; }
        public int? DataPoints { get; set; }
        public string? Units { get; set; }
        public DateTime? ObservationDate { get; set; }
        public Dictionary<string, object>? InstrumentSettings { get; set; }
    }

    public class ProcessingResult
    {
        public string Id { get; set; } = ObjectId.GenerateNewId().ToString();
        public string Algorithm { get; set; } = string.Empty;
        public DateTime ProcessedDate { get; set; } = DateTime.UtcNow;
        public string Status { get; set; } = string.Empty; // "success", "failed"
        public Dictionary<string, object> Parameters { get; set; } = new();
        public Dictionary<string, object> Results { get; set; } = new();
        public string? OutputFilePath { get; set; }
        public string? ErrorMessage { get; set; }
    }
} 