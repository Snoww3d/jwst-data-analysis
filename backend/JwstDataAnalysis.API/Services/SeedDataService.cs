// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Configuration;
using JwstDataAnalysis.API.Models;

using Microsoft.Extensions.Options;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Seeds default users into the database on application startup.
    /// Controlled by the Seeding:Enabled configuration flag.
    /// </summary>
    public partial class SeedDataService(
        IMongoDBService mongoDBService,
        IAuthService authService,
        IOptions<SeedingSettings> seedingSettings,
        IWebHostEnvironment environment,
        ILogger<SeedDataService> logger)
    {
        private readonly IMongoDBService mongoDBService = mongoDBService;
        private readonly IAuthService authService = authService;
        private readonly SeedingSettings settings = seedingSettings.Value;
        private readonly IWebHostEnvironment environment = environment;
        private readonly ILogger<SeedDataService> logger = logger;

        /// <summary>
        /// Seeds default users if seeding is enabled in configuration.
        /// Blocked in non-development environments as a safety measure.
        /// </summary>
        public async Task SeedUsersAsync()
        {
            if (!settings.Enabled)
            {
                LogSeedingDisabled();
                return;
            }

            if (!environment.IsDevelopment())
            {
                LogSeedingBlockedInNonDev(environment.EnvironmentName);
                return;
            }

            if (settings.Users.Count == 0)
            {
                LogNoSeedUsersConfigured();
                return;
            }

            foreach (var user in settings.Users)
            {
                if (string.IsNullOrWhiteSpace(user.Password))
                {
                    LogSeedUserMissingPassword(user.Username);
                    continue;
                }

                await SeedUserAsync(user.Username, user.Email, user.Password, user.DisplayName);
            }
        }

        private async Task SeedUserAsync(string username, string email, string password, string displayName)
        {
            var existingUser = await mongoDBService.GetUserByUsernameAsync(username);
            if (existingUser != null)
            {
                LogSeedUserExists(username);
                return;
            }

            try
            {
                await authService.RegisterAsync(new RegisterRequest
                {
                    Username = username,
                    Email = email,
                    Password = password,
                    DisplayName = displayName,
                });

                LogSeedUserCreated(username);
            }
            catch (Exception ex)
            {
                LogSeedUserFailed(ex, username);
            }
        }
    }
}
