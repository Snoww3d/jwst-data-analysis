// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Interface for RGB composite image generation operations.
    /// </summary>
    public interface ICompositeService
    {
        /// <summary>
        /// Generate an RGB composite image from 3 FITS files.
        /// </summary>
        /// <param name="request">Composite request with channel configurations.</param>
        /// <returns>Binary image data (PNG or JPEG).</returns>
        Task<byte[]> GenerateCompositeAsync(CompositeRequestDto request);
    }
}
