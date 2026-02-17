// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Globalization;
using System.Text;
using System.Text.Json;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services.Storage;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class MosaicService : IMosaicService
    {
        private readonly HttpClient httpClient;
        private readonly IMongoDBService mongoDBService;
        private readonly IStorageProvider storageProvider;
        private readonly IThumbnailQueue thumbnailQueue;
        private readonly ILogger<MosaicService> logger;
        private readonly string processingEngineUrl;
        private readonly JsonSerializerOptions jsonOptions;

        public MosaicService(
            HttpClient httpClient,
            IMongoDBService mongoDBService,
            IStorageProvider storageProvider,
            IThumbnailQueue thumbnailQueue,
            ILogger<MosaicService> logger,
            IConfiguration configuration)
        {
            this.httpClient = httpClient;
            this.mongoDBService = mongoDBService;
            this.storageProvider = storageProvider;
            this.thumbnailQueue = thumbnailQueue;
            this.logger = logger;
            processingEngineUrl = configuration["ProcessingEngine:BaseUrl"]
                ?? "http://localhost:8000";

            jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
                PropertyNameCaseInsensitive = true,
            };
        }

        /// <inheritdoc/>
        public async Task<byte[]> GenerateMosaicAsync(MosaicRequestDto request)
        {
            LogGeneratingMosaic(request.Files.Count, request.CombineMethod);

            // Resolve all data IDs to file paths
            var processingFiles = new List<ProcessingMosaicFileConfig>();
            foreach (var fileConfig in request.Files)
            {
                var filePath = await ResolveDataIdToFilePathAsync(fileConfig.DataId);
                processingFiles.Add(CreateProcessingFileConfig(fileConfig, filePath));
            }

            // Build processing engine request
            var processingRequest = new ProcessingMosaicRequest
            {
                Files = processingFiles,
                OutputFormat = request.OutputFormat,
                Quality = request.Quality,
                Width = request.Width,
                Height = request.Height,
                CombineMethod = request.CombineMethod,
                Cmap = request.Cmap,
            };

            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            LogCallingProcessingEngine(json);

            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/mosaic/generate",
                content);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                LogProcessingEngineError(response.StatusCode, errorBody);
                throw new HttpRequestException(
                    $"Processing engine error: {response.StatusCode} - {errorBody}",
                    null,
                    response.StatusCode);
            }

            var imageBytes = await response.Content.ReadAsByteArrayAsync();
            LogMosaicGenerated(imageBytes.Length, request.OutputFormat);

            return imageBytes;
        }

        /// <inheritdoc/>
        public async Task<SavedMosaicResponseDto> GenerateAndSaveMosaicAsync(
            MosaicRequestDto request,
            string? userId,
            bool isAuthenticated,
            bool isAdmin)
        {
            LogGeneratingMosaic(request.Files.Count, request.CombineMethod);

            var processingFiles = new List<ProcessingMosaicFileConfig>();
            var sourceRecordsById = new Dictionary<string, JwstDataModel>(StringComparer.Ordinal);
            var sourceIds = request.Files
                .Select(f => f.DataId)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.Ordinal)
                .ToList();

            if (sourceIds.Count == 0)
            {
                throw new InvalidOperationException("No valid source data IDs were provided");
            }

            foreach (var fileConfig in request.Files)
            {
                var sourceData = await ResolveDataIdToRecordAsync(fileConfig.DataId);
                if (!CanAccessData(sourceData, userId, isAuthenticated, isAdmin))
                {
                    throw new UnauthorizedAccessException($"Access denied for data ID {fileConfig.DataId}");
                }

                sourceRecordsById[sourceData.Id] = sourceData;
                var relativePath = StorageKeyHelper.ToRelativeKey(sourceData.FilePath!);
                processingFiles.Add(CreateProcessingFileConfig(fileConfig, relativePath));
            }

            // FITS persistence endpoint always uses native FITS output for large mosaics.
            var processingRequest = new ProcessingMosaicRequest
            {
                Files = processingFiles,
                OutputFormat = "fits",
                Quality = 95,
                Width = null,
                Height = null,
                CombineMethod = request.CombineMethod,
                Cmap = request.Cmap,
            };

            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            LogCallingProcessingEngine(json);

            using var requestMessage = new HttpRequestMessage(
                HttpMethod.Post,
                $"{processingEngineUrl}/mosaic/generate")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
            using var response = await httpClient.SendAsync(
                requestMessage,
                HttpCompletionOption.ResponseHeadersRead);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                LogProcessingEngineError(response.StatusCode, errorBody);
                throw new HttpRequestException(
                    $"Processing engine error: {response.StatusCode} - {errorBody}",
                    null,
                    response.StatusCode);
            }

            var fileName = BuildGeneratedMosaicFileName();
            var storageKey = $"mosaic/{fileName}";

            // Write the response stream to storage
            await using (var responseStream = await response.Content.ReadAsStreamAsync())
            {
                await storageProvider.WriteAsync(storageKey, responseStream);
            }

            // Verify the written file exists and has content
            if (!await storageProvider.ExistsAsync(storageKey))
            {
                throw new InvalidOperationException("Generated mosaic FITS file was empty");
            }

            // Verify the file has content and get its size
            var mosaicFileSize = await storageProvider.GetSizeAsync(storageKey);
            if (mosaicFileSize == 0)
            {
                await storageProvider.DeleteAsync(storageKey);
                throw new InvalidOperationException("Generated mosaic FITS file was empty");
            }

            var sourceRecords = sourceRecordsById.Values.ToList();
            var generatedAt = DateTime.UtcNow;
            var observationBaseId = GetSingleDistinctValue(
                sourceRecords.Select(source => source.ObservationBaseId))
                ?? GetSingleDistinctValue(
                    sourceRecords.Select(source => GetStringMetadataValue(source.Metadata, "mast_obs_id")));

            var model = new JwstDataModel
            {
                FileName = fileName,
                DataType = DataTypes.Image,
                Description = $"Generated WCS mosaic from {request.Files.Count} source FITS files (combine={request.CombineMethod})",
                Metadata = BuildGeneratedMosaicMetadata(request, sourceRecords, sourceIds, generatedAt),
                Tags = ["mosaic-generated", "mosaic", "generated", "fits"],
                FilePath = storageKey,
                FileSize = mosaicFileSize,
                UploadDate = generatedAt,
                ProcessingStatus = ProcessingStatuses.Completed,
                FileFormat = FileFormats.FITS,
                IsValidated = true,
                UserId = isAuthenticated ? userId : null,
                IsPublic = sourceRecords.All(s => s.IsPublic),
                ProcessingLevel = ProcessingLevels.Level3,
                ObservationBaseId = observationBaseId,
                ParentId = sourceIds[0],
                DerivedFrom = sourceIds,
                IsViewable = true,
                ImageInfo = BuildGeneratedMosaicImageInfo(sourceRecords),
            };

            await mongoDBService.CreateAsync(model);
            thumbnailQueue.EnqueueBatch([model.Id!]);

            LogSavedMosaicFits(model.Id, model.FileName, model.FileSize);

            return new SavedMosaicResponseDto
            {
                DataId = model.Id,
                FileName = model.FileName,
                FileSize = model.FileSize,
                FileFormat = model.FileFormat ?? FileFormats.FITS,
                ProcessingLevel = model.ProcessingLevel ?? ProcessingLevels.Level3,
                DerivedFrom = model.DerivedFrom,
            };
        }

        /// <inheritdoc/>
        public async Task<FootprintResponseDto> GetFootprintsAsync(FootprintRequestDto request)
        {
            LogComputingFootprints(request.DataIds.Count);

            // Resolve data IDs to file paths
            var filePaths = new List<string>();
            foreach (var dataId in request.DataIds)
            {
                var filePath = await ResolveDataIdToFilePathAsync(dataId);
                filePaths.Add(filePath);
            }

            // Build processing engine request
            var processingRequest = new ProcessingFootprintRequest
            {
                FilePaths = filePaths,
            };

            var json = JsonSerializer.Serialize(processingRequest, jsonOptions);
            LogCallingFootprintEndpoint(json);

            var content = new StringContent(json, Encoding.UTF8, "application/json");
            var response = await httpClient.PostAsync(
                $"{processingEngineUrl}/mosaic/footprint",
                content);

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                LogProcessingEngineError(response.StatusCode, errorBody);
                throw new HttpRequestException(
                    $"Processing engine error: {response.StatusCode} - {errorBody}",
                    null,
                    response.StatusCode);
            }

            var responseBody = await response.Content.ReadAsStringAsync();
            var footprintResponse = JsonSerializer.Deserialize<FootprintResponseDto>(
                responseBody, jsonOptions)
                ?? throw new InvalidOperationException("Failed to deserialize footprint response");

            LogFootprintsComputed(footprintResponse.NFiles);

            return footprintResponse;
        }

        private static bool CanAccessData(
            JwstDataModel data,
            string? userId,
            bool isAuthenticated,
            bool isAdmin)
        {
            if (isAdmin)
            {
                return true;
            }

            if (!isAuthenticated)
            {
                return data.IsPublic;
            }

            return data.IsPublic
                || data.UserId == userId
                || (userId != null && data.SharedWith.Contains(userId));
        }

        private static ProcessingMosaicFileConfig CreateProcessingFileConfig(
            MosaicFileConfigDto fileConfig,
            string filePath)
        {
            return new ProcessingMosaicFileConfig
            {
                FilePath = filePath,
                Stretch = fileConfig.Stretch,
                BlackPoint = fileConfig.BlackPoint,
                WhitePoint = fileConfig.WhitePoint,
                Gamma = fileConfig.Gamma,
                AsinhA = fileConfig.AsinhA,
            };
        }

        private static Dictionary<string, object> BuildGeneratedMosaicMetadata(
            MosaicRequestDto request,
            List<JwstDataModel> sourceRecords,
            List<string> sourceIds,
            DateTime generatedAt)
        {
            var metadata = new Dictionary<string, object>
            {
                { "source", "mosaic-generator" },
                { "generated_at", generatedAt.ToString("O", CultureInfo.InvariantCulture) },
                { "combine_method", request.CombineMethod },
                { "source_file_count", request.Files.Count },
                { "source_unique_count", sourceRecords.Count },
                { "source_ids", sourceIds },
                { "fits_metadata_embedded", true },
                { "fits_source_metadata_extension", "SRCMETA" },
            };

            if (!string.IsNullOrWhiteSpace(request.Cmap))
            {
                metadata["preview_cmap"] = request.Cmap;
            }

            var sourceFileNames = sourceRecords
                .Select(source => source.FileName)
                .Where(fileName => !string.IsNullOrWhiteSpace(fileName))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(fileName => fileName, StringComparer.OrdinalIgnoreCase)
                .ToList();
            AddMetadataValues(metadata, "source_file_names", sourceFileNames);

            var targetNames = GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
            {
                source.ImageInfo?.TargetName,
                GetStringMetadataValue(source.Metadata, "mast_target_name"),
                GetStringMetadataValue(source.Metadata, "target_name"),
            }));
            AddMetadataValues(metadata, "source_targets", targetNames);

            var instruments = GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
            {
                source.ImageInfo?.Instrument,
                GetStringMetadataValue(source.Metadata, "mast_instrument_name"),
                GetStringMetadataValue(source.Metadata, "instrument_name"),
            }));
            AddMetadataValues(metadata, "source_instruments", instruments);

            var filters = GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
            {
                source.ImageInfo?.Filter,
                GetStringMetadataValue(source.Metadata, "mast_filters"),
                GetStringMetadataValue(source.Metadata, "filters"),
            }));
            AddMetadataValues(metadata, "source_filters", filters);

            var proposalIds = GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
            {
                source.ImageInfo?.ProposalId,
                GetStringMetadataValue(source.Metadata, "mast_proposal_id"),
                GetStringMetadataValue(source.Metadata, "proposal_id"),
            }));
            AddMetadataValues(metadata, "source_proposal_ids", proposalIds);

            var proposalPis = GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
            {
                source.ImageInfo?.ProposalPi,
                GetStringMetadataValue(source.Metadata, "mast_proposal_pi"),
                GetStringMetadataValue(source.Metadata, "proposal_pi"),
            }));
            AddMetadataValues(metadata, "source_proposal_pis", proposalPis);

            var observationIds = GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
            {
                source.ObservationBaseId,
                GetStringMetadataValue(source.Metadata, "mast_obs_id"),
            }));
            AddMetadataValues(metadata, "source_observation_ids", observationIds);

            var processingLevels = GetDistinctNonEmptyValues(
                sourceRecords.Select(source => source.ProcessingLevel));
            AddMetadataValues(metadata, "source_processing_levels", processingLevels);

            var sourceTags = sourceRecords
                .SelectMany(source => source.Tags)
                .Where(tag => !string.IsNullOrWhiteSpace(tag))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(tag => tag, StringComparer.OrdinalIgnoreCase)
                .ToList();
            AddMetadataValues(metadata, "source_tags", sourceTags);

            var sourceExposureTimes = sourceRecords
                .Select(source => source.ImageInfo?.ExposureTime)
                .Where(exposure => exposure.HasValue && exposure.Value > 0)
                .Select(exposure => exposure!.Value)
                .ToList();
            if (sourceExposureTimes.Count > 0)
            {
                metadata["source_total_exposure_seconds"] = sourceExposureTimes.Sum();
            }

            var sourceSummaries = new List<Dictionary<string, object>>();
            foreach (var source in sourceRecords.OrderBy(record => record.FileName, StringComparer.OrdinalIgnoreCase))
            {
                var summary = new Dictionary<string, object>
                {
                    { "id", source.Id },
                    { "file_name", source.FileName },
                };

                if (!string.IsNullOrWhiteSpace(source.FileFormat))
                {
                    summary["file_format"] = source.FileFormat;
                }

                if (!string.IsNullOrWhiteSpace(source.ProcessingLevel))
                {
                    summary["processing_level"] = source.ProcessingLevel;
                }

                if (!string.IsNullOrWhiteSpace(source.ObservationBaseId))
                {
                    summary["observation_base_id"] = source.ObservationBaseId;
                }

                if (!string.IsNullOrWhiteSpace(source.ImageInfo?.TargetName))
                {
                    summary["target_name"] = source.ImageInfo.TargetName!;
                }

                if (!string.IsNullOrWhiteSpace(source.ImageInfo?.Instrument))
                {
                    summary["instrument"] = source.ImageInfo.Instrument!;
                }

                if (!string.IsNullOrWhiteSpace(source.ImageInfo?.Filter))
                {
                    summary["filter"] = source.ImageInfo.Filter!;
                }

                if (source.ImageInfo?.ExposureTime is double exposureTime && exposureTime > 0)
                {
                    summary["exposure_time"] = exposureTime;
                }

                sourceSummaries.Add(summary);
            }

            if (sourceSummaries.Count > 0)
            {
                metadata["source_records"] = sourceSummaries;
            }

            return metadata;
        }

        private static ImageMetadata BuildGeneratedMosaicImageInfo(List<JwstDataModel> sourceRecords)
        {
            var metadata = new ImageMetadata
            {
                Format = FileFormats.FITS,
            };

            metadata.TargetName = FormatSingleOrJoinedValues(
                GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
                {
                    source.ImageInfo?.TargetName,
                    GetStringMetadataValue(source.Metadata, "mast_target_name"),
                    GetStringMetadataValue(source.Metadata, "target_name"),
                })));
            metadata.Instrument = FormatSingleOrJoinedValues(
                GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
                {
                    source.ImageInfo?.Instrument,
                    GetStringMetadataValue(source.Metadata, "mast_instrument_name"),
                    GetStringMetadataValue(source.Metadata, "instrument_name"),
                })));
            metadata.Filter = FormatSingleOrJoinedValues(
                GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
                {
                    source.ImageInfo?.Filter,
                    GetStringMetadataValue(source.Metadata, "mast_filters"),
                    GetStringMetadataValue(source.Metadata, "filters"),
                })));
            metadata.Wavelength = FormatSingleOrJoinedValues(
                GetDistinctNonEmptyValues(sourceRecords.Select(source => source.ImageInfo?.Wavelength)));
            metadata.WavelengthRange = FormatSingleOrJoinedValues(
                GetDistinctNonEmptyValues(sourceRecords.Select(source => source.ImageInfo?.WavelengthRange)));
            metadata.ProposalId = FormatSingleOrJoinedValues(
                GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
                {
                    source.ImageInfo?.ProposalId,
                    GetStringMetadataValue(source.Metadata, "mast_proposal_id"),
                    GetStringMetadataValue(source.Metadata, "proposal_id"),
                })));
            metadata.ProposalPi = FormatSingleOrJoinedValues(
                GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
                {
                    source.ImageInfo?.ProposalPi,
                    GetStringMetadataValue(source.Metadata, "mast_proposal_pi"),
                    GetStringMetadataValue(source.Metadata, "proposal_pi"),
                })));
            metadata.ObservationTitle = FormatSingleOrJoinedValues(
                GetDistinctNonEmptyValues(sourceRecords.SelectMany(source => new[]
                {
                    source.ImageInfo?.ObservationTitle,
                    GetStringMetadataValue(source.Metadata, "mast_obs_title"),
                    GetStringMetadataValue(source.Metadata, "obs_title"),
                })));
            metadata.Units = FormatSingleOrJoinedValues(
                GetDistinctNonEmptyValues(sourceRecords.Select(source => source.ImageInfo?.Units)));
            metadata.CoordinateSystem = FormatSingleOrJoinedValues(
                GetDistinctNonEmptyValues(sourceRecords.Select(source => source.ImageInfo?.CoordinateSystem)))
                ?? "ICRS";

            var observationDates = sourceRecords
                .Select(source => source.ImageInfo?.ObservationDate)
                .Where(observationDate => observationDate.HasValue)
                .Select(observationDate => observationDate!.Value)
                .ToList();
            if (observationDates.Count > 0)
            {
                metadata.ObservationDate = observationDates.Min();
            }

            var exposureTimes = sourceRecords
                .Select(source => source.ImageInfo?.ExposureTime)
                .Where(exposureTime => exposureTime.HasValue && exposureTime.Value > 0)
                .Select(exposureTime => exposureTime!.Value)
                .ToList();
            if (exposureTimes.Count > 0)
            {
                metadata.ExposureTime = exposureTimes.Sum();
            }

            var calibrationLevels = sourceRecords
                .Select(source => source.ImageInfo?.CalibrationLevel)
                .Where(level => level.HasValue)
                .Select(level => level!.Value)
                .ToList();
            if (calibrationLevels.Count > 0)
            {
                metadata.CalibrationLevel = calibrationLevels.Max();
            }

            var raValues = new List<double>();
            var decValues = new List<double>();
            foreach (var source in sourceRecords)
            {
                if (TryGetWcsValue(source.ImageInfo?.WCS, "CRVAL1", out var ra))
                {
                    raValues.Add(ra);
                }

                if (TryGetWcsValue(source.ImageInfo?.WCS, "CRVAL2", out var dec))
                {
                    decValues.Add(dec);
                }
            }

            if (raValues.Count > 0 || decValues.Count > 0)
            {
                var wcsSummary = new Dictionary<string, double>();
                if (raValues.Count > 0)
                {
                    wcsSummary["CRVAL1"] = raValues.Average();
                    wcsSummary["MIN_RA"] = raValues.Min();
                    wcsSummary["MAX_RA"] = raValues.Max();
                }

                if (decValues.Count > 0)
                {
                    wcsSummary["CRVAL2"] = decValues.Average();
                    wcsSummary["MIN_DEC"] = decValues.Min();
                    wcsSummary["MAX_DEC"] = decValues.Max();
                }

                metadata.WCS = wcsSummary;
            }

            return metadata;
        }

        private static void AddMetadataValues(
            Dictionary<string, object> metadata,
            string key,
            List<string> values)
        {
            if (values.Count > 0)
            {
                metadata[key] = values;
            }
        }

        private static List<string> GetDistinctNonEmptyValues(IEnumerable<string?> values)
        {
            return values
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value!.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static string? GetSingleDistinctValue(IEnumerable<string?> values)
        {
            var distinctValues = GetDistinctNonEmptyValues(values);
            return distinctValues.Count == 1 ? distinctValues[0] : null;
        }

        private static string? FormatSingleOrJoinedValues(
            List<string> values,
            int maxJoinedValues = 5)
        {
            if (values.Count == 0)
            {
                return null;
            }

            if (values.Count == 1)
            {
                return values[0];
            }

            if (values.Count <= maxJoinedValues)
            {
                return string.Join(", ", values);
            }

            var previewValues = values.Take(maxJoinedValues).ToList();
            previewValues.Add($"... (+{values.Count - maxJoinedValues} more)");
            return string.Join(", ", previewValues);
        }

        private static string? GetStringMetadataValue(
            IReadOnlyDictionary<string, object>? metadata,
            string key)
        {
            if (metadata == null)
            {
                return null;
            }

            foreach (var (metadataKey, metadataValue) in metadata)
            {
                if (string.Equals(metadataKey, key, StringComparison.OrdinalIgnoreCase))
                {
                    return ConvertMetadataValueToString(metadataValue);
                }
            }

            return null;
        }

        private static string? ConvertMetadataValueToString(object? value)
        {
            if (value == null)
            {
                return null;
            }

            if (value is JsonElement element)
            {
                return element.ValueKind switch
                {
                    JsonValueKind.String => element.GetString(),
                    JsonValueKind.Number => element.ToString(),
                    JsonValueKind.True => bool.TrueString,
                    JsonValueKind.False => bool.FalseString,
                    JsonValueKind.Null => null,
                    _ => element.ToString(),
                };
            }

            var stringValue = value.ToString();
            return string.IsNullOrWhiteSpace(stringValue) ? null : stringValue.Trim();
        }

        private static bool TryGetWcsValue(
            Dictionary<string, double>? wcs,
            string key,
            out double value)
        {
            if (wcs != null)
            {
                if (wcs.TryGetValue(key, out value))
                {
                    return true;
                }

                foreach (var (wcsKey, wcsValue) in wcs)
                {
                    if (string.Equals(wcsKey, key, StringComparison.OrdinalIgnoreCase))
                    {
                        value = wcsValue;
                        return true;
                    }
                }
            }

            value = 0;
            return false;
        }

        private static string BuildGeneratedMosaicFileName()
        {
            var timestamp = DateTime.UtcNow.ToString("yyyyMMddTHHmmss", CultureInfo.InvariantCulture);
            var suffix = Guid.NewGuid().ToString("N")[..8];
            return $"jwst-mosaic-{timestamp}-{suffix}_i2d.fits";
        }

        private async Task<JwstDataModel> ResolveDataIdToRecordAsync(string dataId)
        {
            var data = await mongoDBService.GetAsync(dataId);
            if (data == null)
            {
                LogDataNotFound(dataId);
                throw new KeyNotFoundException($"Data with ID {dataId} not found");
            }

            if (string.IsNullOrEmpty(data.FilePath))
            {
                LogNoFilePath(dataId);
                throw new InvalidOperationException($"Data {dataId} has no file path");
            }

            return data;
        }

        private async Task<string> ResolveDataIdToFilePathAsync(string dataId)
        {
            var data = await ResolveDataIdToRecordAsync(dataId);

            // Convert absolute path to relative path for processing engine
            var relativePath = StorageKeyHelper.ToRelativeKey(data.FilePath!);
            LogResolvedPath(dataId, data.FilePath!, relativePath);

            return relativePath;
        }
    }
}
