// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Runtime.CompilerServices;

using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Transfer;

using JwstDataAnalysis.API.Configuration;

using Microsoft.Extensions.Options;

namespace JwstDataAnalysis.API.Services.Storage
{
    /// <summary>
    /// S3-compatible object storage implementation of <see cref="IStorageProvider"/>.
    /// Works with AWS S3, SeaweedFS, and other S3-compatible services.
    /// </summary>
    public sealed partial class S3StorageProvider : IStorageProvider, IDisposable
    {
        private const long LargeObjectThreshold = 100 * 1024 * 1024; // 100MB

        private readonly AmazonS3Client client;
        private readonly string bucketName;
        private readonly S3Settings settings;
        private readonly ILogger<S3StorageProvider> logger;
        private bool disposed;

        public S3StorageProvider(IOptions<S3Settings> options, ILogger<S3StorageProvider> logger)
        {
            settings = options.Value;
            this.logger = logger;
            bucketName = settings.BucketName;

            var config = new AmazonS3Config
            {
                ForcePathStyle = settings.ForcePathStyle,
            };

            if (!string.IsNullOrEmpty(settings.Endpoint))
            {
                config.ServiceURL = settings.Endpoint;
            }
            else if (!string.IsNullOrEmpty(settings.Region))
            {
                config.RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(settings.Region);
            }

            if (!string.IsNullOrEmpty(settings.AccessKey) && !string.IsNullOrEmpty(settings.SecretKey))
            {
                client = new AmazonS3Client(settings.AccessKey, settings.SecretKey, config);
            }
            else
            {
                // Use default credential chain (IAM roles, environment variables, etc.)
                client = new AmazonS3Client(config);
            }

            LogInitialized(bucketName, settings.Endpoint ?? "default AWS");
        }

        /// <inheritdoc/>
        public bool SupportsLocalPath => false;

        /// <inheritdoc/>
        public async Task WriteAsync(string key, Stream data, CancellationToken ct = default)
        {
            // Use TransferUtility for large objects (multipart upload)
            if (data.CanSeek && data.Length > LargeObjectThreshold)
            {
                using var transferUtility = new TransferUtility(client);
                var uploadRequest = new TransferUtilityUploadRequest
                {
                    BucketName = bucketName,
                    Key = key,
                    InputStream = data,
                };
                await transferUtility.UploadAsync(uploadRequest, ct);
            }
            else
            {
                var request = new PutObjectRequest
                {
                    BucketName = bucketName,
                    Key = key,
                    InputStream = data,
                };
                await client.PutObjectAsync(request, ct);
            }
        }

        /// <inheritdoc/>
        public async Task<Stream> ReadStreamAsync(string key, CancellationToken ct = default)
        {
            try
            {
                var response = await client.GetObjectAsync(bucketName, key, ct);
                return response.ResponseStream;
            }
            catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                throw new FileNotFoundException($"File not found in S3: {key}", key);
            }
        }

        /// <inheritdoc/>
        public async Task<bool> ExistsAsync(string key, CancellationToken ct = default)
        {
            try
            {
                await client.GetObjectMetadataAsync(bucketName, key, ct);
                return true;
            }
            catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return false;
            }
        }

        /// <inheritdoc/>
        public async Task DeleteAsync(string key, CancellationToken ct = default)
        {
            await client.DeleteObjectAsync(bucketName, key, ct);
        }

        /// <inheritdoc/>
        public async Task<long> GetSizeAsync(string key, CancellationToken ct = default)
        {
            var metadata = await client.GetObjectMetadataAsync(bucketName, key, ct);
            return metadata.ContentLength;
        }

        /// <inheritdoc/>
        public Task<string?> GetPresignedUrlAsync(string key, TimeSpan expiry, string? downloadFilename = null, CancellationToken ct = default)
        {
            var request = new GetPreSignedUrlRequest
            {
                BucketName = bucketName,
                Key = key,
                Expires = DateTime.UtcNow.Add(expiry),
                Verb = HttpVerb.GET,
            };

            // Set Content-Disposition so browsers use the original filename
            if (!string.IsNullOrEmpty(downloadFilename))
            {
                request.ResponseHeaderOverrides.ContentDisposition =
                    $"attachment; filename=\"{downloadFilename}\"";
            }

            var url = client.GetPreSignedURL(request);

            // Rewrite internal Docker hostname to public endpoint if configured
            if (!string.IsNullOrEmpty(settings.PublicEndpoint) && !string.IsNullOrEmpty(settings.Endpoint))
            {
                url = url.Replace(settings.Endpoint, settings.PublicEndpoint);
            }

            return Task.FromResult<string?>(url);
        }

        /// <inheritdoc/>
        public async IAsyncEnumerable<string> ListAsync(
            string prefix,
            [EnumeratorCancellation] CancellationToken ct = default)
        {
            var request = new ListObjectsV2Request
            {
                BucketName = bucketName,
                Prefix = prefix,
            };

            ListObjectsV2Response response;
            do
            {
                ct.ThrowIfCancellationRequested();
                response = await client.ListObjectsV2Async(request, ct);

                foreach (var obj in response.S3Objects)
                {
                    yield return obj.Key;
                }

                request.ContinuationToken = response.NextContinuationToken;
            }
            while (response.IsTruncated == true);
        }

        /// <inheritdoc/>
        public string ResolveLocalPath(string key)
        {
            throw new NotSupportedException(
                "S3 storage does not support local filesystem paths. " +
                "Check SupportsLocalPath before calling this method.");
        }

        public void Dispose()
        {
            if (!disposed)
            {
                client.Dispose();
                disposed = true;
            }
        }

        [LoggerMessage(EventId = 4001, Level = LogLevel.Information,
            Message = "Initialized S3 storage provider (bucket={Bucket}, endpoint={Endpoint})")]
        private partial void LogInitialized(string bucket, string endpoint);
    }
}
