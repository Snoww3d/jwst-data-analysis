// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Models
{
    /// <summary>
    /// Request to check which MAST observations have existing data in the library.
    /// </summary>
    public class DataAvailabilityRequest
    {
        /// <summary>
        /// Gets or sets the list of MAST observation IDs (obs_id) to check.
        /// </summary>
        public List<string> ObservationIds { get; set; } = [];
    }

    /// <summary>
    /// Response with availability status for each requested observation.
    /// </summary>
    public class DataAvailabilityResponse
    {
        /// <summary>
        /// Gets or sets the map of MAST obs_id to availability info.
        /// </summary>
        public Dictionary<string, DataAvailabilityItem> Results { get; set; } = [];
    }

    /// <summary>
    /// Availability info for a single observation.
    /// </summary>
    public class DataAvailabilityItem
    {
        /// <summary>
        /// Gets or sets a value indicating whether usable data files exist for this observation.
        /// </summary>
        public bool Available { get; set; }

        /// <summary>
        /// Gets or sets the IDs of the accessible data records for this observation.
        /// </summary>
        public List<string> DataIds { get; set; } = [];

        /// <summary>
        /// Gets or sets the filter name from the observation metadata (e.g. "F770W").
        /// </summary>
        public string? Filter { get; set; }
    }
}
