// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

using Microsoft.Extensions.Options;

using MongoDB.Driver;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// On server start, marks any queued/running jobs in MongoDB as failed
    /// with reason "service_restart". These jobs were interrupted by a restart
    /// and cannot be resumed.
    /// </summary>
    public partial class StartupReconciliationService(
        IOptions<MongoDBSettings> mongoSettings,
        ILogger<StartupReconciliationService> logger) : IHostedService
    {
        private readonly IMongoCollection<JobStatus> jobsCollection = new MongoClient(mongoSettings.Value.ConnectionString)
            .GetDatabase(mongoSettings.Value.DatabaseName)
            .GetCollection<JobStatus>("jobs");

        private readonly ILogger<StartupReconciliationService> logger = logger;

        public async Task StartAsync(CancellationToken cancellationToken)
        {
            var now = DateTime.UtcNow;
            var filter = Builders<JobStatus>.Filter.In(
                j => j.State,
                new[] { JobStates.Queued, JobStates.Running });

            var update = Builders<JobStatus>.Update
                .Set(j => j.State, JobStates.Failed)
                .Set(j => j.Error, "Job interrupted by service restart")
                .Set(j => j.CompletedAt, now)
                .Set(j => j.UpdatedAt, now)
                .Set(j => j.ExpiresAt, now + TimeSpan.FromMinutes(30));

            var result = await jobsCollection.UpdateManyAsync(filter, update, cancellationToken: cancellationToken);

            if (result.ModifiedCount > 0)
            {
                LogReconciled(result.ModifiedCount);
            }
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        [LoggerMessage(Level = LogLevel.Warning, Message = "Startup reconciliation: marked {Count} in-flight jobs as failed")]
        private partial void LogReconciled(long count);
    }
}
