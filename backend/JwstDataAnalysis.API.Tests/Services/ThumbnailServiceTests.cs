// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;
using System.Text;
using System.Text.Json;

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.Extensions.Logging;

using Moq;
using Moq.Protected;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for ThumbnailService.
/// Covers path stripping, skip logic, batch counting, null response handling,
/// and HTTP error scenarios.
/// </summary>
public class ThumbnailServiceTests
{
    private readonly Mock<IHttpClientFactory> mockHttpClientFactory;
    private readonly Mock<IMongoDBService> mockMongoDBService;
    private readonly Mock<ILogger<ThumbnailService>> mockLogger;
    private readonly Mock<HttpMessageHandler> mockHandler;
    private readonly ThumbnailService sut;

    public ThumbnailServiceTests()
    {
        mockHttpClientFactory = new Mock<IHttpClientFactory>();
        mockMongoDBService = new Mock<IMongoDBService>();
        mockLogger = new Mock<ILogger<ThumbnailService>>();
        mockHandler = new Mock<HttpMessageHandler>();

        var httpClient = new HttpClient(mockHandler.Object)
        {
            BaseAddress = new Uri("http://localhost:8000"),
        };

        mockHttpClientFactory
            .Setup(f => f.CreateClient("ThumbnailEngine"))
            .Returns(httpClient);

        sut = new ThumbnailService(
            mockHttpClientFactory.Object,
            mockMongoDBService.Object,
            mockLogger.Object);
    }

    [Fact]
    public async Task GenerateThumbnailAsync_Strips_AppData_Prefix_From_FilePath()
    {
        // Arrange
        var record = MakeRecord(filePath: "/app/data/mast/obs_id/file.fits");
        mockMongoDBService.Setup(m => m.GetAsync("id-1")).ReturnsAsync(record);
        SetupThumbnailResponse("dGVzdA=="); // "test" in base64

        // Act
        await sut.GenerateThumbnailAsync("id-1");

        // Assert — the HTTP request body should contain the stripped path
        mockHandler.Protected().Verify(
            "SendAsync",
            Times.Once(),
            ItExpr.Is<HttpRequestMessage>(r =>
                r.Content!.ReadAsStringAsync().Result.Contains("mast/obs_id/file.fits") &&
                !r.Content!.ReadAsStringAsync().Result.Contains("/app/data/")),
            ItExpr.IsAny<CancellationToken>());
    }

    [Fact]
    public async Task GenerateThumbnailAsync_Leaves_Relative_Path_Unchanged()
    {
        // Arrange
        var record = MakeRecord(filePath: "mast/obs_id/file.fits");
        mockMongoDBService.Setup(m => m.GetAsync("id-1")).ReturnsAsync(record);
        SetupThumbnailResponse("dGVzdA==");

        // Act
        await sut.GenerateThumbnailAsync("id-1");

        // Assert
        mockHandler.Protected().Verify(
            "SendAsync",
            Times.Once(),
            ItExpr.Is<HttpRequestMessage>(r =>
                r.Content!.ReadAsStringAsync().Result.Contains("mast/obs_id/file.fits")),
            ItExpr.IsAny<CancellationToken>());
    }

    [Fact]
    public async Task GenerateThumbnailAsync_Skips_When_Record_Not_Found()
    {
        // Arrange
        mockMongoDBService.Setup(m => m.GetAsync("missing")).ReturnsAsync((JwstDataModel?)null);

        // Act
        await sut.GenerateThumbnailAsync("missing");

        // Assert — no HTTP call made
        mockHandler.Protected().Verify(
            "SendAsync",
            Times.Never(),
            ItExpr.IsAny<HttpRequestMessage>(),
            ItExpr.IsAny<CancellationToken>());
    }

