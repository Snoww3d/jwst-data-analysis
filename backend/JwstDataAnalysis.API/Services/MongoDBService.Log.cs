//

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
    }
}
