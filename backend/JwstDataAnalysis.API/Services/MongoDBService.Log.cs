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
    }
}
