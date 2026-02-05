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
    }
}
