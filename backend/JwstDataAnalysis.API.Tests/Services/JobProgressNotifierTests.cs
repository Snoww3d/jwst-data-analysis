// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;
using JwstDataAnalysis.API.Hubs;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.AspNetCore.SignalR;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for JobProgressNotifier — verifies it sends to the correct
/// SignalR groups/clients with the correct event names.
/// </summary>
public class JobProgressNotifierTests
{
    private readonly Mock<IHubContext<JobProgressHub>> mockHubContext = new();
    private readonly Mock<IHubClients> mockClients = new();
    private readonly Mock<ISingleClientProxy> mockGroupProxy = new();
    private readonly Mock<ISingleClientProxy> mockClientProxy = new();
    private readonly JobProgressNotifier sut;

    public JobProgressNotifierTests()
    {
        mockHubContext.Setup(h => h.Clients).Returns(mockClients.Object);
        sut = new JobProgressNotifier(mockHubContext.Object);
    }

    [Fact]
    public async Task NotifyProgressAsync_SendsToCorrectGroup()
    {
        var update = new JobProgressUpdate
        {
            JobId = "abc123",
            JobType = "composite",
            State = "running",
            ProgressPercent = 42,
        };

        mockClients.Setup(c => c.Group("job-abc123")).Returns(mockGroupProxy.Object);

        await sut.NotifyProgressAsync(update);

        mockGroupProxy.Verify(
            p => p.SendCoreAsync("JobProgress", It.Is<object?[]>(args => args.Length == 1 && args[0] == update), default),
            Times.Once);
    }

    [Fact]
    public async Task NotifyCompletedAsync_SendsToCorrectGroup()
    {
        var update = new JobCompletionUpdate
        {
            JobId = "def456",
            JobType = "mosaic",
            Message = "Done",
        };

        mockClients.Setup(c => c.Group("job-def456")).Returns(mockGroupProxy.Object);

        await sut.NotifyCompletedAsync(update);

        mockGroupProxy.Verify(
            p => p.SendCoreAsync("JobCompleted", It.Is<object?[]>(args => args.Length == 1 && args[0] == update), default),
            Times.Once);
    }

    [Fact]
    public async Task NotifyFailedAsync_SendsToCorrectGroup()
    {
        var update = new JobFailureUpdate
        {
            JobId = "ghi789",
            JobType = "import",
            Error = "Something broke",
        };

        mockClients.Setup(c => c.Group("job-ghi789")).Returns(mockGroupProxy.Object);

        await sut.NotifyFailedAsync(update);

        mockGroupProxy.Verify(
            p => p.SendCoreAsync("JobFailed", It.Is<object?[]>(args => args.Length == 1 && args[0] == update), default),
            Times.Once);
    }

    [Fact]
    public async Task SendSnapshotAsync_SendsToSpecificConnection()
    {
        var snapshot = new JobSnapshotUpdate
        {
            JobId = "snap1",
            JobType = "composite",
            State = "running",
            ProgressPercent = 75,
        };

        mockClients.Setup(c => c.Client("conn-id-42")).Returns(mockClientProxy.Object);

        await sut.SendSnapshotAsync("conn-id-42", snapshot);

        mockClientProxy.Verify(
            p => p.SendCoreAsync("JobSnapshot", It.Is<object?[]>(args => args.Length == 1 && args[0] == snapshot), default),
            Times.Once);
    }

    [Fact]
    public async Task NotifyProgressAsync_DifferentJobIds_SendToDifferentGroups()
    {
        var mockGroup1 = new Mock<ISingleClientProxy>();
        var mockGroup2 = new Mock<ISingleClientProxy>();

        mockClients.Setup(c => c.Group("job-aaa")).Returns(mockGroup1.Object);
        mockClients.Setup(c => c.Group("job-bbb")).Returns(mockGroup2.Object);

        await sut.NotifyProgressAsync(new JobProgressUpdate { JobId = "aaa", State = "running" });
        await sut.NotifyProgressAsync(new JobProgressUpdate { JobId = "bbb", State = "running" });

        mockGroup1.Verify(p => p.SendCoreAsync("JobProgress", It.IsAny<object?[]>(), default), Times.Once);
        mockGroup2.Verify(p => p.SendCoreAsync("JobProgress", It.IsAny<object?[]>(), default), Times.Once);
    }
}
