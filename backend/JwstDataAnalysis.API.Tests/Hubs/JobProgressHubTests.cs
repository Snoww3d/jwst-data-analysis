// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using FluentAssertions;
using JwstDataAnalysis.API.Hubs;

using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Hubs;

/// <summary>
/// Unit tests for JobProgressHub — verifies auth enforcement and group management.
/// </summary>
public class JobProgressHubTests : IDisposable
{
    private readonly Mock<IGroupManager> mockGroups = new();
    private readonly Mock<ILogger<JobProgressHub>> mockLogger = new();
    private readonly JobProgressHub sut;

    public JobProgressHubTests()
    {
        sut = new JobProgressHub(mockLogger.Object);
    }

    [Fact]
    public async Task SubscribeToJob_WithAuthenticatedUser_AddsToGroup()
    {
        SetupHubContext("user-1");

        await sut.SubscribeToJob("job-123");

        mockGroups.Verify(g => g.AddToGroupAsync("conn-1", "job-job-123", default), Times.Once);
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

        await sut.SubscribeToJob("job-789");

        mockGroups.Verify(g => g.AddToGroupAsync("conn-1", "job-job-789", default), Times.Once);
    }

    public void Dispose()
    {
        sut.Dispose();
        GC.SuppressFinalize(this);
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

        // Use reflection to set Hub.Context and Hub.Groups (they're set by SignalR normally)
        typeof(Hub).GetProperty("Context")!.SetValue(sut, mockContext.Object);
        typeof(Hub).GetProperty("Groups")!.SetValue(sut, mockGroups.Object);
    }
}
