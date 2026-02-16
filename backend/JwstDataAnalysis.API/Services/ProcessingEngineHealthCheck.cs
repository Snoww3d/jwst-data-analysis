// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace JwstDataAnalysis.API.Services;

/// <summary>
/// Health check that verifies the processing engine (Python/FastAPI) is reachable.
/// Calls GET /health on the processing engine and expects a 200 response.
/// </summary>
public partial class ProcessingEngineHealthCheck : IHealthCheck
{
    private readonly IHttpClientFactory httpClientFactory;
    private readonly ILogger<ProcessingEngineHealthCheck> logger;

    public ProcessingEngineHealthCheck(
        IHttpClientFactory httpClientFactory,
        ILogger<ProcessingEngineHealthCheck> logger)
    {
        this.httpClientFactory = httpClientFactory;
        this.logger = logger;
    }

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var client = httpClientFactory.CreateClient("ProcessingEngine");
            var response = await client.GetAsync("/health", cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                return HealthCheckResult.Healthy("Processing engine is reachable");
            }

            LogUnexpectedStatusCode(response.StatusCode);

            return HealthCheckResult.Unhealthy(
                $"Processing engine returned {(int)response.StatusCode}");
        }
        catch (HttpRequestException ex)
        {
            LogConnectionRefused(ex);
            return HealthCheckResult.Unhealthy(
                "Processing engine unreachable",
                ex);
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            LogTimeout(ex);
            return HealthCheckResult.Unhealthy(
                "Processing engine health check timed out",
                ex);
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Processing engine health check returned {StatusCode}")]
    private partial void LogUnexpectedStatusCode(System.Net.HttpStatusCode statusCode);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Processing engine health check failed: connection refused")]
    private partial void LogConnectionRefused(Exception ex);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Processing engine health check timed out")]
    private partial void LogTimeout(Exception ex);
}
