// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Configuration
{
    /// <summary>
    /// Configuration settings for automatic observation-level mosaic generation.
    /// Bound from the "ObservationMosaic" configuration section.
    /// </summary>
    public class ObservationMosaicSettings
    {
        /// <summary>
        /// Gets or sets a value indicating whether automatic observation mosaic detection is enabled.
        /// </summary>
        public bool Enabled { get; set; } = true;

        /// <summary>
        /// Gets or sets the minimum number of per-detector files in a group before
        /// an observation mosaic is triggered. Groups with fewer files are left as-is.
        /// </summary>
        public int FileThreshold { get; set; } = 4;
    }
}
