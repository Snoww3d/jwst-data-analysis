// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    public interface IThumbnailQueue
    {
        void EnqueueBatch(List<string> dataIds);

        int PendingCount { get; }
    }
}
