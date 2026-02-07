// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    public partial class SeedDataService
    {
        // Event IDs: 7xxx for seed data operations
        [LoggerMessage(EventId = 7001, Level = LogLevel.Information,
            Message = "Database seeding is disabled via configuration")]
        private partial void LogSeedingDisabled();

        [LoggerMessage(EventId = 7002, Level = LogLevel.Warning,
            Message = "Database seeding is enabled in {Environment} environment. Set Seeding:Enabled to false in production configuration")]
        private partial void LogSeedingEnabledInNonDev(string environment);

        [LoggerMessage(EventId = 7003, Level = LogLevel.Debug,
            Message = "Seed user '{Username}' already exists, skipping")]
        private partial void LogSeedUserExists(string username);

        [LoggerMessage(EventId = 7004, Level = LogLevel.Information,
            Message = "Created seed user '{Username}'")]
        private partial void LogSeedUserCreated(string username);

        [LoggerMessage(EventId = 7005, Level = LogLevel.Warning,
            Message = "Failed to create seed user '{Username}'")]
        private partial void LogSeedUserFailed(Exception ex, string username);
    }
}
