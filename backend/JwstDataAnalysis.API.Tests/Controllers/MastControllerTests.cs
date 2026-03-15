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

    // ========== SearchByTarget: happy path + alias resolution ==========

    /// <summary>
    /// Tests that SearchByTarget returns Ok with results on success.
    /// </summary>
    [Fact]
    public async Task SearchByTarget_WithValidRequest_ReturnsOk()
    {
        // Arrange
        var request = new MastTargetSearchRequest { TargetName = "Crab Nebula", Radius = 0.2 };
        var expectedResponse = new MastSearchResponse
        {
            Results = [new Dictionary<string, object?> { { "obs_id", "jw02733-o001" } }],
            ResultCount = 1,
        };
        mockDiscoveryService.Setup(d => d.ResolveTargetAlias("Crab Nebula")).Returns((string?)null);
        mockMastService.Setup(s => s.SearchByTargetAsync(request)).ReturnsAsync(expectedResponse);

        // Act
        var result = await sut.SearchByTarget(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(expectedResponse);
    }

    /// <summary>
    /// Tests that SearchByTarget resolves a common alias and passes the resolved name to the service.
    /// </summary>
    [Fact]
    public async Task SearchByTarget_WithAliasedTarget_ResolvesAndSearches()
    {
        // Arrange
        var request = new MastTargetSearchRequest { TargetName = "Pillars of Creation", Radius = 0.2 };
        var expectedResponse = new MastSearchResponse { Results = [], ResultCount = 0 };
        mockDiscoveryService.Setup(d => d.ResolveTargetAlias("Pillars of Creation")).Returns("M16");
        mockMastService.Setup(s => s.SearchByTargetAsync(It.Is<MastTargetSearchRequest>(r => r.TargetName == "M16")))
            .ReturnsAsync(expectedResponse);

        // Act
        var result = await sut.SearchByTarget(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(expectedResponse);
        mockMastService.Verify(
            s => s.SearchByTargetAsync(It.Is<MastTargetSearchRequest>(r => r.TargetName == "M16")),
            Times.Once);
    }

    // ========== SearchByCoordinates: happy path ==========

    /// <summary>
    /// Tests that SearchByCoordinates returns Ok with results on success.
    /// </summary>
    [Fact]
    public async Task SearchByCoordinates_WithValidRequest_ReturnsOk()
    {
        // Arrange
        var request = new MastCoordinateSearchRequest { Ra = 187.7, Dec = 12.4, Radius = 0.1 };
        var expectedResponse = new MastSearchResponse { Results = [], ResultCount = 0 };
        mockMastService.Setup(s => s.SearchByCoordinatesAsync(request)).ReturnsAsync(expectedResponse);

        // Act
        var result = await sut.SearchByCoordinates(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(expectedResponse);
        mockMastService.Verify(s => s.SearchByCoordinatesAsync(request), Times.Once);
    }

    /// <summary>
    /// Tests that SearchByCoordinates returns 500 for unexpected exceptions.
    /// </summary>
    [Fact]
    public async Task SearchByCoordinates_WhenUnexpectedError_Returns500()
    {
        // Arrange
        var request = new MastCoordinateSearchRequest { Ra = 187.7, Dec = 12.4, Radius = 0.1 };
        mockMastService.Setup(s => s.SearchByCoordinatesAsync(request))
            .ThrowsAsync(new InvalidOperationException("Something broke"));

        // Act
        var result = await sut.SearchByCoordinates(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== SearchByObservationId: happy path ==========

    /// <summary>
    /// Tests that SearchByObservationId returns Ok with results on success.
    /// </summary>
    [Fact]
    public async Task SearchByObservationId_WithValidRequest_ReturnsOk()
    {
        // Arrange
        var request = new MastObservationSearchRequest { ObsId = "jw02733-o001" };
        var expectedResponse = new MastSearchResponse { Results = [], ResultCount = 0 };
        mockMastService.Setup(s => s.SearchByObservationIdAsync(request)).ReturnsAsync(expectedResponse);

        // Act
        var result = await sut.SearchByObservationId(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(expectedResponse);
        mockMastService.Verify(s => s.SearchByObservationIdAsync(request), Times.Once);
    }

    /// <summary>
    /// Tests that SearchByObservationId returns 500 for unexpected exceptions.
    /// </summary>
    [Fact]
    public async Task SearchByObservationId_WhenUnexpectedError_Returns500()
    {
        // Arrange
        var request = new MastObservationSearchRequest { ObsId = "jw02733-o001" };
        mockMastService.Setup(s => s.SearchByObservationIdAsync(request))
            .ThrowsAsync(new InvalidOperationException("Something broke"));

        // Act
        var result = await sut.SearchByObservationId(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== SearchByProgramId: happy path ==========

    /// <summary>
    /// Tests that SearchByProgramId returns Ok with results on success.
    /// </summary>
    [Fact]
    public async Task SearchByProgramId_WithValidRequest_ReturnsOk()
    {
        // Arrange
        var request = new MastProgramSearchRequest { ProgramId = "2733" };
        var expectedResponse = new MastSearchResponse { Results = [], ResultCount = 0 };
        mockMastService.Setup(s => s.SearchByProgramIdAsync(request)).ReturnsAsync(expectedResponse);

        // Act
        var result = await sut.SearchByProgramId(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(expectedResponse);
        mockMastService.Verify(s => s.SearchByProgramIdAsync(request), Times.Once);
    }

    /// <summary>
    /// Tests that SearchByProgramId returns 500 for unexpected exceptions.
    /// </summary>
    [Fact]
    public async Task SearchByProgramId_WhenUnexpectedError_Returns500()
    {
        // Arrange
        var request = new MastProgramSearchRequest { ProgramId = "2733" };
        mockMastService.Setup(s => s.SearchByProgramIdAsync(request))
            .ThrowsAsync(new InvalidOperationException("Something broke"));

        // Act
        var result = await sut.SearchByProgramId(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== GetWhatsNew ==========

    /// <summary>
    /// Tests that GetWhatsNew returns Ok with results on success.
    /// </summary>
    [Fact]
    public async Task GetWhatsNew_WithValidRequest_ReturnsOk()
    {
        // Arrange
        var request = new MastRecentReleasesRequest { DaysBack = 30, Limit = 50 };
        var expectedResponse = new MastSearchResponse { Results = [], ResultCount = 0 };
        mockMastService.Setup(s => s.SearchRecentReleasesAsync(request)).ReturnsAsync(expectedResponse);

        // Act
        var result = await sut.GetWhatsNew(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(expectedResponse);
        mockMastService.Verify(s => s.SearchRecentReleasesAsync(request), Times.Once);
    }

    /// <summary>
    /// Tests that GetWhatsNew returns 503 when the processing engine is unavailable.
    /// </summary>
    [Fact]
    public async Task GetWhatsNew_WhenProcessingEngineDown_Returns503()
    {
        // Arrange
        var request = new MastRecentReleasesRequest { DaysBack = 7 };
        mockMastService.Setup(s => s.SearchRecentReleasesAsync(request))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.GetWhatsNew(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that GetWhatsNew returns 500 for unexpected exceptions.
    /// </summary>
    [Fact]
    public async Task GetWhatsNew_WhenUnexpectedError_Returns500()
    {
        // Arrange
        var request = new MastRecentReleasesRequest { DaysBack = 30 };
        mockMastService.Setup(s => s.SearchRecentReleasesAsync(request))
            .ThrowsAsync(new InvalidOperationException("Something broke"));

        // Act
        var result = await sut.GetWhatsNew(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== GetDataProducts ==========

    /// <summary>
    /// Tests that GetDataProducts returns Ok with results on success.
    /// </summary>
    [Fact]
    public async Task GetDataProducts_WithValidRequest_ReturnsOk()
    {
        // Arrange
        var request = new MastDataProductsRequest { ObsId = "jw02733-o001" };
        var expectedResponse = new MastDataProductsResponse
        {
            ObsId = "jw02733-o001",
            Products = [new Dictionary<string, object?> { { "product_id", "p001" } }],
            ProductCount = 1,
        };
        mockMastService.Setup(s => s.GetDataProductsAsync(request)).ReturnsAsync(expectedResponse);

        // Act
        var result = await sut.GetDataProducts(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(expectedResponse);
        mockMastService.Verify(s => s.GetDataProductsAsync(request), Times.Once);
    }

    /// <summary>
    /// Tests that GetDataProducts returns 503 when the processing engine is unavailable.
    /// </summary>
    [Fact]
    public async Task GetDataProducts_WhenProcessingEngineDown_Returns503()
    {
        // Arrange
        var request = new MastDataProductsRequest { ObsId = "jw02733-o001" };
        mockMastService.Setup(s => s.GetDataProductsAsync(request))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.GetDataProducts(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that GetDataProducts returns 500 for unexpected exceptions.
    /// </summary>
    [Fact]
    public async Task GetDataProducts_WhenUnexpectedError_Returns500()
    {
        // Arrange
        var request = new MastDataProductsRequest { ObsId = "jw02733-o001" };
        mockMastService.Setup(s => s.GetDataProductsAsync(request))
            .ThrowsAsync(new InvalidOperationException("Something broke"));

        // Act
        var result = await sut.GetDataProducts(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== Download ==========

    /// <summary>
    /// Tests that Download returns Ok with a result on success.
    /// </summary>
    [Fact]
    public async Task Download_WithValidRequest_ReturnsOk()
    {
        // Arrange
        var request = new MastDownloadRequest { ObsId = "jw02733-o001_t001_nircam" };
        var expectedResponse = new MastDownloadResponse
        {
            Status = "completed",
            ObsId = "jw02733-o001_t001_nircam",
            Files = ["/data/mast/jw02733-o001_t001_nircam/test_i2d.fits"],
            FileCount = 1,
        };
        mockMastService.Setup(s => s.DownloadObservationAsync(request)).ReturnsAsync(expectedResponse);

        // Act
        var result = await sut.Download(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(expectedResponse);
        mockMastService.Verify(s => s.DownloadObservationAsync(request), Times.Once);
    }

    /// <summary>
    /// Tests that Download returns 503 when the processing engine is unavailable.
    /// </summary>
    [Fact]
    public async Task Download_WhenProcessingEngineDown_Returns503()
    {
        // Arrange
        var request = new MastDownloadRequest { ObsId = "jw02733-o001_t001_nircam" };
        mockMastService.Setup(s => s.DownloadObservationAsync(request))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.Download(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that Download returns 500 for unexpected exceptions.
    /// </summary>
    [Fact]
    public async Task Download_WhenUnexpectedError_Returns500()
    {
        // Arrange
        var request = new MastDownloadRequest { ObsId = "jw02733-o001_t001_nircam" };
        mockMastService.Setup(s => s.DownloadObservationAsync(request))
            .ThrowsAsync(new InvalidOperationException("Something broke"));

        // Act
        var result = await sut.Download(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== CancelImport: tracker returns false ==========

    /// <summary>
    /// Tests that CancelImport returns BadRequest when the tracker cannot cancel the job.
    /// </summary>
    [Fact]
    public async Task CancelImport_WhenTrackerCannotCancel_ReturnsBadRequest()
    {
        // Arrange
        var job = new ImportJobStatus
        {
            JobId = "test-job",
            ObsId = "jw02733-o001_t001_nircam",
            IsComplete = false,
        };
        mockJobTracker.Setup(j => j.GetJob("test-job")).Returns(job);
        mockJobTracker.Setup(j => j.CancelJob("test-job", It.IsAny<string>())).Returns(false);

        // Act
        var result = await sut.CancelImport("test-job");

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    /// <summary>
    /// Tests that CancelImport continues to Ok even when pausing the download in the
    /// processing engine throws — the job is still cancelled.
    /// </summary>
    [Fact]
    public async Task CancelImport_WhenPauseDownloadThrows_StillReturnsOk()
    {
        // Arrange
        var job = new ImportJobStatus
        {
            JobId = "test-job",
            ObsId = "jw02733-o001_t001_nircam",
            IsComplete = false,
            DownloadJobId = "dl-999",
        };
        mockJobTracker.Setup(j => j.GetJob("test-job")).Returns(job);
        mockJobTracker.Setup(j => j.CancelJob("test-job", It.IsAny<string>())).Returns(true);
        mockMastService.Setup(s => s.PauseDownloadAsync("dl-999"))
            .ThrowsAsync(new HttpRequestException("processing engine down"));

        // Act
        var result = await sut.CancelImport("test-job");

        // Assert — pause failure is swallowed; import cancel still succeeds
        Assert.IsType<OkObjectResult>(result);
    }

    /// <summary>
    /// Tests that CancelImport returns Ok without calling PauseDownload when there is
    /// no download job ID associated with the job.
    /// </summary>
    [Fact]
    public async Task CancelImport_WithNoDownloadJobId_ReturnsOkWithoutCallingPause()
    {
        // Arrange
        var job = new ImportJobStatus
        {
            JobId = "test-job",
            ObsId = "jw02733-o001_t001_nircam",
            IsComplete = false,
            DownloadJobId = null,
        };
        mockJobTracker.Setup(j => j.GetJob("test-job")).Returns(job);
        mockJobTracker.Setup(j => j.CancelJob("test-job", It.IsAny<string>())).Returns(true);

        // Act
        var result = await sut.CancelImport("test-job");

        // Assert
        Assert.IsType<OkObjectResult>(result);
        mockMastService.Verify(s => s.PauseDownloadAsync(It.IsAny<string>()), Times.Never);
    }

    // ========== GetResumableImports: service throws ==========

    /// <summary>
    /// Tests that GetResumableImports returns 503 when the processing engine is unavailable.
    /// </summary>
    [Fact]
    public async Task GetResumableImports_WhenProcessingEngineDown_Returns503()
    {
        // Arrange
        mockMastService.Setup(s => s.GetResumableDownloadsAsync())
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.GetResumableImports();

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that GetResumableImports returns an empty list when the service returns null.
    /// </summary>
    [Fact]
    public async Task GetResumableImports_WhenServiceReturnsNull_ReturnsEmptyList()
    {
        // Arrange
        SetupAdminUser(TestUserId);
        mockMastService.Setup(s => s.GetResumableDownloadsAsync())
            .ReturnsAsync((ResumableJobsResponse?)null);

        // Act
        var result = await sut.GetResumableImports();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<ResumableJobsResponse>().Subject;
        response.Jobs.Should().BeEmpty();
        response.Count.Should().Be(0);
    }

    // ========== DismissResumableDownload: service returns false / throws ==========

    /// <summary>
    /// Tests that DismissResumableDownload returns 404 when the service reports the job
    /// could not be dismissed (non-admin path — ownership check passes).
    /// </summary>
    [Fact]
    public async Task DismissResumableDownload_WhenServiceReturnsFalse_Returns404()
    {
        // Arrange
        mockJobTracker.Setup(j => j.GetJob("job-1"))
            .Returns(new ImportJobStatus { JobId = "job-1", UserId = TestUserId });
        mockMastService.Setup(s => s.DismissResumableDownloadAsync("job-1", false))
            .ReturnsAsync(false);

        // Act
        var result = await sut.DismissResumableDownload("job-1");

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    /// <summary>
    /// Tests that DismissResumableDownload returns 503 when the processing engine is unavailable.
    /// </summary>
    [Fact]
    public async Task DismissResumableDownload_WhenProcessingEngineDown_Returns503()
    {
        // Arrange — admin to skip ownership check
        SetupAdminUser(TestUserId);
        mockMastService.Setup(s => s.DismissResumableDownloadAsync("job-1", false))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        // Act
        var result = await sut.DismissResumableDownload("job-1");

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that DismissResumableDownload passes deleteFiles=true to the service when requested.
    /// </summary>
    [Fact]
    public async Task DismissResumableDownload_WithDeleteFiles_PassesFlagToService()
    {
        // Arrange
        mockJobTracker.Setup(j => j.GetJob("job-1"))
            .Returns(new ImportJobStatus { JobId = "job-1", UserId = TestUserId });
        mockMastService.Setup(s => s.DismissResumableDownloadAsync("job-1", true))
            .ReturnsAsync(true);

        // Act
        var result = await sut.DismissResumableDownload("job-1", deleteFiles: true);

        // Assert
        Assert.IsType<OkObjectResult>(result);
        mockMastService.Verify(s => s.DismissResumableDownloadAsync("job-1", true), Times.Once);
    }

    // ========== RefreshMetadata: MAST search returns no results / service throws ==========

    /// <summary>
    /// Tests that RefreshMetadata returns 404 when MAST returns no results for the observation.
    /// </summary>
    [Fact]
    public async Task RefreshMetadata_WhenMastReturnsNoResults_ReturnsNotFound()
    {
        // Arrange
        var records = new List<JwstDataModel>
        {
            new()
            {
                Id = "rec-1",
                FileName = "test.fits",
                UserId = TestUserId,
                Metadata = new Dictionary<string, object>
                {
                    { "mast_obs_id", "obs-123" },
                    { "source", "MAST" },
                },
            },
        };
        mockMongoService.Setup(s => s.GetAsync()).ReturnsAsync(records);
        mockMastService.Setup(s => s.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(new MastSearchResponse { Results = [], ResultCount = 0 });

        // Act
        var result = await sut.RefreshMetadata("obs-123");

        // Assert
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    /// <summary>
    /// Tests that RefreshMetadata returns 503 when the MAST service throws while fetching metadata.
    /// </summary>
    [Fact]
    public async Task RefreshMetadata_WhenMastServiceThrows_Returns503()
    {
        // Arrange
        var records = new List<JwstDataModel>
        {
            new()
            {
                Id = "rec-1",
                FileName = "test.fits",
                UserId = TestUserId,
                Metadata = new Dictionary<string, object>
                {
                    { "mast_obs_id", "obs-123" },
                    { "source", "MAST" },
                },
            },
        };
        mockMongoService.Setup(s => s.GetAsync()).ReturnsAsync(records);
        mockMastService.Setup(s => s.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ThrowsAsync(new HttpRequestException("MAST unavailable"));

        // Act
        var result = await sut.RefreshMetadata("obs-123");

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(503);
    }

    /// <summary>
    /// Tests that RefreshMetadata returns 404 when no records match the obs ID at all.
    /// </summary>
    [Fact]
    public async Task RefreshMetadata_WhenNoRecordsMatchObsId_ReturnsNotFound()
    {
        // Arrange — records exist, but none have the requested mast_obs_id
        var records = new List<JwstDataModel>
        {
            new()
            {
                Id = "rec-1",
                FileName = "test.fits",
                UserId = TestUserId,
                Metadata = new Dictionary<string, object>
                {
                    { "mast_obs_id", "different-obs" },
                    { "source", "MAST" },
                },
            },
        };
        mockMongoService.Setup(s => s.GetAsync()).ReturnsAsync(records);

        // Act
        var result = await sut.RefreshMetadata("obs-123");

        // Assert
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // ========== RefreshAllMetadata (admin-only) ==========

    /// <summary>
    /// Tests that RefreshAllMetadata returns Ok with updated count when admin refreshes all records.
    /// </summary>
    [Fact]
    public async Task RefreshAllMetadata_AsAdmin_RefreshesAllMastRecords()
    {
        // Arrange
        SetupAdminUser(TestUserId);
        var records = new List<JwstDataModel>
        {
            new()
            {
                Id = "rec-1",
                FileName = "test_i2d.fits",
                UserId = "any-user",
                Metadata = new Dictionary<string, object>
                {
                    { "source", "MAST" },
                    { "mast_obs_id", "obs-456" },
                },
            },
            new()
            {
                Id = "rec-2",
                FileName = "test_cal.fits",
                UserId = "other-user",
                Metadata = new Dictionary<string, object>
                {
                    { "source", "MAST" },
                    { "mast_obs_id", "obs-456" },
                },
            },
        };
        mockMongoService.Setup(s => s.GetAsync()).ReturnsAsync(records);
        mockMastService.Setup(s => s.SearchByObservationIdAsync(
                It.Is<MastObservationSearchRequest>(r => r.ObsId == "obs-456")))
            .ReturnsAsync(new MastSearchResponse
            {
                Results = [new Dictionary<string, object?> { { "obs_id", "obs-456" } }],
                ResultCount = 1,
            });
        mockMongoService.Setup(s => s.UpdateAsync(It.IsAny<string>(), It.IsAny<JwstDataModel>()))
            .Returns(Task.CompletedTask);
        mockMongoService.Setup(s => s.GetViewableWithoutThumbnailIdsAsync())
            .ReturnsAsync([]);

        // Act
        var result = await sut.RefreshAllMetadata();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<MetadataRefreshResponse>().Subject;
        response.UpdatedCount.Should().Be(2);
    }

    /// <summary>
    /// Tests that RefreshAllMetadata returns Ok with zero count when no MAST records exist.
    /// </summary>
    [Fact]
    public async Task RefreshAllMetadata_WhenNoMastRecords_ReturnsOkWithZeroCount()
    {
        // Arrange
        SetupAdminUser(TestUserId);
        // Records exist, but none have source=MAST
        var records = new List<JwstDataModel>
        {
            new()
            {
                Id = "rec-1",
                FileName = "manual.fits",
                UserId = TestUserId,
                Metadata = new Dictionary<string, object> { { "source", "upload" } },
            },
        };
        mockMongoService.Setup(s => s.GetAsync()).ReturnsAsync(records);

        // Act
        var result = await sut.RefreshAllMetadata();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<MetadataRefreshResponse>().Subject;
        response.UpdatedCount.Should().Be(0);
        response.ObsId.Should().Be("all");
    }

    /// <summary>
    /// Tests that RefreshAllMetadata continues processing other observations when one MAST
    /// fetch fails, and includes the failed obs ID in the response message.
    /// </summary>
    [Fact]
    public async Task RefreshAllMetadata_WhenOneMastFetchFails_ContinuesAndReportsFailure()
    {
        // Arrange
        SetupAdminUser(TestUserId);
        var records = new List<JwstDataModel>
        {
            new()
            {
                Id = "rec-1",
                FileName = "test_i2d.fits",
                UserId = TestUserId,
                Metadata = new Dictionary<string, object>
                {
                    { "source", "MAST" },
                    { "mast_obs_id", "obs-good" },
                },
            },
            new()
            {
                Id = "rec-2",
                FileName = "test_cal.fits",
                UserId = TestUserId,
                Metadata = new Dictionary<string, object>
                {
                    { "source", "MAST" },
                    { "mast_obs_id", "obs-bad" },
                },
            },
        };
        mockMongoService.Setup(s => s.GetAsync()).ReturnsAsync(records);
        mockMastService.Setup(s => s.SearchByObservationIdAsync(
                It.Is<MastObservationSearchRequest>(r => r.ObsId == "obs-good")))
            .ReturnsAsync(new MastSearchResponse
            {
                Results = [new Dictionary<string, object?> { { "obs_id", "obs-good" } }],
                ResultCount = 1,
            });
        mockMastService.Setup(s => s.SearchByObservationIdAsync(
                It.Is<MastObservationSearchRequest>(r => r.ObsId == "obs-bad")))
            .ThrowsAsync(new HttpRequestException("MAST unavailable"));
        mockMongoService.Setup(s => s.UpdateAsync(It.IsAny<string>(), It.IsAny<JwstDataModel>()))
            .Returns(Task.CompletedTask);
        mockMongoService.Setup(s => s.GetViewableWithoutThumbnailIdsAsync())
            .ReturnsAsync([]);

        // Act
        var result = await sut.RefreshAllMetadata();

        // Assert — 1 record updated, 1 observation failed
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<MetadataRefreshResponse>().Subject;
        response.UpdatedCount.Should().Be(1);
        response.Message.Should().Contain("Failed");
    }
}
