// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Models
{
    /// <summary>
    /// Sent via SignalR when a job's progress updates.
    /// </summary>
    public class JobProgressUpdate
    {
        public string JobId { get; set; } = string.Empty;

        public string JobType { get; set; } = string.Empty;

        public string State { get; set; } = string.Empty;

        public int ProgressPercent { get; set; }

        public string? Stage { get; set; }

        public string? Message { get; set; }

        public DateTime UpdatedAt { get; set; }

        /// <summary>
        /// Gets or sets type-specific metadata (e.g., byte-level progress for imports).
        /// </summary>
        public Dictionary<string, object>? Metadata { get; set; }
    }

    /// <summary>
    /// Sent via SignalR when a job completes successfully.
    /// </summary>
    public class JobCompletionUpdate
    {
        public string JobId { get; set; } = string.Empty;

        public string JobType { get; set; } = string.Empty;

        public string State { get; set; } = "completed";

        public string? Message { get; set; }

        public DateTime CompletedAt { get; set; }

        public DateTime ExpiresAt { get; set; }

        /// <summary>
        /// Gets or sets the result kind: "blob" for binary file results, "data_id" for MongoDB record references.
        /// </summary>
        public string? ResultKind { get; set; }

        public string? ResultContentType { get; set; }

        public string? ResultFilename { get; set; }

        /// <summary>
        /// Gets or sets the result data ID for data_id results (e.g., saved mosaics).
        /// </summary>
        public string? ResultDataId { get; set; }
    }

    /// <summary>
    /// Sent via SignalR when a job fails.
    /// </summary>
    public class JobFailureUpdate
    {
        public string JobId { get; set; } = string.Empty;

        public string JobType { get; set; } = string.Empty;

        public string State { get; set; } = "failed";

        public string Error { get; set; } = string.Empty;

        public DateTime FailedAt { get; set; }
    }

    /// <summary>
    /// Full job snapshot sent on SignalR reconnect to catch up the client.
    /// </summary>
    public class JobSnapshotUpdate
    {
        public string JobId { get; set; } = string.Empty;

        public string JobType { get; set; } = string.Empty;

        public string State { get; set; } = string.Empty;

        public string? Description { get; set; }

        public int ProgressPercent { get; set; }

        public string? Stage { get; set; }

        public string? Message { get; set; }

        public string? Error { get; set; }

        public bool CancelRequested { get; set; }

        public DateTime CreatedAt { get; set; }

        public DateTime? StartedAt { get; set; }

        public DateTime UpdatedAt { get; set; }

        public DateTime? CompletedAt { get; set; }

        public DateTime? ExpiresAt { get; set; }

        // Result fields (populated on completion)
        public string? ResultKind { get; set; }

        public string? ResultContentType { get; set; }

        public string? ResultFilename { get; set; }

        public string? ResultDataId { get; set; }

        /// <summary>
        /// Gets or sets type-specific metadata.
        /// </summary>
        public Dictionary<string, object>? Metadata { get; set; }
    }
}
