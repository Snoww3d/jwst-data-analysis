// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text.RegularExpressions;

using JwstDataAnalysis.API.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Bson;
using MongoDB.Driver;

using User = JwstDataAnalysis.API.Models.User;

namespace JwstDataAnalysis.API.Services
{
    public partial class MongoDBService : IMongoDBService
    {
        private readonly IMongoCollection<JwstDataModel> jwstDataCollection;
        private readonly IMongoCollection<User> usersCollection;

        private readonly ILogger<MongoDBService> logger;

        /// <summary>
        /// Initializes a new instance of the <see cref="MongoDBService"/> class.
        /// Production constructor - creates MongoDB client from settings.
        /// </summary>
        public MongoDBService(IOptions<MongoDBSettings> mongoDBSettings, ILogger<MongoDBService> logger)
        {
            this.logger = logger ?? throw new ArgumentNullException(nameof(logger));
            var mongoClient = new MongoClient(mongoDBSettings.Value.ConnectionString);
            var mongoDatabase = mongoClient.GetDatabase(mongoDBSettings.Value.DatabaseName);
            jwstDataCollection = mongoDatabase.GetCollection<JwstDataModel>("jwst_data");
            usersCollection = mongoDatabase.GetCollection<User>("users");
        }

        /// <summary>
        /// Initializes a new instance of the <see cref="MongoDBService"/> class.
        /// Internal constructor for unit testing - accepts pre-configured collections.
        /// Exposed via InternalsVisibleTo for test project access.
        /// </summary>
        internal MongoDBService(IMongoCollection<JwstDataModel> collection, ILogger<MongoDBService> logger)
        {
            this.jwstDataCollection = collection ?? throw new ArgumentNullException(nameof(collection));
            this.usersCollection = null!; // Will be null in some tests
            this.logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        /// <summary>
        /// Initializes a new instance of the <see cref="MongoDBService"/> class.
        /// Internal constructor for unit testing - accepts both collections.
        /// Exposed via InternalsVisibleTo for test project access.
        /// </summary>
        internal MongoDBService(
            IMongoCollection<JwstDataModel> collection,
            IMongoCollection<User> usersCollection,
            ILogger<MongoDBService> logger)
        {
            this.jwstDataCollection = collection ?? throw new ArgumentNullException(nameof(collection));
            this.usersCollection = usersCollection ?? throw new ArgumentNullException(nameof(usersCollection));
            this.logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        /// <summary>
        /// Creates indexes for commonly queried fields to optimize query performance.
        /// Should be called once during application startup.
        /// </summary>
        public async Task EnsureIndexesAsync()
        {
            try
            {
                var indexModels = new List<CreateIndexModel<JwstDataModel>>
                {
                    // Single field indexes for commonly filtered fields
                    new(
                        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.DataType),
                        new CreateIndexOptions { Name = "idx_dataType", Background = true }),

                    new(
                        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.ProcessingStatus),
                        new CreateIndexOptions { Name = "idx_processingStatus", Background = true }),

                    new(
                        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.ObservationBaseId),
                        new CreateIndexOptions { Name = "idx_observationBaseId", Background = true }),

                    new(
                        Builders<JwstDataModel>.IndexKeys.Descending(x => x.UploadDate),
                        new CreateIndexOptions { Name = "idx_uploadDate_desc", Background = true }),

                    new(
                        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.UserId),
                        new CreateIndexOptions { Name = "idx_userId", Background = true }),

                    new(
                        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.Tags),
                        new CreateIndexOptions { Name = "idx_tags", Background = true }),

                    new(
                        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.IsPublic),
                        new CreateIndexOptions { Name = "idx_isPublic", Background = true }),

