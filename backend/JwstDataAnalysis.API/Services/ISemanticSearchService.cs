// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    public interface ISemanticSearchService
    {
        /// <summary>
        /// Search the semantic index and enrich results from MongoDB.
        /// </summary>
        Task<SemanticSearchResponse> SearchAsync(string query, int topK, double minScore, string? userId, bool isAdmin);

        /// <summary>
        /// Get the status of the semantic index from Python.
        /// </summary>
        Task<IndexStatusResponse> GetIndexStatusAsync();

        /// <summary>
        /// Embed a batch of files by their MongoDB IDs.
        /// </summary>
        Task<EmbedBatchResponse> EmbedBatchAsync(List<string> fileIds);

        /// <summary>
        /// Embed all eligible files (full re-index).
        /// </summary>
        Task<EmbedBatchResponse> ReindexAllAsync();
    }
}
