// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Globalization;
using System.Text;
using System.Text.Json;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <inheritdoc/>
    public partial class MosaicService : IMosaicService
    {
        private readonly HttpClient httpClient;
        private readonly IMongoDBService mongoDBService;
        private readonly ILogger<MosaicService> logger;
        private readonly string processingEngineUrl;
        private readonly string dataBasePath;
        private readonly JsonSerializerOptions jsonOptions;

        public MosaicService(
            HttpClient httpClient,
            IMongoDBService mongoDBService,
            ILogger<MosaicService> logger,
            IConfiguration configuration)
        {
            this.httpClient = httpClient;
            this.mongoDBService = mongoDBService;
            this.logger = logger;
            processingEngineUrl = configuration["ProcessingEngine:BaseUrl"]
                ?? "http://localhost:8000";
            dataBasePath = configuration["Downloads:BasePath"] ?? "/app/data/mast";

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

                var relativePath = ConvertToRelativePath(sourceData.FilePath!);
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

            var outputDirectory = GetMosaicOutputDirectory();
            Directory.CreateDirectory(outputDirectory);

            var fileName = BuildGeneratedMosaicFileName();
            var outputPath = Path.Combine(outputDirectory, fileName);

            await using (var outputStream = new FileStream(outputPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                await response.Content.CopyToAsync(outputStream);
            }

            var fileInfo = new FileInfo(outputPath);
            if (!fileInfo.Exists || fileInfo.Length == 0)
            {
                if (fileInfo.Exists)
                {
                    File.Delete(outputPath);
                }

                throw new InvalidOperationException("Generated mosaic FITS file was empty");
            }

            var model = new JwstDataModel
            {
                FileName = fileName,
                DataType = DataTypes.Image,
                Description = $"Generated WCS mosaic from {request.Files.Count} source FITS files (combine={request.CombineMethod})",
                Metadata = new Dictionary<string, object>
                {
                    { "source", "mosaic-generator" },
                    { "generated_at", DateTime.UtcNow.ToString("O") },
                    { "combine_method", request.CombineMethod },
                    { "source_count", request.Files.Count },
                },
                Tags = ["mosaic", "generated", "fits"],
                FilePath = NormalizePathForStorage(outputPath),
                FileSize = fileInfo.Length,
                UploadDate = DateTime.UtcNow,
                ProcessingStatus = ProcessingStatuses.Completed,
                FileFormat = FileFormats.FITS,
                IsValidated = true,
                UserId = isAuthenticated ? userId : null,
                IsPublic = false,
                ProcessingLevel = ProcessingLevels.Level3,
                ParentId = sourceIds[0],
                DerivedFrom = sourceIds,
                IsViewable = true,
                ImageInfo = new ImageMetadata
                {
                    Format = FileFormats.FITS,
                },
            };

            await mongoDBService.CreateAsync(model);

            logger.LogInformation(
                "Saved generated mosaic FITS dataId={DataId} file={FileName} size={SizeBytes}",
                model.Id,
                model.FileName,
                model.FileSize);

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

        private string BuildGeneratedMosaicFileName()
        {
            var timestamp = DateTime.UtcNow.ToString("yyyyMMddTHHmmss", CultureInfo.InvariantCulture);
            var suffix = Guid.NewGuid().ToString("N")[..8];
            return $"jwst-mosaic-{timestamp}-{suffix}_i2d.fits";
        }

        private string GetMosaicOutputDirectory()
        {
            var trimmedBasePath = dataBasePath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var outputRoot = trimmedBasePath.EndsWith("mast", StringComparison.OrdinalIgnoreCase)
                ? Path.GetDirectoryName(trimmedBasePath)
                : trimmedBasePath;

            outputRoot ??= "/app/data";
            return Path.Combine(outputRoot, "mosaic");
        }

        private string NormalizePathForStorage(string path) => path.Replace('\\', '/');

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
            var relativePath = ConvertToRelativePath(data.FilePath!);
            LogResolvedPath(dataId, data.FilePath!, relativePath);

            return relativePath;
        }

        private string ConvertToRelativePath(string absolutePath)
        {
            // The processing engine's DATA_DIR is /app/data
            // File paths in DB are like /app/data/mast/obs_id/file.fits
            // We need to strip /app/data/ prefix
            const string dataPrefix = "/app/data/";
            if (absolutePath.StartsWith(dataPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return absolutePath[dataPrefix.Length..];
            }

            // If path doesn't start with expected prefix, try stripping the configured base path
            if (absolutePath.StartsWith(dataBasePath, StringComparison.OrdinalIgnoreCase))
            {
                var relative = absolutePath[dataBasePath.Length..].TrimStart('/');
                return $"mast/{relative}";
            }

            // Return as-is if already relative or has unexpected format
            return absolutePath;
        }
    }
}
