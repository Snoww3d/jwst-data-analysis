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
    public class SeedDataService(
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
        /// </summary>
        public async Task SeedUsersAsync()
        {
            if (!settings.Enabled)
            {
                logger.LogInformation("Database seeding is disabled via configuration");
                return;
            }

            if (!environment.IsDevelopment())
            {
                logger.LogWarning(
                    "Database seeding is enabled in {Environment} environment. " +
                    "Set Seeding:Enabled to false in production configuration",
                    environment.EnvironmentName);
            }

            await SeedUserAsync(
                username: "admin",
                email: "admin@jwst.local",
                password: "Admin123!",
                displayName: "Administrator");

            await SeedUserAsync(
                username: "demo",
                email: "demo@jwst.local",
                password: "Demo1234!",
                displayName: "Demo User");
        }

        private async Task SeedUserAsync(string username, string email, string password, string displayName)
        {
            var existingUser = await mongoDBService.GetUserByUsernameAsync(username);
            if (existingUser != null)
            {
                logger.LogDebug("Seed user '{Username}' already exists, skipping", username);
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

                logger.LogInformation("Created seed user '{Username}'", username);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to create seed user '{Username}'", username);
            }
        }
    }
}
