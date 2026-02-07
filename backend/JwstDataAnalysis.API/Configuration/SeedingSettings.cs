// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Configuration
{
    /// <summary>
    /// Configuration settings for database seeding.
    /// </summary>
    public class SeedingSettings
    {
        /// <summary>
        /// Gets or sets a value indicating whether seed data (default users) should be created on startup.
        /// Defaults to true for development; should be false in production.
        /// </summary>
        public bool Enabled { get; set; } = true;
    }
}
