// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Interface for composite image generation operations.
    /// </summary>
    public interface ICompositeService
    {
        /// <summary>
        /// Generate an N-channel composite image from arbitrary channels with color assignments.
        /// </summary>
        /// <param name="request">N-channel composite request with channel configurations.</param>
        /// <param name="userId">Current user ID when authenticated, otherwise null.</param>
        /// <param name="isAuthenticated">Whether the request is authenticated.</param>
        /// <param name="isAdmin">Whether the current user has Admin role.</param>
        /// <returns>Binary image data (PNG or JPEG).</returns>
        Task<byte[]> GenerateNChannelCompositeAsync(
            NChannelCompositeRequestDto request,
            string? userId,
            bool isAuthenticated,
            bool isAdmin);
    }
}
