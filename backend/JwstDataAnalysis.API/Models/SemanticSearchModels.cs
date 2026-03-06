// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Models
{
    /// <summary>
    /// A single result from Python semantic search, before enrichment.
    /// </summary>
    public class PythonSearchResult
    {
        public string FileId { get; set; } = string.Empty;

        public double Score { get; set; }

        public string MatchedText { get; set; } = string.Empty;
    }

    /// <summary>
    /// Response from Python /semantic/search endpoint.
    /// </summary>
    public class PythonSearchResponse
    {
        public List<PythonSearchResult> Results { get; set; } = [];

        public string Query { get; set; } = string.Empty;

        public double EmbedTimeMs { get; set; }

        public double SearchTimeMs { get; set; }

        public int TotalIndexed { get; set; }
    }

    /// <summary>
    /// Enriched search result returned to the frontend.
    /// </summary>
    public class SemanticSearchResult
    {
        public string Id { get; set; } = string.Empty;

        public string FileName { get; set; } = string.Empty;

        public double Score { get; set; }

        public string MatchedText { get; set; } = string.Empty;

        public string? TargetName { get; set; }

        public string? Instrument { get; set; }

        public string? Filter { get; set; }

        public string? ProcessingLevel { get; set; }

        public string? WavelengthRange { get; set; }

        public double? ExposureTime { get; set; }

        public byte[]? ThumbnailData { get; set; }
    }

    /// <summary>
    /// Full search response returned to the frontend.
    /// </summary>
    public class SemanticSearchResponse
    {
        public List<SemanticSearchResult> Results { get; set; } = [];

        public string Query { get; set; } = string.Empty;

        public double EmbedTimeMs { get; set; }

        public double SearchTimeMs { get; set; }

        public int TotalIndexed { get; set; }

        public int ResultCount { get; set; }
    }

    /// <summary>
    /// Response from Python /semantic/index-status endpoint.
    /// </summary>
    public class IndexStatusResponse
    {
        public int TotalIndexed { get; set; }

        public bool ModelLoaded { get; set; }

        public bool IndexFileExists { get; set; }

        public string ModelName { get; set; } = string.Empty;

        public int EmbeddingDim { get; set; }
    }

    /// <summary>
    /// Metadata for a file to be embedded (sent to Python).
    /// </summary>
    public class FileEmbeddingMetadata
    {
        public string FileId { get; set; } = string.Empty;

        public string? TargetName { get; set; }

        public string? Instrument { get; set; }

        public string? FilterName { get; set; }

        public double? ExposureTime { get; set; }

        public string? WavelengthRange { get; set; }

        public string? ProcessingLevel { get; set; }

        public int? CalibrationLevel { get; set; }

        public string? ObservationDate { get; set; }

        public string? ProposalPi { get; set; }

        public string? ProposalId { get; set; }

        public string? ObservationTitle { get; set; }

        public string? DataType { get; set; }

        public string? FileName { get; set; }
    }

    /// <summary>
    /// Response from Python /semantic/embed-batch endpoint.
    /// </summary>
    public class EmbedBatchResponse
    {
        public int EmbeddedCount { get; set; }

        public int TotalIndexed { get; set; }

        public List<string> Errors { get; set; } = [];
    }

    /// <summary>
    /// Work item for the embedding background queue.
    /// </summary>
    public sealed class EmbeddingJobItem
    {
        public required string JobId { get; init; }

        public required List<string> FileIds { get; init; }

        public bool IsFullReindex { get; init; }
    }
}
