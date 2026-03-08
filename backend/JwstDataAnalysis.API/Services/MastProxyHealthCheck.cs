// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace JwstDataAnalysis.API.Services;

/// <summary>
/// Health check that verifies the MAST proxy service (Python/FastAPI) is reachable.
/// Calls GET /health on the MAST proxy and expects a 200 response.
/// </summary>
public partial class MastProxyHealthCheck : IHealthCheck
{
    private readonly IHttpClientFactory httpClientFactory;
    private readonly ILogger<MastProxyHealthCheck> logger;

    public MastProxyHealthCheck(
        IHttpClientFactory httpClientFactory,
        ILogger<MastProxyHealthCheck> logger)
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
            var client = httpClientFactory.CreateClient("MastProxy");
            var response = await client.GetAsync("/health", cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                return HealthCheckResult.Healthy("MAST proxy is reachable");
            }

            LogUnexpectedStatusCode(response.StatusCode);

            return HealthCheckResult.Unhealthy(
                $"MAST proxy returned {(int)response.StatusCode}");
        }
        catch (HttpRequestException ex)
        {
            LogConnectionRefused(ex);
            return HealthCheckResult.Unhealthy(
                "MAST proxy unreachable",
                ex);
        }
        catch (TaskCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            LogTimeout(ex);
            return HealthCheckResult.Unhealthy(
                "MAST proxy health check timed out",
                ex);
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "MAST proxy health check returned {StatusCode}")]
    private partial void LogUnexpectedStatusCode(System.Net.HttpStatusCode statusCode);

    [LoggerMessage(Level = LogLevel.Warning, Message = "MAST proxy health check failed: connection refused")]
    private partial void LogConnectionRefused(Exception ex);

    [LoggerMessage(Level = LogLevel.Warning, Message = "MAST proxy health check timed out")]
    private partial void LogTimeout(Exception ex);
}
