namespace JwstDataAnalysis.API.Controllers
{
    public partial class JwstDataController
    {
        // Event IDs: 1xxx for JWST Data Controller CRUD operations

        // Read operations (11xx)
        [LoggerMessage(EventId = 1101, Level = LogLevel.Error,
            Message = "Error retrieving JWST data")]
        private partial void LogErrorRetrievingData(Exception ex);

        [LoggerMessage(EventId = 1102, Level = LogLevel.Error,
            Message = "Error retrieving JWST data with id: {Id}")]
        private partial void LogErrorRetrievingDataById(Exception ex, string id);

        [LoggerMessage(EventId = 1103, Level = LogLevel.Error,
            Message = "Error retrieving JWST data by type: {DataType}")]
        private partial void LogErrorRetrievingByType(Exception ex, string dataType);

        [LoggerMessage(EventId = 1104, Level = LogLevel.Error,
            Message = "Error retrieving JWST data by status: {Status}")]
        private partial void LogErrorRetrievingByStatus(Exception ex, string status);

        [LoggerMessage(EventId = 1105, Level = LogLevel.Error,
            Message = "Error retrieving JWST data for user: {UserId}")]
        private partial void LogErrorRetrievingByUser(Exception ex, string userId);

        [LoggerMessage(EventId = 1106, Level = LogLevel.Error,
            Message = "Error retrieving JWST data by tags: {Tags}")]
        private partial void LogErrorRetrievingByTags(Exception ex, string tags);

        [LoggerMessage(EventId = 1107, Level = LogLevel.Error,
            Message = "Error retrieving archived data")]
        private partial void LogErrorRetrievingArchivedData(Exception ex);

        [LoggerMessage(EventId = 1108, Level = LogLevel.Error,
            Message = "Error performing advanced search")]
        private partial void LogErrorAdvancedSearch(Exception ex);

        [LoggerMessage(EventId = 1109, Level = LogLevel.Error,
            Message = "Error retrieving statistics")]
        private partial void LogErrorRetrievingStatistics(Exception ex);

        [LoggerMessage(EventId = 1110, Level = LogLevel.Error,
            Message = "Error retrieving public data")]
        private partial void LogErrorRetrievingPublicData(Exception ex);

        [LoggerMessage(EventId = 1111, Level = LogLevel.Error,
            Message = "Error retrieving validated data")]
        private partial void LogErrorRetrievingValidatedData(Exception ex);

        [LoggerMessage(EventId = 1112, Level = LogLevel.Error,
            Message = "Error retrieving data by file format: {FileFormat}")]
        private partial void LogErrorRetrievingByFileFormat(Exception ex, string fileFormat);

        [LoggerMessage(EventId = 1113, Level = LogLevel.Error,
            Message = "Error retrieving common tags")]
        private partial void LogErrorRetrievingTags(Exception ex);

        // Create/Update/Delete operations (12xx)
        [LoggerMessage(EventId = 1201, Level = LogLevel.Error,
            Message = "Error creating JWST data")]
        private partial void LogErrorCreatingData(Exception ex);

        [LoggerMessage(EventId = 1202, Level = LogLevel.Error,
            Message = "Error updating JWST data with id: {Id}")]
        private partial void LogErrorUpdatingData(Exception ex, string id);

        [LoggerMessage(EventId = 1203, Level = LogLevel.Error,
            Message = "Error deleting JWST data with id: {Id}")]
        private partial void LogErrorDeletingData(Exception ex, string id);

        // File operations (13xx)
        [LoggerMessage(EventId = 1301, Level = LogLevel.Error,
            Message = "Error retrieving file for id: {Id}")]
        private partial void LogErrorRetrievingFile(Exception ex, string id);

        [LoggerMessage(EventId = 1302, Level = LogLevel.Warning,
            Message = "File content validation failed for {FileName}: {Error}")]
        private partial void LogFileValidationFailed(string fileName, string error);

        [LoggerMessage(EventId = 1303, Level = LogLevel.Information,
            Message = "FITS file uploaded: {Id}")]
        private partial void LogFitsFileUploaded(string id);

