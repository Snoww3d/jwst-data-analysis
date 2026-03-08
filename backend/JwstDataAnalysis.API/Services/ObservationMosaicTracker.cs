// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Collections.Concurrent;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Lightweight in-memory tracker for active observation mosaic jobs.
    /// Maps ObservationBaseId → JobId so the composite pipeline can detect
    /// in-progress mosaic generation and return 409 for sync previews.
    /// Resets on restart (correct — no running jobs survive a restart).
    /// </summary>
    public sealed class ObservationMosaicTracker
    {
        private readonly ConcurrentDictionary<string, string> activeJobs = new(StringComparer.Ordinal);

        /// <summary>
        /// Register an active mosaic job for the given observation.
        /// </summary>
        /// <returns>True if registered; false if an entry already exists.</returns>
        public bool TryRegister(string observationBaseId, string jobId)
        {
            return activeJobs.TryAdd(observationBaseId, jobId);
        }

        /// <summary>
        /// Check whether an active mosaic job exists for the given observation.
        /// </summary>
        public bool TryGetActiveJobId(string observationBaseId, out string? jobId)
        {
            return activeJobs.TryGetValue(observationBaseId, out jobId);
        }

        /// <summary>
        /// Remove the tracker entry on job completion or failure.
        /// </summary>
        public void Remove(string observationBaseId)
        {
            activeJobs.TryRemove(observationBaseId, out _);
        }
    }
}
