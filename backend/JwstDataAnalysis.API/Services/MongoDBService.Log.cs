// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    public partial class MongoDBService
    {
        // Event IDs: 6xxx for MongoDB Service operations
        [LoggerMessage(EventId = 6001, Level = LogLevel.Information,
            Message = "MongoDB indexes created/verified successfully. Total indexes: {Count}")]
        private partial void LogIndexesCreated(int count);

        [LoggerMessage(EventId = 6002, Level = LogLevel.Warning,
            Message = "Error creating MongoDB indexes. They may already exist with different options.")]
        private partial void LogIndexCreationWarning(Exception ex);

        [LoggerMessage(EventId = 6003, Level = LogLevel.Information,
            Message = "User collection indexes created/verified successfully. Total indexes: {Count}")]
        private partial void LogUserIndexesCreated(int count);

        [LoggerMessage(EventId = 6004, Level = LogLevel.Warning,
            Message = "Error creating user indexes. They may already exist with different options.")]
        private partial void LogUserIndexCreationWarning(Exception ex);

        // Index migration (60xx)
        [LoggerMessage(EventId = 6005, Level = LogLevel.Information,
            Message = "Dropped legacy index '{IndexName}' during migration")]
        private partial void LogLegacyIndexDropped(string indexName);

        // Deduplication operations (65xx)
        [LoggerMessage(EventId = 6501, Level = LogLevel.Information,
            Message = "Deduplicated file '{FileName}': removed {Count} duplicate(s), kept record {KeptId}")]
        private partial void LogDeduplicatedRecords(string fileName, int count, string keptId);

        [LoggerMessage(EventId = 6502, Level = LogLevel.Information,
            Message = "Deduplication complete: removed {TotalDeleted} duplicate record(s)")]
        private partial void LogDeduplicationComplete(int totalDeleted);

        [LoggerMessage(EventId = 6503, Level = LogLevel.Information,
            Message = "No duplicate records found during deduplication check")]
        private partial void LogNoDuplicatesFound();

        [LoggerMessage(EventId = 6504, Level = LogLevel.Error,
            Message = "Deduplication failed")]
        private partial void LogDeduplicationFailed(Exception ex);

        [LoggerMessage(EventId = 6505, Level = LogLevel.Information,
            Message = "Marked {Count} MAST-imported record(s) as public")]
        private partial void LogMarkedMastDataPublic(long count);

        [LoggerMessage(EventId = 6506, Level = LogLevel.Error,
            Message = "Failed to mark MAST data as public")]
        private partial void LogMarkMastPublicFailed(Exception ex);
    }
}
