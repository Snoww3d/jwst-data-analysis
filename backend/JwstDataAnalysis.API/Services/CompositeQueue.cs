// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Threading.Channels;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Work item for the composite background queue.
    /// </summary>
    public sealed class CompositeJobItem
    {
        public required string JobId { get; init; }

        public required NChannelCompositeRequestDto Request { get; init; }

        public string? UserId { get; init; }

        public bool IsAuthenticated { get; init; }

        public bool IsAdmin { get; init; }
    }

#pragma warning disable CA1711 // Type name intentionally ends in 'Queue' — it is a queue
    public sealed class CompositeQueue
#pragma warning restore CA1711
    {
        private readonly Channel<CompositeJobItem> channel = Channel.CreateBounded<CompositeJobItem>(
            new BoundedChannelOptions(10) { SingleReader = true });

        public ChannelReader<CompositeJobItem> Reader => channel.Reader;

        /// <summary>
        /// Try to enqueue a composite job. Returns false when the queue is full.
        /// </summary>
        public bool TryEnqueue(CompositeJobItem item)
        {
            return channel.Writer.TryWrite(item);
        }
    }
}
