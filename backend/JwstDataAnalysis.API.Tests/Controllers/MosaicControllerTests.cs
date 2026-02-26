// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;
using System.Security.Claims;

using FluentAssertions;

using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Controllers;

/// <summary>
/// Unit tests for MosaicController.
/// </summary>
public class MosaicControllerTests
{
    private const string TestUserId = "test-user-123";
    private readonly Mock<IMosaicService> mockMosaicService = new();
    private readonly Mock<IJobTracker> mockJobTracker = new();
    private readonly MosaicQueue mosaicQueue = new();
    private readonly Mock<ILogger<MosaicController>> mockLogger = new();
    private readonly IConfiguration configuration;
    private readonly MosaicController sut;

    /// <summary>
    /// Initializes a new instance of the <see cref="MosaicControllerTests"/> class.
    /// </summary>
    public MosaicControllerTests()
    {
        configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "Mosaic:MaxFileSizeMB", "2048" },
                { "Composite:MaxFileSizeMB", "4096" },
            })
            .Build();
        sut = new MosaicController(
            mockMosaicService.Object,
            mockJobTracker.Object,
            mosaicQueue,
            mockLogger.Object,
            configuration);
        SetupAuthenticatedUser(TestUserId);
    }

    // ===== GenerateMosaic Tests =====

    /// <summary>
    /// Tests that GenerateMosaic returns BadRequest when Files is null.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_ReturnsBadRequest_WhenFilesNull()
    {
        // Arrange
        var request = new MosaicRequestDto { Files = null! };

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        badRequest.Value.Should().NotBeNull();
    }

    /// <summary>
    /// Tests that GenerateMosaic returns BadRequest when fewer than 2 files are provided.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_ReturnsBadRequest_WhenFewerThan2Files()
    {
        // Arrange
        var request = new MosaicRequestDto
        {
            Files = [new MosaicFileConfigDto { DataId = "id1" }],
        };

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        badRequest.Value.Should().NotBeNull();
    }

    /// <summary>
    /// Tests that GenerateMosaic returns BadRequest when a file has an empty DataId.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_ReturnsBadRequest_WhenDataIdEmpty()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        request.Files[0].DataId = string.Empty;

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        badRequest.Value.Should().NotBeNull();
    }

    /// <summary>
    /// Tests that GenerateMosaic returns a PNG file on success with default output format.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_ReturnsFile_OnSuccess()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        var imageBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 };
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(request))
            .ReturnsAsync(imageBytes);

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        var fileResult = Assert.IsType<FileContentResult>(result);
        fileResult.ContentType.Should().Be("image/png");
        fileResult.FileDownloadName.Should().Be("mosaic.png");
        fileResult.FileContents.Should().BeEquivalentTo(imageBytes);
    }

    /// <summary>
    /// Tests that GenerateMosaic returns JPEG content type when OutputFormat is jpeg.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_ReturnsJpeg_WhenOutputFormatJpeg()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        request.OutputFormat = "jpeg";
        var imageBytes = new byte[] { 0xFF, 0xD8, 0xFF };
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(request))
            .ReturnsAsync(imageBytes);

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        var fileResult = Assert.IsType<FileContentResult>(result);
        fileResult.ContentType.Should().Be("image/jpeg");
        fileResult.FileDownloadName.Should().Be("mosaic.jpeg");
    }

    /// <summary>
    /// Tests that GenerateMosaic returns FITS content type when OutputFormat is fits.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_ReturnsFits_WhenOutputFormatFits()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        request.OutputFormat = "fits";
        var imageBytes = new byte[] { 0x53, 0x49, 0x4D, 0x50 };
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(request))
            .ReturnsAsync(imageBytes);

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        var fileResult = Assert.IsType<FileContentResult>(result);
        fileResult.ContentType.Should().Be("application/fits");
        fileResult.FileDownloadName.Should().Be("mosaic.fits");
    }

    /// <summary>
    /// Tests that GenerateMosaic returns NotFound on KeyNotFoundException.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_ReturnsNotFound_OnKeyNotFoundException()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(request))
            .ThrowsAsync(new KeyNotFoundException("Data not found"));

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateMosaic returns BadRequest on InvalidOperationException.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_ReturnsBadRequest_OnInvalidOperationException()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(request))
            .ThrowsAsync(new InvalidOperationException("Incompatible files"));

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateMosaic returns 413 on HttpRequestException with RequestEntityTooLarge.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_Returns413_OnPayloadTooLarge()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(request))
            .ThrowsAsync(new HttpRequestException("Too large", null, HttpStatusCode.RequestEntityTooLarge));

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(413);
    }

    /// <summary>
    /// Tests that GenerateMosaic returns 503 on generic HttpRequestException.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_Returns503_OnHttpRequestException()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(request))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that GenerateMosaic returns 500 on unexpected exception.
    /// </summary>
    [Fact]
    public async Task GenerateMosaic_Returns500_OnUnexpectedException()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(request))
