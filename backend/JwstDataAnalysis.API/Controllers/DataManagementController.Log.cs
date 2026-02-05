// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Controllers
{
    public partial class DataManagementController
    {
        // Event IDs: 3xxx for Data Management Controller operations

        // Search and retrieval operations (31xx)
        [LoggerMessage(EventId = 3101, Level = LogLevel.Error,
            Message = "Error performing advanced search")]
        private partial void LogErrorAdvancedSearch(Exception ex);

        [LoggerMessage(EventId = 3102, Level = LogLevel.Error,
            Message = "Error retrieving statistics")]
        private partial void LogErrorRetrievingStatistics(Exception ex);

        [LoggerMessage(EventId = 3103, Level = LogLevel.Error,
            Message = "Error retrieving public data")]
        private partial void LogErrorRetrievingPublicData(Exception ex);

        [LoggerMessage(EventId = 3104, Level = LogLevel.Error,
            Message = "Error retrieving validated data")]
        private partial void LogErrorRetrievingValidatedData(Exception ex);

        [LoggerMessage(EventId = 3105, Level = LogLevel.Error,
            Message = "Error retrieving data by file format: {FileFormat}")]
        private partial void LogErrorRetrievingByFileFormat(Exception ex, string fileFormat);

        [LoggerMessage(EventId = 3106, Level = LogLevel.Error,
            Message = "Error retrieving common tags")]
        private partial void LogErrorRetrievingTags(Exception ex);

        // Bulk operations (32xx)
        [LoggerMessage(EventId = 3201, Level = LogLevel.Error,
            Message = "Error performing bulk tag update")]
        private partial void LogErrorBulkTagUpdate(Exception ex);

        [LoggerMessage(EventId = 3202, Level = LogLevel.Error,
            Message = "Error performing bulk status update")]
        private partial void LogErrorBulkStatusUpdate(Exception ex);

        // Export operations (33xx)
        [LoggerMessage(EventId = 3301, Level = LogLevel.Error,
            Message = "Error exporting data")]
        private partial void LogErrorExportingData(Exception ex);

        [LoggerMessage(EventId = 3302, Level = LogLevel.Warning,
            Message = "Invalid export ID format attempted: {ExportId}")]
        private partial void LogInvalidExportIdFormat(string exportId);

        [LoggerMessage(EventId = 3303, Level = LogLevel.Warning,
            Message = "Path traversal attempt blocked for export: {ExportId}")]
        private partial void LogPathTraversalAttemptBlocked(string exportId);

        [LoggerMessage(EventId = 3304, Level = LogLevel.Error,
            Message = "Error downloading export: {ExportId}")]
        private partial void LogErrorDownloadingExport(Exception ex, string exportId);

        // Bulk import operations (34xx)
        [LoggerMessage(EventId = 3401, Level = LogLevel.Information,
            Message = "Found {FileCount} FITS files in {ObsCount} observations")]
        private partial void LogFoundFitsFiles(int fileCount, int obsCount);

        [LoggerMessage(EventId = 3402, Level = LogLevel.Debug,
            Message = "Fetched MAST metadata for observation {ObsId}")]
        private partial void LogFetchedMastMetadata(string obsId);

        [LoggerMessage(EventId = 3403, Level = LogLevel.Warning,
            Message = "Could not fetch MAST metadata for {ObsId}, using basic metadata")]
        private partial void LogCouldNotFetchMastMetadata(Exception ex, string obsId);

        [LoggerMessage(EventId = 3404, Level = LogLevel.Information,
            Message = "Bulk import completed: {Imported} imported, {Skipped} skipped, {Refreshed} refreshed, {Errors} errors")]
        private partial void LogBulkImportCompleted(int imported, int skipped, int refreshed, int errors);

        [LoggerMessage(EventId = 3405, Level = LogLevel.Error,
            Message = "Error during bulk import")]
        private partial void LogErrorBulkImport(Exception ex);

        // Ownership operations (35xx)
        [LoggerMessage(EventId = 3501, Level = LogLevel.Error,
            Message = "Error claiming orphaned data")]
        private partial void LogErrorClaimingOrphanedData(Exception ex);
    }
}
