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
            Message = "Database seeding is blocked in {Environment} environment. Seeding is only allowed in Development. Set Seeding:Enabled to false in non-development configuration")]
        private partial void LogSeedingBlockedInNonDev(string environment);

        [LoggerMessage(EventId = 7006, Level = LogLevel.Warning,
            Message = "Database seeding is enabled but no users are configured in Seeding:Users")]
        private partial void LogNoSeedUsersConfigured();

        [LoggerMessage(EventId = 7007, Level = LogLevel.Warning,
            Message = "Seed user '{Username}' has no password configured — skipping. Set the password via environment variable")]
        private partial void LogSeedUserMissingPassword(string username);

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