                    new(
                        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.IsArchived),
                        new CreateIndexOptions { Name = "idx_isArchived", Background = true }),

                    new(
                        Builders<JwstDataModel>.IndexKeys.Ascending(x => x.ProcessingLevel),
                        new CreateIndexOptions { Name = "idx_processingLevel", Background = true }),

                    // Compound index for lineage queries (observation + processing level + filename)
                    new(
                        Builders<JwstDataModel>.IndexKeys
                            .Ascending(x => x.ObservationBaseId)
                            .Ascending(x => x.ProcessingLevel)
                            .Ascending(x => x.FileName),
                        new CreateIndexOptions { Name = "idx_lineage_compound", Background = true }),

                    // Text index for search on FileName and Description
                    new(
                        Builders<JwstDataModel>.IndexKeys
                            .Text(x => x.FileName)
                            .Text(x => x.Description),
                        new CreateIndexOptions { Name = "idx_text_search", Background = true }),
                };

                await jwstDataCollection.Indexes.CreateManyAsync(indexModels);
                LogIndexesCreated(indexModels.Count);
            }
            catch (Exception ex)
            {
                // Log but don't throw - indexes may already exist with different options
                LogIndexCreationWarning(ex);
            }
        }

        // Basic CRUD operations
        public async Task<List<JwstDataModel>> GetAsync() =>
            await jwstDataCollection.Find(_ => true)
                .SortByDescending(x => x.UploadDate)
                .ToListAsync();

        public async Task<JwstDataModel?> GetAsync(string id) =>
            await jwstDataCollection.Find(x => x.Id == id).FirstOrDefaultAsync();

        public async Task<List<JwstDataModel>> GetManyAsync(IEnumerable<string> ids)
        {
            var filter = Builders<JwstDataModel>.Filter.In(x => x.Id, ids);
            return await jwstDataCollection.Find(filter).ToListAsync();
        }

        public async Task<List<JwstDataModel>> GetByDataTypeAsync(string dataType) =>
            await jwstDataCollection.Find(x => x.DataType == dataType).ToListAsync();

        public async Task<List<JwstDataModel>> GetByStatusAsync(string status) =>
            await jwstDataCollection.Find(x => x.ProcessingStatus == status).ToListAsync();

        public async Task CreateAsync(JwstDataModel jwstData) =>
            await jwstDataCollection.InsertOneAsync(jwstData);

        public async Task UpdateAsync(string id, JwstDataModel jwstData) =>
            await jwstDataCollection.ReplaceOneAsync(x => x.Id == id, jwstData);

        public async Task RemoveAsync(string id) =>
            await jwstDataCollection.DeleteOneAsync(x => x.Id == id);

        // Enhanced querying methods
        public async Task<List<JwstDataModel>> GetByUserIdAsync(string userId) =>
            await jwstDataCollection.Find(x => x.UserId == userId).ToListAsync();

        public async Task<List<JwstDataModel>> GetPublicDataAsync() =>
            await jwstDataCollection.Find(x => x.IsPublic == true).ToListAsync();

        public async Task<List<JwstDataModel>> GetByFileFormatAsync(string fileFormat) =>
            await jwstDataCollection.Find(x => x.FileFormat == fileFormat).ToListAsync();

        public async Task<List<JwstDataModel>> GetValidatedDataAsync() =>
            await jwstDataCollection.Find(x => x.IsValidated == true).ToListAsync();

        public async Task<List<JwstDataModel>> GetByTagsAsync(List<string> tags)
        {
            var filter = Builders<JwstDataModel>.Filter.AnyIn(x => x.Tags, tags);
            return await jwstDataCollection.Find(filter).ToListAsync();
        }

        public async Task<List<JwstDataModel>> GetByDateRangeAsync(DateTime startDate, DateTime endDate) =>
            await jwstDataCollection.Find(x => x.UploadDate >= startDate && x.UploadDate <= endDate).ToListAsync();

        public async Task<List<JwstDataModel>> GetByFileSizeRangeAsync(long minSize, long maxSize) =>
            await jwstDataCollection.Find(x => x.FileSize >= minSize && x.FileSize <= maxSize).ToListAsync();

        /// <summary>
        /// Builds a MongoDB filter from search request criteria.
        /// Used by both AdvancedSearchAsync and GetSearchCountAsync to ensure consistent filtering.
        /// </summary>
        /// <param name="request">The search request containing filter criteria.</param>
        /// <returns>A MongoDB filter definition for the specified criteria.</returns>
        private static FilterDefinition<JwstDataModel> BuildSearchFilter(SearchRequest request)
        {
            var filter = Builders<JwstDataModel>.Filter.Empty;

            // Search term - escape special regex characters to prevent ReDoS attacks
            if (!string.IsNullOrEmpty(request.SearchTerm))
            {
                var escapedSearchTerm = Regex.Escape(request.SearchTerm);
                var searchFilter = Builders<JwstDataModel>.Filter.Or(
                    Builders<JwstDataModel>.Filter.Regex(x => x.FileName, new BsonRegularExpression(escapedSearchTerm, "i")),
                    Builders<JwstDataModel>.Filter.Regex(x => x.Description, new BsonRegularExpression(escapedSearchTerm, "i")),
                    Builders<JwstDataModel>.Filter.AnyIn(x => x.Tags, [request.SearchTerm]));
                filter = Builders<JwstDataModel>.Filter.And(filter, searchFilter);
            }

            // Data types
            if (request.DataTypes != null && request.DataTypes.Count > 0)
            {
                var typeFilter = Builders<JwstDataModel>.Filter.In(x => x.DataType, request.DataTypes);
                filter = Builders<JwstDataModel>.Filter.And(filter, typeFilter);
            }

            // Statuses
            if (request.Statuses != null && request.Statuses.Count > 0)
            {
                var statusFilter = Builders<JwstDataModel>.Filter.In(x => x.ProcessingStatus, request.Statuses);
                filter = Builders<JwstDataModel>.Filter.And(filter, statusFilter);
            }

            // Tags
            if (request.Tags != null && request.Tags.Count > 0)
            {
                var tagFilter = Builders<JwstDataModel>.Filter.AnyIn(x => x.Tags, request.Tags);
                filter = Builders<JwstDataModel>.Filter.And(filter, tagFilter);
            }

            // User ID
            if (!string.IsNullOrEmpty(request.UserId))
            {
                var userFilter = Builders<JwstDataModel>.Filter.Eq(x => x.UserId, request.UserId);
                filter = Builders<JwstDataModel>.Filter.And(filter, userFilter);
            }

            // Date range
            if (request.DateFrom.HasValue || request.DateTo.HasValue)
            {
                var dateFilter = Builders<JwstDataModel>.Filter.Empty;
                if (request.DateFrom.HasValue)
                {
                    dateFilter = Builders<JwstDataModel>.Filter.Gte(x => x.UploadDate, request.DateFrom.Value);
                }

                if (request.DateTo.HasValue)
                {
                    dateFilter = Builders<JwstDataModel>.Filter.And(
                        dateFilter,
                        Builders<JwstDataModel>.Filter.Lte(x => x.UploadDate, request.DateTo.Value));
                }

                filter = Builders<JwstDataModel>.Filter.And(filter, dateFilter);
            }

            // File size range
            if (request.MinFileSize.HasValue || request.MaxFileSize.HasValue)
            {
                var sizeFilter = Builders<JwstDataModel>.Filter.Empty;
                if (request.MinFileSize.HasValue)
                {
                    sizeFilter = Builders<JwstDataModel>.Filter.Gte(x => x.FileSize, request.MinFileSize.Value);
                }

                if (request.MaxFileSize.HasValue)
                {
                    sizeFilter = Builders<JwstDataModel>.Filter.And(
                        sizeFilter,
                        Builders<JwstDataModel>.Filter.Lte(x => x.FileSize, request.MaxFileSize.Value));
                }

                filter = Builders<JwstDataModel>.Filter.And(filter, sizeFilter);
            }

            // Public/private filter
            if (request.IsPublic.HasValue)
            {
                var publicFilter = Builders<JwstDataModel>.Filter.Eq(x => x.IsPublic, request.IsPublic.Value);
                filter = Builders<JwstDataModel>.Filter.And(filter, publicFilter);
            }

            // Validation filter
            if (request.IsValidated.HasValue)
            {
                var validationFilter = Builders<JwstDataModel>.Filter.Eq(x => x.IsValidated, request.IsValidated.Value);
                filter = Builders<JwstDataModel>.Filter.And(filter, validationFilter);
            }

            return filter;
        }

        // Advanced search with multiple criteria
        public async Task<List<JwstDataModel>> AdvancedSearchAsync(SearchRequest request)
        {
            var filter = BuildSearchFilter(request);

            // Sorting
            var sortDefinition = request.SortBy?.ToLowerInvariant() switch
            {
                "filename" => request.SortOrder == "asc" ?
                    Builders<JwstDataModel>.Sort.Ascending(x => x.FileName) :
                    Builders<JwstDataModel>.Sort.Descending(x => x.FileName),
                "filesize" => request.SortOrder == "asc" ?
                    Builders<JwstDataModel>.Sort.Ascending(x => x.FileSize) :
                    Builders<JwstDataModel>.Sort.Descending(x => x.FileSize),
                "datatype" => request.SortOrder == "asc" ?
                    Builders<JwstDataModel>.Sort.Ascending(x => x.DataType) :
                    Builders<JwstDataModel>.Sort.Descending(x => x.DataType),
                _ => request.SortOrder == "asc" ?
                    Builders<JwstDataModel>.Sort.Ascending(x => x.UploadDate) :
                    Builders<JwstDataModel>.Sort.Descending(x => x.UploadDate),
            };

            // Pagination
            var skip = (request.Page - 1) * request.PageSize;
            var limit = request.PageSize;

            return await jwstDataCollection.Find(filter)
                .Sort(sortDefinition)
                .Skip(skip)
                .Limit(limit)
                .ToListAsync();
        }

        public async Task<long> GetSearchCountAsync(SearchRequest request)
        {
            var filter = BuildSearchFilter(request);
            return await jwstDataCollection.CountDocumentsAsync(filter);
        }

        // Processing status management
        public async Task UpdateProcessingStatusAsync(string id, string status) =>
            await jwstDataCollection.UpdateOneAsync(
                x => x.Id == id,
                Builders<JwstDataModel>.Update.Set(x => x.ProcessingStatus, status));

        public async Task AddProcessingResultAsync(string id, ProcessingResult result)
        {
            var update = Builders<JwstDataModel>.Update.Push(x => x.ProcessingResults, result);
            await jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        // File validation
        public async Task UpdateValidationStatusAsync(string id, bool isValidated, string? validationError = null)
        {
            var update = Builders<JwstDataModel>.Update
                .Set(x => x.IsValidated, isValidated)
                .Set(x => x.ValidationError, validationError);
            await jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        // Access tracking
        public async Task UpdateLastAccessedAsync(string id)
        {
            var update = Builders<JwstDataModel>.Update.Set(x => x.LastAccessed, DateTime.UtcNow);
            await jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        // Archive functionality
        public async Task ArchiveAsync(string id)
        {
            var update = Builders<JwstDataModel>.Update
                .Set(x => x.IsArchived, true)
                .Set(x => x.ArchivedDate, DateTime.UtcNow);
            await jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        public async Task UnarchiveAsync(string id)
        {
            var update = Builders<JwstDataModel>.Update
                .Set(x => x.IsArchived, false)
                .Set(x => x.ArchivedDate, (DateTime?)null);
            await jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        public async Task<List<JwstDataModel>> GetNonArchivedAsync() =>
            await jwstDataCollection.Find(x => x.IsArchived == false)
                .SortByDescending(x => x.UploadDate)
                .ToListAsync();

        public async Task<List<JwstDataModel>> GetArchivedAsync() =>
            await jwstDataCollection.Find(x => x.IsArchived == true)
                .SortByDescending(x => x.UploadDate)
                .ToListAsync();

        // Statistics - uses MongoDB aggregation pipelines for efficiency
        public async Task<DataStatistics> GetStatisticsAsync()
        {
            var stats = new DataStatistics();

            // Use aggregation pipeline for basic statistics (count, sum, avg, min, max)
            var basicStatsPipeline = new BsonDocument[]
            {
                new("$group", new BsonDocument
                {
                    { "_id", BsonNull.Value },
                    { "totalFiles", new BsonDocument("$sum", 1) },
                    { "totalSize", new BsonDocument("$sum", "$FileSize") },
                    { "avgSize", new BsonDocument("$avg", "$FileSize") },
                    { "oldestFile", new BsonDocument("$min", "$UploadDate") },
                    { "newestFile", new BsonDocument("$max", "$UploadDate") },
                }),
            };

            var basicStatsResult = await jwstDataCollection
                .Aggregate<BsonDocument>(basicStatsPipeline)
                .FirstOrDefaultAsync();

            if (basicStatsResult != null)
            {
                stats.TotalFiles = basicStatsResult.GetValue("totalFiles", 0).AsInt32;
                stats.TotalSize = basicStatsResult.GetValue("totalSize", 0).ToInt64();
                stats.AverageFileSize = basicStatsResult.GetValue("avgSize", 0).ToDouble();
                stats.OldestFile = basicStatsResult.GetValue("oldestFile", BsonNull.Value).IsBsonNull
                    ? DateTime.MinValue
                    : basicStatsResult.GetValue("oldestFile").ToUniversalTime();
                stats.NewestFile = basicStatsResult.GetValue("newestFile", BsonNull.Value).IsBsonNull
                    ? DateTime.MinValue
                    : basicStatsResult.GetValue("newestFile").ToUniversalTime();
            }

            // Data type distribution via aggregation
            var dataTypePipeline = new BsonDocument[]
            {
                new("$group", new BsonDocument
                {
                    { "_id", new BsonDocument("$ifNull", new BsonArray { "$DataType", "unknown" }) },
                    { "count", new BsonDocument("$sum", 1) },
                }),
            };

            var dataTypeResults = await jwstDataCollection
                .Aggregate<BsonDocument>(dataTypePipeline)
                .ToListAsync();

            stats.DataTypeDistribution = dataTypeResults
                .ToDictionary(
                    r => r.GetValue("_id").AsString,
                    r => r.GetValue("count").AsInt32);

            // Status distribution via aggregation
            var statusPipeline = new BsonDocument[]
            {
                new("$group", new BsonDocument
                {
                    { "_id", new BsonDocument("$ifNull", new BsonArray { "$ProcessingStatus", "unknown" }) },
                    { "count", new BsonDocument("$sum", 1) },
                }),
            };

            var statusResults = await jwstDataCollection
                .Aggregate<BsonDocument>(statusPipeline)
                .ToListAsync();

            stats.StatusDistribution = statusResults
                .ToDictionary(
                    r => r.GetValue("_id").AsString,
                    r => r.GetValue("count").AsInt32);

            // Format distribution via aggregation (only non-null/non-empty formats)
            var formatPipeline = new BsonDocument[]
            {
                new("$match", new BsonDocument("FileFormat", new BsonDocument("$nin", new BsonArray { BsonNull.Value, string.Empty }))),
                new("$group", new BsonDocument
                {
                    { "_id", "$FileFormat" },
                    { "count", new BsonDocument("$sum", 1) },
                }),
            };

            var formatResults = await jwstDataCollection
                .Aggregate<BsonDocument>(formatPipeline)
                .ToListAsync();

            stats.FormatDistribution = formatResults
                .ToDictionary(
                    r => r.GetValue("_id").AsString,
                    r => r.GetValue("count").AsInt32);

            // Processing level distribution via aggregation (only non-null/non-empty levels)
            var levelPipeline = new BsonDocument[]
            {
                new("$match", new BsonDocument("ProcessingLevel", new BsonDocument("$nin", new BsonArray { BsonNull.Value, string.Empty }))),
                new("$group", new BsonDocument
                {
                    { "_id", "$ProcessingLevel" },
                    { "count", new BsonDocument("$sum", 1) },
                }),
            };

            var levelResults = await jwstDataCollection
                .Aggregate<BsonDocument>(levelPipeline)
                .ToListAsync();

            stats.ProcessingLevelDistribution = levelResults
                .ToDictionary(
                    r => r.GetValue("_id").AsString,
                    r => r.GetValue("count").AsInt32);

            // Most common tags via aggregation ($unwind + $group + $sort + $limit)
            var tagsPipeline = new BsonDocument[]
            {
                new("$unwind", "$Tags"),
                new("$group", new BsonDocument
                {
                    { "_id", "$Tags" },
                    { "count", new BsonDocument("$sum", 1) },
                }),
                new("$sort", new BsonDocument("count", -1)),
                new("$limit", 10),
            };

            var tagsResults = await jwstDataCollection
                .Aggregate<BsonDocument>(tagsPipeline)
                .ToListAsync();

            stats.MostCommonTags = [.. tagsResults.Select(r => r.GetValue("_id").AsString)];

            // Validated and public files - CountDocumentsAsync is already efficient
            stats.ValidatedFiles = (int)await jwstDataCollection.CountDocumentsAsync(x => x.IsValidated);
            stats.PublicFiles = (int)await jwstDataCollection.CountDocumentsAsync(x => x.IsPublic);

            return stats;
        }

        // Search with facets
        public async Task<SearchResponse> SearchWithFacetsAsync(SearchRequest request)
        {
            var data = await AdvancedSearchAsync(request);
            var totalCount = await GetSearchCountAsync(request);
            var totalPages = (int)Math.Ceiling((double)totalCount / request.PageSize);

            // Get facets
            var facets = new Dictionary<string, int>();

            // Data type facets
            var typeFacets = await jwstDataCollection.Aggregate<BsonDocument>(new[]
            {
                new BsonDocument("$group", new BsonDocument
                {
                    { "_id", "$DataType" },
                    { "count", new BsonDocument("$sum", 1) },
                }),
            }).ToListAsync();

            foreach (var facet in typeFacets)
            {
                facets[$"type_{facet.GetValue("_id").AsString}"] = facet.GetValue("count").AsInt32;
            }

            return new SearchResponse
            {
                Data = [.. data.Select(MapToDataResponse)],
                TotalCount = (int)totalCount,
                Page = request.Page,
                PageSize = request.PageSize,
                TotalPages = (int)totalPages,
                Facets = facets,
            };
        }

        // Helper method to map to response DTO
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
                LastProcessed = model.ProcessingResults.Count > 0 ?
                    model.ProcessingResults.Max(r => r.ProcessedDate) : null,

                // Lineage fields
                ProcessingLevel = model.ProcessingLevel,
                ObservationBaseId = model.ObservationBaseId,
                ExposureId = model.ExposureId,
                ParentId = model.ParentId,
                DerivedFrom = model.DerivedFrom,
            };
        }

        // Bulk operations
        public async Task BulkUpdateTagsAsync(List<string> ids, List<string> tags, bool append = true)
        {
            var filter = Builders<JwstDataModel>.Filter.In(x => x.Id, ids);
            var update = append ?
                Builders<JwstDataModel>.Update.AddToSetEach(x => x.Tags, tags) :
                Builders<JwstDataModel>.Update.Set(x => x.Tags, tags);

            await jwstDataCollection.UpdateManyAsync(filter, update);
        }

        public async Task BulkUpdateStatusAsync(List<string> ids, string status)
        {
            var filter = Builders<JwstDataModel>.Filter.In(x => x.Id, ids);
            var update = Builders<JwstDataModel>.Update.Set(x => x.ProcessingStatus, status);

            await jwstDataCollection.UpdateManyAsync(filter, update);
        }

        // Version control
        public async Task<string> CreateVersionAsync(string parentId, JwstDataModel newVersion)
        {
            newVersion.ParentId = parentId;
            newVersion.Version = (await GetMaxVersionAsync(parentId)) + 1;
            newVersion.UploadDate = DateTime.UtcNow;

            await CreateAsync(newVersion);
            return newVersion.Id;
        }

        private async Task<int> GetMaxVersionAsync(string parentId)
        {
            var filter = Builders<JwstDataModel>.Filter.Eq(x => x.ParentId, parentId);
            var sort = Builders<JwstDataModel>.Sort.Descending(x => x.Version);
            var result = await jwstDataCollection.Find(filter).Sort(sort).FirstOrDefaultAsync();
            return result?.Version ?? 0;
        }

        // Lineage query methods
        public async Task<List<JwstDataModel>> GetByObservationBaseIdAsync(string observationBaseId)
        {
            // First try to find by ObservationBaseId
            var results = await jwstDataCollection.Find(x => x.ObservationBaseId == observationBaseId).ToListAsync();

            // If not found, try to find by mast_obs_id in Metadata (fallback for UI compatibility)
            if (results.Count == 0)
            {
                var filter = Builders<JwstDataModel>.Filter.Eq("Metadata.mast_obs_id", observationBaseId);
                results = await jwstDataCollection.Find(filter).ToListAsync();
            }

            return results;
        }

        public async Task<List<JwstDataModel>> GetByProcessingLevelAsync(string processingLevel) =>
            await jwstDataCollection.Find(x => x.ProcessingLevel == processingLevel).ToListAsync();

        public async Task<List<JwstDataModel>> GetLineageTreeAsync(string observationBaseId)
        {
            var sort = Builders<JwstDataModel>.Sort
                .Ascending(x => x.ProcessingLevel)
                .Ascending(x => x.FileName);

            // First try to find by ObservationBaseId
            var filter = Builders<JwstDataModel>.Filter.Eq(x => x.ObservationBaseId, observationBaseId);
            var results = await jwstDataCollection.Find(filter).Sort(sort).ToListAsync();

            // If not found, try by mast_obs_id in Metadata (fallback for UI compatibility)
            if (results.Count == 0)
            {
                filter = Builders<JwstDataModel>.Filter.Eq("Metadata.mast_obs_id", observationBaseId);
                results = await jwstDataCollection.Find(filter).Sort(sort).ToListAsync();
            }

            return results;
        }

        public async Task<Dictionary<string, List<JwstDataModel>>> GetLineageGroupedAsync()
        {
            var allData = await jwstDataCollection.Find(x => x.ObservationBaseId != null).ToListAsync();
            return allData
                .GroupBy(x => x.ObservationBaseId ?? "unknown")
                .ToDictionary(g => g.Key, g => g.OrderBy(x => x.ProcessingLevel).ToList());
        }

        public async Task UpdateLineageAsync(string id, string? parentId, List<string>? derivedFrom)
        {
            var update = Builders<JwstDataModel>.Update
                .Set(x => x.ParentId, parentId)
                .Set(x => x.DerivedFrom, derivedFrom ?? []);
            await jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        // Delete all records by observation base ID (also checks mast_obs_id as fallback)
        public async Task<DeleteResult> RemoveByObservationBaseIdAsync(string observationBaseId)
        {
            // First try to delete by ObservationBaseId
            var result = await jwstDataCollection.DeleteManyAsync(x => x.ObservationBaseId == observationBaseId);

            // If nothing deleted, try by mast_obs_id in Metadata (fallback for UI compatibility)
            if (result.DeletedCount == 0)
            {
                var filter = Builders<JwstDataModel>.Filter.Eq("Metadata.mast_obs_id", observationBaseId);
                result = await jwstDataCollection.DeleteManyAsync(filter);
            }

            return result;
        }

        // Get files by observation and processing level
        public async Task<List<JwstDataModel>> GetByObservationAndLevelAsync(
            string observationBaseId,
            string processingLevel)
        {
            // First try by ObservationBaseId
            var filter = Builders<JwstDataModel>.Filter.And(
                Builders<JwstDataModel>.Filter.Eq(x => x.ObservationBaseId, observationBaseId),
                Builders<JwstDataModel>.Filter.Eq(x => x.ProcessingLevel, processingLevel));
            var results = await jwstDataCollection.Find(filter).ToListAsync();

            // Fallback to mast_obs_id if no results
            if (results.Count == 0)
            {
                filter = Builders<JwstDataModel>.Filter.And(
                    Builders<JwstDataModel>.Filter.Eq("Metadata.mast_obs_id", observationBaseId),
                    Builders<JwstDataModel>.Filter.Eq(x => x.ProcessingLevel, processingLevel));
                results = await jwstDataCollection.Find(filter).ToListAsync();
            }

            return results;
        }

        // Delete files by observation and processing level
        public async Task<DeleteResult> RemoveByObservationAndLevelAsync(
            string observationBaseId,
            string processingLevel)
        {
            // First try by ObservationBaseId
            var filter = Builders<JwstDataModel>.Filter.And(
                Builders<JwstDataModel>.Filter.Eq(x => x.ObservationBaseId, observationBaseId),
                Builders<JwstDataModel>.Filter.Eq(x => x.ProcessingLevel, processingLevel));
            var result = await jwstDataCollection.DeleteManyAsync(filter);

            // Fallback to mast_obs_id if no results
            if (result.DeletedCount == 0)
            {
                filter = Builders<JwstDataModel>.Filter.And(
                    Builders<JwstDataModel>.Filter.Eq("Metadata.mast_obs_id", observationBaseId),
                    Builders<JwstDataModel>.Filter.Eq(x => x.ProcessingLevel, processingLevel));
                result = await jwstDataCollection.DeleteManyAsync(filter);
            }

            return result;
        }

        // Archive files by observation and processing level
        public async Task<long> ArchiveByObservationAndLevelAsync(
            string observationBaseId,
            string processingLevel)
        {
            // First try by ObservationBaseId
            var filter = Builders<JwstDataModel>.Filter.And(
                Builders<JwstDataModel>.Filter.Eq(x => x.ObservationBaseId, observationBaseId),
                Builders<JwstDataModel>.Filter.Eq(x => x.ProcessingLevel, processingLevel));

            var update = Builders<JwstDataModel>.Update
                .Set(x => x.IsArchived, true)
                .Set(x => x.ArchivedDate, DateTime.UtcNow);

            var result = await jwstDataCollection.UpdateManyAsync(filter, update);

            // Fallback to mast_obs_id if no results
            if (result.ModifiedCount == 0)
            {
                filter = Builders<JwstDataModel>.Filter.And(
                    Builders<JwstDataModel>.Filter.Eq("Metadata.mast_obs_id", observationBaseId),
                    Builders<JwstDataModel>.Filter.Eq(x => x.ProcessingLevel, processingLevel));
                result = await jwstDataCollection.UpdateManyAsync(filter, update);
            }

            return result.ModifiedCount;
        }

        // User management methods

        /// <summary>
        /// Creates indexes for user collection fields.
        /// Should be called once during application startup.
        /// </summary>
        public async Task EnsureUserIndexesAsync()
        {
            if (usersCollection == null)
            {
                return;
            }

            try
            {
                var indexModels = new List<CreateIndexModel<User>>
                {
                    // Unique username index
                    new(
                        Builders<User>.IndexKeys.Ascending(x => x.Username),
                        new CreateIndexOptions { Name = "idx_username_unique", Unique = true, Background = true }),

                    // Unique email index
                    new(
                        Builders<User>.IndexKeys.Ascending(x => x.Email),
                        new CreateIndexOptions { Name = "idx_email_unique", Unique = true, Background = true }),

                    // Refresh token index for token lookup
                    new(
                        Builders<User>.IndexKeys.Ascending(x => x.RefreshToken),
                        new CreateIndexOptions { Name = "idx_refreshToken", Background = true }),
                };

                await usersCollection.Indexes.CreateManyAsync(indexModels);
                LogUserIndexesCreated(indexModels.Count);
            }
            catch (Exception ex)
            {
                // Log but don't throw - indexes may already exist with different options
                LogUserIndexCreationWarning(ex);
            }
        }

        public async Task<User?> GetUserByIdAsync(string id) =>
            await usersCollection.Find(x => x.Id == id).FirstOrDefaultAsync();

        public async Task<User?> GetUserByUsernameAsync(string username) =>
            await usersCollection.Find(x => x.Username == username).FirstOrDefaultAsync();

        public async Task<User?> GetUserByEmailAsync(string email) =>
            await usersCollection.Find(x => x.Email == email).FirstOrDefaultAsync();

        public async Task<User?> GetUserByRefreshTokenAsync(string refreshToken) =>
            await usersCollection.Find(x => x.RefreshToken == refreshToken).FirstOrDefaultAsync();

        public async Task CreateUserAsync(User user) =>
            await usersCollection.InsertOneAsync(user);

        public async Task UpdateUserAsync(User user) =>
            await usersCollection.ReplaceOneAsync(x => x.Id == user.Id, user);

        public async Task UpdateRefreshTokenAsync(string userId, string? refreshToken, DateTime? expiresAt)
        {
            var update = Builders<User>.Update
                .Set(x => x.RefreshToken, refreshToken)
                .Set(x => x.RefreshTokenExpiresAt, expiresAt);
            await usersCollection.UpdateOneAsync(x => x.Id == userId, update);
        }

        // Data access control methods

        /// <summary>
        /// Gets all data items accessible to the specified user.
        /// Admins can see all items. Regular users can see:
        /// - Their own items (UserId matches)
        /// - Public items (IsPublic = true)
        /// - Items shared with them (SharedWith contains their userId).
        /// </summary>
        public async Task<List<JwstDataModel>> GetAccessibleDataAsync(string userId, bool isAdmin)
        {
            if (isAdmin)
            {
                return await GetAsync();
            }

            var filter = Builders<JwstDataModel>.Filter.Or(
                Builders<JwstDataModel>.Filter.Eq(x => x.UserId, userId),
                Builders<JwstDataModel>.Filter.Eq(x => x.IsPublic, true),
                Builders<JwstDataModel>.Filter.AnyEq(x => x.SharedWith, userId));

            return await jwstDataCollection.Find(filter)
                .SortByDescending(x => x.UploadDate)
                .ToListAsync();
        }

        /// <summary>
        /// Gets a specific data item if accessible to the user.
        /// Returns null if the item doesn't exist or the user doesn't have access.
        /// </summary>
        public async Task<JwstDataModel?> GetAccessibleDataByIdAsync(string dataId, string userId, bool isAdmin)
        {
            var data = await GetAsync(dataId);
            if (data == null)
            {
                return null;
            }

            if (isAdmin)
            {
                return data;
            }

            // Check access: owner, public, or shared with
            if (data.UserId == userId || data.IsPublic || data.SharedWith.Contains(userId))
            {
                return data;
            }

            return null;
        }
    }

    public class MongoDBSettings
    {
        public string ConnectionString { get; set; } = string.Empty;

        public string DatabaseName { get; set; } = string.Empty;
    }
}
