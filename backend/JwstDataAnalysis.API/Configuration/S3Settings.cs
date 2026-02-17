// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Configuration
{
    /// <summary>
    /// Configuration settings for S3-compatible object storage.
    /// Bound from the "Storage:S3" configuration section.
    /// </summary>
    public class S3Settings
    {
        /// <summary>
        /// Gets or sets the S3 bucket name for storing application data.
        /// </summary>
        public string BucketName { get; set; } = "jwst-data";

        /// <summary>
        /// Gets or sets the custom S3 endpoint URL (e.g., "http://seaweedfs-s3:8333" for local dev).
        /// Leave null to use the default AWS S3 endpoint.
        /// </summary>
        public string? Endpoint { get; set; }

        /// <summary>
        /// Gets or sets the S3 access key. Required for non-AWS providers (SeaweedFS, MinIO).
        /// For AWS, prefer IAM roles/instance profiles instead.
        /// </summary>
        public string? AccessKey { get; set; }

        /// <summary>
        /// Gets or sets the S3 secret key. Required for non-AWS providers (SeaweedFS, MinIO).
        /// </summary>
        public string? SecretKey { get; set; }

        /// <summary>
        /// Gets or sets a value indicating whether to force path-style addressing (bucket in path, not subdomain).
        /// Required for SeaweedFS, MinIO, and other S3-compatible services.
        /// </summary>
        public bool ForcePathStyle { get; set; } = true;

        /// <summary>
        /// Gets or sets the AWS region (used for signing requests). Defaults to us-east-1.
        /// For non-AWS providers, this can be any valid region string.
        /// </summary>
        public string Region { get; set; } = "us-east-1";

        /// <summary>
        /// Gets or sets the default expiry for presigned download URLs.
        /// </summary>
        public TimeSpan PresignedUrlExpiry { get; set; } = TimeSpan.FromMinutes(15);

        /// <summary>
        /// Gets or sets the public endpoint for generating presigned URLs reachable from the browser.
        /// For local dev, this should be the externally-accessible SeaweedFS URL
        /// (e.g., "http://localhost:8333") since the Docker internal hostname
        /// isn't reachable from the browser.
        /// </summary>
        public string? PublicEndpoint { get; set; }
    }
}