        [LoggerMessage(EventId = 1304, Level = LogLevel.Error,
            Message = "Error uploading file")]
        private partial void LogErrorUploadingFile(Exception ex);

        // Preview/Histogram operations (14xx)
        [LoggerMessage(EventId = 1401, Level = LogLevel.Error,
            Message = "Preview generation failed: {StatusCode} - {Error}")]
        private partial void LogPreviewGenerationFailed(System.Net.HttpStatusCode statusCode, string error);

        [LoggerMessage(EventId = 1402, Level = LogLevel.Error,
            Message = "Preview generation timed out for id: {Id}")]
        private partial void LogPreviewTimedOut(Exception ex, string id);

        [LoggerMessage(EventId = 1403, Level = LogLevel.Error,
            Message = "Error connecting to processing engine for preview: {Id}")]
        private partial void LogErrorConnectingForPreview(Exception ex, string id);

        [LoggerMessage(EventId = 1404, Level = LogLevel.Error,
            Message = "Error retrieving preview for id: {Id}")]
        private partial void LogErrorRetrievingPreview(Exception ex, string id);

        [LoggerMessage(EventId = 1405, Level = LogLevel.Error,
            Message = "Histogram computation failed: {StatusCode} - {Error}")]
        private partial void LogHistogramComputationFailed(System.Net.HttpStatusCode statusCode, string error);

        [LoggerMessage(EventId = 1406, Level = LogLevel.Error,
            Message = "Histogram computation timed out for id: {Id}")]
        private partial void LogHistogramTimedOut(Exception ex, string id);

        [LoggerMessage(EventId = 1407, Level = LogLevel.Error,
            Message = "Error connecting to processing engine for histogram: {Id}")]
        private partial void LogErrorConnectingForHistogram(Exception ex, string id);

        [LoggerMessage(EventId = 1408, Level = LogLevel.Error,
            Message = "Error computing histogram for id: {Id}")]
        private partial void LogErrorComputingHistogram(Exception ex, string id);

        // Pixel data operations (149x)
        [LoggerMessage(EventId = 1409, Level = LogLevel.Error,
            Message = "Pixel data retrieval failed: {StatusCode} - {Error}")]
        private partial void LogPixelDataRetrievalFailed(System.Net.HttpStatusCode statusCode, string error);

        [LoggerMessage(EventId = 1410, Level = LogLevel.Error,
            Message = "Pixel data retrieval timed out for id: {Id}")]
        private partial void LogPixelDataTimedOut(Exception ex, string id);

        [LoggerMessage(EventId = 1411, Level = LogLevel.Error,
            Message = "Error connecting to processing engine for pixel data: {Id}")]
        private partial void LogErrorConnectingForPixelData(Exception ex, string id);

        [LoggerMessage(EventId = 1412, Level = LogLevel.Error,
            Message = "Error retrieving pixel data for id: {Id}")]
        private partial void LogErrorRetrievingPixelData(Exception ex, string id);

        // Processing operations (15xx)
        [LoggerMessage(EventId = 1501, Level = LogLevel.Error,
            Message = "Error processing JWST data with id: {Id}")]
        private partial void LogErrorProcessingData(Exception ex, string id);

        [LoggerMessage(EventId = 1502, Level = LogLevel.Error,
            Message = "Error retrieving processing results for id: {Id}")]
        private partial void LogErrorRetrievingProcessingResults(Exception ex, string id);

        [LoggerMessage(EventId = 1503, Level = LogLevel.Error,
            Message = "Error validating data with id: {Id}")]
        private partial void LogErrorValidatingData(Exception ex, string id);

        // Sharing operations (16xx)
        [LoggerMessage(EventId = 1601, Level = LogLevel.Error,
            Message = "Error updating sharing for data with id: {Id}")]
        private partial void LogErrorUpdatingSharing(Exception ex, string id);

        // Archive operations (17xx)
        [LoggerMessage(EventId = 1701, Level = LogLevel.Error,
            Message = "Error archiving data with id: {Id}")]
        private partial void LogErrorArchivingData(Exception ex, string id);

        [LoggerMessage(EventId = 1702, Level = LogLevel.Error,
            Message = "Error unarchiving data with id: {Id}")]
        private partial void LogErrorUnarchivingData(Exception ex, string id);

