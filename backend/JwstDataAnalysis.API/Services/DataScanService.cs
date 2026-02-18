// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text.RegularExpressions;

using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services.Storage;

namespace JwstDataAnalysis.API.Services
{
    public sealed partial class DataScanService(
        IMongoDBService mongoDBService,
        IMastService mastService,
        IStorageProvider storageProvider,
        IThumbnailQueue thumbnailQueue,
        ILogger<DataScanService> logger) : IDataScanService
    {
        private readonly IMongoDBService mongoDBService = mongoDBService;
        private readonly IMastService mastService = mastService;
        private readonly IStorageProvider storageProvider = storageProvider;
        private readonly IThumbnailQueue thumbnailQueue = thumbnailQueue;
        private readonly ILogger<DataScanService> logger = logger;

        public async Task<BulkImportResponse> ScanAndImportAsync()
        {
            var importedFiles = new List<string>();
            var importedIds = new List<string>();
            var skippedFiles = new List<string>();
            var errors = new List<string>();
            var metadataRefreshed = 0;

            // Get all existing file paths in database to avoid duplicates
            var existingData = await mongoDBService.GetAsync();
            var existingPaths = existingData
                .Where(d => !string.IsNullOrEmpty(d.FilePath))
                .Select(d => d.FilePath)
                .ToHashSet();

            // Also track existing records by path for metadata refresh
            var existingByPath = existingData
                .Where(d => !string.IsNullOrEmpty(d.FilePath))
                .GroupBy(d => d.FilePath!)
                .ToDictionary(g => g.Key, g => g.First());

            // Discover FITS files — local filesystem scan or S3 prefix listing
            List<string> storageKeys;
            if (storageProvider.SupportsLocalPath)
            {
                var storageBasePath = storageProvider.ResolveLocalPath(string.Empty);
                var mastDir = Path.Combine(storageBasePath, "mast");
                if (!Directory.Exists(mastDir))
                {
                    return new BulkImportResponse
                    {
                        ImportedCount = 0,
                        SkippedCount = 0,
                        ErrorCount = 0,
                        Message = "MAST directory not found",
                    };
                }

                // Scan local filesystem and convert to storage keys
                var fitsFiles = Directory.GetFiles(mastDir, "*.fits", SearchOption.AllDirectories)
                    .Concat(Directory.GetFiles(mastDir, "*.fits.gz", SearchOption.AllDirectories))
                    .ToList();

                storageKeys = fitsFiles
                    .Select(f => Path.GetRelativePath(storageBasePath, f).Replace('\\', '/'))
                    .ToList();
            }
            else
            {
                // S3: list all keys under the mast/ prefix
                storageKeys = [];
                await foreach (var key in storageProvider.ListAsync("mast/"))
                {
                    if (key.EndsWith(".fits", StringComparison.OrdinalIgnoreCase) ||
                        key.EndsWith(".fits.gz", StringComparison.OrdinalIgnoreCase))
                    {
                        storageKeys.Add(key);
                    }
                }

                if (storageKeys.Count == 0)
                {
                    return new BulkImportResponse
                    {
                        ImportedCount = 0,
                        SkippedCount = 0,
                        ErrorCount = 0,
                        Message = "No FITS files found in S3 mast/ prefix",
                    };
                }
            }

            // Group storage keys by observation ID (parent directory segment)
            var filesByObservation = storageKeys
                .GroupBy(k =>
                {
                    // Storage key format: mast/{obsId}/{filename}
                    var parts = k.Split('/');
                    return parts.Length >= 3 ? parts[1] : "unknown";
                })
                .ToDictionary(g => g.Key, g => g.ToList());

            LogFoundFitsFiles(storageKeys.Count, filesByObservation.Count);

            // Process each observation group
            foreach (var (obsId, files) in filesByObservation)
            {
                // Try to fetch MAST metadata for this observation
                Dictionary<string, object?>? obsMeta = null;
                try
                {
                    var obsSearch = await mastService.SearchByObservationIdAsync(
                        new MastObservationSearchRequest { ObsId = obsId });
                    obsMeta = obsSearch?.Results.FirstOrDefault();

                    if (obsMeta != null)
                    {
                        LogFetchedMastMetadata(obsId);
                    }
                }
                catch (Exception ex)
                {
                    LogCouldNotFetchMastMetadata(ex, obsId);
                }

                // Process each file in the observation
                foreach (var storageKey in files)
                {
                    var fileName = storageKey.Split('/').Last();
                    try
                    {
                        // Check if file already exists in database
                        if (existingPaths.Contains(storageKey))
                        {
                            // File exists - check if it needs metadata refresh
                            if (existingByPath.TryGetValue(storageKey, out var existingRecord))
                            {
                                // Refresh metadata if: no ImageInfo, no TargetName, or unknown processing level
                                var needsRefresh = obsMeta != null && (
                                    existingRecord.ImageInfo?.TargetName == null ||
                                    string.IsNullOrEmpty(existingRecord.ProcessingLevel) ||
                                    existingRecord.ProcessingLevel == ProcessingLevels.Unknown);

                                // Fix visibility for records imported before IsPublic was set
                                var needsVisibilityFix = !existingRecord.IsPublic
                                    && string.IsNullOrEmpty(existingRecord.UserId);

                                if (needsRefresh || needsVisibilityFix)
                                {
                                    if (needsRefresh)
                                    {
                                        // Existing record lacks metadata - refresh it
                                        var fileInfo2 = ParseFileInfo(fileName, obsMeta);

                                        existingRecord.Metadata = BuildMastMetadata(obsMeta, obsId, fileInfo2.ProcessingLevel);
                                        existingRecord.ImageInfo = CreateImageMetadata(obsMeta);
                                        existingRecord.ProcessingLevel = fileInfo2.ProcessingLevel;
                                        existingRecord.ObservationBaseId = fileInfo2.ObservationBaseId ?? obsId;
                                        existingRecord.ExposureId = fileInfo2.ExposureId;
                                        existingRecord.IsViewable = fileInfo2.IsViewable;
                                        existingRecord.DataType = fileInfo2.DataType;
                                    }

                                    if (needsVisibilityFix)
                                    {
                                        existingRecord.IsPublic = true;
                                    }

                                    await mongoDBService.UpdateAsync(existingRecord.Id, existingRecord);
                                    if (needsRefresh)
                                    {
                                        metadataRefreshed++;
                                    }
                                }
                            }

                            skippedFiles.Add(fileName);
                            continue;
                        }

                        // Parse file info using MAST metadata
                        var (dataType, processingLevel, observationBaseId, exposureId, isViewable) =
                            ParseFileInfo(fileName, obsMeta);

                        // Get file size via storage provider (HEAD request for S3, FileInfo for local)
                        var fileSize = await storageProvider.GetSizeAsync(storageKey);

                        // Build tags
                        var tags = new List<string> { "mast-import", obsId };
                        if (storageKey.Contains("nircam", StringComparison.OrdinalIgnoreCase))
                        {
                            tags.Add("NIRCam");
                        }

                        if (storageKey.Contains("miri", StringComparison.OrdinalIgnoreCase))
                        {
                            tags.Add("MIRI");
                        }

                        if (storageKey.Contains("nirspec", StringComparison.OrdinalIgnoreCase))
                        {
                            tags.Add("NIRSpec");
                        }

                        if (storageKey.Contains("niriss", StringComparison.OrdinalIgnoreCase))
                        {
                            tags.Add("NIRISS");
                        }

                        var jwstData = new JwstDataModel
                        {
                            FileName = fileName,
                            FilePath = storageKey,
                            FileSize = fileSize,
                            FileFormat = FileFormats.FITS,
                            DataType = dataType,
                            ProcessingLevel = processingLevel,
                            ObservationBaseId = observationBaseId ?? obsId,
                            ExposureId = exposureId,
                            IsViewable = isViewable,
                            IsPublic = true,
                            Description = $"Imported from MAST - Observation: {obsId} - Level: {processingLevel}",
                            UploadDate = DateTime.UtcNow,
                            ProcessingStatus = ProcessingStatuses.Pending,
                            Tags = tags,
                            Metadata = BuildMastMetadata(obsMeta, obsId, processingLevel),
                            ImageInfo = CreateImageMetadata(obsMeta),
                        };

                        await mongoDBService.CreateAsync(jwstData);
                        importedFiles.Add(fileName);
                        importedIds.Add(jwstData.Id);
                    }
                    catch (Exception ex)
                    {
                        errors.Add($"{fileName}: {ex.Message}");
                    }
                }
            }

            var message = $"Imported {importedFiles.Count} files";
            if (metadataRefreshed > 0)
            {
                message += $", refreshed metadata for {metadataRefreshed} existing files";
            }

            LogBulkImportCompleted(importedFiles.Count, skippedFiles.Count, metadataRefreshed, errors.Count);

            // Enqueue thumbnail generation for newly imported files
            if (importedIds.Count > 0)
            {
                thumbnailQueue.EnqueueBatch(importedIds);
            }

            return new BulkImportResponse
            {
                ImportedCount = importedFiles.Count,
                SkippedCount = skippedFiles.Count,
                ErrorCount = errors.Count,
                ImportedFiles = [.. importedFiles.Take(50)],
                SkippedFiles = [.. skippedFiles.Take(20)],
                Errors = [.. errors.Take(10)],
                Message = message,
            };
        }

        /// <summary>
        /// Parse JWST filename to extract data type, processing level, and lineage info.
        /// </summary>
        internal static (string DataType, string ProcessingLevel, string? ObservationBaseId, string? ExposureId, bool IsViewable)
            ParseFileInfo(string fileName, Dictionary<string, object?>? obsMeta)
        {
            var fileNameLower = fileName.ToLowerInvariant();
            var dataType = DataTypes.Image;
            var processingLevel = ProcessingLevels.Unknown;
            string? observationBaseId = null;
            string? exposureId = null;
            var isViewable = true;

            // Determine processing level from filename suffix
            if (fileNameLower.Contains("_uncal.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level1;
                dataType = DataTypes.Raw;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_rate.fits", StringComparison.Ordinal) || fileNameLower.Contains("_rateints.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level2a;
                dataType = DataTypes.Sensor;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_cal.fits", StringComparison.Ordinal) || fileNameLower.Contains("_calints.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level2b;
                dataType = DataTypes.Image;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_i2d.fits", StringComparison.Ordinal) || fileNameLower.Contains("_s2d.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level3;
                dataType = DataTypes.Image;
                isViewable = true;
            }
            else if (fileNameLower.Contains("_crf.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level2b;
                dataType = DataTypes.Image;
                isViewable = true;
            }

            // Table files - not viewable as images
            else if (fileNameLower.Contains("_asn.json", StringComparison.Ordinal) || fileNameLower.Contains("_asn.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Unknown;
                dataType = DataTypes.Metadata;
                isViewable = false;
            }
            else if (fileNameLower.Contains("_x1d.fits", StringComparison.Ordinal) || fileNameLower.Contains("_x1dints.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level3;
                dataType = DataTypes.Spectral;
                isViewable = false;
            }
            else if (fileNameLower.Contains("_cat.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Level3;
                dataType = DataTypes.Metadata;
                isViewable = false;
            }
            else if (fileNameLower.Contains("_pool.fits", StringComparison.Ordinal))
            {
                processingLevel = ProcessingLevels.Unknown;
                dataType = DataTypes.Metadata;
                isViewable = false;
            }

            // Parse JWST filename pattern: jw{program}{obs}{visit}_{exposure}_{detector}_{suffix}.fits
            var match = JwstFileNameRegex().Match(fileName);
            if (match.Success)
            {
                var program = match.Groups[1].Value;
                var obs = match.Groups[2].Value;
                var visit = match.Groups[3].Value;
                var exposure = match.Groups[4].Value;

                observationBaseId = $"jw{program}{obs}{visit}";
                exposureId = $"jw{program}{obs}{visit}_{exposure}";
            }

            return (dataType, processingLevel, observationBaseId, exposureId, isViewable);
        }

        /// <summary>
        /// Build metadata dictionary with all MAST fields prefixed with 'mast_'.
        /// </summary>
        internal static Dictionary<string, object> BuildMastMetadata(
            Dictionary<string, object?>? obsMeta,
            string obsId,
            string processingLevel)
        {
            var metadata = new Dictionary<string, object>
            {
                { "mast_obs_id", obsId },
                { "source", "MAST" },
                { "import_date", DateTime.UtcNow.ToString("O") },
                { "processing_level", processingLevel },
            };

            if (obsMeta != null)
            {
                foreach (var (key, value) in obsMeta)
                {
                    if (value != null)
                    {
                        var mastKey = key.StartsWith("mast_", StringComparison.Ordinal) ? key : $"mast_{key}";

                        // Convert JsonElement to basic types
                        if (value is System.Text.Json.JsonElement jsonElement)
                        {
                            metadata[mastKey] = ConvertJsonElement(jsonElement);
                        }
                        else
                        {
                            metadata[mastKey] = value;
                        }
                    }
                }
            }

            return metadata;
        }

        internal static object ConvertJsonElement(System.Text.Json.JsonElement element)
        {
            return element.ValueKind switch
            {
                System.Text.Json.JsonValueKind.String => element.GetString() ?? string.Empty,
                System.Text.Json.JsonValueKind.Number => element.TryGetInt64(out var l) ? l : element.GetDouble(),
                System.Text.Json.JsonValueKind.True => true,
                System.Text.Json.JsonValueKind.False => false,
                System.Text.Json.JsonValueKind.Null => string.Empty,
                _ => element.ToString(),
            };
        }

        /// <summary>
        /// Create ImageMetadata from MAST observation data.
        /// </summary>
        internal static ImageMetadata? CreateImageMetadata(Dictionary<string, object?>? obsMeta)
        {
            if (obsMeta == null)
            {
                return null;
            }

            var metadata = new ImageMetadata();

            if (obsMeta.TryGetValue("target_name", out var targetName) && targetName != null)
            {
                metadata.TargetName = targetName.ToString();
            }

            if (obsMeta.TryGetValue("instrument_name", out var instrument) && instrument != null)
            {
                metadata.Instrument = instrument.ToString();
            }

            if (obsMeta.TryGetValue("filters", out var filter) && filter != null)
            {
                metadata.Filter = filter.ToString();
            }

            if (obsMeta.TryGetValue("t_exptime", out var expTime) && expTime != null)
            {
                if (double.TryParse(expTime.ToString(), out var expTimeValue))
                {
                    metadata.ExposureTime = expTimeValue;
                }
            }

            if (obsMeta.TryGetValue("wavelength_region", out var wavelengthRegion) && wavelengthRegion != null)
            {
                metadata.WavelengthRange = wavelengthRegion.ToString();
            }

            if (obsMeta.TryGetValue("calib_level", out var calibLevel) && calibLevel != null)
            {
                if (int.TryParse(calibLevel.ToString(), out var calibLevelValue))
                {
                    metadata.CalibrationLevel = calibLevelValue;
                }
            }

            if (obsMeta.TryGetValue("proposal_id", out var proposalId) && proposalId != null)
            {
                metadata.ProposalId = proposalId.ToString();
            }

            if (obsMeta.TryGetValue("proposal_pi", out var proposalPi) && proposalPi != null)
            {
                metadata.ProposalPi = proposalPi.ToString();
            }

            if (obsMeta.TryGetValue("obs_title", out var obsTitle) && obsTitle != null)
            {
                metadata.ObservationTitle = obsTitle.ToString();
            }

            // Convert MJD to DateTime
            DateTime? observationDate = null;
            var dateFields = new[] { "t_min", "t_max", "t_obs_release" };
            foreach (var dateField in dateFields)
            {
                if (obsMeta.TryGetValue(dateField, out var dateValue) && dateValue != null)
                {
                    if (double.TryParse(dateValue.ToString(), out var mjd) && mjd > 0)
                    {
                        observationDate = new DateTime(1858, 11, 17, 0, 0, 0, DateTimeKind.Utc).AddDays(mjd);
                        break;
                    }
                }
            }

            if (observationDate.HasValue)
            {
                metadata.ObservationDate = observationDate.Value;
            }

            metadata.CoordinateSystem = "ICRS";

            if (obsMeta.TryGetValue("s_ra", out var ra) && ra != null &&
                obsMeta.TryGetValue("s_dec", out var dec) && dec != null)
            {
                if (double.TryParse(ra.ToString(), out var raValue) &&
                    double.TryParse(dec.ToString(), out var decValue))
                {
                    metadata.WCS = new Dictionary<string, double>
                    {
                        { "CRVAL1", raValue },
                        { "CRVAL2", decValue },
                    };
                }
            }

            return metadata;
        }

        [GeneratedRegex(@"jw(\d{5})(\d{3})(\d{3})_(\d{5})_(\d{5})_([a-z0-9]+)", RegexOptions.IgnoreCase, "en-US")]
        private static partial Regex JwstFileNameRegex();

        [LoggerMessage(EventId = 3701, Level = LogLevel.Information,
            Message = "Found {FileCount} FITS files in {ObsCount} observations")]
        private partial void LogFoundFitsFiles(int fileCount, int obsCount);

        [LoggerMessage(EventId = 3702, Level = LogLevel.Debug,
            Message = "Fetched MAST metadata for observation {ObsId}")]
        private partial void LogFetchedMastMetadata(string obsId);

        [LoggerMessage(EventId = 3703, Level = LogLevel.Warning,
            Message = "Could not fetch MAST metadata for {ObsId}, using basic metadata")]
        private partial void LogCouldNotFetchMastMetadata(Exception ex, string obsId);

        [LoggerMessage(EventId = 3704, Level = LogLevel.Information,
            Message = "Scan import completed: {Imported} imported, {Skipped} skipped, {Refreshed} refreshed, {Errors} errors")]
        private partial void LogBulkImportCompleted(int imported, int skipped, int refreshed, int errors);
    }
}
