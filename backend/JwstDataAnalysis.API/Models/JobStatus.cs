// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace JwstDataAnalysis.API.Models
{
    /// <summary>
    /// Unified job status model persisted to MongoDB and exposed via the Jobs API.
    /// Covers all job types: import, composite, mosaic.
    /// </summary>
    public class JobStatus
    {
        [BsonId]
        [BsonRepresentation(BsonType.String)]
        public string JobId { get; set; } = string.Empty;

        public string JobType { get; set; } = string.Empty;

        public string State { get; set; } = JobStates.Queued;

        public string? Description { get; set; }

        public string OwnerUserId { get; set; } = string.Empty;

        public int ProgressPercent { get; set; }

        public string? Stage { get; set; }

        public string? Message { get; set; }

        public string? Error { get; set; }

        public bool CancelRequested { get; set; }

        public DateTime CreatedAt { get; set; }

        public DateTime? StartedAt { get; set; }

        public DateTime UpdatedAt { get; set; }

        public DateTime? CompletedAt { get; set; }

        /// <summary>
        /// Gets or sets the expiration time. Resets on each result access.
        /// The reaper deletes jobs after this time passes.
        /// </summary>
        public DateTime? ExpiresAt { get; set; }

        /// <summary>
        /// Gets or sets the last time the result was accessed (for TTL extension).
        /// </summary>
        public DateTime? LastAccessedAt { get; set; }

        // Result fields (populated on completion)

        /// <summary>
        /// Gets or sets the result kind: "blob" for binary file results, "data_id" for MongoDB record references.
        /// </summary>
        public string? ResultKind { get; set; }

        /// <summary>
        /// Gets or sets the IStorageProvider key for blob results.
        /// </summary>
        public string? ResultStorageKey { get; set; }

        /// <summary>
        /// Gets or sets the MIME type of the result (e.g., "image/png").
        /// </summary>
        public string? ResultContentType { get; set; }

        /// <summary>
        /// Gets or sets the suggested download filename.
        /// </summary>
        public string? ResultFilename { get; set; }

        /// <summary>
        /// Gets or sets the result data ID for data_id results (e.g., saved mosaics).
        /// </summary>
        public string? ResultDataId { get; set; }

        /// <summary>
        /// Gets or sets type-specific metadata (e.g., byte-level progress for imports).
        /// </summary>
        [BsonExtraElements]
        public Dictionary<string, object>? Metadata { get; set; }
    }

    /// <summary>
    /// Constants for job states. State machine: queued -> running -> completed | failed | cancelled.
    /// </summary>
    public static class JobStates
    {
        public const string Queued = "queued";
        public const string Running = "running";
        public const string Completed = "completed";
        public const string Failed = "failed";
        public const string Cancelled = "cancelled";
    }

    /// <summary>
    /// Constants for job types.
    /// </summary>
    public static class JobTypes
    {
        public const string Import = "import";
        public const string Composite = "composite";
        public const string Mosaic = "mosaic";
    }

    /// <summary>
    /// Constants for result kinds.
    /// </summary>
    public static class ResultKinds
    {
        public const string Blob = "blob";
        public const string DataId = "data_id";
    }
}
