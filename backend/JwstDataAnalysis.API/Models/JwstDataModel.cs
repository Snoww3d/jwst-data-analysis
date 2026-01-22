using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace JwstDataAnalysis.API.Models
{
    public class JwstDataModel
    {
        [BsonId]
        [BsonRepresentation(BsonType.ObjectId)]
        public string Id { get; set; } = string.Empty;

        [Required]
        [StringLength(255)]
        public string FileName { get; set; } = string.Empty;

        [Required]
        [StringLength(50)]
        public string DataType { get; set; } = string.Empty; // "image", "sensor", "spectral", "metadata", "calibration", "raw"

        [Required]
        public DateTime UploadDate { get; set; } = DateTime.UtcNow;

        [StringLength(1000)]
        public string? Description { get; set; }

        public Dictionary<string, object> Metadata { get; set; } = new();

        public string? FilePath { get; set; }

        public long FileSize { get; set; }

        [StringLength(20)]
        public string? ProcessingStatus { get; set; } = "pending"; // "pending", "processing", "completed", "failed", "cancelled"

        public List<string> Tags { get; set; } = new();

        public string? UserId { get; set; }

        // Enhanced metadata for different data types
        public ImageMetadata? ImageInfo { get; set; }
        public SensorMetadata? SensorInfo { get; set; }
        public SpectralMetadata? SpectralInfo { get; set; }
        public CalibrationMetadata? CalibrationInfo { get; set; }

        // Processing results
        public List<ProcessingResult> ProcessingResults { get; set; } = new();

        // File format and validation
        public string? FileFormat { get; set; } // "fits", "csv", "json", "hdf5", etc.
        public string? Checksum { get; set; }
        public bool IsValidated { get; set; } = false;
        public string? ValidationError { get; set; }

        // Access control and sharing
        public bool IsPublic { get; set; } = false;
        public List<string> SharedWith { get; set; } = new();
        public DateTime? LastAccessed { get; set; }

        // Archive functionality
        public bool IsArchived { get; set; } = false;
        public DateTime? ArchivedDate { get; set; }

        // Version control
        public int Version { get; set; } = 1;
        public string? ParentId { get; set; } // For derived data
        public List<string> DerivedFrom { get; set; } = new(); // IDs of source data

        // JWST Processing Level Tracking
        public string? ProcessingLevel { get; set; } // "L1", "L2a", "L2b", "L3"
        public string? ObservationBaseId { get; set; } // Groups related files (e.g., "jw02733-o001_t001_nircam")
        public string? ExposureId { get; set; } // Finer-grained lineage (e.g., "jw02733001001_02101_00001")

        // File viewability (image vs table/catalog)
        public bool IsViewable { get; set; } = true; // true for image files, false for tables/catalogs
    }

    public class ImageMetadata
    {
        public int Width { get; set; }
        public int Height { get; set; }
        public string? Format { get; set; }
        public int? BitDepth { get; set; }
        public List<string>? Channels { get; set; }
        public Dictionary<string, double>? Statistics { get; set; } // min, max, mean, std, median
        
        // Astronomical specific fields
        public string? TargetName { get; set; } // Astronomical object name (e.g., "NGC-6804")
        public string? Wavelength { get; set; }
        public string? Filter { get; set; }
        public string? Instrument { get; set; }
        public DateTime? ObservationDate { get; set; }
        public double? ExposureTime { get; set; }
        public string? CoordinateSystem { get; set; }
        public Dictionary<string, double>? WCS { get; set; } // World Coordinate System
        public string? Units { get; set; } // "adu", "mjy/sr", "erg/s/cm2/angstrom", etc.
    }

    public class SensorMetadata
    {
        public string? Instrument { get; set; }
        public string? Wavelength { get; set; }
        public int? DataPoints { get; set; }
        public string? Units { get; set; }
        public DateTime? ObservationDate { get; set; }
        public Dictionary<string, object>? InstrumentSettings { get; set; }
        
        // Enhanced sensor fields
        public double? SamplingRate { get; set; }
        public double? IntegrationTime { get; set; }
        public string? DetectorType { get; set; }
        public List<string>? CalibrationFiles { get; set; }
        public Dictionary<string, double>? NoiseCharacteristics { get; set; }
    }

    public class SpectralMetadata
    {
        public string? Instrument { get; set; }
        public string? Grating { get; set; }
        public double? WavelengthStart { get; set; }
        public double? WavelengthEnd { get; set; }
        public double? SpectralResolution { get; set; }
        public int? SpectralPoints { get; set; }
        public string? Units { get; set; }
        public DateTime? ObservationDate { get; set; }
        
        // Spectral analysis fields
        public List<SpectralFeature>? Features { get; set; }
        public Dictionary<string, double>? LineMeasurements { get; set; }
        public string? ContinuumType { get; set; }
        public double? SignalToNoise { get; set; }
    }

    public class CalibrationMetadata
    {
        public string? CalibrationType { get; set; } // "flat", "dark", "bias", "wavelength", "flux"
        public string? ReferenceStandard { get; set; }
        public DateTime? CalibrationDate { get; set; }
        public string? CalibrationMethod { get; set; }
        public double? Uncertainty { get; set; }
        public Dictionary<string, object>? CalibrationParameters { get; set; }
        public bool IsValid { get; set; } = true;
        public DateTime? ExpiryDate { get; set; }
    }

    public class SpectralFeature
    {
        public string Id { get; set; } = ObjectId.GenerateNewId().ToString();
        public double Wavelength { get; set; }
        public double? Flux { get; set; }
        public double? EquivalentWidth { get; set; }
        public string? FeatureType { get; set; } // "emission", "absorption", "continuum"
        public string? Identification { get; set; } // Chemical/element identification
        public double? Confidence { get; set; }
        public Dictionary<string, object>? Properties { get; set; }
    }

    public class ProcessingResult
    {
        public string Id { get; set; } = ObjectId.GenerateNewId().ToString();
        public string Algorithm { get; set; } = string.Empty;
        public DateTime ProcessedDate { get; set; } = DateTime.UtcNow;
        public string Status { get; set; } = string.Empty; // "success", "failed", "partial"
        public Dictionary<string, object> Parameters { get; set; } = new();
        public Dictionary<string, object> Results { get; set; } = new();
        public string? OutputFilePath { get; set; }
        public string? ErrorMessage { get; set; }
        
        // Enhanced processing metadata
        public double? ProcessingTime { get; set; } // in seconds
        public string? ProcessingEngine { get; set; } // "python", "idl", "custom"
        public string? AlgorithmVersion { get; set; }
        public Dictionary<string, object>? QualityMetrics { get; set; }
        public List<string>? Warnings { get; set; }
        public bool IsReproducible { get; set; } = true;
    }

    // Enums for better type safety
    public static class DataTypes
    {
        public const string Image = "image";
        public const string Sensor = "sensor";
        public const string Spectral = "spectral";
        public const string Metadata = "metadata";
        public const string Calibration = "calibration";
        public const string Raw = "raw";
        public const string Processed = "processed";
    }

    public static class ProcessingStatuses
    {
        public const string Pending = "pending";
        public const string Processing = "processing";
        public const string Completed = "completed";
        public const string Failed = "failed";
        public const string Cancelled = "cancelled";
    }

    public static class FileFormats
    {
        public const string FITS = "fits";
        public const string CSV = "csv";
        public const string JSON = "json";
        public const string HDF5 = "hdf5";
        public const string ASCII = "ascii";
        public const string Binary = "binary";
    }

    public static class ProcessingLevels
    {
        public const string Level1 = "L1";      // _uncal - raw detector readout
        public const string Level2a = "L2a";    // _rate, _rateints - count rate images
        public const string Level2b = "L2b";    // _cal, _crf - calibrated exposures
        public const string Level3 = "L3";      // _i2d, _s2d, _x1d - combined/mosaicked products
        public const string Unknown = "unknown";

        public static readonly Dictionary<string, string> SuffixToLevel = new()
        {
            { "_uncal", Level1 },
            { "_rate", Level2a },
            { "_rateints", Level2a },
            { "_cal", Level2b },
            { "_crf", Level2b },
            { "_i2d", Level3 },
            { "_s2d", Level3 },
            { "_x1d", Level3 }
        };
    }
} 