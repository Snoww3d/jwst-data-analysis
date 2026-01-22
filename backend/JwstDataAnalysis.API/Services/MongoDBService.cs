using Microsoft.Extensions.Options;
using MongoDB.Driver;
using JwstDataAnalysis.API.Models;
using MongoDB.Bson;

namespace JwstDataAnalysis.API.Services
{
    public class MongoDBService
    {
        private readonly IMongoCollection<JwstDataModel> _jwstDataCollection;

        public MongoDBService(IOptions<MongoDBSettings> mongoDBSettings)
        {
            var mongoClient = new MongoClient(mongoDBSettings.Value.ConnectionString);
            var mongoDatabase = mongoClient.GetDatabase(mongoDBSettings.Value.DatabaseName);
            _jwstDataCollection = mongoDatabase.GetCollection<JwstDataModel>("jwst_data");
        }

        // Basic CRUD operations
        public async Task<List<JwstDataModel>> GetAsync() =>
            await _jwstDataCollection.Find(_ => true).ToListAsync();

        public async Task<JwstDataModel?> GetAsync(string id) =>
            await _jwstDataCollection.Find(x => x.Id == id).FirstOrDefaultAsync();

        public async Task<List<JwstDataModel>> GetByDataTypeAsync(string dataType) =>
            await _jwstDataCollection.Find(x => x.DataType == dataType).ToListAsync();

        public async Task<List<JwstDataModel>> GetByStatusAsync(string status) =>
            await _jwstDataCollection.Find(x => x.ProcessingStatus == status).ToListAsync();

        public async Task CreateAsync(JwstDataModel jwstData) =>
            await _jwstDataCollection.InsertOneAsync(jwstData);

        public async Task UpdateAsync(string id, JwstDataModel jwstData) =>
            await _jwstDataCollection.ReplaceOneAsync(x => x.Id == id, jwstData);

        public async Task RemoveAsync(string id) =>
            await _jwstDataCollection.DeleteOneAsync(x => x.Id == id);

        // Enhanced querying methods
        public async Task<List<JwstDataModel>> GetByUserIdAsync(string userId) =>
            await _jwstDataCollection.Find(x => x.UserId == userId).ToListAsync();

        public async Task<List<JwstDataModel>> GetPublicDataAsync() =>
            await _jwstDataCollection.Find(x => x.IsPublic == true).ToListAsync();

        public async Task<List<JwstDataModel>> GetByFileFormatAsync(string fileFormat) =>
            await _jwstDataCollection.Find(x => x.FileFormat == fileFormat).ToListAsync();

        public async Task<List<JwstDataModel>> GetValidatedDataAsync() =>
            await _jwstDataCollection.Find(x => x.IsValidated == true).ToListAsync();

        public async Task<List<JwstDataModel>> GetByTagsAsync(List<string> tags)
        {
            var filter = Builders<JwstDataModel>.Filter.AnyIn(x => x.Tags, tags);
            return await _jwstDataCollection.Find(filter).ToListAsync();
        }

        public async Task<List<JwstDataModel>> GetByDateRangeAsync(DateTime startDate, DateTime endDate) =>
            await _jwstDataCollection.Find(x => x.UploadDate >= startDate && x.UploadDate <= endDate).ToListAsync();

        public async Task<List<JwstDataModel>> GetByFileSizeRangeAsync(long minSize, long maxSize) =>
            await _jwstDataCollection.Find(x => x.FileSize >= minSize && x.FileSize <= maxSize).ToListAsync();

