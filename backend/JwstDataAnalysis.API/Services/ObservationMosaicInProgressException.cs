// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Thrown when a sync composite preview is requested but an observation mosaic
    /// is currently being generated in the background.
    /// </summary>
    public sealed class ObservationMosaicInProgressException : Exception
    {
        public ObservationMosaicInProgressException(string observationBaseId, string jobId)
            : base($"Observation mosaic for {observationBaseId} is being generated (job {jobId})")
        {
            ObservationBaseId = observationBaseId;
            JobId = jobId;
        }

        public string ObservationBaseId { get; }

        public string JobId { get; }
    }
}
