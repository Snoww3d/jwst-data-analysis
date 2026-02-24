// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Interface for region statistics analysis operations.
    /// </summary>
    public interface IAnalysisService
    {
        /// <summary>
        /// Compute statistics for a selected region within a FITS image.
        /// </summary>
        /// <param name="request">Region statistics request with data ID and region definition.</param>
        /// <returns>Computed statistics for the region.</returns>
        Task<RegionStatisticsResponseDto> GetRegionStatisticsAsync(RegionStatisticsRequestDto request);

        /// <summary>
        /// Detect astronomical sources in a FITS image.
        /// </summary>
        Task<SourceDetectionResponseDto> DetectSourcesAsync(SourceDetectionRequestDto request);

        /// <summary>
        /// Get table HDU information from a FITS file.
        /// </summary>
        Task<TableInfoResponseDto> GetTableInfoAsync(string dataId);

        /// <summary>
        /// Get paginated table data from a specific HDU.
        /// </summary>
        Task<TableDataResponseDto> GetTableDataAsync(
            string dataId,
            int hduIndex = 0,
            int page = 0,
            int pageSize = 100,
            string? sortColumn = null,
            string? sortDirection = null,
            string? search = null);

        /// <summary>
        /// Get spectral data from a FITS file for plotting.
        /// </summary>
        /// <param name="filePath">The storage key / file path of the FITS file.</param>
        /// <param name="hduIndex">The HDU index to read (default 1 for first extension).</param>
        Task<SpectralDataResponseDto> GetSpectralDataAsync(string filePath, int hduIndex = 1);
    }
}
