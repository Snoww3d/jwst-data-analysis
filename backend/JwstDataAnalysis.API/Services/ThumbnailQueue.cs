// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Threading.Channels;

namespace JwstDataAnalysis.API.Services
{
#pragma warning disable CA1711 // Type name intentionally ends in 'Queue' — it is a queue
    public sealed class ThumbnailQueue : IThumbnailQueue
#pragma warning restore CA1711
    {
        private readonly Channel<List<string>> channel = Channel.CreateUnbounded<List<string>>(
            new UnboundedChannelOptions { SingleReader = true });

        private int pendingCount;

        public ChannelReader<List<string>> Reader => channel.Reader;

        public int PendingCount => Volatile.Read(ref pendingCount);

        public void EnqueueBatch(List<string> dataIds)
        {
            if (dataIds.Count == 0)
            {
                return;
            }

            channel.Writer.TryWrite(dataIds);
            Interlocked.Increment(ref pendingCount);
        }

        public void DecrementPending()
        {
            Interlocked.Decrement(ref pendingCount);
        }
    }
}
