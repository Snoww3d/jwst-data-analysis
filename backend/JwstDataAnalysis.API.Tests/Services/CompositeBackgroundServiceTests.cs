// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Services.Storage;

using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for CompositeBackgroundService.
/// </summary>
public class CompositeBackgroundServiceTests : IDisposable
{
    private readonly CompositeQueue queue;
    private readonly Mock<ICompositeService> mockCompositeService;
    private readonly Mock<IJobTracker> mockJobTracker;
    private readonly Mock<IStorageProvider> mockStorageProvider;
    private readonly Mock<ILogger<CompositeBackgroundService>> mockLogger;
    private readonly CompositeBackgroundService sut;

    public CompositeBackgroundServiceTests()
    {
        queue = new CompositeQueue();
        mockCompositeService = new Mock<ICompositeService>();
        mockJobTracker = new Mock<IJobTracker>();
        mockStorageProvider = new Mock<IStorageProvider>();
        mockLogger = new Mock<ILogger<CompositeBackgroundService>>();

        sut = new CompositeBackgroundService(
            queue,
            mockCompositeService.Object,
            mockJobTracker.Object,
            mockStorageProvider.Object,
            mockLogger.Object);
    }

    public void Dispose()
    {
        sut.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task DequeuesAndCallsService()
    {
        // Arrange
        var imageBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 };
        var item = CreateItem("job-1");
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin))
            .ReturnsAsync(imageBytes);

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await Task.Delay(300);
        cts.Cancel();

        try { await sut.StopAsync(CancellationToken.None); }
        catch (OperationCanceledException) { }

        // Assert
        mockJobTracker.Verify(j => j.StartJobAsync("job-1"), Times.Once);
        mockJobTracker.Verify(j => j.UpdateProgressAsync("job-1", 10, "generating", "Generating composite image..."), Times.Once);
        mockCompositeService.Verify(s => s.GenerateNChannelCompositeAsync(
            item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin), Times.Once);
        mockStorageProvider.Verify(s => s.WriteAsync(
            It.Is<string>(k => k.StartsWith("tmp/jobs/job-1/")),
            It.IsAny<Stream>(),
            It.IsAny<CancellationToken>()), Times.Once);
        mockJobTracker.Verify(j => j.CompleteBlobJobAsync(
            "job-1",
            It.Is<string>(k => k.StartsWith("tmp/jobs/job-1/")),
            "image/png",
            "composite-nchannel.png",
            null), Times.Once);
    }

    [Fact]
    public async Task CancelBeforeProcessing_MarksCancelled()
    {
        // Arrange
        var item = CreateItem("job-cancel");
        mockJobTracker.Setup(j => j.IsCancelRequested("job-cancel")).Returns(true);

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await Task.Delay(200);
        cts.Cancel();

        try { await sut.StopAsync(CancellationToken.None); }
        catch (OperationCanceledException) { }

        // Assert
        mockJobTracker.Verify(j => j.FailJobAsync("job-cancel", "Cancelled"), Times.Once);
        mockCompositeService.Verify(s => s.GenerateNChannelCompositeAsync(
            It.IsAny<NChannelCompositeRequestDto>(), It.IsAny<string?>(), It.IsAny<bool>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task CancelAfterProcessing_SkipsStorageWrite()
    {
        // Arrange
        var item = CreateItem("job-cancel-after");
        var callCount = 0;
        mockJobTracker.Setup(j => j.IsCancelRequested("job-cancel-after"))
            .Returns(() =>
            {
                callCount++;
                return callCount > 1; // false first time, true second time
            });
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin))
            .ReturnsAsync(new byte[] { 1, 2, 3 });

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await Task.Delay(300);
        cts.Cancel();

        try { await sut.StopAsync(CancellationToken.None); }
        catch (OperationCanceledException) { }

        // Assert — storage write skipped, job failed as cancelled
        mockStorageProvider.Verify(s => s.WriteAsync(
            It.IsAny<string>(), It.IsAny<Stream>(), It.IsAny<CancellationToken>()), Times.Never);
        mockJobTracker.Verify(j => j.FailJobAsync("job-cancel-after", "Cancelled"), Times.Once);
    }

    [Fact]
    public async Task ServiceError_MarksFailed()
    {
        // Arrange
        var item = CreateItem("job-fail");
        mockCompositeService.Setup(s => s.GenerateNChannelCompositeAsync(
                item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin))
            .ThrowsAsync(new InvalidOperationException("Processing failed"));

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await Task.Delay(300);
        cts.Cancel();

        try { await sut.StopAsync(CancellationToken.None); }
        catch (OperationCanceledException) { }

        // Assert
        mockJobTracker.Verify(j => j.FailJobAsync("job-fail", "Processing failed"), Times.Once);
    }

    private static CompositeJobItem CreateItem(string jobId) => new()
    {
        JobId = jobId,
        Request = new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = ["id1"],
                    Color = new ChannelColorDto { Hue = 0 },
                },
            ],
        },
        UserId = "test-user",
        IsAuthenticated = true,
        IsAdmin = false,
    };
}
