// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using FluentAssertions;

using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Controllers;

/// <summary>
/// Unit tests for CompositeController.
/// </summary>
public class CompositeControllerTests
{
    private const string TestUserId = "test-user-123";
    private readonly Mock<ICompositeService> mockCompositeService = new();
    private readonly Mock<IJobTracker> mockJobTracker = new();
    private readonly CompositeQueue compositeQueue = new();
    private readonly Mock<ILogger<CompositeController>> mockLogger = new();
    private readonly CompositeController sut;

    /// <summary>
    /// Initializes a new instance of the <see cref="CompositeControllerTests"/> class.
    /// </summary>
    public CompositeControllerTests()
    {
        sut = new CompositeController(
            mockCompositeService.Object,
            mockJobTracker.Object,
            compositeQueue,
            mockLogger.Object);
        SetupAuthenticatedUser(TestUserId);
    }

    // ===== GenerateNChannelComposite Tests =====

    /// <summary>
    /// Tests that GenerateNChannelComposite returns BadRequest when Channels is null.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsBadRequest_WhenChannelsNull()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto { Channels = null! };

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns BadRequest when Channels is empty.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsBadRequest_WhenChannelsEmpty()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto { Channels = [] };

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns BadRequest when a channel has no DataIds.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsBadRequest_WhenChannelHasNoDataIds()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = [],
                    Color = new ChannelColorDto { Hue = 0 },
                },
            ],
        };

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns BadRequest when channel Color is null.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsBadRequest_WhenChannelColorNull()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = ["id1"],
                    Color = null!,
                },
            ],
        };

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns BadRequest when no color is specified.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsBadRequest_WhenNoColorSpecified()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = ["id1"],
                    Color = new ChannelColorDto { Hue = null, Rgb = null, Luminance = false },
                },
            ],
        };

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns BadRequest when both Hue and Rgb are specified.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsBadRequest_WhenBothHueAndRgb()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = ["id1"],
                    Color = new ChannelColorDto { Hue = 180, Rgb = [1.0, 0.0, 0.0] },
                },
            ],
        };

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns BadRequest when Luminance is true with Hue.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsBadRequest_WhenLuminanceWithHue()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = ["id1"],
                    Color = new ChannelColorDto { Luminance = true, Hue = 180 },
                },
            ],
        };

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns BadRequest when Rgb has wrong length.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsBadRequest_WhenRgbWrongLength()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = ["id1"],
                    Color = new ChannelColorDto { Rgb = [1.0, 0.0] },
                },
            ],
        };

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns BadRequest when Rgb values are out of range.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsBadRequest_WhenRgbOutOfRange()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = ["id1"],
                    Color = new ChannelColorDto { Rgb = [1.5, 0.0, 0.0] },
                },
            ],
        };

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns PNG file on success with default format.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsFile_OnSuccess_Png()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        var imageBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 };
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, TestUserId, true, false, false, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CompositeResult(imageBytes, new Dictionary<string, string>()));

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        var fileResult = Assert.IsType<FileContentResult>(result);
        fileResult.ContentType.Should().Be("image/png");
        fileResult.FileDownloadName.Should().Be("composite-nchannel.png");
        fileResult.FileContents.Should().BeEquivalentTo(imageBytes);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns JPEG file when OutputFormat is jpeg.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsFile_OnSuccess_Jpeg()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        request.OutputFormat = "jpeg";
        var imageBytes = new byte[] { 0xFF, 0xD8, 0xFF };
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, TestUserId, true, false, false, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CompositeResult(imageBytes, new Dictionary<string, string>()));

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        var fileResult = Assert.IsType<FileContentResult>(result);
        fileResult.ContentType.Should().Be("image/jpeg");
        fileResult.FileDownloadName.Should().Be("composite-nchannel.jpeg");
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns NotFound on KeyNotFoundException.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsNotFound_OnKeyNotFoundException()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, TestUserId, true, false))
            .ThrowsAsync(new KeyNotFoundException("Data not found"));

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns BadRequest on InvalidOperationException.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsBadRequest_OnInvalidOperationException()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, TestUserId, true, false))
            .ThrowsAsync(new InvalidOperationException("Invalid files"));

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns Forbid on UnauthorizedAccessException when authenticated.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsForbid_OnUnauthorizedAccessException_WhenAuthenticated()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, TestUserId, true, false))
            .ThrowsAsync(new UnauthorizedAccessException("Access denied"));

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<ForbidResult>(result);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns NotFound on UnauthorizedAccessException when unauthenticated.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_ReturnsNotFound_OnUnauthorizedAccessException_WhenUnauthenticated()
    {
        // Arrange
        SetupUnauthenticatedUser();
        var request = CreateValidNChannelRequest();
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, It.IsAny<string?>(), false, false))
            .ThrowsAsync(new UnauthorizedAccessException("Access denied"));

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    /// <summary>
    /// Tests that NotFound messages are indistinguishable for anonymous users
    /// to prevent data enumeration via error message inspection.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_NotFoundMessages_AreIndistinguishable_ForAnonymous()
    {
        // Arrange
        SetupUnauthenticatedUser();
        var request = CreateValidNChannelRequest();

        // Path 1: data doesn't exist (KeyNotFoundException)
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, It.IsAny<string?>(), false, false))
            .ThrowsAsync(new KeyNotFoundException("Data not found"));
        var result1 = await sut.GenerateNChannelComposite(request);
        var body1 = ((NotFoundObjectResult)result1).Value;

        // Path 2: data exists but is private (UnauthorizedAccessException)
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, It.IsAny<string?>(), false, false))
            .ThrowsAsync(new UnauthorizedAccessException("Access denied"));
        var result2 = await sut.GenerateNChannelComposite(request);
        var body2 = ((NotFoundObjectResult)result2).Value;

        // Bodies must be indistinguishable to prevent enumeration
        body1.Should().BeEquivalentTo(body2);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns 503 on HttpRequestException.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_Returns503_OnHttpRequestException()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, TestUserId, true, false))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that GenerateNChannelComposite returns 500 on unexpected exception.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_Returns500_OnUnexpectedException()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, TestUserId, true, false))
