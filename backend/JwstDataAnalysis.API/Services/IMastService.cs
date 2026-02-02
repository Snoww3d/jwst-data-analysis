// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Interface for MAST portal search and download operations.
    /// </summary>
    public interface IMastService
    {
        /// <summary>
        /// Search MAST by target name.
        /// </summary>
        Task<MastSearchResponse> SearchByTargetAsync(MastTargetSearchRequest request);

        /// <summary>
        /// Search MAST by RA/Dec coordinates.
        /// </summary>
        Task<MastSearchResponse> SearchByCoordinatesAsync(MastCoordinateSearchRequest request);

        /// <summary>
        /// Search MAST by observation ID.
        /// </summary>
        Task<MastSearchResponse> SearchByObservationIdAsync(MastObservationSearchRequest request);

        /// <summary>
        /// Search MAST by program/proposal ID.
        /// </summary>
        Task<MastSearchResponse> SearchByProgramIdAsync(MastProgramSearchRequest request);

        /// <summary>
        /// Search MAST for recently released observations.
        /// </summary>
        Task<MastSearchResponse> SearchRecentReleasesAsync(MastRecentReleasesRequest request);

        /// <summary>
        /// Get available data products for an observation.
        /// </summary>
        Task<MastDataProductsResponse> GetDataProductsAsync(MastDataProductsRequest request);

        /// <summary>
        /// Download observation data (synchronous).
        /// </summary>
        Task<MastDownloadResponse> DownloadObservationAsync(MastDownloadRequest request);

        /// <summary>
        /// Start an async download job in the processing engine.
        /// </summary>
        Task<DownloadJobStartResponse> StartAsyncDownloadAsync(MastDownloadRequest request);

        /// <summary>
        /// Get the progress of an async download job.
        /// </summary>
        Task<DownloadJobProgress?> GetDownloadProgressAsync(string jobId);

        /// <summary>
        /// Start a chunked download job with byte-level progress tracking.
        /// </summary>
        Task<ChunkedDownloadStartResponse> StartChunkedDownloadAsync(ChunkedDownloadRequest request);

        /// <summary>
        /// Resume a paused or failed download job.
        /// </summary>
        Task<PauseResumeResponse> ResumeDownloadAsync(string jobId);

        /// <summary>
        /// Pause an active download job.
        /// </summary>
        Task<PauseResumeResponse> PauseDownloadAsync(string jobId);

        /// <summary>
        /// Get detailed byte-level progress for a chunked download job.
        /// </summary>
        Task<DownloadJobProgress?> GetChunkedDownloadProgressAsync(string jobId);

        /// <summary>
        /// List all downloads that can be resumed.
        /// </summary>
        Task<ResumableJobsResponse?> GetResumableDownloadsAsync();
    }
}
