// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
#pragma warning disable CA1711 // Type name intentionally ends in 'Queue' — it is a queue
    public interface IThumbnailQueue
#pragma warning restore CA1711
    {
        int PendingCount { get; }

        void EnqueueBatch(List<string> dataIds);
    }
}
