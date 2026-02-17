// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

using MongoDB.Driver;

// Bring User into scope
using User = JwstDataAnalysis.API.Models.User;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Interface for MongoDB operations on JWST data.
    /// Enables dependency injection and unit testing with mocks.
    /// </summary>
    public interface IMongoDBService
    {
        // Index management
        Task EnsureIndexesAsync();

        // Basic CRUD operations
        Task<List<JwstDataModel>> GetAsync();

        Task<JwstDataModel?> GetAsync(string id);

        Task<List<JwstDataModel>> GetManyAsync(IEnumerable<string> ids);

        Task<List<JwstDataModel>> GetByDataTypeAsync(string dataType);

        Task<List<JwstDataModel>> GetByStatusAsync(string status);

        Task CreateAsync(JwstDataModel jwstData);

        Task UpdateAsync(string id, JwstDataModel jwstData);

        Task RemoveAsync(string id);

        // Enhanced querying methods
        Task<List<JwstDataModel>> GetByUserIdAsync(string userId);

        Task<List<JwstDataModel>> GetPublicDataAsync();

        Task<List<JwstDataModel>> GetByFileFormatAsync(string fileFormat);

        Task<bool> ExistsByFileNameAsync(string fileName);

        Task<JwstDataModel?> GetByFileNameAsync(string fileName);

        Task<List<JwstDataModel>> GetValidatedDataAsync();

        Task<List<JwstDataModel>> GetByTagsAsync(List<string> tags);

        Task<List<JwstDataModel>> GetByDateRangeAsync(DateTime startDate, DateTime endDate);

        Task<List<JwstDataModel>> GetByFileSizeRangeAsync(long minSize, long maxSize);

        // Advanced search with multiple criteria
        Task<List<JwstDataModel>> AdvancedSearchAsync(SearchRequest request);

        Task<long> GetSearchCountAsync(SearchRequest request);

        // Processing status management
        Task UpdateProcessingStatusAsync(string id, string status);

        Task AddProcessingResultAsync(string id, ProcessingResult result);

        // File validation
        Task UpdateValidationStatusAsync(string id, bool isValidated, string? validationError = null);

        // Access tracking
        Task UpdateLastAccessedAsync(string id);

        // Archive functionality
        Task ArchiveAsync(string id);

        Task UnarchiveAsync(string id);

        Task<List<JwstDataModel>> GetNonArchivedAsync();

        Task<List<JwstDataModel>> GetArchivedAsync();

        // Statistics
        Task<DataStatistics> GetStatisticsAsync();

        // Search with facets
        Task<SearchResponse> SearchWithFacetsAsync(SearchRequest request);

        // Bulk operations
        Task BulkUpdateTagsAsync(List<string> ids, List<string> tags, bool append = true);

        Task BulkUpdateStatusAsync(List<string> ids, string status);

        // Version control
        Task<string> CreateVersionAsync(string parentId, JwstDataModel newVersion);

        // Lineage query methods
        Task<List<JwstDataModel>> GetByObservationBaseIdAsync(string observationBaseId);

        Task<List<JwstDataModel>> GetByProcessingLevelAsync(string processingLevel);

        Task<List<JwstDataModel>> GetLineageTreeAsync(string observationBaseId);

        Task<Dictionary<string, List<JwstDataModel>>> GetLineageGroupedAsync();

        Task UpdateLineageAsync(string id, string? parentId, List<string>? derivedFrom);

        // Delete operations by observation
        Task<DeleteResult> RemoveByObservationBaseIdAsync(string observationBaseId);

        // Get files by observation and processing level
        Task<List<JwstDataModel>> GetByObservationAndLevelAsync(string observationBaseId, string processingLevel);

        // Delete files by observation and processing level
        Task<DeleteResult> RemoveByObservationAndLevelAsync(string observationBaseId, string processingLevel);

        // Archive files by observation and processing level
        Task<long> ArchiveByObservationAndLevelAsync(string observationBaseId, string processingLevel);

        // User management methods
        Task EnsureUserIndexesAsync();

        Task<User?> GetUserByIdAsync(string id);

        Task<User?> GetUserByUsernameAsync(string username);

        Task<User?> GetUserByEmailAsync(string email);

        Task<User?> GetUserByRefreshTokenAsync(string refreshToken);

        Task CreateUserAsync(User user);

        Task UpdateUserAsync(User user);

        Task UpdateRefreshTokenAsync(
            string userId,
            string? refreshToken,
            DateTime? expiresAt,
            string? previousRefreshToken = null,
            DateTime? previousRefreshTokenExpiresAt = null);

        // Data access control
        Task<List<JwstDataModel>> GetAccessibleDataAsync(string userId, bool isAdmin);

        Task<JwstDataModel?> GetAccessibleDataByIdAsync(string dataId, string userId, bool isAdmin);

        /// <summary>
        /// Claims ownership of all data items that have no owner (UserId is null or empty).
        /// </summary>
        /// <param name="userId">The user ID to assign as owner.</param>
        /// <returns>The number of items claimed.</returns>
        Task<long> ClaimOrphanedDataAsync(string userId);

        // Thumbnail methods
        Task UpdateThumbnailAsync(string id, byte[] thumbnailData);

        Task<byte[]?> GetThumbnailAsync(string id);

        Task<List<string>> GetViewableWithoutThumbnailIdsAsync();
    }
}
