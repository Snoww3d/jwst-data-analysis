// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;
using System.Text;
using System.Text.Json;

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Services.Storage;
using JwstDataAnalysis.API.Tests.Fixtures;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for MosaicService.
/// </summary>
public class MosaicServiceTests
{
    private readonly Mock<IMongoDBService> mockMongo = new();
    private readonly Mock<IStorageProvider> mockStorage = new();
    private readonly Mock<IThumbnailQueue> mockThumbnailQueue = new();
    private readonly Mock<ILogger<MosaicService>> mockLogger = new();
    private readonly IConfiguration configuration;

    public MosaicServiceTests()
    {
        configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ProcessingEngine:BaseUrl", "http://test-engine:8000" },
            })
            .Build();

        // Default GetManyAsync delegates to per-id GetAsync setups
        mockMongo.Setup(m => m.GetManyAsync(It.IsAny<IEnumerable<string>>()))
            .Returns<IEnumerable<string>>(async ids =>
            {
                var results = new List<JwstDataModel>();
                foreach (var id in ids)
                {
                    var item = await mockMongo.Object.GetAsync(id);
                    if (item != null)
                    {
                        results.Add(item);
                    }
                }

                return results;
            });

        // Default storage stubs — tests that need specific behaviour override these
        mockStorage.Setup(s => s.WriteAsync(It.IsAny<string>(), It.IsAny<Stream>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        mockStorage.Setup(s => s.ExistsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        mockStorage.Setup(s => s.GetSizeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(1024L);
        mockStorage.Setup(s => s.DeleteAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
    }

    // ==================== GenerateMosaicAsync ====================

    /// <summary>
    /// Happy path: returns image bytes when the processing engine responds with 200.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_ReturnsImageBytes_OnSuccess()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits");
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var expectedBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 }; // PNG header
        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(expectedBytes),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var result = await sut.GenerateMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        result.Should().BeEquivalentTo(expectedBytes);
    }

    /// <summary>
    /// The service calls POST /mosaic/generate on the configured engine URL.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_CallsCorrectEndpoint()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits");
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        HttpRequestMessage? captured = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1]) },
            req => captured = req);

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        await sut.GenerateMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        captured.Should().NotBeNull();
        captured!.RequestUri!.ToString().Should().Be("http://test-engine:8000/mosaic/generate");
        captured.Method.Should().Be(HttpMethod.Post);
    }

    /// <summary>
    /// Verifies the request body forwarded to the processing engine includes the stripped
    /// relative path (no /app/data/ prefix) and the per-file stretch parameters.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_SendsRelativeFilePaths_ToEngine()
    {
        // Arrange — absolute path with the /app/data/ prefix
        var data1 = CreateDataModel("data-1", filePath: "/app/data/mast/obs1/file1.fits");
        var data2 = CreateDataModel("data-2", filePath: "/app/data/mast/obs1/file2.fits");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        HttpRequestMessage? captured = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1]) },
            req => captured = req);

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        await sut.GenerateMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        var body = await captured!.Content!.ReadAsStringAsync();
        body.Should().Contain("mast/obs1/file1.fits");
        body.Should().Contain("mast/obs1/file2.fits");
        body.Should().NotContain("/app/data/");
    }

    /// <summary>
    /// Throws KeyNotFoundException when a requested data ID does not exist in MongoDB.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_ThrowsKeyNotFound_WhenDataMissing()
    {
        // Arrange
        mockMongo.Setup(m => m.GetManyAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync([]);

        var sut = CreateService();
        var request = CreateMosaicRequest(["missing-1", "missing-2"]);

        // Act
        var act = () => sut.GenerateMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<KeyNotFoundException>()
            .WithMessage("*not found*");
    }

    /// <summary>
    /// Throws UnauthorizedAccessException when the caller cannot access a private record.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_ThrowsUnauthorized_WhenAccessDenied()
    {
        // Arrange — private data owned by someone else
        var private1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: false, userId: "other");
        var private2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits", isPublic: false, userId: "other");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(private1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(private2);

        var sut = CreateService();
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var act = () => sut.GenerateMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<UnauthorizedAccessException>()
            .WithMessage("*Access denied*");
    }

    /// <summary>
    /// Throws InvalidOperationException when a record has no FilePath.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_ThrowsInvalidOperation_WhenNoFilePath()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: null);
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var sut = CreateService();
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var act = () => sut.GenerateMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*no file path*");
    }

    /// <summary>
    /// Throws HttpRequestException with the engine's detail message on a non-success status.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_ThrowsHttpRequestException_OnEngineError()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits");
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent("{\"detail\":\"Projection failed\"}", Encoding.UTF8, "application/json"),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var act = () => sut.GenerateMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert — exception message should contain the parsed detail string
        var ex = await act.Should().ThrowAsync<HttpRequestException>();
        ex.Which.Message.Should().Contain("Projection failed");
        ex.Which.StatusCode.Should().Be(HttpStatusCode.InternalServerError);
    }

    /// <summary>
    /// Admin can access private data owned by another user.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_AdminAccessesPrivateData_Succeeds()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: false, userId: "other");
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits", isPublic: false, userId: "other");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1, 2, 3]),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var result = await sut.GenerateMosaicAsync(request, "admin-user", isAuthenticated: true, isAdmin: true);

        // Assert
        result.Should().NotBeEmpty();
    }

    /// <summary>
    /// Unauthenticated callers can access public data.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_UnauthenticatedCanAccessPublicData()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: true);
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits", isPublic: true);
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var result = await sut.GenerateMosaicAsync(request, null, isAuthenticated: false, isAdmin: false);

        // Assert
        result.Should().NotBeEmpty();
    }

    /// <summary>
    /// Unauthenticated callers cannot access private data.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_UnauthenticatedCannotAccessPrivateData()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: false);
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits", isPublic: false);
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var sut = CreateService();
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var act = () => sut.GenerateMosaicAsync(request, null, isAuthenticated: false, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<UnauthorizedAccessException>();
    }

    /// <summary>
    /// Owner can access their own private data.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_OwnerAccessesOwnPrivateData_Succeeds()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: false, userId: "owner");
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits", isPublic: false, userId: "owner");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var result = await sut.GenerateMosaicAsync(request, "owner", isAuthenticated: true, isAdmin: false);

        // Assert
        result.Should().NotBeEmpty();
    }

    /// <summary>
    /// Users in SharedWith can access data even though they are not the owner.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_SharedWithUserCanAccess()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: false, userId: "owner");
        data1.SharedWith = ["shared-user"];
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits", isPublic: false, userId: "owner");
        data2.SharedWith = ["shared-user"];
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var result = await sut.GenerateMosaicAsync(request, "shared-user", isAuthenticated: true, isAdmin: false);

        // Assert
        result.Should().NotBeEmpty();
    }

    /// <summary>
    /// Falls back to the raw error body when the engine returns non-JSON.
    /// </summary>
    [Fact]
    public async Task GenerateMosaicAsync_ParsesPlainTextError_AsRawBody()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits");
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.BadGateway)
        {
            Content = new StringContent("Engine unavailable", Encoding.UTF8, "text/plain"),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var act = () => sut.GenerateMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        var ex = await act.Should().ThrowAsync<HttpRequestException>();
        ex.Which.Message.Should().Contain("Engine unavailable");
    }

    /// <summary>
    /// Uses the default URL (http://localhost:8000) when no config is provided.
    /// </summary>
    [Fact]
    public void Constructor_UsesDefaultUrl_WhenConfigMissing()
    {
        // Arrange
        var emptyConfig = new ConfigurationBuilder().Build();

        // Act — should not throw
        var sut = new MosaicService(
            new HttpClient(),
            mockMongo.Object,
            mockStorage.Object,
            mockThumbnailQueue.Object,
            mockLogger.Object,
            emptyConfig);

        // Assert
        sut.Should().NotBeNull();
    }

    // ==================== GenerateAndSaveMosaicAsync ====================

    /// <summary>
    /// Happy path: saves the FITS stream, creates a MongoDB record, enqueues thumbnail,
    /// and returns the correct DTO.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_ReturnsSavedDto_OnSuccess()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var fitsBytes = new byte[] { 0x53, 0x49, 0x4D, 0x50 }; // "SIMP"
        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(fitsBytes),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var result = await sut.GenerateAndSaveMosaicAsync(
            request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        result.Should().NotBeNull();
        result.FileName.Should().EndWith("_i2d.fits");
        result.FileSize.Should().Be(1024L); // from mock GetSizeAsync
        result.FileFormat.Should().Be(FileFormats.FITS);
        result.ProcessingLevel.Should().Be(ProcessingLevels.Level3);
        result.DerivedFrom.Should().Contain("data-1").And.Contain("data-2");
    }

    /// <summary>
    /// Creates a MongoDB record and enqueues the thumbnail job after saving.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_CreatesMongoRecordAndEnqueuesThumbnail()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1, 2, 3]),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        await sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        mockMongo.Verify(m => m.CreateAsync(It.IsAny<JwstDataModel>()), Times.Once);
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(It.IsAny<List<string>>()), Times.Once);
    }

    /// <summary>
    /// The saved record is marked as private when the caller is authenticated.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_SetsUserIdOnRecord_WhenAuthenticated()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        JwstDataModel? savedModel = null;
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => savedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        await sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        savedModel.Should().NotBeNull();
        savedModel!.UserId.Should().Be("user-1");
    }

    /// <summary>
    /// The saved record has no UserId when the caller is unauthenticated.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_NullUserId_WhenUnauthenticated()
    {
        // Arrange — public data accessible without auth
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: true);
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits", isPublic: true);
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        JwstDataModel? savedModel = null;
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => savedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        await sut.GenerateAndSaveMosaicAsync(request, null, isAuthenticated: false, isAdmin: false);

        // Assert
        savedModel.Should().NotBeNull();
        savedModel!.UserId.Should().BeNull();
    }

    /// <summary>
    /// Throws InvalidOperationException when no valid source IDs are provided.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_ThrowsInvalidOperation_WhenNoSourceIds()
    {
        // Arrange
        var sut = CreateService();
        var request = new MosaicRequestDto
        {
            Files = [new MosaicFileConfigDto { DataId = "   " }, new MosaicFileConfigDto { DataId = string.Empty }],
        };

        // Act
        var act = () => sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*No valid source data IDs*");
    }

    /// <summary>
    /// Throws KeyNotFoundException when a data ID cannot be resolved.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_ThrowsKeyNotFound_WhenDataMissing()
    {
        // Arrange
        mockMongo.Setup(m => m.GetAsync("missing")).ReturnsAsync((JwstDataModel?)null);

        var sut = CreateService();
        var request = CreateMosaicRequest(["missing", "missing-2"]);

        // Act
        var act = () => sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<KeyNotFoundException>();
    }

    /// <summary>
    /// Throws InvalidOperationException when a source record has no FilePath.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_ThrowsInvalidOperation_WhenNoFilePath()
    {
        // Arrange
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(
            CreateDataModel("data-1", filePath: null));
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(
            CreateDataModel("data-2", filePath: "mast/obs1/file2.fits"));

        var sut = CreateService();
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var act = () => sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*no file path*");
    }

    /// <summary>
    /// Throws HttpRequestException on processing engine failure.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_ThrowsHttpRequestException_OnEngineError()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.UnprocessableEntity)
        {
            Content = new StringContent("{\"detail\":\"WCS mismatch\"}", Encoding.UTF8, "application/json"),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var act = () => sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        var ex = await act.Should().ThrowAsync<HttpRequestException>();
        ex.Which.Message.Should().Contain("WCS mismatch");
    }

    /// <summary>
    /// Deletes the stored file and throws when the storage provider reports the file
    /// has zero bytes after writing.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_DeletesFileAndThrows_WhenSizeIsZero()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        mockStorage.Setup(s => s.GetSizeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0L);

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var act = () => sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*empty*");
        mockStorage.Verify(s => s.DeleteAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>
    /// Throws when ExistsAsync returns false immediately after writing.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_Throws_WhenFileDoesNotExistAfterWrite()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        mockStorage.Setup(s => s.ExistsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        var act = () => sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*empty*");
    }

    /// <summary>
    /// Always forces OutputFormat=fits and ignores the request OutputFormat field.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_ForcesFitsOutputFormat()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        string? capturedBody = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1]) },
            req => capturedBody = req.Content?.ReadAsStringAsync().GetAwaiter().GetResult());

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);
        request.OutputFormat = "png"; // should be overridden

        // Act
        await sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        capturedBody.Should().NotBeNull();
        using var doc = JsonDocument.Parse(capturedBody!);
        doc.RootElement.GetProperty("output_format").GetString().Should().Be("fits");
    }

    /// <summary>
    /// The generated record inherits IsPublic=true only when all sources are public.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_SetsIsPublicFalse_WhenAnySourceIsPrivate()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: true, userId: "user-1");
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits", isPublic: false, userId: "user-1");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        JwstDataModel? savedModel = null;
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => savedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        await sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        savedModel!.IsPublic.Should().BeFalse();
    }

    /// <summary>
    /// The saved record tags always include "mosaic-generated", "mosaic", "generated", "fits".
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaicAsync_RecordContainsMosaicTags()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        JwstDataModel? savedModel = null;
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => savedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateService(new HttpClient(handler));
        var request = CreateMosaicRequest(["data-1", "data-2"]);

        // Act
        await sut.GenerateAndSaveMosaicAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        savedModel!.Tags.Should().Contain("mosaic-generated")
            .And.Contain("mosaic")
            .And.Contain("generated")
            .And.Contain("fits");
    }

    // ==================== GenerateObservationMosaicAsync ====================

    /// <summary>
    /// Happy path: calls /mosaic/generate-observation and persists the result.
    /// </summary>
    [Fact]
    public async Task GenerateObservationMosaicAsync_ReturnsSavedDto_OnSuccess()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1, 2, 3]),
        });

        var sut = CreateService(new HttpClient(handler));

        // Act
        var result = await sut.GenerateObservationMosaicAsync(
            ["data-1", "data-2"],
            "jw01234-o001_t001_nircam",
            "user-1",
            isAuthenticated: true,
            isAdmin: false);

        // Assert
        result.Should().NotBeNull();
        result.FileName.Should().EndWith("_i2d.fits");
        result.FileFormat.Should().Be(FileFormats.FITS);
        result.ProcessingLevel.Should().Be(ProcessingLevels.Level3);
        result.DerivedFrom.Should().Contain("data-1").And.Contain("data-2");
    }

    /// <summary>
    /// Calls the correct /mosaic/generate-observation endpoint.
    /// </summary>
    [Fact]
    public async Task GenerateObservationMosaicAsync_CallsCorrectEndpoint()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        HttpRequestMessage? captured = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([1]) },
            req => captured = req);

        var sut = CreateService(new HttpClient(handler));

        // Act
        await sut.GenerateObservationMosaicAsync(
            ["data-1", "data-2"],
            "jw01234",
            "user-1",
            isAuthenticated: true,
            isAdmin: false);

        // Assert
        captured!.RequestUri!.ToString().Should().Be("http://test-engine:8000/mosaic/generate-observation");
        captured.Method.Should().Be(HttpMethod.Post);
    }

    /// <summary>
    /// Observation mosaic record is tagged "observation-mosaic", not "generated".
    /// </summary>
    [Fact]
    public async Task GenerateObservationMosaicAsync_RecordContainsObservationMosaicTag()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        JwstDataModel? savedModel = null;
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => savedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateService(new HttpClient(handler));

        // Act
        await sut.GenerateObservationMosaicAsync(
            ["data-1", "data-2"],
            "jw01234",
            "user-1",
            isAuthenticated: true,
            isAdmin: false);

        // Assert
        savedModel!.Tags.Should().Contain("observation-mosaic").And.Contain("mosaic-generated");
    }

    /// <summary>
    /// Stores the correct observationBaseId on the saved record.
    /// </summary>
    [Fact]
    public async Task GenerateObservationMosaicAsync_SetsObservationBaseId_OnRecord()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        JwstDataModel? savedModel = null;
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => savedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateService(new HttpClient(handler));
        const string obsId = "jw01234-o001_t001_nircam";

        // Act
        await sut.GenerateObservationMosaicAsync(
            ["data-1", "data-2"],
            obsId,
            "user-1",
            isAuthenticated: true,
            isAdmin: false);

        // Assert
        savedModel!.ObservationBaseId.Should().Be(obsId);
    }

    /// <summary>
    /// Throws KeyNotFoundException when a source data ID is not found in MongoDB.
    /// </summary>
    [Fact]
    public async Task GenerateObservationMosaicAsync_ThrowsKeyNotFound_WhenDataMissing()
    {
        // Arrange
        mockMongo.Setup(m => m.GetManyAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync([]);

        var sut = CreateService();

        // Act
        var act = () => sut.GenerateObservationMosaicAsync(
            ["missing-1", "missing-2"],
            "obs-1",
            "user-1",
            isAuthenticated: true,
            isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<KeyNotFoundException>();
    }

    /// <summary>
    /// Throws UnauthorizedAccessException when access is denied to a source record.
    /// </summary>
    [Fact]
    public async Task GenerateObservationMosaicAsync_ThrowsUnauthorized_WhenAccessDenied()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: false, userId: "other");
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits", isPublic: false, userId: "other");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var sut = CreateService();

        // Act
        var act = () => sut.GenerateObservationMosaicAsync(
            ["data-1", "data-2"],
            "obs-1",
            "user-1",
            isAuthenticated: true,
            isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<UnauthorizedAccessException>();
    }

    /// <summary>
    /// Throws InvalidOperationException when a source record has no FilePath.
    /// </summary>
    [Fact]
    public async Task GenerateObservationMosaicAsync_ThrowsInvalidOperation_WhenNoFilePath()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: null);
        var data2 = CreateDataModel("data-2", filePath: "mast/obs1/file2.fits");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var sut = CreateService();

        // Act
        var act = () => sut.GenerateObservationMosaicAsync(
            ["data-1", "data-2"],
            "obs-1",
            "user-1",
            isAuthenticated: true,
            isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*no file path*");
    }

    /// <summary>
    /// Throws HttpRequestException on engine failure.
    /// </summary>
    [Fact]
    public async Task GenerateObservationMosaicAsync_ThrowsHttpRequestException_OnEngineError()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent("{\"detail\":\"Out of memory\"}", Encoding.UTF8, "application/json"),
        });

        var sut = CreateService(new HttpClient(handler));

        // Act
        var act = () => sut.GenerateObservationMosaicAsync(
            ["data-1", "data-2"],
            "obs-1",
            "user-1",
            isAuthenticated: true,
            isAdmin: false);

        // Assert
        var ex = await act.Should().ThrowAsync<HttpRequestException>();
        ex.Which.Message.Should().Contain("Out of memory");
    }

    /// <summary>
    /// Deletes the stored file and throws when GetSizeAsync returns zero.
    /// </summary>
    [Fact]
    public async Task GenerateObservationMosaicAsync_DeletesFileAndThrows_WhenSizeIsZero()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        mockStorage.Setup(s => s.GetSizeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(0L);

        var sut = CreateService(new HttpClient(handler));

        // Act
        var act = () => sut.GenerateObservationMosaicAsync(
            ["data-1", "data-2"],
            "obs-1",
            "user-1",
            isAuthenticated: true,
            isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*empty*");
        mockStorage.Verify(s => s.DeleteAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    /// <summary>
    /// Respects CancellationToken: passes it through to storage and HTTP calls.
    /// </summary>
    [Fact]
    public async Task GenerateObservationMosaicAsync_RespectsCancel_WithAlreadyCancelledToken()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        // Override storage write to throw when cancelled
        mockStorage.Setup(s => s.WriteAsync(It.IsAny<string>(), It.IsAny<Stream>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OperationCanceledException());

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });

        var sut = CreateService(new HttpClient(handler));

        // Act
        var act = () => sut.GenerateObservationMosaicAsync(
            ["data-1", "data-2"],
            "obs-1",
            "user-1",
            isAuthenticated: true,
            isAdmin: false,
            cts.Token);

        // Assert
        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    // ==================== GetFootprintsAsync ====================

    /// <summary>
    /// Happy path: returns a FootprintResponseDto when engine responds with 200.
    /// </summary>
    [Fact]
    public async Task GetFootprintsAsync_ReturnsFootprintDto_OnSuccess()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");
        SetupSingleGetAsync("data-2", "mast/obs1/file2.fits");

        var footprintJson = """
            {
              "footprints": [
                { "file_path": "mast/obs1/file1.fits", "corners_ra": [1.0,2.0,3.0,4.0], "corners_dec": [5.0,6.0,7.0,8.0], "center_ra": 2.5, "center_dec": 6.5 },
                { "file_path": "mast/obs1/file2.fits", "corners_ra": [9.0,10.0,11.0,12.0], "corners_dec": [13.0,14.0,15.0,16.0], "center_ra": 10.5, "center_dec": 14.5 }
              ],
              "bounding_box": { "min_ra": 1.0, "max_ra": 12.0, "min_dec": 5.0, "max_dec": 16.0 },
              "n_files": 2
            }
            """;

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(footprintJson, Encoding.UTF8, "application/json"),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = new FootprintRequestDto { DataIds = ["data-1", "data-2"] };

        // Act
        var result = await sut.GetFootprintsAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        result.Should().NotBeNull();
        result.NFiles.Should().Be(2);
        result.Footprints.Should().HaveCount(2);
        result.BoundingBox.Should().ContainKey("min_ra");
    }

    /// <summary>
    /// Calls POST /mosaic/footprint on the configured engine URL.
    /// </summary>
    [Fact]
    public async Task GetFootprintsAsync_CallsCorrectEndpoint()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");

        HttpRequestMessage? captured = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"footprints\":[],\"bounding_box\":{},\"n_files\":1}",
                    Encoding.UTF8,
                    "application/json"),
            },
            req => captured = req);

        var sut = CreateService(new HttpClient(handler));
        var request = new FootprintRequestDto { DataIds = ["data-1"] };

        // Act
        await sut.GetFootprintsAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        captured!.RequestUri!.ToString().Should().Be("http://test-engine:8000/mosaic/footprint");
        captured.Method.Should().Be(HttpMethod.Post);
    }

    /// <summary>
    /// Sends the relative file paths (prefix stripped) in the request body.
    /// </summary>
    [Fact]
    public async Task GetFootprintsAsync_SendsRelativeFilePaths_ToEngine()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "/app/data/mast/obs1/file1.fits");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);

        HttpRequestMessage? captured = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    "{\"footprints\":[],\"bounding_box\":{},\"n_files\":1}",
                    Encoding.UTF8,
                    "application/json"),
            },
            req => captured = req);

        var sut = CreateService(new HttpClient(handler));
        var request = new FootprintRequestDto { DataIds = ["data-1"] };

        // Act
        await sut.GetFootprintsAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        var body = await captured!.Content!.ReadAsStringAsync();
        body.Should().Contain("mast/obs1/file1.fits");
        body.Should().NotContain("/app/data/");
    }

    /// <summary>
    /// Throws KeyNotFoundException when a requested data ID is missing.
    /// </summary>
    [Fact]
    public async Task GetFootprintsAsync_ThrowsKeyNotFound_WhenDataMissing()
    {
        // Arrange
        mockMongo.Setup(m => m.GetManyAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync([]);

        var sut = CreateService();
        var request = new FootprintRequestDto { DataIds = ["missing"] };

        // Act
        var act = () => sut.GetFootprintsAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<KeyNotFoundException>();
    }

    /// <summary>
    /// Throws UnauthorizedAccessException when access is denied to a data record.
    /// </summary>
    [Fact]
    public async Task GetFootprintsAsync_ThrowsUnauthorized_WhenAccessDenied()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: false, userId: "other");
        data1.SharedWith = [];
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);

        var sut = CreateService();
        var request = new FootprintRequestDto { DataIds = ["data-1"] };

        // Act
        var act = () => sut.GetFootprintsAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<UnauthorizedAccessException>();
    }

    /// <summary>
    /// Throws InvalidOperationException when a record has no FilePath.
    /// </summary>
    [Fact]
    public async Task GetFootprintsAsync_ThrowsInvalidOperation_WhenNoFilePath()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: null);
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);

        var sut = CreateService();
        var request = new FootprintRequestDto { DataIds = ["data-1"] };

        // Act
        var act = () => sut.GetFootprintsAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*no file path*");
    }

    /// <summary>
    /// Throws HttpRequestException on engine failure and includes the detail message.
    /// </summary>
    [Fact]
    public async Task GetFootprintsAsync_ThrowsHttpRequestException_OnEngineError()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent("{\"detail\":\"Footprint error\"}", Encoding.UTF8, "application/json"),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = new FootprintRequestDto { DataIds = ["data-1"] };

        // Act
        var act = () => sut.GetFootprintsAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        var ex = await act.Should().ThrowAsync<HttpRequestException>();
        ex.Which.Message.Should().Contain("Footprint error");
    }

    /// <summary>
    /// Throws InvalidOperationException when the engine returns a null/empty response body.
    /// </summary>
    [Fact]
    public async Task GetFootprintsAsync_ThrowsInvalidOperation_WhenResponseDeserializesToNull()
    {
        // Arrange
        SetupSingleGetAsync("data-1", "mast/obs1/file1.fits");

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("null", Encoding.UTF8, "application/json"),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = new FootprintRequestDto { DataIds = ["data-1"] };

        // Act
        var act = () => sut.GetFootprintsAsync(request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*deserialize footprint response*");
    }

    /// <summary>
    /// Admin can access private data in footprint calculation.
    /// </summary>
    [Fact]
    public async Task GetFootprintsAsync_AdminAccessesPrivateData_Succeeds()
    {
        // Arrange
        var data1 = CreateDataModel("data-1", filePath: "mast/obs1/file1.fits", isPublic: false, userId: "other");
        data1.SharedWith = [];
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                "{\"footprints\":[],\"bounding_box\":{},\"n_files\":1}",
                Encoding.UTF8,
                "application/json"),
        });

        var sut = CreateService(new HttpClient(handler));
        var request = new FootprintRequestDto { DataIds = ["data-1"] };

        // Act
        var result = await sut.GetFootprintsAsync(
            request, "admin-user", isAuthenticated: true, isAdmin: true);

        // Assert
        result.Should().NotBeNull();
    }

    // ==================== Helper methods
    private static JwstDataModel CreateDataModel(
        string id = "data-1",
        string? filePath = "mast/obs1/file.fits",
        bool isPublic = true,
        string? userId = "owner-user")
    {
        var model = TestDataFixtures.CreateSampleData(id: id);
        model.FilePath = filePath;
        model.IsPublic = isPublic;
        model.UserId = userId;
        model.SharedWith = [];
        return model;
    }

    private static MosaicRequestDto CreateMosaicRequest(List<string> dataIds)
    {
        return new MosaicRequestDto
        {
            Files = dataIds
                .Select(id => new MosaicFileConfigDto
                {
                    DataId = id,
                    Stretch = "asinh",
                    BlackPoint = 0.0,
                    WhitePoint = 1.0,
                    Gamma = 1.0,
                    AsinhA = 0.1,
                })
                .ToList(),
            OutputFormat = "png",
            Quality = 95,
            Width = 1000,
            Height = 1000,
            CombineMethod = "mean",
            Cmap = "grayscale",
        };
    }

    private MosaicService CreateService(HttpClient? httpClient = null)
    {
        return new MosaicService(
            httpClient ?? new HttpClient(),
            mockMongo.Object,
            mockStorage.Object,
            mockThumbnailQueue.Object,
            mockLogger.Object,
            configuration);
    }

    private void SetupSingleGetAsync(string id, string? filePath)
    {
        mockMongo.Setup(m => m.GetAsync(id))
            .ReturnsAsync(CreateDataModel(id, filePath: filePath));
    }

    /// <summary>
    /// Lightweight HttpMessageHandler for testing HTTP calls without a real network.
    /// </summary>
    private sealed class FakeHttpMessageHandler : HttpMessageHandler
    {
        private readonly HttpResponseMessage response;
        private readonly Action<HttpRequestMessage>? onSend;

        public FakeHttpMessageHandler(
            HttpResponseMessage response,
            Action<HttpRequestMessage>? onSend = null)
        {
            this.response = response;
            this.onSend = onSend;
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            onSend?.Invoke(request);
            return Task.FromResult(response);
        }
    }
}
