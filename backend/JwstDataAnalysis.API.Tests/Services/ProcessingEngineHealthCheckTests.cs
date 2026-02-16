// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;

using FluentAssertions;

using JwstDataAnalysis.API.Services;

using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging;

using Moq;
using Moq.Protected;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for ProcessingEngineHealthCheck.
/// Verifies correct health status reporting for various processing engine states.
/// </summary>
public class ProcessingEngineHealthCheckTests
{
    private readonly Mock<IHttpClientFactory> mockFactory;
    private readonly Mock<ILogger<ProcessingEngineHealthCheck>> mockLogger;

    public ProcessingEngineHealthCheckTests()
    {
        mockFactory = new Mock<IHttpClientFactory>();
        mockLogger = new Mock<ILogger<ProcessingEngineHealthCheck>>();
    }

    /// <summary>
    /// Tests that health check returns Healthy when processing engine responds with 200.
    /// </summary>
    [Fact]
    public async Task CheckHealthAsync_WhenEngineResponds200_ReturnsHealthy()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.OK);
        var client = new HttpClient(handler.Object) { BaseAddress = new Uri("http://localhost:8000") };
        mockFactory.Setup(f => f.CreateClient("ProcessingEngine")).Returns(client);

        var sut = new ProcessingEngineHealthCheck(mockFactory.Object, mockLogger.Object);

        // Act
        var result = await sut.CheckHealthAsync(new HealthCheckContext());

        // Assert
        result.Status.Should().Be(HealthStatus.Healthy);
    }

    /// <summary>
    /// Tests that health check returns Unhealthy when processing engine responds with 500.
    /// </summary>
    [Fact]
    public async Task CheckHealthAsync_WhenEngineResponds500_ReturnsUnhealthy()
    {
        // Arrange
        var handler = CreateMockHandler(HttpStatusCode.InternalServerError);
        var client = new HttpClient(handler.Object) { BaseAddress = new Uri("http://localhost:8000") };
        mockFactory.Setup(f => f.CreateClient("ProcessingEngine")).Returns(client);

        var sut = new ProcessingEngineHealthCheck(mockFactory.Object, mockLogger.Object);

        // Act
        var result = await sut.CheckHealthAsync(new HealthCheckContext());

        // Assert
        result.Status.Should().Be(HealthStatus.Unhealthy);
    }

    /// <summary>
    /// Tests that health check returns Unhealthy when processing engine is unreachable.
    /// </summary>
    [Fact]
    public async Task CheckHealthAsync_WhenEngineUnreachable_ReturnsUnhealthy()
    {
        // Arrange
        var handler = new Mock<HttpMessageHandler>();
        handler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        var client = new HttpClient(handler.Object) { BaseAddress = new Uri("http://localhost:8000") };
        mockFactory.Setup(f => f.CreateClient("ProcessingEngine")).Returns(client);

        var sut = new ProcessingEngineHealthCheck(mockFactory.Object, mockLogger.Object);

        // Act
        var result = await sut.CheckHealthAsync(new HealthCheckContext());

        // Assert
        result.Status.Should().Be(HealthStatus.Unhealthy);
        result.Exception.Should().BeOfType<HttpRequestException>();
    }

    /// <summary>
    /// Tests that health check returns Unhealthy when the request times out.
    /// </summary>
    [Fact]
    public async Task CheckHealthAsync_WhenTimeout_ReturnsUnhealthy()
    {
        // Arrange
        var handler = new Mock<HttpMessageHandler>();
        handler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ThrowsAsync(new TaskCanceledException("Request timed out"));

        var client = new HttpClient(handler.Object) { BaseAddress = new Uri("http://localhost:8000") };
        mockFactory.Setup(f => f.CreateClient("ProcessingEngine")).Returns(client);

        var sut = new ProcessingEngineHealthCheck(mockFactory.Object, mockLogger.Object);

        // Act
        var result = await sut.CheckHealthAsync(new HealthCheckContext());

        // Assert
        result.Status.Should().Be(HealthStatus.Unhealthy);
        result.Description.Should().Contain("timed out");
    }

    private static Mock<HttpMessageHandler> CreateMockHandler(HttpStatusCode statusCode)
    {
        var handler = new Mock<HttpMessageHandler>();
        handler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage(statusCode));
        return handler;
    }
}