#pragma warning disable CA2201
            .ThrowsAsync(new Exception("Something broke"));
#pragma warning restore CA2201

        // Act
        var result = await sut.GenerateMosaic(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ===== GenerateAndSaveMosaic Tests =====

    /// <summary>
    /// Tests that GenerateAndSaveMosaic returns BadRequest when Files is null.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaic_ReturnsBadRequest_WhenFilesNull()
    {
        // Arrange
        var request = new MosaicRequestDto { Files = null! };

        // Act
        var result = await sut.GenerateAndSaveMosaic(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateAndSaveMosaic returns BadRequest when fewer than 2 files are provided.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaic_ReturnsBadRequest_WhenFewerThan2Files()
    {
        // Arrange
        var request = new MosaicRequestDto
        {
            Files = [new MosaicFileConfigDto { DataId = "id1" }],
        };

        // Act
        var result = await sut.GenerateAndSaveMosaic(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateAndSaveMosaic returns 201 on success.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaic_Returns201_OnSuccess()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        var savedResponse = new SavedMosaicResponseDto
        {
            DataId = "new-data-id",
            FileName = "mosaic.fits",
            FileSize = 1024,
            FileFormat = "fits",
        };
        mockMosaicService.Setup(s => s.GenerateAndSaveMosaicAsync(
                request, TestUserId, true, false))
            .ReturnsAsync(savedResponse);

        // Act
        var result = await sut.GenerateAndSaveMosaic(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(201);
        statusResult.Value.Should().Be(savedResponse);
    }

    /// <summary>
    /// Tests that GenerateAndSaveMosaic returns NotFound on KeyNotFoundException.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaic_ReturnsNotFound_OnKeyNotFoundException()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        mockMosaicService.Setup(s => s.GenerateAndSaveMosaicAsync(
                request, TestUserId, true, false))
            .ThrowsAsync(new KeyNotFoundException("Data not found"));

        // Act
        var result = await sut.GenerateAndSaveMosaic(request);

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateAndSaveMosaic returns Forbid on UnauthorizedAccessException.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaic_ReturnsForbid_OnUnauthorizedAccessException()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        mockMosaicService.Setup(s => s.GenerateAndSaveMosaicAsync(
                request, TestUserId, true, false))
            .ThrowsAsync(new UnauthorizedAccessException("Access denied"));

        // Act
        var result = await sut.GenerateAndSaveMosaic(request);

        // Assert
        Assert.IsType<ForbidResult>(result);
    }

    /// <summary>
    /// Tests that GenerateAndSaveMosaic returns 413 on PayloadTooLarge.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaic_Returns413_OnPayloadTooLarge()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        mockMosaicService.Setup(s => s.GenerateAndSaveMosaicAsync(
                request, TestUserId, true, false))
            .ThrowsAsync(new HttpRequestException("Too large", null, HttpStatusCode.RequestEntityTooLarge));

        // Act
        var result = await sut.GenerateAndSaveMosaic(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(413);
    }

    /// <summary>
    /// Tests that GenerateAndSaveMosaic returns 503 on HttpRequestException.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaic_Returns503_OnHttpRequestException()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        mockMosaicService.Setup(s => s.GenerateAndSaveMosaicAsync(
                request, TestUserId, true, false))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.GenerateAndSaveMosaic(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that GenerateAndSaveMosaic returns 500 on unexpected exception.
    /// </summary>
    [Fact]
    public async Task GenerateAndSaveMosaic_Returns500_OnUnexpectedException()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        mockMosaicService.Setup(s => s.GenerateAndSaveMosaicAsync(
                request, TestUserId, true, false))
#pragma warning disable CA2201
            .ThrowsAsync(new Exception("Something broke"));
#pragma warning restore CA2201

        // Act
        var result = await sut.GenerateAndSaveMosaic(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ===== GetFootprint Tests =====

    /// <summary>
    /// Tests that GetFootprint returns BadRequest when DataIds is null.
    /// </summary>
    [Fact]
    public async Task GetFootprint_ReturnsBadRequest_WhenDataIdsNull()
    {
        // Arrange
        var request = new FootprintRequestDto { DataIds = null! };

        // Act
        var result = await sut.GetFootprint(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GetFootprint returns BadRequest when DataIds is empty.
    /// </summary>
    [Fact]
    public async Task GetFootprint_ReturnsBadRequest_WhenDataIdsEmpty()
    {
        // Arrange
        var request = new FootprintRequestDto { DataIds = [] };

        // Act
        var result = await sut.GetFootprint(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GetFootprint returns BadRequest when a DataId is empty string.
    /// </summary>
    [Fact]
    public async Task GetFootprint_ReturnsBadRequest_WhenDataIdEmpty()
    {
        // Arrange
        var request = new FootprintRequestDto { DataIds = ["id1", string.Empty] };

        // Act
        var result = await sut.GetFootprint(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GetFootprint returns Ok on success.
    /// </summary>
    [Fact]
    public async Task GetFootprint_ReturnsOk_OnSuccess()
    {
        // Arrange
        var request = new FootprintRequestDto { DataIds = ["id1", "id2"] };
        var response = new FootprintResponseDto
        {
            NFiles = 2,
            Footprints = [],
            BoundingBox = new Dictionary<string, double>
            {
                { "min_ra", 10.0 },
                { "max_ra", 11.0 },
                { "min_dec", 20.0 },
                { "max_dec", 21.0 },
            },
        };
        mockMosaicService.Setup(s => s.GetFootprintsAsync(request))
            .ReturnsAsync(response);

        // Act
        var result = await sut.GetFootprint(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result);
        okResult.Value.Should().Be(response);
    }

    /// <summary>
    /// Tests that GetFootprint returns NotFound on KeyNotFoundException.
    /// </summary>
    [Fact]
    public async Task GetFootprint_ReturnsNotFound_OnKeyNotFoundException()
    {
        // Arrange
        var request = new FootprintRequestDto { DataIds = ["id1"] };
        mockMosaicService.Setup(s => s.GetFootprintsAsync(request))
            .ThrowsAsync(new KeyNotFoundException("Data not found"));

        // Act
        var result = await sut.GetFootprint(request);

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    /// <summary>
    /// Tests that GetFootprint returns BadRequest on InvalidOperationException.
    /// </summary>
    [Fact]
    public async Task GetFootprint_ReturnsBadRequest_OnInvalidOperationException()
    {
        // Arrange
        var request = new FootprintRequestDto { DataIds = ["id1"] };
        mockMosaicService.Setup(s => s.GetFootprintsAsync(request))
            .ThrowsAsync(new InvalidOperationException("No WCS info"));

        // Act
        var result = await sut.GetFootprint(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GetFootprint returns 503 on HttpRequestException.
    /// </summary>
    [Fact]
    public async Task GetFootprint_Returns503_OnHttpRequestException()
    {
        // Arrange
        var request = new FootprintRequestDto { DataIds = ["id1"] };
        mockMosaicService.Setup(s => s.GetFootprintsAsync(request))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.GetFootprint(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(503);
    }

    // ===== GetLimits Tests =====

    /// <summary>
    /// Tests that GetLimits returns Ok with configured limits.
    /// </summary>
    [Fact]
    public void GetLimits_ReturnsOk_WithConfiguredLimits()
    {
        // Act
        var result = sut.GetLimits();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result);
        okResult.Value.Should().NotBeNull();
        var value = okResult.Value!;
        var mosaicMax = value.GetType().GetProperty("mosaicMaxFileSizeMB")?.GetValue(value);
        var compositeMax = value.GetType().GetProperty("compositeMaxFileSizeMB")?.GetValue(value);
        mosaicMax.Should().Be(2048);
        compositeMax.Should().Be(4096);
    }

    // ===== ExportMosaic Tests =====

    /// <summary>
    /// Tests that ExportMosaic returns 202 Accepted with a jobId on success.
    /// </summary>
    [Fact]
    public async Task ExportMosaic_Returns202_OnSuccess()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        var jobStatus = new JobStatus { JobId = "mosaic-job-1" };
        mockJobTracker.Setup(j => j.CreateJobAsync(JobTypes.Mosaic, It.IsAny<string>(), TestUserId, null))
            .ReturnsAsync(jobStatus);

        // Act
        var result = await sut.ExportMosaic(request);

        // Assert
        Assert.IsType<AcceptedResult>(result);
    }

    /// <summary>
    /// Tests that ExportMosaic returns BadRequest when fewer than 2 files.
    /// </summary>
    [Fact]
    public async Task ExportMosaic_ReturnsBadRequest_WhenFewerThan2Files()
    {
        // Arrange
        var request = new MosaicRequestDto
        {
            Files = [new MosaicFileConfigDto { DataId = "id1" }],
        };

        // Act
        var result = await sut.ExportMosaic(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that ExportMosaic returns 429 when queue is full.
    /// </summary>
    [Fact]
    public async Task ExportMosaic_Returns429_WhenQueueFull()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        var jobStatus = new JobStatus { JobId = "mosaic-job-full" };
        mockJobTracker.Setup(j => j.CreateJobAsync(JobTypes.Mosaic, It.IsAny<string>(), TestUserId, null))
            .ReturnsAsync(jobStatus);

        // Fill the queue (capacity 10)
        for (var i = 0; i < 10; i++)
        {
            mosaicQueue.TryEnqueue(new MosaicJobItem
            {
                JobId = $"fill-{i}",
                Request = new MosaicRequestDto
                {
                    Files = [new MosaicFileConfigDto { DataId = "id1" }, new MosaicFileConfigDto { DataId = "id2" }],
                },
            });
        }

        // Act
        var result = await sut.ExportMosaic(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(429);
    }

    // ===== SaveMosaic Tests =====

    /// <summary>
    /// Tests that SaveMosaic returns 202 Accepted with a jobId on success.
    /// </summary>
    [Fact]
    public async Task SaveMosaic_Returns202_OnSuccess()
    {
        // Arrange
        var request = CreateValidMosaicRequest();
        var jobStatus = new JobStatus { JobId = "mosaic-save-1" };
        mockJobTracker.Setup(j => j.CreateJobAsync(JobTypes.Mosaic, It.IsAny<string>(), TestUserId, null))
            .ReturnsAsync(jobStatus);

        // Act
        var result = await sut.SaveMosaic(request);

        // Assert
        Assert.IsType<AcceptedResult>(result);
    }

    /// <summary>
    /// Tests that SaveMosaic returns BadRequest when fewer than 2 files.
    /// </summary>
    [Fact]
    public async Task SaveMosaic_ReturnsBadRequest_WhenFewerThan2Files()
    {
        // Arrange
        var request = new MosaicRequestDto
        {
            Files = [new MosaicFileConfigDto { DataId = "id1" }],
        };

        // Act
        var result = await sut.SaveMosaic(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ===== Helpers =====
    private static MosaicRequestDto CreateValidMosaicRequest()
    {
        return new MosaicRequestDto
        {
            Files =
            [
                new MosaicFileConfigDto { DataId = "id1" },
                new MosaicFileConfigDto { DataId = "id2" },
            ],
            OutputFormat = "png",
            CombineMethod = "mean",
        };
    }

    /// <summary>
    /// Sets up a mock HttpContext with the specified user claims.
    /// </summary>
    private void SetupAuthenticatedUser(string userId)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId),
            new("sub", userId),
        };

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
