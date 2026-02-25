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

using Moq;

namespace JwstDataAnalysis.API.Tests.Controllers;

/// <summary>
/// Unit tests for JobsController.
/// </summary>
public class JobsControllerTests
{
    private const string TestUserId = "user-1";
    private const string OtherUserId = "user-2";

    private readonly Mock<IJobTracker> mockJobTracker = new();
    private readonly Mock<IStorageProvider> mockStorage = new();
    private readonly JobsController sut;

    public JobsControllerTests()
    {
        sut = new JobsController(mockJobTracker.Object, mockStorage.Object);
        SetupAuthenticatedUser(TestUserId);
    }

    // ===== ListJobs =====
    [Fact]
    public async Task ListJobs_ReturnsOk_WithJobsForAuthenticatedUser()
    {
        var jobs = new List<JobStatus>
        {
            new() { JobId = "job-1", OwnerUserId = TestUserId, JobType = JobTypes.Import },
            new() { JobId = "job-2", OwnerUserId = TestUserId, JobType = JobTypes.Composite },
        };
        mockJobTracker
            .Setup(t => t.GetJobsForUserAsync(TestUserId, null, null))
            .ReturnsAsync(jobs);

        var result = await sut.ListJobs();

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        var returnedJobs = okResult.Value.Should().BeAssignableTo<List<JobStatus>>().Subject;
        returnedJobs.Should().HaveCount(2);
    }

    [Fact]
    public async Task ListJobs_PassesFiltersToTracker()
    {
        mockJobTracker
            .Setup(t => t.GetJobsForUserAsync(TestUserId, JobStates.Running, JobTypes.Import))
            .ReturnsAsync([]);

        await sut.ListJobs(status: JobStates.Running, type: JobTypes.Import);

        mockJobTracker.Verify(
            t => t.GetJobsForUserAsync(TestUserId, JobStates.Running, JobTypes.Import),
            Times.Once);
    }

    [Fact]
    public async Task ListJobs_ReturnsUnauthorized_WhenNoUserClaim()
    {
        SetupUnauthenticatedUser();

        var result = await sut.ListJobs();

        result.Should().BeOfType<UnauthorizedResult>();
    }

    // ===== GetJob =====
    [Fact]
    public async Task GetJob_ReturnsOk_ForOwner()
    {
        var job = new JobStatus { JobId = "job-1", OwnerUserId = TestUserId };
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-1", TestUserId))
            .ReturnsAsync(job);

        var result = await sut.GetJob("job-1");

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        var returned = okResult.Value.Should().BeOfType<JobStatus>().Subject;
        returned.JobId.Should().Be("job-1");
    }

