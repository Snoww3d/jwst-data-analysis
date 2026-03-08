// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;
using System.Text.Json;

using FluentAssertions;

using JwstDataAnalysis.API.Configuration;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Services.Storage;
using JwstDataAnalysis.API.Tests.Fixtures;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

public class CompositeServiceTests
{
    private readonly Mock<IMongoDBService> mockMongo;
    private readonly Mock<IStorageProvider> mockStorage;
    private readonly Mock<ILogger<CompositeService>> mockLogger;
    private readonly IConfiguration configuration;

    public CompositeServiceTests()
    {
        mockMongo = new Mock<IMongoDBService>();
        mockStorage = new Mock<IStorageProvider>();
        mockLogger = new Mock<ILogger<CompositeService>>();
        configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ProcessingEngine:BaseUrl"] = "http://test-engine:8000",
            })
            .Build();

        // Default GetManyAsync delegates to individual GetAsync setups
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
    }

    [Fact]
    public async Task GenerateNChannelComposite_Success_ReturnsImageBytes()
    {
        // Arrange
        var data = CreateDataModel();
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        var expectedBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 }; // PNG header
        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(expectedBytes),
        });
        var httpClient = new HttpClient(handler);

        var sut = CreateService(httpClient);
        var request = CreateRequest();

        // Act
        var result = await sut.GenerateNChannelCompositeAsync(
            request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        result.Should().BeEquivalentTo(expectedBytes);
    }

    [Fact]
    public async Task GenerateNChannelComposite_ProcessingEngineError_ThrowsHttpRequestException()
    {
        // Arrange
        var data = CreateDataModel();
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.InternalServerError)
        {
            Content = new StringContent("Internal error"),
        });
        var httpClient = new HttpClient(handler);

        var sut = CreateService(httpClient);
        var request = CreateRequest();

        // Act & Assert
        var act = () => sut.GenerateNChannelCompositeAsync(
            request, "user-1", isAuthenticated: true, isAdmin: false);
        await act.Should().ThrowAsync<HttpRequestException>()
            .WithMessage("*Processing engine error*InternalServerError*");
    }

    [Fact]
    public async Task GenerateNChannelComposite_WithOverallAdjustments_SerializesCorrectly()
    {
        // Arrange
        var data = CreateDataModel();
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        HttpRequestMessage? capturedRequest = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(new byte[] { 1, 2, 3 }),
            },
            req => capturedRequest = req);
        var httpClient = new HttpClient(handler);

        var sut = CreateService(httpClient);
        var request = CreateRequest(overall: new OverallAdjustmentsDto
        {
            Stretch = "asinh",
            BlackPoint = 0.1,
            WhitePoint = 0.9,
            Gamma = 2.0,
            AsinhA = 0.05,
        });

        // Act
        await sut.GenerateNChannelCompositeAsync(
            request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        capturedRequest.Should().NotBeNull();
        var body = await capturedRequest!.Content!.ReadAsStringAsync();
        body.Should().Contain("\"overall\"");
        body.Should().Contain("\"asinh\"");
    }

    [Fact]
    public async Task GenerateNChannelComposite_MultipleChannels_ResolvesAllDataIds()
    {
        // Arrange
        var data1 = CreateDataModel(id: "data-1");
        var data2 = CreateDataModel(id: "data-2");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data1);
        mockMongo.Setup(m => m.GetAsync("data-2")).ReturnsAsync(data2);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(new byte[] { 1 }),
        });
        var httpClient = new HttpClient(handler);
        var sut = CreateService(httpClient);

        var request = new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = ["data-1"],
                    Color = new ChannelColorDto { Hue = 0.0 },
                },
                new NChannelConfigDto
                {
                    DataIds = ["data-2"],
                    Color = new ChannelColorDto { Rgb = [1.0, 0.0, 0.0] },
                },
            ],
        };

        // Act
        await sut.GenerateNChannelCompositeAsync(
            request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert - GetManyAsync is called once per channel (2 channels)
        mockMongo.Verify(m => m.GetManyAsync(It.IsAny<IEnumerable<string>>()), Times.Exactly(2));
    }

    [Fact]
    public async Task GenerateNChannelComposite_DataNotFound_ThrowsKeyNotFoundException()
    {
        // Arrange
        mockMongo.Setup(m => m.GetAsync("missing")).ReturnsAsync((JwstDataModel?)null);

        var sut = CreateService();
        var request = CreateRequest(dataIds: ["missing"]);

        // Act & Assert
        var act = () => sut.GenerateNChannelCompositeAsync(
            request, "user-1", isAuthenticated: true, isAdmin: false);
        await act.Should().ThrowAsync<KeyNotFoundException>()
            .WithMessage("*missing*not found*");
    }

    [Fact]
    public async Task GenerateNChannelComposite_AccessDenied_ThrowsUnauthorizedException()
    {
        // Arrange - private data owned by someone else
        var data = CreateDataModel(isPublic: false, userId: "other-user");
        data.SharedWith = [];
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        var sut = CreateService();
        var request = CreateRequest();

        // Act & Assert
        var act = () => sut.GenerateNChannelCompositeAsync(
            request, "user-1", isAuthenticated: true, isAdmin: false);
        await act.Should().ThrowAsync<UnauthorizedAccessException>()
            .WithMessage("*Access denied*");
    }

    [Fact]
    public async Task GenerateNChannelComposite_NoFilePath_ThrowsInvalidOperationException()
    {
        // Arrange
        var data = CreateDataModel(filePath: string.Empty);
        data.FilePath = string.Empty;
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        var sut = CreateService();
        var request = CreateRequest();

        // Act & Assert
        var act = () => sut.GenerateNChannelCompositeAsync(
            request, "user-1", isAuthenticated: true, isAdmin: false);
        await act.Should().ThrowAsync<InvalidOperationException>()
            .WithMessage("*no file path*");
    }

    [Fact]
    public async Task GenerateNChannelComposite_AdminCanAccessPrivateData()
    {
        // Arrange
        var data = CreateDataModel(isPublic: false, userId: "other-user");
        data.SharedWith = [];
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(new byte[] { 1 }),
        });
        var sut = CreateService(new HttpClient(handler));

        // Act - admin should succeed
        var result = await sut.GenerateNChannelCompositeAsync(
            CreateRequest(), "admin-user", isAuthenticated: true, isAdmin: true);

        // Assert
        result.Should().NotBeEmpty();
    }

    [Fact]
    public async Task GenerateNChannelComposite_OwnerCanAccessOwnPrivateData()
    {
        // Arrange
        var data = CreateDataModel(isPublic: false, userId: "owner-user");
        data.SharedWith = [];
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(new byte[] { 1 }),
        });
        var sut = CreateService(new HttpClient(handler));

        // Act
        var result = await sut.GenerateNChannelCompositeAsync(
            CreateRequest(), "owner-user", isAuthenticated: true, isAdmin: false);

        // Assert
        result.Should().NotBeEmpty();
    }

    [Fact]
    public async Task GenerateNChannelComposite_SharedWithUserCanAccess()
    {
        // Arrange
        var data = CreateDataModel(isPublic: false, userId: "other-user");
        data.SharedWith = ["shared-user"];
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(new byte[] { 1 }),
        });
        var sut = CreateService(new HttpClient(handler));

        // Act
        var result = await sut.GenerateNChannelCompositeAsync(
            CreateRequest(), "shared-user", isAuthenticated: true, isAdmin: false);

        // Assert
        result.Should().NotBeEmpty();
    }

    [Fact]
    public async Task GenerateNChannelComposite_UnauthenticatedCanAccessPublicData()
    {
        // Arrange
        var data = CreateDataModel(isPublic: true);
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        var handler = new FakeHttpMessageHandler(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(new byte[] { 1 }),
        });
        var sut = CreateService(new HttpClient(handler));

        // Act
        var result = await sut.GenerateNChannelCompositeAsync(
            CreateRequest(), null, isAuthenticated: false, isAdmin: false);

        // Assert
        result.Should().NotBeEmpty();
    }

    [Fact]
    public async Task GenerateNChannelComposite_UnauthenticatedCannotAccessPrivateData()
    {
        // Arrange
        var data = CreateDataModel(isPublic: false);
        data.SharedWith = [];
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        var sut = CreateService();

        // Act & Assert
        var act = () => sut.GenerateNChannelCompositeAsync(
            CreateRequest(), null, isAuthenticated: false, isAdmin: false);
        await act.Should().ThrowAsync<UnauthorizedAccessException>();
    }

    [Fact]
    public async Task GenerateNChannelComposite_NullOverall_OmitsFromRequest()
    {
        // Arrange
        var data = CreateDataModel();
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        HttpRequestMessage? capturedRequest = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(new byte[] { 1 }),
            },
            req => capturedRequest = req);
        var httpClient = new HttpClient(handler);

        var sut = CreateService(httpClient);
        var request = CreateRequest(overall: null);

        // Act
        await sut.GenerateNChannelCompositeAsync(
            request, "user-1", isAuthenticated: true, isAdmin: false);

        // Assert
        var body = await capturedRequest!.Content!.ReadAsStringAsync();
        var doc = JsonDocument.Parse(body);
        doc.RootElement.TryGetProperty("overall", out var overallProp).Should().BeTrue();
        overallProp.ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task GenerateNChannelComposite_StripsAbsolutePathPrefix()
    {
        // Arrange - file path starts with /app/data/ prefix
        var data = CreateDataModel(filePath: "/app/data/uploads/test.fits");
        mockMongo.Setup(m => m.GetAsync("data-1")).ReturnsAsync(data);

        HttpRequestMessage? capturedRequest = null;
        var handler = new FakeHttpMessageHandler(
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(new byte[] { 1 }),
            },
            req => capturedRequest = req);
        var httpClient = new HttpClient(handler);

        var sut = CreateService(httpClient);

        // Act
        await sut.GenerateNChannelCompositeAsync(
            CreateRequest(), "user-1", isAuthenticated: true, isAdmin: false);

        // Assert - should have stripped /app/data/ prefix
        var body = await capturedRequest!.Content!.ReadAsStringAsync();
        body.Should().Contain("uploads/test.fits");
        body.Should().NotContain("/app/data/");
    }

    [Fact]
    public void Constructor_UsesDefaultUrl_WhenConfigMissing()
    {
        // Arrange
        var emptyConfig = new ConfigurationBuilder().Build();

        // Act - should not throw, falls back to default
        var sut = new CompositeService(
            new HttpClient(),
            mockMongo.Object,
            mockStorage.Object,
            mockLogger.Object,
            emptyConfig,
            Options.Create(new ObservationMosaicSettings()));

        // Assert - service was created (default URL is http://localhost:8000)
        sut.Should().NotBeNull();
    }

    private static NChannelCompositeRequestDto CreateRequest(
        List<string>? dataIds = null,
        OverallAdjustmentsDto? overall = null)
    {
        return new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = dataIds ?? ["data-1"],
                    Stretch = "zscale",
                    BlackPoint = 0.0,
                    WhitePoint = 1.0,
                    Gamma = 1.0,
                    AsinhA = 0.1,
                    Curve = "linear",
                    Weight = 1.0,
                    Color = new ChannelColorDto { Hue = 0.0 },
                    Label = "F200W",
                    WavelengthUm = 2.0,
                },
            ],
            Overall = overall,
            BackgroundNeutralization = true,
            OutputFormat = "png",
            Quality = 95,
            Width = 1000,
            Height = 1000,
        };
    }

    private static JwstDataModel CreateDataModel(
        string id = "data-1",
        bool isPublic = true,
        string? userId = null,
        string? filePath = "/app/data/test/file.fits")
    {
        var model = TestDataFixtures.CreateSampleData(id: id);
        model.IsPublic = isPublic;
        model.UserId = userId ?? "owner-user";
        model.FilePath = filePath!;
        return model;
    }

    private CompositeService CreateService(HttpClient? httpClient = null)
    {
        return new CompositeService(
            httpClient ?? new HttpClient(),
            mockMongo.Object,
            mockStorage.Object,
            mockLogger.Object,
            configuration,
            Options.Create(new ObservationMosaicSettings()));
    }

    /// <summary>
    /// Fake HttpMessageHandler for testing HTTP calls without real network.
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
