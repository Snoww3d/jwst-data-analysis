// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using FluentAssertions;

using JwstDataAnalysis.API.Configuration;
using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Services.Storage;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

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
    private readonly Mock<IDiscoveryService> mockDiscoveryService;
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
        mockDiscoveryService = new Mock<IDiscoveryService>();
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

        var mockThumbnailQueue = new Mock<IThumbnailQueue>();
        var mockMosaicQueue = new MosaicQueue();
        var mockMosaicJobTracker = new Mock<IJobTracker>();
        var mockStorageProvider = new Mock<IStorageProvider>();
        var observationMosaicOptions = Options.Create(new ObservationMosaicSettings());

        sut = new MastController(
            mockMastService.Object,
            mockDiscoveryService.Object,
            mockMongoService.Object,
            mockJobTracker.Object,
            mockThumbnailQueue.Object,
            mockMosaicQueue,
            mockMosaicJobTracker.Object,
            mockStorageProvider.Object,
            new ObservationMosaicTracker(),
            mockLogger.Object,
            configuration,
            observationMosaicOptions);

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
            UserId = TestUserId,
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
        mockJobTracker.Setup(j => j.CreateJob("jw02733-o001_t001_nircam", It.IsAny<string>()))
            .Returns("test-job-id");

        // Act
        var result = sut.Import(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<JobStartResponse>().Subject;
        response.JobId.Should().Be("test-job-id");
        response.ObsId.Should().Be("jw02733-o001_t001_nircam");
        mockJobTracker.Verify(j => j.CreateJob("jw02733-o001_t001_nircam", It.IsAny<string>()), Times.Once);
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
            UserId = TestUserId,
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
    /// Tests that GetImportProgress returns NotFound when job belongs to another user.
    /// </summary>
    [Fact]
    public void GetImportProgress_ReturnsForbid_WhenNotOwner()
    {
        // Arrange
        var job = new ImportJobStatus
        {
            JobId = "other-job",
            ObsId = "jw02733-o001_t001_nircam",
            UserId = "different-user",
        };
        mockJobTracker.Setup(j => j.GetJob("other-job"))
            .Returns(job);

        // Act
        var result = sut.GetImportProgress("other-job");

        // Assert — returns NotFound (not Forbid) to prevent job ID enumeration
        Assert.IsType<NotFoundObjectResult>(result.Result);
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
        mockJobTracker.Setup(j => j.CancelJob("test-job", It.IsAny<string>()))
            .Returns(true);
        mockMastService.Setup(s => s.PauseDownloadAsync("download-job-123"))
            .ReturnsAsync(new PauseResumeResponse { Status = "paused", Message = "Download paused" });

        // Act
        var result = await sut.CancelImport("test-job");

        // Assert
        Assert.IsType<OkObjectResult>(result);
        mockJobTracker.Verify(j => j.CancelJob("test-job", It.IsAny<string>()), Times.Once);
        mockMastService.Verify(s => s.PauseDownloadAsync("download-job-123"), Times.Once);
    }

    /// <summary>
    /// Tests that SearchByTarget returns 503 when the processing engine is unavailable.
    /// </summary>
    [Fact]
    public async Task SearchByTarget_WhenProcessingEngineDown_Returns503()
    {
        // Arrange
        var request = new MastTargetSearchRequest { TargetName = "NGC 3132", Radius = 0.1 };
        mockMastService.Setup(s => s.SearchByTargetAsync(request))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.SearchByTarget(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that SearchByCoordinates returns 503 when the processing engine is unavailable.
    /// </summary>
    [Fact]
    public async Task SearchByCoordinates_WhenProcessingEngineDown_Returns503()
    {
        // Arrange
        var request = new MastCoordinateSearchRequest { Ra = 187.7, Dec = 12.4, Radius = 0.1 };
        mockMastService.Setup(s => s.SearchByCoordinatesAsync(request))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.SearchByCoordinates(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that SearchByObservationId returns 503 when the processing engine is unavailable.
    /// </summary>
    [Fact]
    public async Task SearchByObservationId_WhenProcessingEngineDown_Returns503()
    {
        // Arrange
        var request = new MastObservationSearchRequest { ObsId = "jw02733-o001" };
        mockMastService.Setup(s => s.SearchByObservationIdAsync(request))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.SearchByObservationId(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that SearchByProgramId returns 503 when the processing engine is unavailable.
    /// </summary>
    [Fact]
    public async Task SearchByProgramId_WhenProcessingEngineDown_Returns503()
    {
        // Arrange
        var request = new MastProgramSearchRequest { ProgramId = "3132" };
        mockMastService.Setup(s => s.SearchByProgramIdAsync(request))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.SearchByProgramId(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that SearchByTarget returns 500 for unexpected exceptions (not 503).
    /// </summary>
    [Fact]
    public async Task SearchByTarget_WhenUnexpectedError_Returns500()
    {
        // Arrange
        var request = new MastTargetSearchRequest { TargetName = "NGC 3132", Radius = 0.1 };
        mockMastService.Setup(s => s.SearchByTargetAsync(request))
            .ThrowsAsync(new InvalidOperationException("Something broke"));

        // Act
        var result = await sut.SearchByTarget(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== #566: ResumeImport Authorization Tests ==========

    /// <summary>
    /// Tests that the job owner can resume their own job.
    /// </summary>
    [Fact]
    public async Task ResumeImport_OwnerCanResume()
    {
        // Arrange
        var job = new ImportJobStatus
        {
            JobId = "test-job",
            ObsId = "jw02733-o001_t001_nircam",
            IsResumable = true,
            DownloadJobId = "dl-123",
            UserId = TestUserId,
        };
        mockJobTracker.Setup(j => j.GetJob("test-job")).Returns(job);
        mockMastService.Setup(s => s.ResumeDownloadAsync("dl-123"))
            .ReturnsAsync(new PauseResumeResponse { Status = "resumed" });

        // Act
        var result = await sut.ResumeImport("test-job");

        // Assert — owner should be able to resume
        Assert.IsType<OkObjectResult>(result);
    }

    /// <summary>
    /// Tests that admin can resume any job.
    /// </summary>
    [Fact]
    public async Task ResumeImport_AdminCanResumeAnyJob()
    {
        // Arrange
        SetupAdminUser(TestUserId);
        var job = new ImportJobStatus
        {
            JobId = "test-job",
            ObsId = "jw02733-o001_t001_nircam",
            IsResumable = true,
            DownloadJobId = "dl-123",
            UserId = "other-user",
        };
        mockJobTracker.Setup(j => j.GetJob("test-job")).Returns(job);
        mockMastService.Setup(s => s.ResumeDownloadAsync("dl-123"))
            .ReturnsAsync(new PauseResumeResponse { Status = "resumed" });

        // Act
        var result = await sut.ResumeImport("test-job");

        // Assert — admin can resume any job
        Assert.IsType<OkObjectResult>(result);
    }

    /// <summary>
    /// Tests that non-owner gets 404 when trying to resume someone else's job.
    /// </summary>
    [Fact]
    public async Task ResumeImport_NonOwnerGets404()
    {
        // Arrange
        var job = new ImportJobStatus
        {
            JobId = "test-job",
            ObsId = "jw02733-o001_t001_nircam",
            IsResumable = true,
            DownloadJobId = "dl-123",
            UserId = "different-user",
        };
        mockJobTracker.Setup(j => j.GetJob("test-job")).Returns(job);

        // Act
        var result = await sut.ResumeImport("test-job");

        // Assert — non-owner gets 404 (not 403, to prevent enumeration)
        Assert.IsType<NotFoundObjectResult>(result);
    }

    // ========== #567: GetResumableImports Authorization Tests ==========

    /// <summary>
    /// Tests that non-admin users only see their own resumable jobs.
    /// </summary>
    [Fact]
    public async Task GetResumableImports_UserSeesOnlyOwnJobs()
    {
        // Arrange
        var resumableJobs = new ResumableJobsResponse
        {
            Jobs =
            [
                new ResumableJobSummary { JobId = "job-1", ObsId = "obs-1" },
                new ResumableJobSummary { JobId = "job-2", ObsId = "obs-2" },
                new ResumableJobSummary { JobId = "job-3", ObsId = "obs-3" },
            ],
            Count = 3,
        };
        mockMastService.Setup(s => s.GetResumableDownloadsAsync())
            .ReturnsAsync(resumableJobs);

        // job-1 belongs to current user, job-2 to another user, job-3 not in tracker
        mockJobTracker.Setup(j => j.GetJob("job-1"))
            .Returns(new ImportJobStatus { JobId = "job-1", UserId = TestUserId });
        mockJobTracker.Setup(j => j.GetJob("job-2"))
            .Returns(new ImportJobStatus { JobId = "job-2", UserId = "other-user" });
        mockJobTracker.Setup(j => j.GetJob("job-3"))
            .Returns((ImportJobStatus?)null);

        // Act
        var result = await sut.GetResumableImports();

        // Assert — user should only see job-1
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<ResumableJobsResponse>().Subject;
        response.Jobs.Should().HaveCount(1);
        response.Jobs[0].JobId.Should().Be("job-1");
        response.Count.Should().Be(1);
    }

    /// <summary>
    /// Tests that admin sees all resumable jobs.
    /// </summary>
    [Fact]
    public async Task GetResumableImports_AdminSeesAllJobs()
    {
        // Arrange
        SetupAdminUser(TestUserId);
        var resumableJobs = new ResumableJobsResponse
        {
            Jobs =
            [
                new ResumableJobSummary { JobId = "job-1", ObsId = "obs-1" },
                new ResumableJobSummary { JobId = "job-2", ObsId = "obs-2" },
            ],
            Count = 2,
        };
        mockMastService.Setup(s => s.GetResumableDownloadsAsync())
            .ReturnsAsync(resumableJobs);

        // Act
        var result = await sut.GetResumableImports();

        // Assert — admin should see all jobs
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<ResumableJobsResponse>().Subject;
        response.Jobs.Should().HaveCount(2);
        response.Count.Should().Be(2);
    }

    // ========== #568: DismissResumableDownload Authorization Tests ==========

    /// <summary>
    /// Tests that job owner can dismiss their own job.
    /// </summary>
    [Fact]
    public async Task DismissResumableDownload_OwnerCanDismiss()
    {
        // Arrange
        mockJobTracker.Setup(j => j.GetJob("job-1"))
            .Returns(new ImportJobStatus { JobId = "job-1", UserId = TestUserId });
        mockMastService.Setup(s => s.DismissResumableDownloadAsync("job-1", false))
            .ReturnsAsync(true);

        // Act
        var result = await sut.DismissResumableDownload("job-1");

        // Assert
        Assert.IsType<OkObjectResult>(result);
    }

    /// <summary>
    /// Tests that admin can dismiss any job.
    /// </summary>
    [Fact]
    public async Task DismissResumableDownload_AdminCanDismissAny()
    {
        // Arrange
        SetupAdminUser(TestUserId);
        mockMastService.Setup(s => s.DismissResumableDownloadAsync("job-1", false))
            .ReturnsAsync(true);

        // Act
        var result = await sut.DismissResumableDownload("job-1");

        // Assert — admin bypasses ownership check
        Assert.IsType<OkObjectResult>(result);
    }

    /// <summary>
    /// Tests that non-owner gets 404 when trying to dismiss someone else's job.
    /// </summary>
    [Fact]
    public async Task DismissResumableDownload_NonOwnerGets404()
    {
        // Arrange
        mockJobTracker.Setup(j => j.GetJob("job-1"))
            .Returns(new ImportJobStatus { JobId = "job-1", UserId = "other-user" });

        // Act
        var result = await sut.DismissResumableDownload("job-1");

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    /// <summary>
    /// Tests that dismiss returns 404 when job not found in tracker (non-admin).
    /// </summary>
    [Fact]
    public async Task DismissResumableDownload_NotFoundInTracker_Returns404()
    {
        // Arrange
        mockJobTracker.Setup(j => j.GetJob("unknown-job"))
            .Returns((ImportJobStatus?)null);

        // Act
        var result = await sut.DismissResumableDownload("unknown-job");

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    // ========== #569: RefreshMetadata Authorization Tests ==========

    /// <summary>
    /// Tests that owner can refresh metadata for their own records.
    /// </summary>
    [Fact]
    public async Task RefreshMetadata_OwnerCanRefreshOwnRecords()
    {
        // Arrange
        var records = new List<JwstDataModel>
        {
            new()
            {
                Id = "rec-1",
                FileName = "test.fits",
                UserId = TestUserId,
                Metadata = new Dictionary<string, object> { { "mast_obs_id", "obs-123" }, { "source", "MAST" } },
            },
        };
        mockMongoService.Setup(s => s.GetAsync()).ReturnsAsync(records);
        mockMastService.Setup(s => s.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(new MastSearchResponse
            {
                Results = [new Dictionary<string, object?> { { "obs_id", "obs-123" } }],
                ResultCount = 1,
            });
        mockMongoService.Setup(s => s.UpdateAsync(It.IsAny<string>(), It.IsAny<JwstDataModel>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.RefreshMetadata("obs-123");

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<MetadataRefreshResponse>().Subject;
        response.UpdatedCount.Should().Be(1);
    }

    /// <summary>
    /// Tests that non-owner's records are filtered out during refresh.
    /// </summary>
    [Fact]
    public async Task RefreshMetadata_NonOwnerRecordsFiltered()
    {
        // Arrange — records belong to another user
        var records = new List<JwstDataModel>
        {
            new()
            {
                Id = "rec-1",
                FileName = "test.fits",
                UserId = "other-user",
                Metadata = new Dictionary<string, object> { { "mast_obs_id", "obs-123" }, { "source", "MAST" } },
            },
        };
        mockMongoService.Setup(s => s.GetAsync()).ReturnsAsync(records);

        // Act
        var result = await sut.RefreshMetadata("obs-123");

        // Assert — non-owner should see no matching records
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    /// <summary>
    /// Tests that admin can refresh metadata for any records.
    /// </summary>
    [Fact]
    public async Task RefreshMetadata_AdminCanRefreshAnyRecords()
    {
        // Arrange
        SetupAdminUser(TestUserId);
        var records = new List<JwstDataModel>
        {
            new()
            {
                Id = "rec-1",
                FileName = "test.fits",
                UserId = "other-user",
                Metadata = new Dictionary<string, object> { { "mast_obs_id", "obs-123" }, { "source", "MAST" } },
            },
        };
        mockMongoService.Setup(s => s.GetAsync()).ReturnsAsync(records);
        mockMastService.Setup(s => s.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(new MastSearchResponse
            {
                Results = [new Dictionary<string, object?> { { "obs_id", "obs-123" } }],
                ResultCount = 1,
            });
        mockMongoService.Setup(s => s.UpdateAsync(It.IsAny<string>(), It.IsAny<JwstDataModel>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.RefreshMetadata("obs-123");

        // Assert — admin can refresh any records
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<MetadataRefreshResponse>().Subject;
        response.UpdatedCount.Should().Be(1);
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

    private void SetupAdminUser(string userId)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId),
            new("sub", userId),
            new(ClaimTypes.Role, "Admin"),
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
