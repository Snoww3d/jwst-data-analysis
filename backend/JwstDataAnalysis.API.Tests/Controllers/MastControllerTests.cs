// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

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
/// Unit tests for MastController.
/// Focuses on security validation and path traversal prevention.
/// </summary>
public class MastControllerTests
{
    private const string TestUserId = "test-user-123";
    private readonly Mock<IMastService> mockMastService;
    private readonly Mock<IMongoDBService> mockMongoService;
    private readonly Mock<IImportJobTracker> mockJobTracker;
    private readonly Mock<ILogger<MastController>> mockLogger;
    private readonly IConfiguration configuration;
    private readonly MastController sut;

    /// <summary>
    /// Initializes a new instance of the <see cref="MastControllerTests"/> class.
    /// </summary>
    public MastControllerTests()
    {
        mockMastService = new Mock<IMastService>();
        mockMongoService = new Mock<IMongoDBService>();
        mockJobTracker = new Mock<IImportJobTracker>();
        mockLogger = new Mock<ILogger<MastController>>();

        // Use in-memory configuration
        var configValues = new Dictionary<string, string?>
        {
            { "Downloads:BasePath", "/app/data/mast" },
            { "Downloads:PollIntervalMs", "500" },
        };

        configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(configValues)
            .Build();

        var mockThumbnailService = new Mock<IThumbnailService>();

        sut = new MastController(
            mockMastService.Object,
            mockMongoService.Object,
            mockJobTracker.Object,
            mockThumbnailService.Object,
            mockLogger.Object,
            configuration);

        // Set up a mock HttpContext with an authenticated user
        SetupAuthenticatedUser(TestUserId);
    }

    /// <summary>
    /// Tests that CheckExistingFiles returns BadRequest for path traversal attempts.
    /// </summary>
    /// <param name="obsId">The malicious observation ID to test.</param>
    [Theory]
    [InlineData("../../../etc/passwd")]
    [InlineData("..\\..\\windows\\system32")]
    [InlineData("jw02733-o001/../../../etc")]
    [InlineData("..%2F..%2Fetc")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("simple-invalid-format")]
    [InlineData("12345")]
    [InlineData("jw-invalid")]
    public void CheckExistingFiles_WithInvalidObsId_ReturnsBadRequest(string obsId)
    {
        // Act
        var result = sut.CheckExistingFiles(obsId);

        // Assert
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        badRequest.Value.Should().NotBeNull();
        badRequest.Value!.ToString().Should().Contain("Invalid");
    }

    /// <summary>
    /// Tests that CheckExistingFiles accepts valid JWST observation IDs.
    /// </summary>
    /// <param name="obsId">The valid observation ID to test.</param>
    [Theory]
    [InlineData("jw02733-o001_t001_nircam")]
    [InlineData("jw12345-o002_t003_miri")]
    [InlineData("jw02733-o001_t001_nircam_clear-f090w")]
    [InlineData("JW02733-O001_T001_NIRCAM")] // Case insensitive
    [InlineData("jw00001-o999_t999_nirspec_g140m-f070lp")]
    public void CheckExistingFiles_WithValidObsId_DoesNotReturnBadRequest(string obsId)
    {
        // Act
        var result = sut.CheckExistingFiles(obsId);

        // Assert - should return Ok (exists: false since dir doesn't exist), NOT BadRequest
        Assert.IsNotType<BadRequestObjectResult>(result);

        // Should be OkObjectResult with exists: false since the directory won't exist in tests
        var okResult = Assert.IsType<OkObjectResult>(result);
        okResult.Value.Should().NotBeNull();
    }

    /// <summary>
    /// Tests that ImportFromExistingFiles returns BadRequest for path traversal attempts.
    /// </summary>
    /// <param name="obsId">The malicious observation ID to test.</param>
    [Theory]
    [InlineData("../../../etc/passwd")]
    [InlineData("..\\..\\windows\\system32")]
    [InlineData("jw02733-o001/../../../etc")]
    [InlineData("..%2F..%2Fetc")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("simple-invalid-format")]
    public void ImportFromExistingFiles_WithInvalidObsId_ReturnsBadRequest(string obsId)
    {
        // Act
        var result = sut.ImportFromExistingFiles(obsId);

        // Assert
        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        badRequest.Value.Should().NotBeNull();
        badRequest.Value!.ToString().Should().Contain("Invalid");
    }

