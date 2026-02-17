// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services.Storage
{
    /// <summary>
    /// Abstraction for file storage operations. Keys are relative paths
    /// (e.g. "mast/obs_id/file.fits") with no leading slash or base-path prefix.
    /// </summary>
    public interface IStorageProvider
    {
        /// <summary>
        /// Gets a value indicating whether this provider supports local filesystem paths.
        /// Returns true for local storage, false for cloud providers like S3.
        /// Use this to guard calls to <see cref="ResolveLocalPath"/> without try/catch.
        /// </summary>
        bool SupportsLocalPath { get; }

        /// <summary>
        /// Write data from a stream to storage.
        /// </summary>
        Task WriteAsync(string key, Stream data, CancellationToken ct = default);

        /// <summary>
        /// Read a file from storage as a stream. Caller is responsible for disposing.
        /// </summary>
        Task<Stream> ReadStreamAsync(string key, CancellationToken ct = default);

        /// <summary>
        /// Check whether a key exists in storage.
        /// </summary>
        Task<bool> ExistsAsync(string key, CancellationToken ct = default);

        /// <summary>
        /// Delete a file from storage.
        /// </summary>
        Task DeleteAsync(string key, CancellationToken ct = default);

        /// <summary>
        /// Get the size of a file in storage in bytes without downloading it.
        /// </summary>
        Task<long> GetSizeAsync(string key, CancellationToken ct = default);

        /// <summary>
        /// Get a pre-signed URL for direct client download.
        /// Returns null when the provider does not support pre-signed URLs (e.g. local filesystem).
        /// </summary>
        /// <param name="key">The storage key of the file.</param>
        /// <param name="expiry">How long the URL should be valid.</param>
        /// <param name="downloadFilename">Optional filename for Content-Disposition header override.</param>
        /// <param name="ct">Cancellation token.</param>
        Task<string?> GetPresignedUrlAsync(string key, TimeSpan expiry, string? downloadFilename = null, CancellationToken ct = default);

        /// <summary>
        /// List all keys under a given prefix.
        /// </summary>
        IAsyncEnumerable<string> ListAsync(string prefix, CancellationToken ct = default);

        /// <summary>
        /// Resolve a storage key to an absolute local filesystem path.
        /// Only supported by local storage; cloud providers should throw NotSupportedException.
        /// </summary>
        string ResolveLocalPath(string key);
    }
}