    [Fact]
    public async Task GetJob_ReturnsNotFound_WhenJobDoesNotExist()
    {
        mockJobTracker
            .Setup(t => t.GetJobAsync("nonexistent", TestUserId))
            .ReturnsAsync((JobStatus?)null);

        var result = await sut.GetJob("nonexistent");

        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetJob_ReturnsNotFound_WhenDifferentOwner()
    {
        // GetJobAsync enforces ownership internally and returns null for non-owners.
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-1", TestUserId))
            .ReturnsAsync((JobStatus?)null);

        var result = await sut.GetJob("job-1");

        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetJob_ReturnsUnauthorized_WhenNoUserClaim()
    {
        SetupUnauthenticatedUser();

        var result = await sut.GetJob("job-1");

        result.Should().BeOfType<UnauthorizedResult>();
    }

    // ===== CancelJob =====
    [Fact]
    public async Task CancelJob_ReturnsNoContent_OnSuccess()
    {
        mockJobTracker
            .Setup(t => t.CancelJobAsync("job-1", TestUserId))
            .ReturnsAsync(true);

        var result = await sut.CancelJob("job-1");

        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task CancelJob_ReturnsNotFound_WhenCancelFails()
    {
        mockJobTracker
            .Setup(t => t.CancelJobAsync("job-1", TestUserId))
            .ReturnsAsync(false);

        var result = await sut.CancelJob("job-1");

        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task CancelJob_ReturnsUnauthorized_WhenNoUserClaim()
    {
        SetupUnauthenticatedUser();

        var result = await sut.CancelJob("job-1");

        result.Should().BeOfType<UnauthorizedResult>();
    }

    // ===== GetResult =====
    [Fact]
    public async Task GetResult_ReturnsFile_ForBlobResult()
    {
        var job = new JobStatus
        {
            JobId = "job-1",
            OwnerUserId = TestUserId,
            State = JobStates.Completed,
            ResultKind = ResultKinds.Blob,
            ResultStorageKey = "results/composite.png",
            ResultContentType = "image/png",
            ResultFilename = "composite.png",
        };
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-1", TestUserId))
            .ReturnsAsync(job);
        mockJobTracker
            .Setup(t => t.RecordResultAccessAsync("job-1"))
            .Returns(Task.CompletedTask);
        mockStorage
            .Setup(s => s.ExistsAsync("results/composite.png", It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        mockStorage
            .Setup(s => s.ReadStreamAsync("results/composite.png", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryStream([0x89, 0x50, 0x4E, 0x47]));

        var result = await sut.GetResult("job-1");

        var fileResult = result.Should().BeOfType<FileStreamResult>().Subject;
        fileResult.ContentType.Should().Be("image/png");
        fileResult.FileDownloadName.Should().Be("composite.png");
    }

    [Fact]
    public async Task GetResult_ReturnsDataId_ForDataIdResult()
    {
        var job = new JobStatus
        {
            JobId = "job-1",
            OwnerUserId = TestUserId,
            State = JobStates.Completed,
            ResultKind = ResultKinds.DataId,
            ResultDataId = "data-abc-123",
        };
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-1", TestUserId))
            .ReturnsAsync(job);
        mockJobTracker
            .Setup(t => t.RecordResultAccessAsync("job-1"))
            .Returns(Task.CompletedTask);

        var result = await sut.GetResult("job-1");

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;

        // The anonymous object should contain resultKind and dataId.
        var json = System.Text.Json.JsonSerializer.Serialize(okResult.Value);
        json.Should().Contain("data_id");
        json.Should().Contain("data-abc-123");
    }

    [Fact]
    public async Task GetResult_ExtendsTtl_OnDataIdAccess()
    {
        var job = new JobStatus
        {
            JobId = "job-1",
            OwnerUserId = TestUserId,
            State = JobStates.Completed,
            ResultKind = ResultKinds.DataId,
            ResultDataId = "data-abc-123",
        };
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-1", TestUserId))
            .ReturnsAsync(job);
        mockJobTracker
            .Setup(t => t.RecordResultAccessAsync("job-1"))
            .Returns(Task.CompletedTask);

        await sut.GetResult("job-1");

        mockJobTracker.Verify(
            t => t.RecordResultAccessAsync("job-1"),
            Times.Once);
    }

    [Fact]
    public async Task GetResult_ReturnsBadRequest_WhenJobNotCompleted()
    {
        var job = new JobStatus
        {
            JobId = "job-1",
            OwnerUserId = TestUserId,
            State = JobStates.Running,
        };
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-1", TestUserId))
            .ReturnsAsync(job);

        var result = await sut.GetResult("job-1");

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetResult_ReturnsNotFound_WhenJobDoesNotExist()
    {
        mockJobTracker
            .Setup(t => t.GetJobAsync("nonexistent", TestUserId))
            .ReturnsAsync((JobStatus?)null);

        var result = await sut.GetResult("nonexistent");

        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetResult_ReturnsNotFound_WhenNoStorageKey()
    {
        var job = new JobStatus
        {
            JobId = "job-1",
            OwnerUserId = TestUserId,
            State = JobStates.Completed,
            ResultKind = ResultKinds.Blob,
            ResultStorageKey = null,
        };
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-1", TestUserId))
            .ReturnsAsync(job);

        var result = await sut.GetResult("job-1");

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetResult_ReturnsNotFound_WhenStorageFileExpired()
    {
        var job = new JobStatus
        {
            JobId = "job-1",
            OwnerUserId = TestUserId,
            State = JobStates.Completed,
            ResultKind = ResultKinds.Blob,
            ResultStorageKey = "results/gone.png",
            ResultContentType = "image/png",
            ResultFilename = "gone.png",
        };
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-1", TestUserId))
            .ReturnsAsync(job);
        mockJobTracker
            .Setup(t => t.RecordResultAccessAsync("job-1"))
            .Returns(Task.CompletedTask);
        mockStorage
            .Setup(s => s.ExistsAsync("results/gone.png", It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var result = await sut.GetResult("job-1");

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetResult_ReturnsUnauthorized_WhenNoUserClaim()
    {
        SetupUnauthenticatedUser();

        var result = await sut.GetResult("job-1");

        result.Should().BeOfType<UnauthorizedResult>();
    }

    [Fact]
    public async Task GetResult_ExtendsTtl_OnBlobAccess()
    {
        var job = new JobStatus
        {
            JobId = "job-1",
            OwnerUserId = TestUserId,
            State = JobStates.Completed,
            ResultKind = ResultKinds.Blob,
            ResultStorageKey = "results/composite.png",
            ResultContentType = "image/png",
            ResultFilename = "composite.png",
        };
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-1", TestUserId))
            .ReturnsAsync(job);
        mockJobTracker
            .Setup(t => t.RecordResultAccessAsync("job-1"))
            .Returns(Task.CompletedTask);
        mockStorage
            .Setup(s => s.ExistsAsync("results/composite.png", It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        mockStorage
            .Setup(s => s.ReadStreamAsync("results/composite.png", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryStream([]));

        await sut.GetResult("job-1");

        mockJobTracker.Verify(
            t => t.RecordResultAccessAsync("job-1"),
            Times.Once);
    }

    [Fact]
    public async Task GetResult_FallsBackToOctetStream_WhenContentTypeNull()
    {
        var job = new JobStatus
        {
            JobId = "job-1",
            OwnerUserId = TestUserId,
            State = JobStates.Completed,
            ResultKind = ResultKinds.Blob,
            ResultStorageKey = "results/file.bin",
            ResultContentType = null,
            ResultFilename = "file.bin",
        };
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-1", TestUserId))
            .ReturnsAsync(job);
        mockJobTracker
            .Setup(t => t.RecordResultAccessAsync("job-1"))
            .Returns(Task.CompletedTask);
        mockStorage
            .Setup(s => s.ExistsAsync("results/file.bin", It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        mockStorage
            .Setup(s => s.ReadStreamAsync("results/file.bin", It.IsAny<CancellationToken>()))
            .ReturnsAsync(new MemoryStream([]));

        var result = await sut.GetResult("job-1");

        var fileResult = result.Should().BeOfType<FileStreamResult>().Subject;
        fileResult.ContentType.Should().Be("application/octet-stream");
    }

    // ===== Helpers =====

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
    /// Sets up a mock HttpContext with an unauthenticated user (no claims).
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
