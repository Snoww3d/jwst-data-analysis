// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Controllers
{
    public partial class MastController
    {
        // Event IDs: 2xxx for MAST Controller operations

        // Search operations (21xx)
        [LoggerMessage(EventId = 2101, Level = LogLevel.Error,
            Message = "MAST target search failed for: {Target}")]
        private partial void LogTargetSearchFailed(Exception ex, string target);

        [LoggerMessage(EventId = 2102, Level = LogLevel.Error,
            Message = "MAST coordinate search failed for RA:{Ra} Dec:{Dec}")]
        private partial void LogCoordinateSearchFailed(Exception ex, double ra, double dec);

        [LoggerMessage(EventId = 2103, Level = LogLevel.Error,
            Message = "MAST observation search failed for: {ObsId}")]
        private partial void LogObservationSearchFailed(Exception ex, string obsId);

        [LoggerMessage(EventId = 2104, Level = LogLevel.Error,
            Message = "MAST program search failed for: {ProgramId}")]
        private partial void LogProgramSearchFailed(Exception ex, string programId);

        [LoggerMessage(EventId = 2105, Level = LogLevel.Error,
            Message = "MAST recent releases search failed for: {DaysBack} days")]
        private partial void LogRecentReleasesSearchFailed(Exception ex, int daysBack);

        [LoggerMessage(EventId = 2106, Level = LogLevel.Error,
            Message = "Failed to get products for: {ObsId}")]
        private partial void LogFailedToGetProducts(Exception ex, string obsId);

        [LoggerMessage(EventId = 2107, Level = LogLevel.Error,
            Message = "MAST download failed for: {ObsId}")]
        private partial void LogDownloadFailed(Exception ex, string obsId);

        // Import job operations (22xx)
        [LoggerMessage(EventId = 2201, Level = LogLevel.Information,
            Message = "Starting MAST import job {JobId} for observation: {ObsId}")]
        private partial void LogStartingImportJob(string jobId, string obsId);

        [LoggerMessage(EventId = 2202, Level = LogLevel.Information,
            Message = "Paused download job {DownloadJobId} for cancelled import {JobId}")]
        private partial void LogPausedDownloadForCancelled(string downloadJobId, string jobId);

        [LoggerMessage(EventId = 2203, Level = LogLevel.Warning,
            Message = "Could not pause download job {DownloadJobId}")]
        private partial void LogCouldNotPauseDownload(Exception ex, string downloadJobId);

        [LoggerMessage(EventId = 2204, Level = LogLevel.Information,
            Message = "Cancelled import job {JobId} for observation {ObsId}")]
        private partial void LogCancelledImportJob(string jobId, string obsId);

        [LoggerMessage(EventId = 2205, Level = LogLevel.Information,
            Message = "Resumed import job {JobId} (download job {DownloadJobId})")]
        private partial void LogResumedImportJob(string jobId, string downloadJobId);

        [LoggerMessage(EventId = 2206, Level = LogLevel.Information,
            Message = "Processing engine returned 404 for job {DownloadJobId}, checking for completed files")]
        private partial void LogProcessingEngine404(string downloadJobId);

        [LoggerMessage(EventId = 2207, Level = LogLevel.Information,
            Message = "Found {FileCount} existing files for observation {ObsId}, completing import")]
        private partial void LogFoundExistingFiles(int fileCount, string obsId);

        [LoggerMessage(EventId = 2208, Level = LogLevel.Warning,
            Message = "No files found for observation {ObsId}, cannot resume")]
        private partial void LogNoFilesFoundCannotResume(string obsId);

        [LoggerMessage(EventId = 2209, Level = LogLevel.Error,
            Message = "Failed to resume import job {JobId}")]
        private partial void LogFailedToResumeImport(Exception ex, string jobId);

        [LoggerMessage(EventId = 2210, Level = LogLevel.Error,
            Message = "Failed to get resumable downloads")]
        private partial void LogFailedToGetResumableDownloads(Exception ex);

        // Import execution operations (23xx)
        [LoggerMessage(EventId = 2301, Level = LogLevel.Information,
            Message = "Started chunked download job {DownloadJobId} for import job {ImportJobId}")]
        private partial void LogStartedChunkedDownload(string downloadJobId, string importJobId);

        [LoggerMessage(EventId = 2302, Level = LogLevel.Warning,
            Message = "Could not get download progress for job {DownloadJobId}")]
        private partial void LogCouldNotGetDownloadProgress(string downloadJobId);

        [LoggerMessage(EventId = 2303, Level = LogLevel.Information,
            Message = "Import job {JobId} was cancelled during download")]
        private partial void LogImportCancelledDuringDownload(string jobId);

        [LoggerMessage(EventId = 2304, Level = LogLevel.Warning,
            Message = "Could not fetch observation metadata for {ObsId}")]
        private partial void LogCouldNotFetchObservationMetadata(Exception ex, string obsId);

        [LoggerMessage(EventId = 2305, Level = LogLevel.Information,
            Message = "Import job {JobId} was cancelled")]
        private partial void LogImportJobCancelled(string jobId);

        [LoggerMessage(EventId = 2306, Level = LogLevel.Error,
            Message = "MAST import failed for job {JobId}: {ObsId}")]
        private partial void LogMastImportFailed(Exception ex, string jobId, string obsId);

        [LoggerMessage(EventId = 2307, Level = LogLevel.Information,
            Message = "Continuing resumed import job {JobId} for observation {ObsId}")]
        private partial void LogContinuingResumedImport(string jobId, string obsId);

        [LoggerMessage(EventId = 2308, Level = LogLevel.Information,
            Message = "Resumed import job {JobId} was cancelled during download")]
        private partial void LogResumedImportCancelledDuringDownload(string jobId);

        [LoggerMessage(EventId = 2309, Level = LogLevel.Information,
            Message = "Resumed import job {JobId} was cancelled")]
        private partial void LogResumedImportJobCancelled(string jobId);

        [LoggerMessage(EventId = 2310, Level = LogLevel.Error,
            Message = "Resumed MAST import failed for job {JobId}: {ObsId}")]
        private partial void LogResumedMastImportFailed(Exception ex, string jobId, string obsId);

        // Import from existing files (24xx)
        [LoggerMessage(EventId = 2401, Level = LogLevel.Information,
            Message = "Completed import from existing files for job {JobId}: {Count} records created")]
        private partial void LogCompletedImportFromExisting(string jobId, int count);

        [LoggerMessage(EventId = 2402, Level = LogLevel.Error,
            Message = "Failed to complete import from existing files for job {JobId}")]
        private partial void LogFailedToCompleteImportFromExisting(Exception ex, string jobId);

        [LoggerMessage(EventId = 2403, Level = LogLevel.Information,
            Message = "Starting import from existing files for {ObsId}: {FileCount} files found")]
        private partial void LogStartingImportFromExisting(string obsId, int fileCount);

        // Metadata refresh operations (25xx)
        [LoggerMessage(EventId = 2501, Level = LogLevel.Information,
            Message = "Refreshing metadata for MAST observation: {ObsId}")]
        private partial void LogRefreshingMetadata(string obsId);

        [LoggerMessage(EventId = 2502, Level = LogLevel.Error,
            Message = "Failed to fetch MAST metadata for {ObsId}")]
        private partial void LogFailedToFetchMastMetadata(Exception ex, string obsId);

        [LoggerMessage(EventId = 2503, Level = LogLevel.Debug,
            Message = "Updated metadata for record {Id} ({FileName})")]
        private partial void LogUpdatedMetadata(string id, string fileName);

        [LoggerMessage(EventId = 2504, Level = LogLevel.Information,
            Message = "Refreshed metadata for {Count} records of observation {ObsId}")]
        private partial void LogRefreshedMetadata(int count, string obsId);

        [LoggerMessage(EventId = 2505, Level = LogLevel.Error,
            Message = "Failed to refresh metadata for {ObsId}")]
        private partial void LogFailedToRefreshMetadata(Exception ex, string obsId);

        [LoggerMessage(EventId = 2506, Level = LogLevel.Information,
            Message = "Starting bulk metadata refresh for all MAST imports")]
        private partial void LogStartingBulkMetadataRefresh();

        [LoggerMessage(EventId = 2507, Level = LogLevel.Warning,
            Message = "Observation {ObsId} not found in MAST, skipping")]
        private partial void LogObservationNotFoundInMast(string obsId);

        [LoggerMessage(EventId = 2508, Level = LogLevel.Warning,
            Message = "Failed to refresh metadata for observation {ObsId}")]
        private partial void LogFailedToRefreshMetadataForObs(Exception ex, string obsId);

        [LoggerMessage(EventId = 2509, Level = LogLevel.Error,
            Message = "Failed to refresh all MAST metadata")]
        private partial void LogFailedToRefreshAllMetadata(Exception ex);

        // Record creation operations (26xx)
        [LoggerMessage(EventId = 2601, Level = LogLevel.Debug,
            Message = "Could not get file size for {FilePath}")]
        private partial void LogCouldNotGetFileSize(Exception ex, string filePath);

        [LoggerMessage(EventId = 2602, Level = LogLevel.Information,
            Message = "Created database record {Id} for file {File} at level {Level}")]
        private partial void LogCreatedDbRecord(string id, string file, string level);

        [LoggerMessage(EventId = 2603, Level = LogLevel.Information,
            Message = "Skipping duplicate file {FileName}, using existing record {ExistingId}")]
        private partial void LogSkippingDuplicateFile(string fileName, string existingId);

        // Lineage operations (27xx)
        [LoggerMessage(EventId = 2701, Level = LogLevel.Debug,
            Message = "Linked {CurrentFile} (L{CurrentLevel}) -> {ParentFile} (L{ParentLevel})")]
        private partial void LogLinkedLineage(string currentFile, string? currentLevel, string parentFile, string? parentLevel);

        // No observation date warning (28xx)
        [LoggerMessage(EventId = 2801, Level = LogLevel.Warning,
            Message = "No observation date found in MAST metadata. Available fields: {Fields}")]
        private partial void LogNoObservationDateFound(string fields);

        // Bulk metadata refresh result (29xx)
        [LoggerMessage(EventId = 2901, Level = LogLevel.Information,
            Message = "{Message}")]
        private partial void LogBulkRefreshResult(string message);

        // Security events (30xx)
        [LoggerMessage(EventId = 3001, Level = LogLevel.Warning,
            Message = "Path traversal attempt blocked for obsId: {ObsId}")]
        private partial void LogPathTraversalAttemptBlocked(string obsId);
    }
}
