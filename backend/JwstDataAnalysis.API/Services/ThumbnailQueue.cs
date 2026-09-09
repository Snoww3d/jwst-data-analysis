// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Threading.Channels;

namespace JwstDataAnalysis.API.Services
{
#pragma warning disable CA1711 // Type name intentionally ends in 'Queue' — it is a queue
    public sealed partial class ThumbnailQueue(ILogger<ThumbnailQueue> logger) : IThumbnailQueue
#pragma warning restore CA1711
    {
        private const int Capacity = 50;
        private const int WarningThreshold = Capacity * 4 / 5;

        private readonly Channel<List<string>> channel = Channel.CreateBounded<List<string>>(
            new BoundedChannelOptions(Capacity)
            {
                SingleReader = true,
                FullMode = BoundedChannelFullMode.Wait,
            });

        private int pendingCount;

        public ChannelReader<List<string>> Reader => channel.Reader;

        // Includes batches waiting for space, buffered, and currently processing.
        public int PendingCount => Volatile.Read(ref pendingCount);

        public async Task EnqueueBatchAsync(List<string> dataIds, CancellationToken cancellationToken = default)
        {
            if (dataIds.Count == 0)
            {
                return;
            }

            var bufferedCount = channel.Reader.Count;
            if (bufferedCount >= WarningThreshold)
            {
                LogQueueNearCapacity(bufferedCount, Capacity);
            }

            // Count before publishing so a fast consumer cannot decrement first.
            Interlocked.Increment(ref pendingCount);
            try
            {
                await channel.Writer.WriteAsync(dataIds, cancellationToken);
            }
            catch
            {
                Interlocked.Decrement(ref pendingCount);
                throw;
            }
        }

        public void DecrementPending()
        {
            Interlocked.Decrement(ref pendingCount);
        }

        [LoggerMessage(EventId = 8005, Level = LogLevel.Warning,
            Message = "Thumbnail queue near capacity: {BufferedCount}/{Capacity} batches buffered; producers wait when full")]
        private partial void LogQueueNearCapacity(int bufferedCount, int capacity);
    }
}
