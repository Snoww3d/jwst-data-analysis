// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Runtime.CompilerServices;

namespace JwstDataAnalysis.API.Services.Storage
{
    /// <summary>
    /// Local filesystem implementation of <see cref="IStorageProvider"/>.
    /// Resolves keys relative to a configurable base path (default /app/data).
    /// </summary>
    public class LocalStorageProvider : IStorageProvider
    {
        private readonly string basePath;

        public LocalStorageProvider(IConfiguration configuration)
        {
            basePath = configuration.GetValue<string>("Storage:BasePath") ?? "/app/data";
        }

        /// <inheritdoc/>
        public bool SupportsLocalPath => true;

        /// <inheritdoc/>
        public async Task WriteAsync(string key, Stream data, CancellationToken ct = default)
        {
            var fullPath = ToFullPath(key);
            var directory = Path.GetDirectoryName(fullPath);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            await using var fileStream = new FileStream(
                fullPath, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true);
            await data.CopyToAsync(fileStream, ct);
        }

        /// <inheritdoc/>
        public Task<Stream> ReadStreamAsync(string key, CancellationToken ct = default)
        {
            var fullPath = ToFullPath(key);
            if (!File.Exists(fullPath))
            {
                throw new FileNotFoundException($"File not found: {key}", key);
            }

            Stream stream = new FileStream(
                fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);
            return Task.FromResult(stream);
        }

        /// <inheritdoc/>
        public Task<bool> ExistsAsync(string key, CancellationToken ct = default)
        {
            return Task.FromResult(File.Exists(ToFullPath(key)));
        }

        /// <inheritdoc/>
        public Task DeleteAsync(string key, CancellationToken ct = default)
        {
            var fullPath = ToFullPath(key);
            if (File.Exists(fullPath))
            {
                File.Delete(fullPath);
            }

            return Task.CompletedTask;
        }

        /// <inheritdoc/>
        public Task<long> GetSizeAsync(string key, CancellationToken ct = default)
        {
            var fullPath = ToFullPath(key);
            return Task.FromResult(new FileInfo(fullPath).Length);
        }

        /// <inheritdoc/>
        public Task<string?> GetPresignedUrlAsync(string key, TimeSpan expiry, string? downloadFilename = null, CancellationToken ct = default)
        {
            // Local filesystem does not support pre-signed URLs.
            return Task.FromResult<string?>(null);
        }

        /// <inheritdoc/>
        public async IAsyncEnumerable<string> ListAsync(
            string prefix,
            [EnumeratorCancellation] CancellationToken ct = default)
        {
            var directory = Path.Combine(basePath, prefix.Replace('/', Path.DirectorySeparatorChar));
            if (!Directory.Exists(directory))
            {
                yield break;
            }

            foreach (var file in Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories))
            {
                ct.ThrowIfCancellationRequested();

                // Return key relative to basePath
                var key = Path.GetRelativePath(basePath, file).Replace('\\', '/');
                yield return key;
            }

            await Task.CompletedTask; // Satisfy async requirement
        }

        /// <inheritdoc/>
        public string ResolveLocalPath(string key)
        {
            return ToFullPath(key);
        }

        private string ToFullPath(string key)
        {
            var normalized = key.Replace('/', Path.DirectorySeparatorChar);
            var fullPath = Path.GetFullPath(Path.Combine(basePath, normalized));
            if (!fullPath.StartsWith(basePath + Path.DirectorySeparatorChar, StringComparison.Ordinal)
                && fullPath != basePath)
            {
                throw new ArgumentException($"Invalid storage key: {key}");
            }

            return fullPath;
        }
    }
}