        // Advanced search with multiple criteria
        public async Task<List<JwstDataModel>> AdvancedSearchAsync(SearchRequest request)
        {
            var filter = Builders<JwstDataModel>.Filter.Empty;

            // Search term
            if (!string.IsNullOrEmpty(request.SearchTerm))
            {
                var searchFilter = Builders<JwstDataModel>.Filter.Or(
                    Builders<JwstDataModel>.Filter.Regex(x => x.FileName, new BsonRegularExpression(request.SearchTerm, "i")),
                    Builders<JwstDataModel>.Filter.Regex(x => x.Description, new BsonRegularExpression(request.SearchTerm, "i")),
                    Builders<JwstDataModel>.Filter.AnyIn(x => x.Tags, new[] { request.SearchTerm })
                );
                filter = Builders<JwstDataModel>.Filter.And(filter, searchFilter);
            }

            // Data types
            if (request.DataTypes != null && request.DataTypes.Any())
            {
                var typeFilter = Builders<JwstDataModel>.Filter.In(x => x.DataType, request.DataTypes);
                filter = Builders<JwstDataModel>.Filter.And(filter, typeFilter);
            }

            // Statuses
            if (request.Statuses != null && request.Statuses.Any())
            {
                var statusFilter = Builders<JwstDataModel>.Filter.In(x => x.ProcessingStatus, request.Statuses);
                filter = Builders<JwstDataModel>.Filter.And(filter, statusFilter);
            }

            // Tags
            if (request.Tags != null && request.Tags.Any())
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
                    dateFilter = Builders<JwstDataModel>.Filter.Gte(x => x.UploadDate, request.DateFrom.Value);
                if (request.DateTo.HasValue)
                    dateFilter = Builders<JwstDataModel>.Filter.And(dateFilter, 
                        Builders<JwstDataModel>.Filter.Lte(x => x.UploadDate, request.DateTo.Value));
                filter = Builders<JwstDataModel>.Filter.And(filter, dateFilter);
            }

            // File size range
            if (request.MinFileSize.HasValue || request.MaxFileSize.HasValue)
            {
                var sizeFilter = Builders<JwstDataModel>.Filter.Empty;
                if (request.MinFileSize.HasValue)
                    sizeFilter = Builders<JwstDataModel>.Filter.Gte(x => x.FileSize, request.MinFileSize.Value);
                if (request.MaxFileSize.HasValue)
                    sizeFilter = Builders<JwstDataModel>.Filter.And(sizeFilter, 
                        Builders<JwstDataModel>.Filter.Lte(x => x.FileSize, request.MaxFileSize.Value));
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

            // Sorting
            var sortDefinition = request.SortBy?.ToLower() switch
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
                    Builders<JwstDataModel>.Sort.Descending(x => x.UploadDate)
            };

            // Pagination
            var skip = (request.Page - 1) * request.PageSize;
            var limit = request.PageSize;

            return await _jwstDataCollection.Find(filter)
                .Sort(sortDefinition)
                .Skip(skip)
                .Limit(limit)
                .ToListAsync();
        }

        public async Task<long> GetSearchCountAsync(SearchRequest request)
        {
            // Similar filter logic as AdvancedSearchAsync but without pagination
            var filter = Builders<JwstDataModel>.Filter.Empty;

            if (!string.IsNullOrEmpty(request.SearchTerm))
            {
                var searchFilter = Builders<JwstDataModel>.Filter.Or(
                    Builders<JwstDataModel>.Filter.Regex(x => x.FileName, new BsonRegularExpression(request.SearchTerm, "i")),
                    Builders<JwstDataModel>.Filter.Regex(x => x.Description, new BsonRegularExpression(request.SearchTerm, "i")),
                    Builders<JwstDataModel>.Filter.AnyIn(x => x.Tags, new[] { request.SearchTerm })
                );
                filter = Builders<JwstDataModel>.Filter.And(filter, searchFilter);
            }

            // Add other filters as needed...
            return await _jwstDataCollection.CountDocumentsAsync(filter);
        }

        // Processing status management
        public async Task UpdateProcessingStatusAsync(string id, string status) =>
            await _jwstDataCollection.UpdateOneAsync(
                x => x.Id == id,
                Builders<JwstDataModel>.Update.Set(x => x.ProcessingStatus, status)
            );

