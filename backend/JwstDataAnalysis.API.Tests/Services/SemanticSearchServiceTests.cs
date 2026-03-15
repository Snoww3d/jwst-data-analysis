// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;
using System.Text;
using System.Text.Json;

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Tests.Fixtures;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

using Moq;
using Moq.Protected;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for SemanticSearchService.
/// </summary>
public class SemanticSearchServiceTests
{
    // Static field appears before instance fields to satisfy SA1204
    private static readonly JsonSerializerOptions SnakeCaseOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    private readonly Mock<HttpMessageHandler> mockHandler = new();
    private readonly Mock<IMongoDBService> mockMongoService = new();
    private readonly Mock<ILogger<SemanticSearchService>> mockLogger = new();
    private readonly SemanticSearchService sut;

    /// <summary>
    /// Initialises a new instance of the <see cref="SemanticSearchServiceTests"/> class.
    /// </summary>
    public SemanticSearchServiceTests()
    {
        var httpClient = new HttpClient(mockHandler.Object);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ProcessingEngine:BaseUrl", "http://localhost:8000" },
            })
            .Build();

        sut = new SemanticSearchService(
            httpClient,
            mockMongoService.Object,
            mockLogger.Object,
            config);
    }

    // ===== SearchAsync — happy path =====

    /// <summary>
    /// Returns enriched results when Python engine succeeds and MongoDB records are accessible.
    /// </summary>
    [Fact]
    public async Task SearchAsync_ReturnsEnrichedResults_OnSuccess()
    {
        // Arrange
        var doc = BuildDoc("file-1", isPublic: true);

        var pythonPayload = BuildPythonSearchJson(
            query: "nebula",
            results: [("file-1", 0.92, "A bright nebula")],
            embedMs: 12.1,
            searchMs: 5.3,
            totalIndexed: 42);

        SetupMockResponse(HttpStatusCode.OK, pythonPayload);
        mockMongoService.Setup(m => m.GetAsync("file-1")).ReturnsAsync(doc);

        // Act
        var result = await sut.SearchAsync("nebula", topK: 5, minScore: 0.5, userId: null, isAdmin: false);

        // Assert
        result.Should().NotBeNull();
        result.Query.Should().Be("nebula");
        result.EmbedTimeMs.Should().Be(12.1);
        result.SearchTimeMs.Should().Be(5.3);
        result.TotalIndexed.Should().Be(42);
        result.ResultCount.Should().Be(1);
        result.Results.Should().HaveCount(1);

        var r = result.Results[0];
        r.Id.Should().Be(doc.Id);
        r.FileName.Should().Be(doc.FileName);
        r.Score.Should().Be(0.92);
        r.MatchedText.Should().Be("A bright nebula");
        r.TargetName.Should().Be(doc.ImageInfo!.TargetName);
        r.Instrument.Should().Be(doc.ImageInfo.Instrument);
        r.Filter.Should().Be(doc.ImageInfo.Filter);
        r.ProcessingLevel.Should().Be(doc.ProcessingLevel);
    }

    /// <summary>
    /// Sends query, top_k, and min_score in the POST body to the correct URL.
    /// </summary>
    [Fact]
    public async Task SearchAsync_PostsToCorrectUrl_WithExpectedBody()
    {
        // Arrange
        HttpRequestMessage? captured = null;
        string? capturedBody = null;

        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>(
                async (req, ct) =>
                {
                    captured = req;
                    capturedBody = await req.Content!.ReadAsStringAsync(ct);
                })
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(
                    BuildPythonSearchJson("star cluster", [], 0, 0, 0),
                    Encoding.UTF8,
                    "application/json"),
            });

        // Act
        await sut.SearchAsync("star cluster", topK: 10, minScore: 0.75, userId: "u1", isAdmin: false);

        // Assert
        captured!.RequestUri!.ToString().Should().Be("http://localhost:8000/semantic/search");
        captured.Method.Should().Be(HttpMethod.Post);

        capturedBody.Should().NotBeNull();
        using var doc = JsonDocument.Parse(capturedBody!);
        doc.RootElement.GetProperty("query").GetString().Should().Be("star cluster");
        doc.RootElement.GetProperty("top_k").GetInt32().Should().Be(10);
        doc.RootElement.GetProperty("min_score").GetDouble().Should().Be(0.75);
    }

    /// <summary>
    /// Returns an empty result list when Python returns no results.
    /// </summary>
    [Fact]
    public async Task SearchAsync_ReturnsEmptyList_WhenPythonReturnsNoResults()
    {
        // Arrange
        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson("galaxy", [], embedMs: 5, searchMs: 2, totalIndexed: 100));

        // Act
        var result = await sut.SearchAsync("galaxy", topK: 5, minScore: 0.5, userId: null, isAdmin: false);

        // Assert
        result.Results.Should().BeEmpty();
        result.ResultCount.Should().Be(0);
        result.TotalIndexed.Should().Be(100);
    }

    // ===== SearchAsync — access control =====

    /// <summary>
    /// Skips private documents that do not belong to the requesting user.
    /// </summary>
    [Fact]
    public async Task SearchAsync_ExcludesPrivateDoc_WhenUserIsNotOwner()
    {
        // Arrange
        var doc = BuildDoc("file-private", isPublic: false, userId: "other-user");

        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson("test", [("file-private", 0.9, "match")], 0, 0, 1));
        mockMongoService.Setup(m => m.GetAsync("file-private")).ReturnsAsync(doc);

        // Act
        var result = await sut.SearchAsync("test", 5, 0.5, userId: "requesting-user", isAdmin: false);

        // Assert
        result.Results.Should().BeEmpty();
    }

    /// <summary>
    /// Includes private documents owned by the requesting user.
    /// </summary>
    [Fact]
    public async Task SearchAsync_IncludesPrivateDoc_WhenUserIsOwner()
    {
        // Arrange
        var doc = BuildDoc("file-owned", isPublic: false, userId: "owner-user");

        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson("test", [("file-owned", 0.88, "match")], 0, 0, 1));
        mockMongoService.Setup(m => m.GetAsync("file-owned")).ReturnsAsync(doc);

        // Act
        var result = await sut.SearchAsync("test", 5, 0.5, userId: "owner-user", isAdmin: false);

        // Assert
        result.Results.Should().HaveCount(1);
        result.Results[0].Id.Should().Be(doc.Id);
    }

    /// <summary>
    /// Admin bypasses access control and sees private documents owned by others.
    /// </summary>
    [Fact]
    public async Task SearchAsync_IncludesPrivateDoc_WhenCallerIsAdmin()
    {
        // Arrange
        var doc = BuildDoc("file-private", isPublic: false, userId: "owner-user");

        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson("test", [("file-private", 0.95, "match")], 0, 0, 1));
        mockMongoService.Setup(m => m.GetAsync("file-private")).ReturnsAsync(doc);

        // Act
        var result = await sut.SearchAsync("test", 5, 0.5, userId: "admin-user", isAdmin: true);

        // Assert
        result.Results.Should().HaveCount(1);
    }

    /// <summary>
    /// User in SharedWith list can see the private document.
    /// </summary>
    [Fact]
    public async Task SearchAsync_IncludesPrivateDoc_WhenUserIsInSharedWithList()
    {
        // Arrange
        var doc = BuildDoc("file-shared", isPublic: false, userId: "owner-user");
        doc.SharedWith = ["shared-user", "another-user"];

        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson("test", [("file-shared", 0.8, "match")], 0, 0, 1));
        mockMongoService.Setup(m => m.GetAsync("file-shared")).ReturnsAsync(doc);

        // Act
        var result = await sut.SearchAsync("test", 5, 0.5, userId: "shared-user", isAdmin: false);

        // Assert
        result.Results.Should().HaveCount(1);
    }

    /// <summary>
    /// Unauthenticated callers (null userId) cannot see private documents.
    /// </summary>
    [Fact]
    public async Task SearchAsync_ExcludesPrivateDoc_WhenCallerIsAnonymous()
    {
        // Arrange
        var doc = BuildDoc("file-private", isPublic: false, userId: "owner-user");

        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson("test", [("file-private", 0.9, "match")], 0, 0, 1));
        mockMongoService.Setup(m => m.GetAsync("file-private")).ReturnsAsync(doc);

        // Act
        var result = await sut.SearchAsync("test", 5, 0.5, userId: null, isAdmin: false);

        // Assert
        result.Results.Should().BeEmpty();
    }

    /// <summary>
    /// Skips a result silently when the corresponding MongoDB document is not found.
    /// </summary>
    [Fact]
    public async Task SearchAsync_SkipsResult_WhenMongoDocNotFound()
    {
        // Arrange
        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson("test", [("missing-id", 0.9, "match")], 0, 0, 1));
        mockMongoService.Setup(m => m.GetAsync("missing-id")).ReturnsAsync((JwstDataModel?)null);

        // Act
        var result = await sut.SearchAsync("test", 5, 0.5, userId: null, isAdmin: false);

        // Assert
        result.Results.Should().BeEmpty();
        result.ResultCount.Should().Be(0);
    }

    /// <summary>
    /// Continues processing remaining results when MongoDB throws for one file.
    /// </summary>
    [Fact]
    public async Task SearchAsync_ContinuesEnrichment_WhenSingleMongoFetchThrows()
    {
        // Arrange
        var goodDoc = BuildDoc("file-good", isPublic: true);

        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson(
                "test",
                [("file-bad", 0.95, "bad"), ("file-good", 0.80, "good")],
                embedMs: 1,
                searchMs: 1,
                totalIndexed: 2));

        mockMongoService.Setup(m => m.GetAsync("file-bad"))
            .ThrowsAsync(new InvalidOperationException("Mongo timeout"));
        mockMongoService.Setup(m => m.GetAsync("file-good"))
            .ReturnsAsync(goodDoc);

        // Act
        var result = await sut.SearchAsync("test", 5, 0.5, userId: null, isAdmin: false);

        // Assert — bad file is skipped, good file is returned
        result.Results.Should().HaveCount(1);
        result.Results[0].Id.Should().Be(goodDoc.Id);
    }

    // ===== SearchAsync — error handling =====

    /// <summary>
    /// Throws HttpRequestException when Python returns a non-success status code.
    /// </summary>
    [Fact]
    public async Task SearchAsync_ThrowsHttpRequestException_WhenEngineReturnsError()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.InternalServerError, "{\"detail\":\"engine failure\"}");

        // Act
        var act = () => sut.SearchAsync("galaxy", 5, 0.5, userId: null, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>()
            .WithMessage("*Semantic search error*");
    }

    /// <summary>
    /// Throws HttpRequestException when Python returns 503 (service unavailable).
    /// </summary>
    [Fact]
    public async Task SearchAsync_ThrowsHttpRequestException_WhenEngineIsDown()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.ServiceUnavailable, string.Empty);

        // Act
        var act = () => sut.SearchAsync("galaxy", 5, 0.5, userId: null, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>();
    }

    /// <summary>
    /// Throws InvalidOperationException when Python returns a null/empty body.
    /// </summary>
    [Fact]
    public async Task SearchAsync_ThrowsInvalidOperation_WhenEngineReturnsNullBody()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "null");

        // Act
        var act = () => sut.SearchAsync("galaxy", 5, 0.5, userId: null, isAdmin: false);

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*null search response*");
    }

    // ===== GetIndexStatusAsync =====

    /// <summary>
    /// Returns parsed status when Python returns a successful response.
    /// </summary>
    [Fact]
    public async Task GetIndexStatusAsync_ReturnsStatus_OnSuccess()
    {
        // Arrange
        var payload = JsonSerializer.Serialize(new
        {
            total_indexed = 128,
            model_loaded = true,
            index_file_exists = true,
            model_name = "all-MiniLM-L6-v2",
            embedding_dim = 384,
        });

        SetupMockResponse(HttpStatusCode.OK, payload);

        // Act
        var result = await sut.GetIndexStatusAsync();

        // Assert
        result.Should().NotBeNull();
        result.TotalIndexed.Should().Be(128);
        result.ModelLoaded.Should().BeTrue();
        result.IndexFileExists.Should().BeTrue();
        result.ModelName.Should().Be("all-MiniLM-L6-v2");
        result.EmbeddingDim.Should().Be(384);
    }

    /// <summary>
    /// Hits the correct URL for the index-status endpoint.
    /// </summary>
    [Fact]
    public async Task GetIndexStatusAsync_CallsCorrectUrl()
    {
        // Arrange
        HttpRequestMessage? captured = null;
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => captured = req)
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(
                    JsonSerializer.Serialize(new
                    {
                        total_indexed = 0,
                        model_loaded = false,
                        index_file_exists = false,
                        model_name = string.Empty,
                        embedding_dim = 0,
                    }),
                    Encoding.UTF8,
                    "application/json"),
            });

        // Act
        await sut.GetIndexStatusAsync();

        // Assert
        captured!.RequestUri!.ToString().Should().Be("http://localhost:8000/semantic/index-status");
        captured.Method.Should().Be(HttpMethod.Get);
    }

    /// <summary>
    /// Throws HttpRequestException when Python returns a non-success status code.
    /// </summary>
    [Fact]
    public async Task GetIndexStatusAsync_ThrowsHttpRequestException_OnEngineError()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.InternalServerError, "{\"detail\":\"index error\"}");

        // Act
        var act = () => sut.GetIndexStatusAsync();

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>()
            .WithMessage("*Index status error*");
    }

    /// <summary>
    /// Throws InvalidOperationException when Python returns a null body.
    /// </summary>
    [Fact]
    public async Task GetIndexStatusAsync_ThrowsInvalidOperation_WhenEngineReturnsNullBody()
    {
        // Arrange
        SetupMockResponse(HttpStatusCode.OK, "null");

        // Act
        var act = () => sut.GetIndexStatusAsync();

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*null index status*");
    }

    // ===== EmbedBatchAsync =====

    /// <summary>
    /// Returns embedded count when MongoDB documents are found and engine succeeds.
    /// </summary>
    [Fact]
    public async Task EmbedBatchAsync_ReturnsResult_OnSuccess()
    {
        // Arrange
        var doc1 = BuildDoc("file-1", isPublic: true);
        var doc2 = BuildDoc("file-2", isPublic: true);

        mockMongoService.Setup(m => m.GetAsync("file-1")).ReturnsAsync(doc1);
        mockMongoService.Setup(m => m.GetAsync("file-2")).ReturnsAsync(doc2);

        SetupMockResponse(
            HttpStatusCode.OK,
            JsonSerializer.Serialize(new { embedded_count = 2, total_indexed = 10, errors = Array.Empty<string>() }));

        // Act
        var result = await sut.EmbedBatchAsync(["file-1", "file-2"]);

        // Assert
        result.Should().NotBeNull();
        result.EmbeddedCount.Should().Be(2);
        result.TotalIndexed.Should().Be(10);
    }

    /// <summary>
    /// Returns zero counts without calling the engine when no MongoDB documents are found.
    /// </summary>
    [Fact]
    public async Task EmbedBatchAsync_ReturnsZeroCount_WhenNoDocsFound()
    {
        // Arrange
        mockMongoService.Setup(m => m.GetAsync(It.IsAny<string>()))
            .ReturnsAsync((JwstDataModel?)null);

        // Act
        var result = await sut.EmbedBatchAsync(["missing-1", "missing-2"]);

        // Assert
        result.EmbeddedCount.Should().Be(0);
        result.TotalIndexed.Should().Be(0);

        // Engine should NOT be called
        mockHandler.Protected()
            .Verify(
                "SendAsync",
                Times.Never(),
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>());
    }

    /// <summary>
    /// Sends only the documents that were successfully retrieved from MongoDB.
    /// </summary>
    [Fact]
    public async Task EmbedBatchAsync_SendsOnlyFoundDocs_WhenSomeIdsAreMissing()
    {
        // Arrange
        var doc = BuildDoc("file-found", isPublic: true);

        mockMongoService.Setup(m => m.GetAsync("file-found")).ReturnsAsync(doc);
        mockMongoService.Setup(m => m.GetAsync("file-missing")).ReturnsAsync((JwstDataModel?)null);

        string? capturedBody = null;
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>(
                async (req, ct) =>
                {
                    capturedBody = await req.Content!.ReadAsStringAsync(ct);
                })
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(
                    JsonSerializer.Serialize(new { embedded_count = 1, total_indexed = 5, errors = Array.Empty<string>() }),
                    Encoding.UTF8,
                    "application/json"),
            });

        // Act
        await sut.EmbedBatchAsync(["file-found", "file-missing"]);

        // Assert — only the found document's metadata is in the body
        capturedBody.Should().NotBeNull();
        using var parsed = JsonDocument.Parse(capturedBody!);
        var items = parsed.RootElement.GetProperty("items");
        items.GetArrayLength().Should().Be(1);
        items[0].GetProperty("file_id").GetString().Should().Be(doc.Id);
    }

    /// <summary>
    /// Posts to the correct embed-batch URL.
    /// </summary>
    [Fact]
    public async Task EmbedBatchAsync_PostsToCorrectUrl()
    {
        // Arrange
        var doc = BuildDoc("file-1", isPublic: true);
        mockMongoService.Setup(m => m.GetAsync("file-1")).ReturnsAsync(doc);

        HttpRequestMessage? captured = null;
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => captured = req)
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(
                    JsonSerializer.Serialize(new { embedded_count = 1, total_indexed = 1, errors = Array.Empty<string>() }),
                    Encoding.UTF8,
                    "application/json"),
            });

        // Act
        await sut.EmbedBatchAsync(["file-1"]);

        // Assert
        captured!.RequestUri!.ToString().Should().Be("http://localhost:8000/semantic/embed-batch");
        captured.Method.Should().Be(HttpMethod.Post);
    }

    /// <summary>
    /// Skips a file ID silently when MongoDB throws during EmbedBatch.
    /// </summary>
    [Fact]
    public async Task EmbedBatchAsync_SkipsFileId_WhenMongoThrows()
    {
        // Arrange
        var goodDoc = BuildDoc("file-good", isPublic: true);

        mockMongoService.Setup(m => m.GetAsync("file-throw"))
            .ThrowsAsync(new InvalidOperationException("Mongo unreachable"));
        mockMongoService.Setup(m => m.GetAsync("file-good")).ReturnsAsync(goodDoc);

        SetupMockResponse(
            HttpStatusCode.OK,
            JsonSerializer.Serialize(new { embedded_count = 1, total_indexed = 1, errors = Array.Empty<string>() }));

        // Act
        var result = await sut.EmbedBatchAsync(["file-throw", "file-good"]);

        // Assert — should still return a result (from the good doc)
        result.EmbeddedCount.Should().Be(1);
    }

    /// <summary>
    /// Throws HttpRequestException when Python returns an error for embed-batch.
    /// </summary>
    [Fact]
    public async Task EmbedBatchAsync_ThrowsHttpRequestException_OnEngineError()
    {
        // Arrange
        var doc = BuildDoc("file-1", isPublic: true);
        mockMongoService.Setup(m => m.GetAsync("file-1")).ReturnsAsync(doc);
        SetupMockResponse(HttpStatusCode.InternalServerError, "{\"detail\":\"embed error\"}");

        // Act
        var act = () => sut.EmbedBatchAsync(["file-1"]);

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>()
            .WithMessage("*Embed batch error*");
    }

    /// <summary>
    /// Maps all ImageMetadata fields into the embedding payload correctly.
    /// </summary>
    [Fact]
    public async Task EmbedBatchAsync_MapsAllMetadataFields_ToEmbeddingPayload()
    {
        // Arrange
        var obsDate = new DateTime(2023, 7, 15, 0, 0, 0, DateTimeKind.Utc);
        var doc = new JwstDataModel
        {
            Id = "rich-file",
            FileName = "rich.fits",
            DataType = "image",
            ProcessingLevel = "L2b",
            ImageInfo = new ImageMetadata
            {
                TargetName = "Carina Nebula",
                Instrument = "NIRCAM",
                Filter = "F200W",
                ExposureTime = 3600.0,
                WavelengthRange = "INFRARED",
                CalibrationLevel = 2,
                ObservationDate = obsDate,
                ProposalPi = "Jane Smith",
                ProposalId = "1234",
                ObservationTitle = "Deep NIRCam Survey",
            },
        };

        mockMongoService.Setup(m => m.GetAsync("rich-file")).ReturnsAsync(doc);

        string? capturedBody = null;
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>(
                async (req, ct) =>
                {
                    capturedBody = await req.Content!.ReadAsStringAsync(ct);
                })
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(
                    JsonSerializer.Serialize(new { embedded_count = 1, total_indexed = 1, errors = Array.Empty<string>() }),
                    Encoding.UTF8,
                    "application/json"),
            });

        // Act
        await sut.EmbedBatchAsync(["rich-file"]);

        // Assert
        capturedBody.Should().NotBeNull();
        using var parsed = JsonDocument.Parse(capturedBody!);
        var item = parsed.RootElement.GetProperty("items")[0];

        item.GetProperty("file_id").GetString().Should().Be("rich-file");
        item.GetProperty("target_name").GetString().Should().Be("Carina Nebula");
        item.GetProperty("instrument").GetString().Should().Be("NIRCAM");
        item.GetProperty("filter_name").GetString().Should().Be("F200W");
        item.GetProperty("exposure_time").GetDouble().Should().Be(3600.0);
        item.GetProperty("wavelength_range").GetString().Should().Be("INFRARED");
        item.GetProperty("calibration_level").GetInt32().Should().Be(2);
        item.GetProperty("observation_date").GetString().Should().Be("2023-07-15");
        item.GetProperty("proposal_pi").GetString().Should().Be("Jane Smith");
        item.GetProperty("proposal_id").GetString().Should().Be("1234");
        item.GetProperty("observation_title").GetString().Should().Be("Deep NIRCam Survey");
        item.GetProperty("data_type").GetString().Should().Be("image");
        item.GetProperty("file_name").GetString().Should().Be("rich.fits");
        item.GetProperty("processing_level").GetString().Should().Be("L2b");
    }

    // ===== ReindexAllAsync =====

    /// <summary>
    /// Returns result when all documents are successfully fetched and embedded.
    /// </summary>
    [Fact]
    public async Task ReindexAllAsync_ReturnsResult_OnSuccess()
    {
        // Arrange
        var docs = TestDataFixtures.CreateSampleDataList(3);
        mockMongoService.Setup(m => m.GetAsync()).ReturnsAsync(docs);

        SetupMockResponse(
            HttpStatusCode.OK,
            JsonSerializer.Serialize(new { embedded_count = 3, total_indexed = 3, errors = Array.Empty<string>() }));

        // Act
        var result = await sut.ReindexAllAsync();

        // Assert
        result.Should().NotBeNull();
        result.EmbeddedCount.Should().Be(3);
        result.TotalIndexed.Should().Be(3);
    }

    /// <summary>
    /// Returns zero counts without calling the engine when the collection is empty.
    /// </summary>
    [Fact]
    public async Task ReindexAllAsync_ReturnsZeroCounts_WhenCollectionIsEmpty()
    {
        // Arrange
        mockMongoService.Setup(m => m.GetAsync()).ReturnsAsync([]);

        // Act
        var result = await sut.ReindexAllAsync();

        // Assert
        result.EmbeddedCount.Should().Be(0);
        result.TotalIndexed.Should().Be(0);

        // Engine should NOT be called
        mockHandler.Protected()
            .Verify(
                "SendAsync",
                Times.Never(),
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>());
    }

    /// <summary>
    /// Maps all documents from the collection into the embed-batch payload.
    /// </summary>
    [Fact]
    public async Task ReindexAllAsync_SendsAllDocuments_ToEmbedBatch()
    {
        // Arrange
        var docs = TestDataFixtures.CreateSampleDataList(4);
        mockMongoService.Setup(m => m.GetAsync()).ReturnsAsync(docs);

        string? capturedBody = null;
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>(
                async (req, ct) =>
                {
                    capturedBody = await req.Content!.ReadAsStringAsync(ct);
                })
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(
                    JsonSerializer.Serialize(new { embedded_count = 4, total_indexed = 4, errors = Array.Empty<string>() }),
                    Encoding.UTF8,
                    "application/json"),
            });

        // Act
        await sut.ReindexAllAsync();

        // Assert
        capturedBody.Should().NotBeNull();
        using var parsed = JsonDocument.Parse(capturedBody!);
        parsed.RootElement.GetProperty("items").GetArrayLength().Should().Be(4);
    }

    /// <summary>
    /// Throws HttpRequestException when Python returns an error during reindex.
    /// </summary>
    [Fact]
    public async Task ReindexAllAsync_ThrowsHttpRequestException_OnEngineError()
    {
        // Arrange
        var docs = TestDataFixtures.CreateSampleDataList(2);
        mockMongoService.Setup(m => m.GetAsync()).ReturnsAsync(docs);
        SetupMockResponse(HttpStatusCode.InternalServerError, "{\"detail\":\"reindex error\"}");

        // Act
        var act = () => sut.ReindexAllAsync();

        // Assert
        await act.Should().ThrowAsync<HttpRequestException>()
            .WithMessage("*Embed batch error*");
    }

    /// <summary>
    /// Throws InvalidOperationException when Python returns a null body during reindex.
    /// </summary>
    [Fact]
    public async Task ReindexAllAsync_ThrowsInvalidOperation_WhenEngineReturnsNullBody()
    {
        // Arrange
        var docs = TestDataFixtures.CreateSampleDataList(1);
        mockMongoService.Setup(m => m.GetAsync()).ReturnsAsync(docs);
        SetupMockResponse(HttpStatusCode.OK, "null");

        // Act
        var act = () => sut.ReindexAllAsync();

        // Assert
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*null embed response*");
    }

    // ===== Configuration =====

    /// <summary>
    /// Uses the default base URL when configuration is missing the ProcessingEngine:BaseUrl key.
    /// </summary>
    [Fact]
    public async Task Constructor_UsesDefaultBaseUrl_WhenConfigKeyMissing()
    {
        // Arrange
        var httpClient = new HttpClient(mockHandler.Object);
        var emptyConfig = new ConfigurationBuilder().Build();
        var service = new SemanticSearchService(
            httpClient, mockMongoService.Object, mockLogger.Object, emptyConfig);

        HttpRequestMessage? captured = null;
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => captured = req)
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(
                    JsonSerializer.Serialize(new
                    {
                        total_indexed = 0,
                        model_loaded = false,
                        index_file_exists = false,
                        model_name = string.Empty,
                        embedding_dim = 0,
                    }),
                    Encoding.UTF8,
                    "application/json"),
            });

        // Act
        await service.GetIndexStatusAsync();

        // Assert — default URL is http://localhost:8000
        captured!.RequestUri!.Host.Should().Be("localhost");
        captured.RequestUri.Port.Should().Be(8000);
    }

    /// <summary>
    /// Uses a custom base URL when configuration supplies one.
    /// </summary>
    [Fact]
    public async Task Constructor_UsesCustomBaseUrl_WhenConfigKeyProvided()
    {
        // Arrange
        var httpClient = new HttpClient(mockHandler.Object);
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ProcessingEngine:BaseUrl", "http://engine.internal:9000" },
            })
            .Build();

        var service = new SemanticSearchService(
            httpClient, mockMongoService.Object, mockLogger.Object, config);

        HttpRequestMessage? captured = null;
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .Callback<HttpRequestMessage, CancellationToken>((req, _) => captured = req)
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content = new StringContent(
                    JsonSerializer.Serialize(new
                    {
                        total_indexed = 0,
                        model_loaded = false,
                        index_file_exists = false,
                        model_name = string.Empty,
                        embedding_dim = 0,
                    }),
                    Encoding.UTF8,
                    "application/json"),
            });

        // Act
        await service.GetIndexStatusAsync();

        // Assert
        captured!.RequestUri!.ToString().Should().StartWith("http://engine.internal:9000");
    }

    // ===== SearchAsync — metadata enrichment =====

    /// <summary>
    /// Enriches results with all available ImageInfo fields from MongoDB.
    /// </summary>
    [Fact]
    public async Task SearchAsync_EnrichesResult_WithAllImageInfoFields()
    {
        // Arrange
        var doc = new JwstDataModel
        {
            Id = "enriched-file",
            FileName = "enriched.fits",
            ProcessingLevel = "L2b",
            IsPublic = true,
            SharedWith = [],
            ImageInfo = new ImageMetadata
            {
                TargetName = "Pillars of Creation",
                Instrument = "MIRI",
                Filter = "F770W",
                WavelengthRange = "MID-IR",
                ExposureTime = 7200.0,
            },
            ThumbnailData = [0x89, 0x50, 0x4E, 0x47],
        };

        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson("pillars", [("enriched-file", 0.98, "bright feature")], 10, 3, 50));
        mockMongoService.Setup(m => m.GetAsync("enriched-file")).ReturnsAsync(doc);

        // Act
        var result = await sut.SearchAsync("pillars", 5, 0.5, userId: null, isAdmin: false);

        // Assert
        var r = result.Results.Should().ContainSingle().Subject;
        r.TargetName.Should().Be("Pillars of Creation");
        r.Instrument.Should().Be("MIRI");
        r.Filter.Should().Be("F770W");
        r.WavelengthRange.Should().Be("MID-IR");
        r.ExposureTime.Should().Be(7200.0);
        r.ProcessingLevel.Should().Be("L2b");
        r.ThumbnailData.Should().Equal([0x89, 0x50, 0x4E, 0x47]);
    }

    /// <summary>
    /// Handles results for documents that have no ImageInfo (all nullable fields remain null).
    /// </summary>
    [Fact]
    public async Task SearchAsync_HandlesDocWithNoImageInfo_GracefullyNullsFields()
    {
        // Arrange
        var doc = new JwstDataModel
        {
            Id = "bare-file",
            FileName = "bare.fits",
            IsPublic = true,
            SharedWith = [],
            ImageInfo = null,
        };

        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson("test", [("bare-file", 0.7, "bare match")], 0, 0, 1));
        mockMongoService.Setup(m => m.GetAsync("bare-file")).ReturnsAsync(doc);

        // Act
        var result = await sut.SearchAsync("test", 5, 0.5, userId: null, isAdmin: false);

        // Assert
        var r = result.Results.Should().ContainSingle().Subject;
        r.TargetName.Should().BeNull();
        r.Instrument.Should().BeNull();
        r.Filter.Should().BeNull();
        r.WavelengthRange.Should().BeNull();
        r.ExposureTime.Should().BeNull();
    }

    // ===== SearchAsync — multiple result handling =====

    /// <summary>
    /// Returns multiple enriched results when Python returns multiple matches.
    /// </summary>
    [Fact]
    public async Task SearchAsync_ReturnsMultipleResults_WithCorrectScores()
    {
        // Arrange
        var doc1 = BuildDoc("file-a", isPublic: true);
        var doc2 = BuildDoc("file-b", isPublic: true);

        SetupMockResponse(
            HttpStatusCode.OK,
            BuildPythonSearchJson(
                "binary star",
                [("file-a", 0.95, "match A"), ("file-b", 0.80, "match B")],
                embedMs: 8,
                searchMs: 4,
                totalIndexed: 200));

        mockMongoService.Setup(m => m.GetAsync("file-a")).ReturnsAsync(doc1);
        mockMongoService.Setup(m => m.GetAsync("file-b")).ReturnsAsync(doc2);

        // Act
        var result = await sut.SearchAsync("binary star", 10, 0.5, userId: null, isAdmin: false);

        // Assert
        result.Results.Should().HaveCount(2);
        result.ResultCount.Should().Be(2);
        result.Results[0].Score.Should().Be(0.95);
        result.Results[0].MatchedText.Should().Be("match A");
        result.Results[1].Score.Should().Be(0.80);
        result.Results[1].MatchedText.Should().Be("match B");
    }

    // ===== Helpers =====

    private static JwstDataModel BuildDoc(
        string id,
        bool isPublic,
        string userId = "owner-user")
    {
        var sample = TestDataFixtures.CreateSampleData(id: id);
        sample.IsPublic = isPublic;
        sample.UserId = userId;
        sample.SharedWith = [];
        return sample;
    }

    /// <summary>
    /// Serialises a PythonSearchResponse payload using snake_case naming to match what the
    /// real Python engine sends over the wire.
    /// </summary>
    private static string BuildPythonSearchJson(
        string query,
        IEnumerable<(string FileId, double Score, string MatchedText)> results,
        double embedMs,
        double searchMs,
        int totalIndexed)
    {
        var payload = new
        {
            results = results.Select(r => new
            {
                file_id = r.FileId,
                score = r.Score,
                matched_text = r.MatchedText,
            }).ToArray(),
            query,
            embed_time_ms = embedMs,
            search_time_ms = searchMs,
            total_indexed = totalIndexed,
        };
        return JsonSerializer.Serialize(payload);
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