    [Fact]
    public async Task GenerateThumbnailAsync_Skips_When_Record_Not_Viewable()
    {
        // Arrange
        var record = MakeRecord(isViewable: false);
        mockMongoDBService.Setup(m => m.GetAsync("id-1")).ReturnsAsync(record);

        // Act
        await sut.GenerateThumbnailAsync("id-1");

        // Assert
        mockHandler.Protected().Verify(
            "SendAsync",
            Times.Never(),
            ItExpr.IsAny<HttpRequestMessage>(),
            ItExpr.IsAny<CancellationToken>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task GenerateThumbnailAsync_Skips_When_FilePath_Is_NullOrEmpty(string? filePath)
    {
        // Arrange
        var record = MakeRecord(filePath: filePath);
        mockMongoDBService.Setup(m => m.GetAsync("id-1")).ReturnsAsync(record);

        // Act
        await sut.GenerateThumbnailAsync("id-1");

        // Assert
        mockHandler.Protected().Verify(
            "SendAsync",
            Times.Never(),
            ItExpr.IsAny<HttpRequestMessage>(),
            ItExpr.IsAny<CancellationToken>());
    }

    [Fact]
    public async Task GenerateThumbnailAsync_Does_Not_Store_When_ThumbnailBase64_Is_Null()
    {
        // Arrange
        var record = MakeRecord();
        mockMongoDBService.Setup(m => m.GetAsync("id-1")).ReturnsAsync(record);
        SetupThumbnailResponse(thumbnailBase64: null);

        // Act
        await sut.GenerateThumbnailAsync("id-1");

        // Assert — UpdateThumbnailAsync should never be called
        mockMongoDBService.Verify(
            m => m.UpdateThumbnailAsync(It.IsAny<string>(), It.IsAny<byte[]>()),
            Times.Never());
    }

    [Fact]
    public async Task GenerateThumbnailAsync_Stores_Decoded_Thumbnail_Bytes()
    {
        // Arrange
        var thumbnailContent = new byte[] { 0x89, 0x50, 0x4E, 0x47 }; // PNG magic bytes
        var base64 = Convert.ToBase64String(thumbnailContent);
        var record = MakeRecord();
        mockMongoDBService.Setup(m => m.GetAsync("id-1")).ReturnsAsync(record);
        SetupThumbnailResponse(base64);

        // Act
        await sut.GenerateThumbnailAsync("id-1");

        // Assert
        mockMongoDBService.Verify(
            m => m.UpdateThumbnailAsync("id-1", It.Is<byte[]>(b => b.SequenceEqual(thumbnailContent))),
            Times.Once());
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task GenerateThumbnailAsync_Handles_Http_Error_Without_Throwing(HttpStatusCode statusCode)
    {
        // Arrange
        var record = MakeRecord();
        mockMongoDBService.Setup(m => m.GetAsync("id-1")).ReturnsAsync(record);
        SetupHttpErrorResponse(statusCode);

        // Act — should not throw due to internal catch
        await sut.GenerateThumbnailAsync("id-1");

        // Assert — no thumbnail stored
        mockMongoDBService.Verify(
            m => m.UpdateThumbnailAsync(It.IsAny<string>(), It.IsAny<byte[]>()),
            Times.Never());
    }

    [Fact]
    public async Task GenerateThumbnailsForIdsAsync_Skips_Null_Record()
    {
        // Arrange
        mockMongoDBService.Setup(m => m.GetAsync("id-1")).ReturnsAsync((JwstDataModel?)null);

        // Act
        await sut.GenerateThumbnailsForIdsAsync(["id-1"]);

        // Assert — no HTTP call, record was skipped
        mockHandler.Protected().Verify(
            "SendAsync",
            Times.Never(),
            ItExpr.IsAny<HttpRequestMessage>(),
            ItExpr.IsAny<CancellationToken>());
    }

    [Fact]
    public async Task GenerateThumbnailsForIdsAsync_Skips_Non_Viewable_Record()
    {
        // Arrange
        var record = MakeRecord(isViewable: false);
        mockMongoDBService.Setup(m => m.GetAsync("id-1")).ReturnsAsync(record);

        // Act
        await sut.GenerateThumbnailsForIdsAsync(["id-1"]);

        // Assert
        mockHandler.Protected().Verify(
            "SendAsync",
            Times.Never(),
            ItExpr.IsAny<HttpRequestMessage>(),
            ItExpr.IsAny<CancellationToken>());
    }

    [Fact]
    public async Task GenerateThumbnailsForIdsAsync_Skips_Record_With_Existing_Thumbnail()
    {
        // Arrange
        var record = MakeRecord(thumbnailData: [0x01, 0x02]);
        mockMongoDBService.Setup(m => m.GetAsync("id-1")).ReturnsAsync(record);

        // Act
        await sut.GenerateThumbnailsForIdsAsync(["id-1"]);

        // Assert
        mockHandler.Protected().Verify(
            "SendAsync",
            Times.Never(),
            ItExpr.IsAny<HttpRequestMessage>(),
            ItExpr.IsAny<CancellationToken>());
    }

    [Fact]
    public async Task GenerateThumbnailsForIdsAsync_Counts_Generated_And_Skipped()
    {
        // Arrange — 3 records: one generates, one already has thumbnail (skipped), one not viewable (skipped)
        var genRecord = MakeRecord(id: "gen-1");
        var skipRecord = MakeRecord(id: "skip-1", thumbnailData: [0x01]);
        var nonViewable = MakeRecord(id: "skip-2", isViewable: false);

        mockMongoDBService.Setup(m => m.GetAsync("gen-1")).ReturnsAsync(genRecord);
        mockMongoDBService.Setup(m => m.GetAsync("skip-1")).ReturnsAsync(skipRecord);
        mockMongoDBService.Setup(m => m.GetAsync("skip-2")).ReturnsAsync(nonViewable);

        SetupThumbnailResponse("dGVzdA==");
        mockMongoDBService
            .Setup(m => m.GetThumbnailAsync("gen-1"))
            .ReturnsAsync(new byte[] { 0x01 });

        // Act
        await sut.GenerateThumbnailsForIdsAsync(["gen-1", "skip-1", "skip-2"]);

        // Assert — gen-1 had GenerateThumbnailAsync called, skip-1 and skip-2 did not
        mockMongoDBService.Verify(m => m.UpdateThumbnailAsync("gen-1", It.IsAny<byte[]>()), Times.Once());
        mockMongoDBService.Verify(m => m.GetThumbnailAsync("gen-1"), Times.Once());
    }

    [Fact]
    public async Task GenerateThumbnailsForIdsAsync_Counts_Failed_When_Thumbnail_Not_Stored()
    {
        // Arrange — record exists, but after GenerateThumbnailAsync the thumbnail is still null
        var record = MakeRecord(id: "fail-1");
        mockMongoDBService.Setup(m => m.GetAsync("fail-1")).ReturnsAsync(record);
        SetupThumbnailResponse(thumbnailBase64: null); // engine returns null
        mockMongoDBService.Setup(m => m.GetThumbnailAsync("fail-1")).ReturnsAsync((byte[]?)null);

        // Act
        await sut.GenerateThumbnailsForIdsAsync(["fail-1"]);

        // Assert — GetThumbnailAsync was called to verify (and found nothing → counted as failed)
        mockMongoDBService.Verify(m => m.GetThumbnailAsync("fail-1"), Times.Once());
    }

    [Fact]
    public async Task GenerateThumbnailsForIdsAsync_Continues_After_Individual_Failure()
    {
        // Arrange — first record throws on GetAsync, second should still be processed
        var record2 = MakeRecord(id: "ok-1");

        mockMongoDBService.Setup(m => m.GetAsync("boom-1"))
            .ThrowsAsync(new InvalidOperationException("db error"));
        mockMongoDBService.Setup(m => m.GetAsync("ok-1")).ReturnsAsync(record2);

        SetupThumbnailResponse("dGVzdA==");
        mockMongoDBService.Setup(m => m.GetThumbnailAsync("ok-1")).ReturnsAsync(new byte[] { 0x01 });

        // Act
        await sut.GenerateThumbnailsForIdsAsync(["boom-1", "ok-1"]);

        // Assert — ok-1 was still processed despite boom-1 failing
        mockMongoDBService.Verify(m => m.UpdateThumbnailAsync("ok-1", It.IsAny<byte[]>()), Times.Once());
    }

    private static JwstDataModel MakeRecord(
        string id = "id-1",
        string? filePath = "mast/obs_id/file.fits",
        bool isViewable = true,
        byte[]? thumbnailData = null)
    {
        return new JwstDataModel
        {
            Id = id,
            FileName = "file.fits",
            DataType = "image",
            FilePath = filePath,
            IsViewable = isViewable,
            ThumbnailData = thumbnailData,
        };
    }

    private void SetupThumbnailResponse(string? thumbnailBase64)
    {
        var responseBody = JsonSerializer.Serialize(new { thumbnail_base64 = thumbnailBase64 });
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(responseBody, Encoding.UTF8, "application/json"),
        };

        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(response);
    }

    private void SetupHttpErrorResponse(HttpStatusCode statusCode)
    {
        var response = new HttpResponseMessage(statusCode);

        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(response);
    }
}
