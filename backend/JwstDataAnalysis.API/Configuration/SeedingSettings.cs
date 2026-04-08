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

        /// <summary>
        /// Gets or sets the list of users to seed on startup.
        /// Credentials should be provided via environment variables or user secrets — never hardcode production passwords.
        /// </summary>
        public List<SeedUser> Users { get; set; } = [];
    }

    /// <summary>
    /// Represents a user to be seeded into the database.
    /// </summary>
    public class SeedUser
    {
        public required string Username { get; set; }

        public required string Email { get; set; }

        public required string Password { get; set; }

        public required string DisplayName { get; set; }
    }
}