#pragma warning disable CA2201
            .ThrowsAsync(new Exception("Something broke"));
#pragma warning restore CA2201

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ===== ExportNChannelComposite Tests =====

    /// <summary>
    /// Tests that ExportNChannelComposite returns 202 Accepted with a job ID.
    /// </summary>
    [Fact]
    public async Task ExportNChannelComposite_Returns202_WithJobId()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        var jobStatus = new JobStatus { JobId = "job-123", State = JobStates.Queued };
        mockJobTracker.Setup(j => j.CreateJobAsync(
                JobTypes.Composite, It.IsAny<string>(), TestUserId, null))
            .ReturnsAsync(jobStatus);

        // Act
        var result = await sut.ExportNChannelComposite(request);

        // Assert
        var acceptedResult = Assert.IsType<AcceptedResult>(result);
        acceptedResult.StatusCode.Should().Be(202);
    }

    /// <summary>
    /// Tests that ExportNChannelComposite returns 401 when user is not authenticated.
    /// </summary>
    [Fact]
    public async Task ExportNChannelComposite_Returns401_WhenNotAuthenticated()
    {
        // Arrange
        SetupUnauthenticatedUser();
        var request = CreateValidNChannelRequest();

        // Act
        var result = await sut.ExportNChannelComposite(request);

        // Assert
        Assert.IsType<UnauthorizedResult>(result);
    }

    /// <summary>
    /// Tests that ExportNChannelComposite returns BadRequest for invalid request.
    /// </summary>
    [Fact]
    public async Task ExportNChannelComposite_ReturnsBadRequest_WhenInvalid()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto { Channels = [] };

        // Act
        var result = await sut.ExportNChannelComposite(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that ExportNChannelComposite returns 429 when queue is full.
    /// </summary>
    [Fact]
    public async Task ExportNChannelComposite_Returns429_WhenQueueFull()
    {
        // Arrange — fill the queue to capacity (10)
        var jobStatus = new JobStatus { JobId = "job-overflow", State = JobStates.Queued };
        mockJobTracker.Setup(j => j.CreateJobAsync(
                JobTypes.Composite, It.IsAny<string>(), TestUserId, null))
            .ReturnsAsync(jobStatus);

        for (int i = 0; i < 10; i++)
        {
            compositeQueue.TryEnqueue(new CompositeJobItem
            {
                JobId = $"fill-{i}",
                Request = CreateValidNChannelRequest(),
            });
        }

        var request = CreateValidNChannelRequest();

        // Act
        var result = await sut.ExportNChannelComposite(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(429);
        sut.ControllerContext.HttpContext.Response.Headers["Retry-After"].ToString().Should().Be("5");
    }

    // ===== GenerateNChannelCompositeAsync Tests (#1470 — async preview path) =====

    /// <summary>
    /// Tests that the async preview endpoint returns 202 Accepted with a job ID.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelCompositeAsync_Returns202_WithJobId()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        var jobStatus = new JobStatus { JobId = "preview-job-123", State = JobStates.Queued };
        mockJobTracker.Setup(j => j.CreateJobAsync(
                JobTypes.CompositePreview, It.IsAny<string>(), TestUserId, null))
            .ReturnsAsync(jobStatus);

        // Act
        var result = await sut.GenerateNChannelCompositeAsync(request);

        // Assert
        var acceptedResult = Assert.IsType<AcceptedResult>(result);
        acceptedResult.StatusCode.Should().Be(202);
    }

    /// <summary>
    /// Tests that preview jobs are created with the CompositePreview type so they
    /// can be filtered out of any future "my jobs" listing.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelCompositeAsync_CreatesJobWithCompositePreviewType()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        var jobStatus = new JobStatus { JobId = "preview-job-typed", State = JobStates.Queued };
        mockJobTracker.Setup(j => j.CreateJobAsync(
                JobTypes.CompositePreview, It.IsAny<string>(), TestUserId, null))
            .ReturnsAsync(jobStatus);

        // Act
        await sut.GenerateNChannelCompositeAsync(request);

        // Assert — verify the type passed to CreateJobAsync is CompositePreview, not Composite,
        // AND the description carries "preview" so a future "my jobs" UI can label it correctly.
        mockJobTracker.Verify(
            j => j.CreateJobAsync(
                JobTypes.CompositePreview,
                It.Is<string>(d => d.Contains("preview", StringComparison.OrdinalIgnoreCase)),
                TestUserId,
                null),
            Times.Once);
        mockJobTracker.Verify(
            j => j.CreateJobAsync(JobTypes.Composite, It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>()),
            Times.Never);
    }

    /// <summary>
    /// Tests that the async preview endpoint returns 401 when user is not authenticated.
    /// (SignalR JobProgressHub requires auth, so anonymous wizard preview stays on the sync path.)
    /// </summary>
    [Fact]
    public async Task GenerateNChannelCompositeAsync_Returns401_WhenNotAuthenticated()
    {
        // Arrange
        SetupUnauthenticatedUser();
        var request = CreateValidNChannelRequest();

        // Act
        var result = await sut.GenerateNChannelCompositeAsync(request);

        // Assert
        Assert.IsType<UnauthorizedResult>(result);
    }

    /// <summary>
    /// Tests that the async preview endpoint returns BadRequest for invalid request.
    /// </summary>
    [Fact]
    public async Task GenerateNChannelCompositeAsync_ReturnsBadRequest_WhenInvalid()
    {
        // Arrange
        var request = new NChannelCompositeRequestDto { Channels = [] };

        // Act
        var result = await sut.GenerateNChannelCompositeAsync(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that the async preview endpoint returns 429 with Retry-After when the queue is full,
    /// and that the rejected job is failed exactly once (not double-failed).
    /// </summary>
    [Fact]
    public async Task GenerateNChannelCompositeAsync_Returns429_WhenQueueFull()
    {
        // Arrange — fill the queue to capacity (10)
        var jobStatus = new JobStatus { JobId = "preview-overflow", State = JobStates.Queued };
        mockJobTracker.Setup(j => j.CreateJobAsync(
                JobTypes.CompositePreview, It.IsAny<string>(), TestUserId, null))
            .ReturnsAsync(jobStatus);

        for (int i = 0; i < 10; i++)
        {
            compositeQueue.TryEnqueue(new CompositeJobItem
            {
                JobId = $"fill-{i}",
                Request = CreateValidNChannelRequest(),
            });
        }

        var request = CreateValidNChannelRequest();

        // Act
        var result = await sut.GenerateNChannelCompositeAsync(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(429);
        sut.ControllerContext.HttpContext.Response.Headers["Retry-After"].ToString().Should().Be("5");
        mockJobTracker.Verify(
            j => j.FailJobAsync(jobStatus.JobId, "Queue full"),
            Times.Once);
    }

    /// <summary>
    /// Tests that the sync generate-nchannel endpoint still returns a file (unchanged).
    /// </summary>
    [Fact]
    public async Task GenerateNChannelComposite_StillReturnsSyncFile()
    {
        // Arrange
        var request = CreateValidNChannelRequest();
        var imageBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 };
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                request, TestUserId, true, false, false, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CompositeResult(imageBytes, new Dictionary<string, string>()));

        // Act
        var result = await sut.GenerateNChannelComposite(request);

        // Assert — sync endpoint still returns file directly
        var fileResult = Assert.IsType<FileContentResult>(result);
        fileResult.ContentType.Should().Be("image/png");
    }

    // PR-2 of #882 train — 413 propagation, header forwarding, /api/composite/estimate
    [Fact]
    public async Task GenerateNChannelComposite_BudgetExceeded_Returns413WithDetail()
    {
        var request = CreateValidNChannelRequest();
        const string detail = "Composite output would shrink to 65%. Lower COMPOSITE_DOWNSCALE_FAIL_THRESHOLD or raise MAX_COMPOSITE_MEMORY_BYTES.";
        mockCompositeService
            .Setup(s => s.GenerateNChannelCompositeAsync(request, TestUserId, true, false, false, null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new CompositeBudgetExceededException(detail));

        var result = await sut.GenerateNChannelComposite(request);

        var status = Assert.IsType<ObjectResult>(result);
        status.StatusCode.Should().Be(StatusCodes.Status413PayloadTooLarge);

        // Detail must reach the caller — it names the actionable env vars.
        status.Value!.ToString().Should().Contain("MAX_COMPOSITE_MEMORY_BYTES");
    }

    [Fact]
    public async Task GenerateNChannelComposite_Success_CopiesCompositeHeadersToResponse()
    {
        var request = CreateValidNChannelRequest();
        var bytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 };
        var headers = new Dictionary<string, string>
        {
            ["X-Composite-Budget-Status"] = "warn",
            ["X-Composite-Was-Downscaled"] = "true",
            ["X-Composite-Original-Shape"] = "5750,5750",
            ["X-Composite-Output-Shape"] = "5462,5462",
            ["X-Composite-Side-Factor"] = "0.950",
            ["X-Quality-Score"] = "0.87",
        };
        mockCompositeService
            .Setup(s => s.GenerateNChannelCompositeAsync(request, TestUserId, true, false, false, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CompositeResult(bytes, headers));

        var result = await sut.GenerateNChannelComposite(request);

        Assert.IsType<FileContentResult>(result);
        sut.Response.Headers.Should().ContainKey("X-Composite-Budget-Status");
        sut.Response.Headers["X-Composite-Budget-Status"].ToString().Should().Be("warn");
        sut.Response.Headers["X-Composite-Was-Downscaled"].ToString().Should().Be("true");
        sut.Response.Headers["X-Composite-Original-Shape"].ToString().Should().Be("5750,5750");
        sut.Response.Headers["X-Composite-Side-Factor"].ToString().Should().Be("0.950");
    }

    [Fact]
    public async Task Estimate_Success_Returns200WithVerdict()
    {
        var request = CreateValidNChannelRequest();
        var verdict = new CompositeEstimateResponseDto
        {
            Status = "warn",
            OriginalShape = [4150, 4150],
            OutputShape = [3947, 3947],
            SideFactor = 0.951,
            Detail = "...",
            MemoryLimitMb = 3000,
            FailThreshold = 0.85,
        };
        mockCompositeService
            .Setup(s => s.EstimateCompositeAsync(request, TestUserId, true, false, It.IsAny<CancellationToken>()))
            .ReturnsAsync(verdict);

        var result = await sut.Estimate(request);

        var ok = Assert.IsType<OkObjectResult>(result);
        ok.Value.Should().BeSameAs(verdict);
    }

    [Fact]
    public async Task Estimate_ReturnsBadRequest_WhenChannelsEmpty()
    {
        var request = new NChannelCompositeRequestDto { Channels = [] };

        var result = await sut.Estimate(request);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Estimate_HttpRequestException_Returns503()
    {
        var request = CreateValidNChannelRequest();
        mockCompositeService
            .Setup(s => s.EstimateCompositeAsync(request, TestUserId, true, false, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new HttpRequestException("engine down"));

        var result = await sut.Estimate(request);

        var status = Assert.IsType<ObjectResult>(result);
        status.StatusCode.Should().Be(StatusCodes.Status503ServiceUnavailable);
    }

    [Fact]
    public async Task GenerateNChannelComposite_BudgetExceededDetail_DoesNotLeakInternalPaths()
    {
        // Regression guard: the engine's 413 detail names env vars by design,
        // but must never include /app/, /data/, FITS file paths, or other
        // internal location strings the operator might want kept private.
        var request = CreateValidNChannelRequest();
        const string detail = "Composite output would shrink to 65% of requested side length. Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB; COMPOSITE_DOWNSCALE_FAIL_THRESHOLD = 0.85.";
        mockCompositeService
            .Setup(s => s.GenerateNChannelCompositeAsync(request, TestUserId, true, false, false, null, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new CompositeBudgetExceededException(detail));

        var result = await sut.GenerateNChannelComposite(request);

        var status = Assert.IsType<ObjectResult>(result);
        var body = status.Value!.ToString()!;
        body.Should().NotContain("/app/");
        body.Should().NotContain("/data/");
        body.Should().NotContain(".fits");
        body.Should().NotContain("http://");
        body.Should().Contain("MAX_COMPOSITE_MEMORY_BYTES");
    }

    [Fact]
    public async Task Estimate_DataNotFound_Returns404()
    {
        var request = CreateValidNChannelRequest();
        mockCompositeService
            .Setup(s => s.EstimateCompositeAsync(request, TestUserId, true, false, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new KeyNotFoundException("data missing"));

        var result = await sut.Estimate(request);

        Assert.IsType<NotFoundObjectResult>(result);
    }

    // ===== Helpers =====
    private static NChannelCompositeRequestDto CreateValidNChannelRequest()
    {
        return new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = ["id1"],
                    Color = new ChannelColorDto { Hue = 0 },
                },
                new NChannelConfigDto
                {
                    DataIds = ["id2"],
                    Color = new ChannelColorDto { Hue = 120 },
                },
            ],
            OutputFormat = "png",
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

    /// <summary>
    /// Sets up a mock HttpContext with an unauthenticated user.
    /// </summary>
    private void SetupUnauthenticatedUser()
    {
        var identity = new ClaimsIdentity(); // No auth type = unauthenticated
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