        // Bulk operations (18xx)
        [LoggerMessage(EventId = 1801, Level = LogLevel.Error,
            Message = "Error performing bulk tag update")]
        private partial void LogErrorBulkTagUpdate(Exception ex);

        [LoggerMessage(EventId = 1802, Level = LogLevel.Error,
            Message = "Error performing bulk status update")]
        private partial void LogErrorBulkStatusUpdate(Exception ex);

        // Lineage operations (19xx)
        [LoggerMessage(EventId = 1901, Level = LogLevel.Error,
            Message = "Error retrieving lineage for: {ObservationBaseId}")]
        private partial void LogErrorRetrievingLineage(Exception ex, string observationBaseId);

        [LoggerMessage(EventId = 1902, Level = LogLevel.Error,
            Message = "Error retrieving all lineages")]
        private partial void LogErrorRetrievingAllLineages(Exception ex);

        // Delete observation operations (1A0x)
        [LoggerMessage(EventId = 1910, Level = LogLevel.Information,
            Message = "Deleted file: {FilePath}")]
        private partial void LogDeletedFile(string filePath);

        [LoggerMessage(EventId = 1911, Level = LogLevel.Warning,
            Message = "File not found (may already be deleted): {FilePath}")]
        private partial void LogFileNotFound(string filePath);

        [LoggerMessage(EventId = 1912, Level = LogLevel.Error,
            Message = "Failed to delete file: {FilePath}")]
        private partial void LogFailedToDeleteFile(Exception ex, string filePath);

        [LoggerMessage(EventId = 1913, Level = LogLevel.Information,
            Message = "Removed empty directory: {Directory}")]
        private partial void LogRemovedEmptyDirectory(string directory);

        [LoggerMessage(EventId = 1914, Level = LogLevel.Warning,
            Message = "Could not remove directory: {Directory}")]
        private partial void LogCouldNotRemoveDirectory(Exception ex, string directory);

        [LoggerMessage(EventId = 1915, Level = LogLevel.Information,
            Message = "Deleted {Count} database records for observation: {ObservationBaseId}")]
        private partial void LogDeletedDbRecords(long count, string observationBaseId);

        [LoggerMessage(EventId = 1916, Level = LogLevel.Error,
            Message = "Error deleting observation: {ObservationBaseId}")]
        private partial void LogErrorDeletingObservation(Exception ex, string observationBaseId);

        // Delete observation level operations (1B0x)
        [LoggerMessage(EventId = 1920, Level = LogLevel.Information,
            Message = "Deleted {Count} {Level} database records for observation: {ObservationBaseId}")]
        private partial void LogDeletedLevelDbRecords(long count, string level, string observationBaseId);

        [LoggerMessage(EventId = 1921, Level = LogLevel.Error,
            Message = "Error deleting {Level} files for observation: {ObservationBaseId}")]
        private partial void LogErrorDeletingLevel(Exception ex, string level, string observationBaseId);

        // Archive level operations (1C0x)
        [LoggerMessage(EventId = 1930, Level = LogLevel.Information,
            Message = "Archived {Count} {Level} files for observation: {ObservationBaseId}")]
        private partial void LogArchivedLevelFiles(long count, string level, string observationBaseId);

        [LoggerMessage(EventId = 1931, Level = LogLevel.Error,
            Message = "Error archiving {Level} files for observation: {ObservationBaseId}")]
        private partial void LogErrorArchivingLevel(Exception ex, string level, string observationBaseId);

        // Migration operations (1D0x)
        [LoggerMessage(EventId = 1940, Level = LogLevel.Error,
            Message = "Error during migration")]
        private partial void LogErrorDuringMigration(Exception ex);

        [LoggerMessage(EventId = 1941, Level = LogLevel.Information,
            Message = "Migrated {FileName}: DataType={DataType}, IsViewable={IsViewable}")]
        private partial void LogMigratedDataType(string fileName, string dataType, bool isViewable);

        [LoggerMessage(EventId = 1942, Level = LogLevel.Error,
            Message = "Error during data type migration")]
        private partial void LogErrorDuringDataTypeMigration(Exception ex);
    }
}
