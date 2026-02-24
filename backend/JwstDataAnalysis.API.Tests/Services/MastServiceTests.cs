// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;
using System.Text;

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

using Moq;
using Moq.Protected;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for MastService.
/// </summary>
public class MastServiceTests
{
    private readonly Mock<HttpMessageHandler> mockHandler = new();
    private readonly Mock<ILogger<MastService>> mockLogger = new();
    private readonly MastService sut;

    /// <summary>
    /// Initializes a new instance of the <see cref="MastServiceTests"/> class.
    /// </summary>
    public MastServiceTests()
    {
        var httpClient = new HttpClient(mockHandler.Object);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ProcessingEngine:BaseUrl", "http://localhost:8000" },
            })
            .Build();
        sut = new MastService(httpClient, mockLogger.Object, config);
    }

    // ===== SearchByTargetAsync =====

    /// <summary>
    /// Tests that SearchByTargetAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task SearchByTargetAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"results\":[],\"result_count\":0}");
        var request = new MastTargetSearchRequest { TargetName = "NGC 3132", Radius = 0.1 };

        // Act
        var result = await sut.SearchByTargetAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.ResultCount.Should().Be(0);
        result.Results.Should().BeEmpty();
    }

    /// <summary>
    /// Tests that SearchByTargetAsync throws HttpRequestException on 500 response.
    /// </summary>
    [Fact]
    public async Task SearchByTargetAsync_ThrowsHttpRequestException_On500()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.InternalServerError, "{\"detail\":\"Internal error\"}");
        var request = new MastTargetSearchRequest { TargetName = "NGC 3132", Radius = 0.1 };

        // Act
        var act = () => sut.SearchByTargetAsync(request);

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>();
    }

    // ===== SearchByCoordinatesAsync =====

    /// <summary>
    /// Tests that SearchByCoordinatesAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task SearchByCoordinatesAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"results\":[],\"result_count\":0}");
        var request = new MastCoordinateSearchRequest { Ra = 187.7, Dec = 12.4, Radius = 0.1 };

        // Act
        var result = await sut.SearchByCoordinatesAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.ResultCount.Should().Be(0);
    }

    // ===== SearchByObservationIdAsync =====

    /// <summary>
    /// Tests that SearchByObservationIdAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task SearchByObservationIdAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"results\":[],\"result_count\":0}");
        var request = new MastObservationSearchRequest { ObsId = "jw02733-o001" };

        // Act
        var result = await sut.SearchByObservationIdAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.ResultCount.Should().Be(0);
    }

    // ===== SearchByProgramIdAsync =====

    /// <summary>
    /// Tests that SearchByProgramIdAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task SearchByProgramIdAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"results\":[],\"result_count\":0}");
        var request = new MastProgramSearchRequest { ProgramId = "3132" };

        // Act
        var result = await sut.SearchByProgramIdAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.ResultCount.Should().Be(0);
    }

    // ===== SearchRecentReleasesAsync =====

    /// <summary>
    /// Tests that SearchRecentReleasesAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task SearchRecentReleasesAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"results\":[],\"result_count\":0}");
        var request = new MastRecentReleasesRequest { DaysBack = 30 };

        // Act
        var result = await sut.SearchRecentReleasesAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.ResultCount.Should().Be(0);
    }

    // ===== GetDataProductsAsync =====

    /// <summary>
    /// Tests that GetDataProductsAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task GetDataProductsAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"products\":[],\"product_count\":0}");
        var request = new MastDataProductsRequest { ObsId = "jw02733-o001" };

        // Act
        var result = await sut.GetDataProductsAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.ProductCount.Should().Be(0);
        result.Products.Should().BeEmpty();
    }

    // ===== DownloadObservationAsync =====

    /// <summary>
    /// Tests that DownloadObservationAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task DownloadObservationAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"status\":\"ok\",\"files\":[],\"obs_id\":\"jw02733-o001\",\"file_count\":0}");
        var request = new MastDownloadRequest { ObsId = "jw02733-o001" };

        // Act
        var result = await sut.DownloadObservationAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.Status.Should().Be("ok");
        result.Files.Should().BeEmpty();
    }

    // ===== StartAsyncDownloadAsync =====

    /// <summary>
    /// Tests that StartAsyncDownloadAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task StartAsyncDownloadAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"job_id\":\"test-job\",\"obs_id\":\"jw02733-o001\"}");
        var request = new MastDownloadRequest { ObsId = "jw02733-o001" };

        // Act
        var result = await sut.StartAsyncDownloadAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.JobId.Should().Be("test-job");
        result.ObsId.Should().Be("jw02733-o001");
    }

    // ===== GetDownloadProgressAsync =====

    /// <summary>
    /// Tests that GetDownloadProgressAsync returns null on non-200 response.
    /// </summary>
    [Fact]
    public async Task GetDownloadProgressAsync_ReturnsNull_OnNon200()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.NotFound, "{\"detail\":\"Not found\"}");

        // Act
        var result = await sut.GetDownloadProgressAsync("nonexistent-job");

        // Assert
        result.Should().BeNull();
    }

    /// <summary>
    /// Tests that GetDownloadProgressAsync returns progress on success.
    /// </summary>
    [Fact]
    public async Task GetDownloadProgressAsync_ReturnsProgress_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"job_id\":\"test-job\",\"status\":\"downloading\",\"progress\":50}");

        // Act
        var result = await sut.GetDownloadProgressAsync("test-job");

        // Assert
        result.Should().NotBeNull();
        result!.JobId.Should().Be("test-job");
        result.Progress.Should().Be(50);
    }

    /// <summary>
    /// Tests that GetDownloadProgressAsync returns null on exception.
    /// </summary>
    [Fact]
    public async Task GetDownloadProgressAsync_ReturnsNull_OnException()
    {
        // Arrange
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.GetDownloadProgressAsync("test-job");

        // Assert
        result.Should().BeNull();
    }

    // ===== StartChunkedDownloadAsync =====

    /// <summary>
    /// Tests that StartChunkedDownloadAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task StartChunkedDownloadAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"job_id\":\"chunked-job\",\"obs_id\":\"jw02733-o001\"}");
        var request = new MastDownloadRequest { ObsId = "jw02733-o001" };

        // Act
        var result = await sut.StartChunkedDownloadAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.JobId.Should().Be("chunked-job");
    }

    // ===== ResumeDownloadAsync =====

    /// <summary>
    /// Tests that ResumeDownloadAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task ResumeDownloadAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"status\":\"resumed\",\"message\":\"ok\",\"job_id\":\"test-job\"}");

        // Act
        var result = await sut.ResumeDownloadAsync("test-job");

        // Assert
        result.Should().NotBeNull();
        result.Status.Should().Be("resumed");
    }

    /// <summary>
    /// Tests that ResumeDownloadAsync throws on failure.
    /// </summary>
    [Fact]
    public async Task ResumeDownloadAsync_Throws_OnFailure()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.BadRequest, "{\"detail\":\"Cannot resume\"}");

        // Act
        var act = () => sut.ResumeDownloadAsync("test-job");

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>();
    }

    // ===== PauseDownloadAsync =====

    /// <summary>
    /// Tests that PauseDownloadAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task PauseDownloadAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"status\":\"paused\",\"message\":\"ok\",\"job_id\":\"test-job\"}");

        // Act
        var result = await sut.PauseDownloadAsync("test-job");

        // Assert
        result.Should().NotBeNull();
        result.Status.Should().Be("paused");
    }

    /// <summary>
    /// Tests that PauseDownloadAsync throws on failure.
    /// </summary>
    [Fact]
    public async Task PauseDownloadAsync_Throws_OnFailure()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.BadRequest, "{\"detail\":\"Cannot pause\"}");

        // Act
        var act = () => sut.PauseDownloadAsync("test-job");

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>();
    }

    // ===== GetChunkedDownloadProgressAsync =====

    /// <summary>
    /// Tests that GetChunkedDownloadProgressAsync returns null on non-200 response.
    /// </summary>
    [Fact]
    public async Task GetChunkedDownloadProgressAsync_ReturnsNull_OnNon200()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.NotFound, "{\"detail\":\"Not found\"}");

        // Act
        var result = await sut.GetChunkedDownloadProgressAsync("nonexistent-job");

        // Assert
        result.Should().BeNull();
    }

    /// <summary>
    /// Tests that GetChunkedDownloadProgressAsync returns progress on success.
    /// </summary>
    [Fact]
    public async Task GetChunkedDownloadProgressAsync_ReturnsProgress_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"job_id\":\"test-job\",\"status\":\"downloading\",\"progress\":75}");

        // Act
        var result = await sut.GetChunkedDownloadProgressAsync("test-job");

        // Assert
        result.Should().NotBeNull();
        result!.JobId.Should().Be("test-job");
        result.Progress.Should().Be(75);
    }

    // ===== GetResumableDownloadsAsync =====

    /// <summary>
    /// Tests that GetResumableDownloadsAsync returns null on non-200 response.
    /// </summary>
    [Fact]
    public async Task GetResumableDownloadsAsync_ReturnsNull_OnNon200()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.InternalServerError, "{\"detail\":\"Error\"}");

        // Act
        var result = await sut.GetResumableDownloadsAsync();

        // Assert
        result.Should().BeNull();
    }

    /// <summary>
    /// Tests that GetResumableDownloadsAsync returns jobs on success.
    /// </summary>
    [Fact]
    public async Task GetResumableDownloadsAsync_ReturnsJobs_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"jobs\":[],\"count\":0}");

        // Act
        var result = await sut.GetResumableDownloadsAsync();

        // Assert
        result.Should().NotBeNull();
        result!.Jobs.Should().BeEmpty();
        result.Count.Should().Be(0);
    }

    // ===== DismissResumableDownloadAsync =====

    /// <summary>
    /// Tests that DismissResumableDownloadAsync returns true on success.
    /// </summary>
    [Fact]
    public async Task DismissResumableDownloadAsync_ReturnsTrue_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{}");

        // Act
        var result = await sut.DismissResumableDownloadAsync("test-job", false);

        // Assert
        result.Should().BeTrue();
    }

    /// <summary>
    /// Tests that DismissResumableDownloadAsync returns false on failure.
    /// </summary>
    [Fact]
    public async Task DismissResumableDownloadAsync_ReturnsFalse_OnFailure()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.NotFound, "{\"detail\":\"Not found\"}");

        // Act
        var result = await sut.DismissResumableDownloadAsync("nonexistent-job", false);

        // Assert
        result.Should().BeFalse();
    }

    /// <summary>
    /// Tests that DismissResumableDownloadAsync returns false on exception.
    /// </summary>
    [Fact]
    public async Task DismissResumableDownloadAsync_ReturnsFalse_OnException()
    {
        // Arrange
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.DismissResumableDownloadAsync("test-job", false);

        // Assert
        result.Should().BeFalse();
    }

    // ===== StartS3DownloadAsync =====

    /// <summary>
    /// Tests that StartS3DownloadAsync returns response on success.
    /// </summary>
    [Fact]
    public async Task StartS3DownloadAsync_ReturnsResponse_OnSuccess()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "{\"job_id\":\"s3-job\",\"obs_id\":\"jw02733-o001\"}");
        var request = new MastDownloadRequest { ObsId = "jw02733-o001" };

        // Act
        var result = await sut.StartS3DownloadAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.JobId.Should().Be("s3-job");
    }

    // ===== PostToProcessingEngine error extraction =====

    /// <summary>
    /// Tests that PostToProcessingEngine extracts detail from error response JSON.
    /// </summary>
    [Fact]
    public async Task PostToProcessingEngine_ExtractsDetailFromErrorResponse()
    {
        // Arrange
        SetupMockResponse(
            HttpStatusCode.UnprocessableEntity,
            "{\"detail\":\"Something wrong\"}");
        var request = new MastTargetSearchRequest { TargetName = "NGC 3132", Radius = 0.1 };

        // Act
        var act = () => sut.SearchByTargetAsync(request);

        // Assert
        var exception = await act.Should().ThrowAsync<HttpRequestException>();
        exception.Which.Message.Should().Be("Something wrong");
    }

    // ===== Helper Methods =====

    private void SetupMockResponse(HttpStatusCode statusCode, string content)
    {
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = statusCode,
                Content = new StringContent(content, Encoding.UTF8, "application/json"),
            });
    }
}
