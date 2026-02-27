// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Service for discovery features: featured targets and recipe suggestions.
    /// </summary>
    public interface IDiscoveryService
    {
        /// <summary>
        /// Get the curated list of featured targets.
        /// </summary>
        /// <returns>List of featured targets.</returns>
        List<FeaturedTarget> GetFeaturedTargets();

        /// <summary>
        /// Resolve a common name or catalog alias to the MAST-compatible target name.
        /// Returns the mastSearchParams.target value if input matches a featured target name or catalogId, null otherwise.
        /// </summary>
        /// <param name="input">The user-provided target name to resolve.</param>
        /// <returns>The resolved MAST target name, or null if no alias match.</returns>
        string? ResolveTargetAlias(string input);

        /// <summary>
        /// Get suggested composite recipes by proxying to the Python processing engine.
        /// </summary>
        /// <param name="request">Recipe request with target name or observations.</param>
        /// <returns>Recipe suggestions from the processing engine.</returns>
        Task<SuggestRecipesResponseDto> SuggestRecipesAsync(SuggestRecipesRequestDto request);
    }
}