        public async Task AddProcessingResultAsync(string id, ProcessingResult result)
        {
            var update = Builders<JwstDataModel>.Update.Push(x => x.ProcessingResults, result);
            await _jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        // File validation
        public async Task UpdateValidationStatusAsync(string id, bool isValidated, string? validationError = null)
        {
            var update = Builders<JwstDataModel>.Update
                .Set(x => x.IsValidated, isValidated)
                .Set(x => x.ValidationError, validationError);
            await _jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        // Access tracking
        public async Task UpdateLastAccessedAsync(string id)
        {
            var update = Builders<JwstDataModel>.Update.Set(x => x.LastAccessed, DateTime.UtcNow);
            await _jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        // Archive functionality
        public async Task ArchiveAsync(string id)
        {
            var update = Builders<JwstDataModel>.Update
                .Set(x => x.IsArchived, true)
                .Set(x => x.ArchivedDate, DateTime.UtcNow);
            await _jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        public async Task UnarchiveAsync(string id)
        {
            var update = Builders<JwstDataModel>.Update
                .Set(x => x.IsArchived, false)
                .Set(x => x.ArchivedDate, (DateTime?)null);
            await _jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        public async Task<List<JwstDataModel>> GetNonArchivedAsync() =>
            await _jwstDataCollection.Find(x => x.IsArchived == false).ToListAsync();

        public async Task<List<JwstDataModel>> GetArchivedAsync() =>
            await _jwstDataCollection.Find(x => x.IsArchived == true).ToListAsync();

        // Statistics
        public async Task<DataStatistics> GetStatisticsAsync()
        {
            var stats = new DataStatistics();

            // Get all data for simple statistics
            var allData = await _jwstDataCollection.Find(_ => true).ToListAsync();
            
            if (allData.Any())
            {
                stats.TotalFiles = allData.Count;
                stats.TotalSize = allData.Sum(x => x.FileSize);
                stats.AverageFileSize = allData.Average(x => x.FileSize);
                stats.OldestFile = allData.Min(x => x.UploadDate);
                stats.NewestFile = allData.Max(x => x.UploadDate);
                
                // Data type distribution
                stats.DataTypeDistribution = allData
                    .GroupBy(x => x.DataType)
                    .ToDictionary(g => g.Key ?? "unknown", g => g.Count());
                
                // Status distribution
                stats.StatusDistribution = allData
                    .GroupBy(x => x.ProcessingStatus ?? "unknown")
                    .ToDictionary(g => g.Key, g => g.Count());
                
                // Format distribution
                stats.FormatDistribution = allData
                    .Where(x => !string.IsNullOrEmpty(x.FileFormat))
                    .GroupBy(x => x.FileFormat)
                    .ToDictionary(g => g.Key ?? "unknown", g => g.Count());

                // Processing level distribution
                stats.ProcessingLevelDistribution = allData
                    .Where(x => !string.IsNullOrEmpty(x.ProcessingLevel))
                    .GroupBy(x => x.ProcessingLevel)
                    .ToDictionary(g => g.Key ?? "unknown", g => g.Count());

                // Most common tags
                stats.MostCommonTags = allData
                    .SelectMany(x => x.Tags)
                    .GroupBy(tag => tag)
                    .OrderByDescending(g => g.Count())
                    .Take(10)
                    .Select(g => g.Key)
                    .ToList();
            }

            // Validated and public files
            stats.ValidatedFiles = (int)await _jwstDataCollection.CountDocumentsAsync(x => x.IsValidated);
            stats.PublicFiles = (int)await _jwstDataCollection.CountDocumentsAsync(x => x.IsPublic);

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
            var typeFacets = await _jwstDataCollection.Aggregate<BsonDocument>(new[]
            {
                new BsonDocument("$group", new BsonDocument
                {
                    { "_id", "$DataType" },
                    { "count", new BsonDocument("$sum", 1) }
                })
            }).ToListAsync();

            foreach (var facet in typeFacets)
            {
                facets[$"type_{facet.GetValue("_id").AsString}"] = facet.GetValue("count").AsInt32;
            }

            return new SearchResponse
            {
                Data = data.Select(MapToDataResponse).ToList(),
                TotalCount = (int)totalCount,
                Page = request.Page,
                PageSize = request.PageSize,
                TotalPages = (int)totalPages,
                Facets = facets
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
                LastProcessed = model.ProcessingResults.Any() ?
                    model.ProcessingResults.Max(r => r.ProcessedDate) : null,
                // Lineage fields
                ProcessingLevel = model.ProcessingLevel,
                ObservationBaseId = model.ObservationBaseId,
                ExposureId = model.ExposureId,
                ParentId = model.ParentId,
                DerivedFrom = model.DerivedFrom
            };
        }

        // Bulk operations
        public async Task BulkUpdateTagsAsync(List<string> ids, List<string> tags, bool append = true)
        {
            var filter = Builders<JwstDataModel>.Filter.In(x => x.Id, ids);
            var update = append ? 
                Builders<JwstDataModel>.Update.AddToSetEach(x => x.Tags, tags) :
                Builders<JwstDataModel>.Update.Set(x => x.Tags, tags);
            
            await _jwstDataCollection.UpdateManyAsync(filter, update);
        }

        public async Task BulkUpdateStatusAsync(List<string> ids, string status)
        {
            var filter = Builders<JwstDataModel>.Filter.In(x => x.Id, ids);
            var update = Builders<JwstDataModel>.Update.Set(x => x.ProcessingStatus, status);
            
            await _jwstDataCollection.UpdateManyAsync(filter, update);
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
            var result = await _jwstDataCollection.Find(filter).Sort(sort).FirstOrDefaultAsync();
            return result?.Version ?? 0;
        }

        // Lineage query methods
        public async Task<List<JwstDataModel>> GetByObservationBaseIdAsync(string observationBaseId) =>
            await _jwstDataCollection.Find(x => x.ObservationBaseId == observationBaseId).ToListAsync();

        public async Task<List<JwstDataModel>> GetByProcessingLevelAsync(string processingLevel) =>
            await _jwstDataCollection.Find(x => x.ProcessingLevel == processingLevel).ToListAsync();

        public async Task<List<JwstDataModel>> GetLineageTreeAsync(string observationBaseId)
        {
            var filter = Builders<JwstDataModel>.Filter.Eq(x => x.ObservationBaseId, observationBaseId);
            var sort = Builders<JwstDataModel>.Sort
                .Ascending(x => x.ProcessingLevel)
                .Ascending(x => x.FileName);
            return await _jwstDataCollection.Find(filter).Sort(sort).ToListAsync();
        }

        public async Task<Dictionary<string, List<JwstDataModel>>> GetLineageGroupedAsync()
        {
            var allData = await _jwstDataCollection.Find(x => x.ObservationBaseId != null).ToListAsync();
            return allData
                .GroupBy(x => x.ObservationBaseId ?? "unknown")
                .ToDictionary(g => g.Key, g => g.OrderBy(x => x.ProcessingLevel).ToList());
        }

        public async Task UpdateLineageAsync(string id, string? parentId, List<string>? derivedFrom)
        {
            var update = Builders<JwstDataModel>.Update
                .Set(x => x.ParentId, parentId)
                .Set(x => x.DerivedFrom, derivedFrom ?? new List<string>());
            await _jwstDataCollection.UpdateOneAsync(x => x.Id == id, update);
        }

        // Delete all records by observation base ID
        public async Task<DeleteResult> RemoveByObservationBaseIdAsync(string observationBaseId) =>
            await _jwstDataCollection.DeleteManyAsync(x => x.ObservationBaseId == observationBaseId);
    }

    public class MongoDBSettings
    {
        public string ConnectionString { get; set; } = string.Empty;
        public string DatabaseName { get; set; } = string.Empty;
    }
} 