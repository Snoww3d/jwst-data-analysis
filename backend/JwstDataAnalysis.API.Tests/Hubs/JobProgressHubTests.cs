// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using FluentAssertions;
using JwstDataAnalysis.API.Hubs;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Hubs;

/// <summary>
/// Unit tests for JobProgressHub — verifies auth enforcement, ownership, and group management.
/// </summary>
public class JobProgressHubTests : IDisposable
{
    private readonly Mock<IGroupManager> mockGroups = new();
    private readonly Mock<ILogger<JobProgressHub>> mockLogger = new();
    private readonly Mock<IJobTracker> mockJobTracker = new();
    private readonly Mock<IHubCallerClients> mockClients = new();
    private readonly Mock<ISingleClientProxy> mockCallerProxy = new();
    private readonly JobProgressHub sut;

    public JobProgressHubTests()
    {
        mockClients.Setup(c => c.Caller).Returns(mockCallerProxy.Object);
        sut = new JobProgressHub(mockLogger.Object, mockJobTracker.Object);
    }

    [Fact]
    public async Task SubscribeToJob_WithAuthenticatedOwner_AddsToGroup()
    {
        SetupHubContext("user-1");
        SetupJobOwnership("job-123", "user-1");

        await sut.SubscribeToJob("job-123");

        mockGroups.Verify(g => g.AddToGroupAsync("conn-1", "job-job-123", default), Times.Once);
    }

    [Fact]
    public async Task SubscribeToJob_SendsSnapshotToCaller()
    {
        SetupHubContext("user-1");
        SetupJobOwnership("job-123", "user-1", state: JobStates.Running, progressPercent: 10, stage: "generating", message: "Generating composite image...");

        JobSnapshotUpdate? capturedSnapshot = null;
        mockCallerProxy
            .Setup(c => c.SendCoreAsync("JobSnapshot", It.IsAny<object?[]>(), default))
            .Callback<string, object?[], CancellationToken>((_, args, _) =>
            {
                if (args.Length > 0)
                {
                    capturedSnapshot = args[0] as JobSnapshotUpdate;
                }
            })
            .Returns(Task.CompletedTask);

        await sut.SubscribeToJob("job-123");

        capturedSnapshot.Should().NotBeNull();
        capturedSnapshot!.JobId.Should().Be("job-123");
        capturedSnapshot.State.Should().Be(JobStates.Running);
        capturedSnapshot.ProgressPercent.Should().Be(10);
        capturedSnapshot.Stage.Should().Be("generating");
    }

    [Fact]
    public async Task SubscribeToJob_WithoutUser_ThrowsHubException()
    {
        SetupHubContext(null);

        var act = () => sut.SubscribeToJob("job-123");

        await act.Should().ThrowAsync<HubException>()
            .WithMessage("Authentication required.");
    }

    [Fact]
    public async Task SubscribeToJob_EmptyJobId_ThrowsHubException()
    {
        SetupHubContext("user-1");

        var act = () => sut.SubscribeToJob(string.Empty);

        await act.Should().ThrowAsync<HubException>()
            .WithMessage("Job ID is required.");
    }

    [Fact]
    public async Task SubscribeToJob_WhitespaceJobId_ThrowsHubException()
    {
        SetupHubContext("user-1");

        var act = () => sut.SubscribeToJob("   ");

        await act.Should().ThrowAsync<HubException>()
            .WithMessage("Job ID is required.");
    }

    [Fact]
    public async Task SubscribeToJob_NonOwner_ThrowsHubException()
    {
        SetupHubContext("user-2");

        // GetJobAsync returns null for non-owners
        mockJobTracker
            .Setup(t => t.GetJobAsync("job-123", "user-2"))
            .ReturnsAsync((JobStatus?)null);

        var act = () => sut.SubscribeToJob("job-123");

        await act.Should().ThrowAsync<HubException>()
            .WithMessage("Job not found or access denied.");
    }

    [Fact]
    public async Task SubscribeToJob_NonexistentJob_ThrowsHubException()
    {
        SetupHubContext("user-1");

        mockJobTracker
            .Setup(t => t.GetJobAsync("nonexistent", "user-1"))
            .ReturnsAsync((JobStatus?)null);

        var act = () => sut.SubscribeToJob("nonexistent");

        await act.Should().ThrowAsync<HubException>()
            .WithMessage("Job not found or access denied.");
    }

    [Fact]
    public async Task UnsubscribeFromJob_RemovesFromGroup()
    {
        SetupHubContext("user-1");

        await sut.UnsubscribeFromJob("job-456");

        mockGroups.Verify(g => g.RemoveFromGroupAsync("conn-1", "job-job-456", default), Times.Once);
    }

    [Fact]
    public async Task UnsubscribeFromJob_EmptyJobId_ThrowsHubException()
    {
        SetupHubContext("user-1");

        var act = () => sut.UnsubscribeFromJob(string.Empty);

        await act.Should().ThrowAsync<HubException>()
            .WithMessage("Job ID is required.");
    }

    [Fact]
    public async Task SubscribeToJob_UsesSubClaimAsFallback()
    {
        var mockContext = new Mock<HubCallerContext>();
        mockContext.Setup(c => c.ConnectionId).Returns("conn-1");

        // Use "sub" claim instead of NameIdentifier
        var claims = new[] { new Claim("sub", "user-sub-1") };
        var identity = new ClaimsIdentity(claims, "test");
        var principal = new ClaimsPrincipal(identity);
        mockContext.Setup(c => c.User).Returns(principal);

        typeof(Hub).GetProperty("Context")!.SetValue(sut, mockContext.Object);
        typeof(Hub).GetProperty("Groups")!.SetValue(sut, mockGroups.Object);
        typeof(Hub).GetProperty("Clients")!.SetValue(sut, mockClients.Object);

        SetupJobOwnership("job-789", "user-sub-1");

        await sut.SubscribeToJob("job-789");

        mockGroups.Verify(g => g.AddToGroupAsync("conn-1", "job-job-789", default), Times.Once);
    }

    public void Dispose()
    {
        sut.Dispose();
        GC.SuppressFinalize(this);
    }

    private void SetupJobOwnership(string jobId, string userId, string state = JobStates.Queued, int progressPercent = 0, string? stage = null, string? message = null)
    {
        mockJobTracker
            .Setup(t => t.GetJobAsync(jobId, userId))
            .ReturnsAsync(new JobStatus
            {
                JobId = jobId,
                OwnerUserId = userId,
                State = state,
                ProgressPercent = progressPercent,
                Stage = stage,
                Message = message,
            });
    }

    private void SetupHubContext(string? userId, string connectionId = "conn-1")
    {
        var mockContext = new Mock<HubCallerContext>();
        mockContext.Setup(c => c.ConnectionId).Returns(connectionId);

        if (userId is not null)
        {
            var claims = new[] { new Claim(ClaimTypes.NameIdentifier, userId) };
            var identity = new ClaimsIdentity(claims, "test");
            var principal = new ClaimsPrincipal(identity);
            mockContext.Setup(c => c.User).Returns(principal);
        }
        else
        {
            mockContext.Setup(c => c.User).Returns((ClaimsPrincipal?)null);
        }

        // Use reflection to set Hub.Context, Hub.Groups, and Hub.Clients (they're set by SignalR normally)
        typeof(Hub).GetProperty("Context")!.SetValue(sut, mockContext.Object);
        typeof(Hub).GetProperty("Groups")!.SetValue(sut, mockGroups.Object);
        typeof(Hub).GetProperty("Clients")!.SetValue(sut, mockClients.Object);
    }
}
