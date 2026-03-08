// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Threading.Channels;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Work item for the mosaic background queue.
    /// </summary>
    public sealed class MosaicJobItem
    {
        public required string JobId { get; init; }

        public required MosaicRequestDto Request { get; init; }

        public string? UserId { get; init; }

        public bool IsAuthenticated { get; init; }

        public bool IsAdmin { get; init; }

        /// <summary>
        /// Gets a value indicating whether the mosaic is generated as FITS and persisted
        /// as a data record (the "Save FITS to Library" flow). When false, an image (PNG/JPEG)
        /// is generated and stored as a blob for download (the "Export &amp; Download" flow).
        /// </summary>
        public bool SaveToLibrary { get; init; }

        /// <summary>
        /// Gets a value indicating whether this is an auto-generated observation-level mosaic
        /// (triggered post-import for large per-detector file groups).
        /// </summary>
        public bool IsObservationMosaic { get; init; }

        /// <summary>
        /// Gets the source data IDs for observation mosaic generation.
        /// Only populated when <see cref="IsObservationMosaic"/> is true.
        /// </summary>
        public List<string>? SourceDataIds { get; init; }

        /// <summary>
        /// Gets the observation base ID for observation mosaic generation.
        /// </summary>
        public string? ObservationBaseId { get; init; }
    }

#pragma warning disable CA1711 // Type name intentionally ends in 'Queue' — it is a queue
    public sealed class MosaicQueue
#pragma warning restore CA1711
    {
        private readonly Channel<MosaicJobItem> channel = Channel.CreateBounded<MosaicJobItem>(
            new BoundedChannelOptions(10) { SingleReader = true });

        public ChannelReader<MosaicJobItem> Reader => channel.Reader;

        /// <summary>
        /// Try to enqueue a mosaic job. Returns false when the queue is full.
        /// </summary>
        public bool TryEnqueue(MosaicJobItem item)
        {
            return channel.Writer.TryWrite(item);
        }
    }
}
