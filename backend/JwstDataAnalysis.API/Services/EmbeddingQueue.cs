// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Threading.Channels;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
#pragma warning disable CA1711 // Type name intentionally ends in 'Queue' — it is a queue
    public sealed class EmbeddingQueue
#pragma warning restore CA1711
    {
        private readonly Channel<EmbeddingJobItem> channel = Channel.CreateBounded<EmbeddingJobItem>(
            new BoundedChannelOptions(10) { SingleReader = true });

        public ChannelReader<EmbeddingJobItem> Reader => channel.Reader;

        /// <summary>
        /// Try to enqueue an embedding job. Returns false when the queue is full.
        /// </summary>
        public bool TryEnqueue(EmbeddingJobItem item)
        {
            return channel.Writer.TryWrite(item);
        }
    }
}