    /// <summary>
    /// Tests that ImportFromExistingFiles accepts valid JWST observation IDs.
    /// </summary>
    /// <param name="obsId">The valid observation ID to test.</param>
    [Theory]
    [InlineData("jw02733-o001_t001_nircam")]
    [InlineData("jw12345-o002_t003_miri")]
    [InlineData("jw02733-o001_t001_nircam_clear-f090w")]
    public void ImportFromExistingFiles_WithValidObsId_DoesNotReturnBadRequest(string obsId)
    {
        // Act
        var result = sut.ImportFromExistingFiles(obsId);

        // Assert - should return NotFound (since dir doesn't exist), NOT BadRequest
        Assert.IsNotType<BadRequestObjectResult>(result.Result);

        // Should be NotFoundObjectResult since the directory won't exist in tests
        var notFoundResult = Assert.IsType<NotFoundObjectResult>(result.Result);
        notFoundResult.Value.Should().NotBeNull();
    }

    /// <summary>
    /// Tests that ResumeImport returns NotFound when job doesn't exist.
    /// </summary>
    [Fact]
    public async Task ResumeImport_WithNonexistentJob_ReturnsNotFound()
    {
        // Arrange
        mockJobTracker.Setup(j => j.GetJob("nonexistent-job"))
            .Returns((ImportJobStatus?)null);

        // Act
        var result = await sut.ResumeImport("nonexistent-job");

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    /// <summary>
    /// Tests that ResumeImport returns BadRequest when job is not resumable.
    /// </summary>
    [Fact]
    public async Task ResumeImport_WithNonResumableJob_ReturnsBadRequest()
    {
        // Arrange
        var job = new ImportJobStatus
        {
            JobId = "test-job",
            ObsId = "jw02733-o001_t001_nircam",
            IsResumable = false,
            DownloadJobId = null,
        };
        mockJobTracker.Setup(j => j.GetJob("test-job"))
            .Returns(job);

        // Act
        var result = await sut.ResumeImport("test-job");

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that the observation ID regex correctly validates JWST formats.
    /// </summary>
    /// <param name="obsId">The observation ID to test.</param>
    /// <param name="shouldBeValid">Whether the ID should be considered valid.</param>
    [Theory]
    [InlineData("jw02733-o001_t001_nircam", true)]
    [InlineData("jw12345-o002_t003_miri", true)]
    [InlineData("jw02733-o001_t001_nircam_clear-f090w", true)]
    [InlineData("JW02733-O001_T001_NIRCAM", true)] // Case insensitive
    [InlineData("jw00001-o999_t999_nirspec", true)]
    [InlineData("jw02733001001_02101_00001_nrca1", false)] // Exposure ID format, not obs ID
    [InlineData("../../../etc/passwd", false)]
    [InlineData("jw02733", false)] // Incomplete
    [InlineData("", false)]
    [InlineData("invalid", false)]
    public void ObservationIdValidation_WorksCorrectly(string obsId, bool shouldBeValid)
    {
        // This tests the validation indirectly through CheckExistingFiles
        // Valid IDs should not return BadRequest, invalid should return BadRequest
        var result = sut.CheckExistingFiles(obsId);

        if (shouldBeValid)
        {
            Assert.IsNotType<BadRequestObjectResult>(result);
        }
        else
        {
            Assert.IsType<BadRequestObjectResult>(result);
        }
    }

    /// <summary>
    /// Tests that SearchByTarget calls the MAST service correctly.
    /// </summary>
    [Fact]
    public async Task SearchByTarget_CallsMastService()
    {
        // Arrange
        var request = new MastTargetSearchRequest { TargetName = "NGC 3132", Radius = 0.1 };
        var expectedResponse = new MastSearchResponse
        {
            Results = [],
            ResultCount = 0,
        };
        mockMastService.Setup(s => s.SearchByTargetAsync(request))
            .ReturnsAsync(expectedResponse);

        // Act
        var result = await sut.SearchByTarget(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(expectedResponse);
        mockMastService.Verify(s => s.SearchByTargetAsync(request), Times.Once);
    }

    /// <summary>
    /// Tests that Import creates a job and starts background processing.
    /// </summary>
    [Fact]
    public void Import_CreatesJobAndReturnsJobId()
    {
        // Arrange
        var request = new MastImportRequest { ObsId = "jw02733-o001_t001_nircam" };
        mockJobTracker.Setup(j => j.CreateJob("jw02733-o001_t001_nircam"))
            .Returns("test-job-id");

        // Act
        var result = sut.Import(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<ImportJobStartResponse>().Subject;
        response.JobId.Should().Be("test-job-id");
        response.ObsId.Should().Be("jw02733-o001_t001_nircam");
        mockJobTracker.Verify(j => j.CreateJob("jw02733-o001_t001_nircam"), Times.Once);
    }

    /// <summary>
    /// Tests that GetImportProgress returns NotFound for unknown jobs.
    /// </summary>
    [Fact]
    public void GetImportProgress_WithUnknownJob_ReturnsNotFound()
    {
        // Arrange
        mockJobTracker.Setup(j => j.GetJob("unknown-job"))
            .Returns((ImportJobStatus?)null);

        // Act
        var result = sut.GetImportProgress("unknown-job");

        // Assert
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    /// <summary>
    /// Tests that GetImportProgress returns job status when found.
    /// </summary>
    [Fact]
    public void GetImportProgress_WithKnownJob_ReturnsStatus()
    {
        // Arrange
        var job = new ImportJobStatus
        {
            JobId = "test-job",
            ObsId = "jw02733-o001_t001_nircam",
            Progress = 50,
            Stage = ImportStages.Downloading,
            Message = "Downloading...",
        };
        mockJobTracker.Setup(j => j.GetJob("test-job"))
            .Returns(job);

        // Act
        var result = sut.GetImportProgress("test-job");

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(job);
    }

    /// <summary>
    /// Tests that CancelImport returns NotFound for unknown jobs.
    /// </summary>
    [Fact]
    public async Task CancelImport_WithUnknownJob_ReturnsNotFound()
    {
        // Arrange
        mockJobTracker.Setup(j => j.GetJob("unknown-job"))
            .Returns((ImportJobStatus?)null);

        // Act
        var result = await sut.CancelImport("unknown-job");

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    /// <summary>
    /// Tests that CancelImport returns BadRequest for already completed jobs.
    /// </summary>
    [Fact]
    public async Task CancelImport_WithCompletedJob_ReturnsBadRequest()
    {
        // Arrange
        var job = new ImportJobStatus
        {
            JobId = "test-job",
            ObsId = "jw02733-o001_t001_nircam",
            IsComplete = true,
            Stage = ImportStages.Complete,
        };
        mockJobTracker.Setup(j => j.GetJob("test-job"))
            .Returns(job);

        // Act
        var result = await sut.CancelImport("test-job");

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that CancelImport cancels the job when valid.
    /// </summary>
    [Fact]
    public async Task CancelImport_WithActiveJob_CancelsJob()
    {
        // Arrange
        var job = new ImportJobStatus
        {
            JobId = "test-job",
            ObsId = "jw02733-o001_t001_nircam",
            IsComplete = false,
            DownloadJobId = "download-job-123",
        };
        mockJobTracker.Setup(j => j.GetJob("test-job"))
            .Returns(job);
        mockJobTracker.Setup(j => j.CancelJob("test-job"))
            .Returns(true);
        mockMastService.Setup(s => s.PauseDownloadAsync("download-job-123"))
            .ReturnsAsync(new PauseResumeResponse { Status = "paused", Message = "Download paused" });

        // Act
        var result = await sut.CancelImport("test-job");

        // Assert
        Assert.IsType<OkObjectResult>(result);
        mockJobTracker.Verify(j => j.CancelJob("test-job"), Times.Once);
        mockMastService.Verify(s => s.PauseDownloadAsync("download-job-123"), Times.Once);
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
