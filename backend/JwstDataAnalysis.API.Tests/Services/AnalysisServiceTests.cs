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
/// Unit tests for AnalysisService.
/// </summary>
public class AnalysisServiceTests
{
    private readonly Mock<HttpMessageHandler> mockHandler = new();
    private readonly Mock<IMongoDBService> mockMongoService = new();
    private readonly Mock<ILogger<AnalysisService>> mockLogger = new();
    private readonly AnalysisService sut;

    /// <summary>
    /// Initializes a new instance of the <see cref="AnalysisServiceTests"/> class.
    /// </summary>
    public AnalysisServiceTests()
    {
        var httpClient = new HttpClient(mockHandler.Object);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ProcessingEngine:BaseUrl", "http://localhost:8000" },
            })
            .Build();
        sut = new AnalysisService(httpClient, mockMongoService.Object, mockLogger.Object, config);
    }

    // ===== GetRegionStatisticsAsync =====

    /// <summary>
    /// Tests that GetRegionStatisticsAsync returns result on success.
    /// </summary>
    [Fact]
    public async Task GetRegionStatisticsAsync_ReturnsResult_OnSuccess()
    {
        // Arrange
        SetupMongoData("data-123", "mast/obs1/file.fits");
        SetupMockResponse(
            HttpStatusCode.OK,
            "{\"pixel_count\":100,\"mean\":50.5,\"std\":10.2,\"min\":0,\"max\":100,\"sum\":5050}");

        var request = new RegionStatisticsRequestDto
        {
            DataId = "data-123",
            RegionType = "rectangle",
            Rectangle = new RectangleRegionDto { X = 0, Y = 0, Width = 10, Height = 10 },
        };

        // Act
        var result = await sut.GetRegionStatisticsAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.PixelCount.Should().Be(100);
        result.Mean.Should().Be(50.5);
        result.Std.Should().Be(10.2);
    }

    /// <summary>
    /// Tests that GetRegionStatisticsAsync throws KeyNotFoundException when data not found.
    /// </summary>
    [Fact]
    public async Task GetRegionStatisticsAsync_ThrowsKeyNotFound_WhenDataNotFound()
    {
        // Arrange
        mockMongoService.Setup(m => m.GetAsync("nonexistent"))
            .ReturnsAsync((JwstDataModel?)null);

        var request = new RegionStatisticsRequestDto { DataId = "nonexistent", RegionType = "rectangle" };

        // Act
        var act = () => sut.GetRegionStatisticsAsync(request);

        // Assert
        await act.Should().ThrowAsync<KeyNotFoundException>();
    }

    /// <summary>
    /// Tests that GetRegionStatisticsAsync throws InvalidOperationException when FilePath is null.
    /// </summary>
    [Fact]
    public async Task GetRegionStatisticsAsync_ThrowsInvalidOp_WhenNoFilePath()
    {
        // Arrange
        mockMongoService.Setup(m => m.GetAsync("data-no-path"))
            .ReturnsAsync(new JwstDataModel { Id = "data-no-path", FilePath = null });

        var request = new RegionStatisticsRequestDto { DataId = "data-no-path", RegionType = "rectangle" };

        // Act
        var act = () => sut.GetRegionStatisticsAsync(request);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>();
    }

    /// <summary>
    /// Tests that GetRegionStatisticsAsync throws HttpRequestException on engine error.
    /// </summary>
    [Fact]
    public async Task GetRegionStatisticsAsync_ThrowsHttpException_OnEngineError()
    {
        // Arrange
        SetupMongoData("data-123", "mast/obs1/file.fits");
        SetupMockResponse(HttpStatusCode.InternalServerError, "{\"detail\":\"Engine error\"}");

        var request = new RegionStatisticsRequestDto { DataId = "data-123", RegionType = "rectangle" };

        // Act
        var act = () => sut.GetRegionStatisticsAsync(request);

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>();
    }

    // ===== DetectSourcesAsync =====

    /// <summary>
    /// Tests that DetectSourcesAsync returns result on success.
    /// </summary>
    [Fact]
    public async Task DetectSourcesAsync_ReturnsResult_OnSuccess()
    {
        // Arrange
        SetupMongoData("data-123", "mast/obs1/file.fits");
        SetupMockResponse(
            HttpStatusCode.OK,
            "{\"n_sources\":5,\"method\":\"daofind\",\"sources\":[]}");

        var request = new SourceDetectionRequestDto { DataId = "data-123", Method = "daofind" };

        // Act
        var result = await sut.DetectSourcesAsync(request);

        // Assert
        result.Should().NotBeNull();
        result.NSources.Should().Be(5);
        result.Method.Should().Be("daofind");
        result.Sources.Should().BeEmpty();
    }

    /// <summary>
    /// Tests that DetectSourcesAsync throws KeyNotFoundException when data not found.
    /// </summary>
    [Fact]
    public async Task DetectSourcesAsync_ThrowsKeyNotFound_WhenDataNotFound()
    {
        // Arrange
        mockMongoService.Setup(m => m.GetAsync("nonexistent"))
            .ReturnsAsync((JwstDataModel?)null);

        var request = new SourceDetectionRequestDto { DataId = "nonexistent" };

        // Act
        var act = () => sut.DetectSourcesAsync(request);

        // Assert
        await act.Should().ThrowAsync<KeyNotFoundException>();
    }

    // ===== GetTableInfoAsync =====

    /// <summary>
    /// Tests that GetTableInfoAsync returns result on success.
    /// </summary>
    [Fact]
    public async Task GetTableInfoAsync_ReturnsResult_OnSuccess()
    {
        // Arrange
        SetupMongoData("data-123", "mast/obs1/file.fits");
        SetupMockResponse(
            HttpStatusCode.OK,
            "{\"table_hdus\":[{\"index\":1,\"name\":\"DATA\",\"n_rows\":100,\"n_columns\":5,\"columns\":[]}]}");

        // Act
        var result = await sut.GetTableInfoAsync("data-123");

        // Assert
        result.Should().NotBeNull();
        result.TableHdus.Should().HaveCount(1);
        result.TableHdus[0].Index.Should().Be(1);
        result.TableHdus[0].Name.Should().Be("DATA");
        result.TableHdus[0].NRows.Should().Be(100);
    }

    /// <summary>
    /// Tests that GetTableInfoAsync throws KeyNotFoundException when data not found.
    /// </summary>
    [Fact]
    public async Task GetTableInfoAsync_ThrowsKeyNotFound_WhenDataNotFound()
    {
        // Arrange
        mockMongoService.Setup(m => m.GetAsync("nonexistent"))
            .ReturnsAsync((JwstDataModel?)null);

        // Act
        var act = () => sut.GetTableInfoAsync("nonexistent");

        // Assert
        await act.Should().ThrowAsync<KeyNotFoundException>();
    }

    // ===== GetTableDataAsync =====

    /// <summary>
    /// Tests that GetTableDataAsync returns result on success.
    /// </summary>
    [Fact]
    public async Task GetTableDataAsync_ReturnsResult_OnSuccess()
    {
        // Arrange
        SetupMongoData("data-123", "mast/obs1/file.fits");
        SetupMockResponse(
            HttpStatusCode.OK,
            "{\"total_rows\":100,\"page\":0,\"page_size\":50,\"rows\":[]}");

        // Act
        var result = await sut.GetTableDataAsync("data-123");

        // Assert
        result.Should().NotBeNull();
        result.TotalRows.Should().Be(100);
        result.Page.Should().Be(0);
        result.PageSize.Should().Be(50);
        result.Rows.Should().BeEmpty();
    }

    /// <summary>
    /// Tests that GetTableDataAsync includes optional parameters in URL.
    /// </summary>
    [Fact]
    public async Task GetTableDataAsync_IncludesOptionalParams()
    {
        // Arrange
        SetupMongoData("data-123", "mast/obs1/file.fits");

        HttpRequestMessage? capturedRequest = null;
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => capturedRequest = req)
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(
                    "{\"total_rows\":100,\"page\":0,\"page_size\":50,\"rows\":[]}",
                    Encoding.UTF8,
                    "application/json"),
            });

        // Act
        await sut.GetTableDataAsync("data-123", sortColumn: "flux", sortDirection: "desc", search: "test");

        // Assert
        capturedRequest.Should().NotBeNull();
        var url = capturedRequest!.RequestUri!.ToString();
        url.Should().Contain("sort_column=flux");
        url.Should().Contain("sort_direction=desc");
        url.Should().Contain("search=test");
    }

    /// <summary>
    /// Tests that GetTableDataAsync throws HttpRequestException on engine error.
    /// </summary>
    [Fact]
    public async Task GetTableDataAsync_ThrowsHttpException_OnEngineError()
    {
        // Arrange
        SetupMongoData("data-123", "mast/obs1/file.fits");
        SetupMockResponse(HttpStatusCode.InternalServerError, "{\"detail\":\"Engine error\"}");

        // Act
        var act = () => sut.GetTableDataAsync("data-123");

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>();
    }

    // ===== GetSpectralDataAsync =====

    /// <summary>
    /// Tests that GetSpectralDataAsync returns result on success (takes filePath directly).
    /// </summary>
    [Fact]
    public async Task GetSpectralDataAsync_ReturnsResult_OnSuccess()
    {
        // Arrange
        SetupMockResponse(
            HttpStatusCode.OK,
            "{\"hdu_index\":1,\"hdu_name\":\"EXTRACT1D\",\"n_points\":100,\"columns\":[],\"data\":{}}");

        // Act
        var result = await sut.GetSpectralDataAsync("mast/obs1/file.fits", hduIndex: 1);

        // Assert
        result.Should().NotBeNull();
        result.HduIndex.Should().Be(1);
        result.HduName.Should().Be("EXTRACT1D");
        result.NPoints.Should().Be(100);
    }

    /// <summary>
    /// Tests that GetSpectralDataAsync throws HttpRequestException on engine error.
    /// </summary>
    [Fact]
    public async Task GetSpectralDataAsync_ThrowsHttpException_OnEngineError()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.InternalServerError, "{\"detail\":\"Engine error\"}");

        // Act
        var act = () => sut.GetSpectralDataAsync("mast/obs1/file.fits");

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>();
    }

    // ===== ResolveDataIdToFilePathAsync (tested indirectly) =====

    /// <summary>
    /// Tests that ResolveDataIdToFilePathAsync strips the /app/data/ prefix.
    /// </summary>
    [Fact]
    public async Task ResolveDataIdToFilePathAsync_StripsPrefix()
    {
        // Arrange — data has the /app/data/ prefix on FilePath
        mockMongoService.Setup(m => m.GetAsync("data-with-prefix"))
            .ReturnsAsync(new JwstDataModel
            {
                Id = "data-with-prefix",
                FilePath = "/app/data/mast/obs1/file.fits",
            });

        // The HTTP mock captures the URL to verify the resolved path
        HttpRequestMessage? capturedRequest = null;
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => capturedRequest = req)
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(
                    "{\"table_hdus\":[{\"index\":1,\"name\":\"DATA\",\"n_rows\":10,\"n_columns\":2,\"columns\":[]}]}",
                    Encoding.UTF8,
                    "application/json"),
            });

        // Act — use GetTableInfoAsync which calls ResolveDataIdToFilePathAsync internally
        await sut.GetTableInfoAsync("data-with-prefix");

        // Assert — the file_path query param should have the prefix stripped
        capturedRequest.Should().NotBeNull();
        var url = capturedRequest!.RequestUri!.ToString();
        url.Should().Contain("file_path=mast");
        url.Should().NotContain("/app/data/");
    }

    // ===== Helper Methods =====
    private void SetupMongoData(string dataId, string filePath)
    {
        mockMongoService.Setup(m => m.GetAsync(dataId))
            .ReturnsAsync(new JwstDataModel { Id = dataId, FilePath = filePath });
    }

    private void SetupMockResponse(HttpStatusCode statusCode, string content)
    {
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = statusCode,
                Content = new StringContent(content, Encoding.UTF8, "application/json"),
            });
    }
}
