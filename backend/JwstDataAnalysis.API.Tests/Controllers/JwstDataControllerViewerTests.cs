// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using FluentAssertions;
using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Services.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;

namespace JwstDataAnalysis.API.Tests.Controllers;

/// <summary>
/// Unit tests for JwstDataController viewer endpoints (preview, histogram, pixeldata).
/// Validates input parameter range/allowlist checks return 400 BadRequest.
/// </summary>
public class JwstDataControllerViewerTests
{
    private const string TestUserId = "test-user-123";
    private const string ValidId = "507f1f77bcf86cd799439011";
    private readonly Mock<IMongoDBService> mockMongoService;
    private readonly Mock<IHttpClientFactory> mockHttpClientFactory;
    private readonly JwstDataController sut;

    /// <summary>
    /// Initializes a new instance of the <see cref="JwstDataControllerViewerTests"/> class.
    /// </summary>
    public JwstDataControllerViewerTests()
    {
        mockMongoService = new Mock<IMongoDBService>();
        var mockLogger = new Mock<ILogger<JwstDataController>>();
        mockHttpClientFactory = new Mock<IHttpClientFactory>();

        var configValues = new Dictionary<string, string?>
        {
            { "FileStorage:AllowedExtensions:0", ".fits" },
        };

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(configValues)
            .Build();

        var mockThumbnailQueue = new Mock<IThumbnailQueue>();
        var mockStorageProvider = new Mock<IStorageProvider>();

        sut = new JwstDataController(
            mockMongoService.Object,
            mockLogger.Object,
            mockHttpClientFactory.Object,
            configuration,
            mockThumbnailQueue.Object,
            mockStorageProvider.Object);

        SetupAuthenticatedUser(TestUserId);
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(1.1)]
    public async Task GetPreview_ReturnsBadRequest_WhenBlackPointOutOfRange(double blackPoint)
    {
        var result = await sut.GetPreview(ValidId, blackPoint: blackPoint);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(1.1)]
    public async Task GetPreview_ReturnsBadRequest_WhenWhitePointOutOfRange(double whitePoint)
    {
        var result = await sut.GetPreview(ValidId, whitePoint: whitePoint);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetPreview_ReturnsBadRequest_WhenBlackPointEqualsWhitePoint()
    {
        var result = await sut.GetPreview(ValidId, blackPoint: 0.5, whitePoint: 0.5);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetPreview_ReturnsBadRequest_WhenBlackPointGreaterThanWhitePoint()
    {
        var result = await sut.GetPreview(ValidId, blackPoint: 0.8, whitePoint: 0.2);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(0.0001)]
    [InlineData(1.1)]
    public async Task GetPreview_ReturnsBadRequest_WhenAsinhAOutOfRange(double asinhA)
    {
        var result = await sut.GetPreview(ValidId, asinhA: asinhA);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetPreview_ReturnsBadRequest_WhenSliceIndexBelowMinusOne()
    {
        var result = await sut.GetPreview(ValidId, sliceIndex: -2);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData("invalid")]
    [InlineData("turbo")]
    [InlineData("")]
    public async Task GetPreview_ReturnsBadRequest_WhenCmapInvalid(string cmap)
    {
        var result = await sut.GetPreview(ValidId, cmap: cmap);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData("invalid")]
    [InlineData("nearest")]
    [InlineData("")]
    public async Task GetPreview_ReturnsBadRequest_WhenStretchInvalid(string stretch)
    {
        var result = await sut.GetPreview(ValidId, stretch: stretch);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData("inferno")]
    [InlineData("grayscale")]
    [InlineData("viridis")]
    [InlineData("jet")]
    public async Task GetPreview_PassesValidation_WithValidCmap(string cmap)
    {
        // Arrange: DB returns null so we get NotFound (past validation)
        mockMongoService.Setup(s => s.GetAsync(ValidId))
            .ReturnsAsync((JwstDataModel?)null);

        var result = await sut.GetPreview(ValidId, cmap: cmap);
        result.Should().BeOfType<NotFoundResult>();
    }

    [Theory]
    [InlineData("zscale")]
    [InlineData("asinh")]
    [InlineData("linear")]
    [InlineData("histeq")]
    public async Task GetPreview_PassesValidation_WithValidStretch(string stretch)
    {
        mockMongoService.Setup(s => s.GetAsync(ValidId))
            .ReturnsAsync((JwstDataModel?)null);

        var result = await sut.GetPreview(ValidId, stretch: stretch);
        result.Should().BeOfType<NotFoundResult>();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(9)]
    [InlineData(10001)]
    [InlineData(-1)]
    public async Task GetHistogram_ReturnsBadRequest_WhenBinsOutOfRange(int bins)
    {
        var result = await sut.GetHistogram(ValidId, bins: bins);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(0.0f)]
    [InlineData(0.09f)]
    [InlineData(5.1f)]
    public async Task GetHistogram_ReturnsBadRequest_WhenGammaOutOfRange(float gamma)
    {
        var result = await sut.GetHistogram(ValidId, gamma: gamma);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetHistogram_ReturnsBadRequest_WhenBlackPointGreaterOrEqualWhitePoint()
    {
        var result = await sut.GetHistogram(ValidId, blackPoint: 0.5f, whitePoint: 0.5f);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData("invalid")]
    [InlineData("")]
    public async Task GetHistogram_ReturnsBadRequest_WhenStretchInvalid(string stretch)
    {
        var result = await sut.GetHistogram(ValidId, stretch: stretch);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(-0.1f)]
    [InlineData(1.1f)]
    public async Task GetHistogram_ReturnsBadRequest_WhenBlackPointOutOfRange(float blackPoint)
    {
        var result = await sut.GetHistogram(ValidId, blackPoint: blackPoint);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(0.0001f)]
    [InlineData(1.1f)]
    public async Task GetHistogram_ReturnsBadRequest_WhenAsinhAOutOfRange(float asinhA)
    {
        var result = await sut.GetHistogram(ValidId, asinhA: asinhA);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetHistogram_ReturnsBadRequest_WhenSliceIndexBelowMinusOne()
    {
        var result = await sut.GetHistogram(ValidId, sliceIndex: -2);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetHistogram_PassesValidation_WithValidParams()
    {
        mockMongoService.Setup(s => s.GetAsync(ValidId))
            .ReturnsAsync((JwstDataModel?)null);

        var result = await sut.GetHistogram(ValidId, bins: 256, gamma: 1.0f, stretch: "zscale");
        result.Should().BeOfType<NotFoundResult>();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(99)]
    [InlineData(8001)]
    [InlineData(-1)]
    public async Task GetPixelData_ReturnsBadRequest_WhenMaxSizeOutOfRange(int maxSize)
    {
        var result = await sut.GetPixelData(ValidId, maxSize: maxSize);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetPixelData_ReturnsBadRequest_WhenSliceIndexBelowMinusOne()
    {
        var result = await sut.GetPixelData(ValidId, sliceIndex: -2);
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetPixelData_PassesValidation_WithValidParams()
    {
        mockMongoService.Setup(s => s.GetAsync(ValidId))
            .ReturnsAsync((JwstDataModel?)null);

        var result = await sut.GetPixelData(ValidId, maxSize: 1200, sliceIndex: -1);
        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetPixelData_PassesValidation_WithBoundaryMaxSize()
    {
        mockMongoService.Setup(s => s.GetAsync(ValidId))
            .ReturnsAsync((JwstDataModel?)null);

        var result = await sut.GetPixelData(ValidId, maxSize: 100);
        result.Should().BeOfType<NotFoundResult>();
    }

    /// <summary>
    /// Sets up a mock HttpContext with the specified user claims.
    /// </summary>
    private void SetupAuthenticatedUser(string userId, bool isAdmin = false)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId),
            new("sub", userId),
        };

        if (isAdmin)
        {
            claims.Add(new Claim(ClaimTypes.Role, "Admin"));
        }

        var identity = new ClaimsIdentity(claims, "TestAuth");
        var principal = new ClaimsPrincipal(identity);

        var httpContext = new DefaultHttpContext
        {
            User = principal,
        };

        sut.ControllerContext = new ControllerContext
        {
            HttpContext = httpContext,
        };
    }
}
