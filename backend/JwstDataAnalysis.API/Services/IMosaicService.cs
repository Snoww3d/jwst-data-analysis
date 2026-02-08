// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Interface for WCS mosaic image generation operations.
    /// </summary>
    public interface IMosaicService
    {
        /// <summary>
        /// Generate a WCS-aware mosaic image from 2+ FITS files.
        /// </summary>
        /// <param name="request">Mosaic request with file configurations.</param>
        /// <returns>Binary image data (PNG, JPEG, or FITS).</returns>
        Task<byte[]> GenerateMosaicAsync(MosaicRequestDto request);

        /// <summary>
        /// Generate a FITS mosaic and persist it as a JWST data record.
        /// </summary>
        /// <param name="request">Mosaic request with file configurations.</param>
        /// <param name="userId">Current user ID.</param>
        /// <param name="isAuthenticated">Whether current request is authenticated.</param>
        /// <param name="isAdmin">Whether current user is an admin.</param>
        /// <returns>Metadata for the saved mosaic record.</returns>
        Task<SavedMosaicResponseDto> GenerateAndSaveMosaicAsync(
            MosaicRequestDto request,
            string? userId,
            bool isAuthenticated,
            bool isAdmin);

        /// <summary>
        /// Get WCS footprint polygons for FITS files.
        /// </summary>
        /// <param name="request">Footprint request with data IDs.</param>
        /// <returns>Footprint response with corner coordinates and bounding box.</returns>
        Task<FootprintResponseDto> GetFootprintsAsync(FootprintRequestDto request);
    }
}
