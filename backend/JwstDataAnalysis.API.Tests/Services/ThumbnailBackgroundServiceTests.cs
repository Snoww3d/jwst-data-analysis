// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Services;

using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for ThumbnailQueue and ThumbnailBackgroundService.
/// Verifies queue behavior, batch processing, and failure resilience.
/// </summary>
public class ThumbnailBackgroundServiceTests
{
    private readonly ThumbnailQueue queue;
    private readonly Mock<IThumbnailService> mockThumbnailService;
    private readonly Mock<ILogger<ThumbnailBackgroundService>> mockLogger;
    private readonly ThumbnailBackgroundService sut;

    public ThumbnailBackgroundServiceTests()
    {
        queue = new ThumbnailQueue();
        mockThumbnailService = new Mock<IThumbnailService>();
        mockLogger = new Mock<ILogger<ThumbnailBackgroundService>>();

        sut = new ThumbnailBackgroundService(queue, mockThumbnailService.Object, mockLogger.Object);
    }

    [Fact]
    public async Task ProcessesBatchFromQueue()
    {
        // Arrange
        var ids = new List<string> { "id-1", "id-2", "id-3" };
        mockThumbnailService
            .Setup(s => s.GenerateThumbnailsForIdsAsync(ids))
            .Returns(Task.CompletedTask);

        queue.EnqueueBatch(ids);

        using var cts = new CancellationTokenSource();

        // Act — start the service, let it process one batch, then cancel
        var serviceTask = sut.StartAsync(cts.Token);
        await Task.Delay(200);
        cts.Cancel();

        try { await sut.StopAsync(CancellationToken.None); }
        catch (OperationCanceledException) { /* expected */ }

        // Assert
        mockThumbnailService.Verify(
            s => s.GenerateThumbnailsForIdsAsync(ids),
            Times.Once);
    }

    [Fact]
    public async Task ContinuesAfterBatchFailure()
    {
        // Arrange — first batch throws, second batch should still be processed
        var failBatch = new List<string> { "fail-1" };
        var okBatch = new List<string> { "ok-1" };

        mockThumbnailService
            .Setup(s => s.GenerateThumbnailsForIdsAsync(failBatch))
            .ThrowsAsync(new InvalidOperationException("test error"));
        mockThumbnailService
            .Setup(s => s.GenerateThumbnailsForIdsAsync(okBatch))
            .Returns(Task.CompletedTask);

        queue.EnqueueBatch(failBatch);
        queue.EnqueueBatch(okBatch);

        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await Task.Delay(300);
        cts.Cancel();

        try { await sut.StopAsync(CancellationToken.None); }
        catch (OperationCanceledException) { /* expected */ }

        // Assert — both batches were attempted
        mockThumbnailService.Verify(
            s => s.GenerateThumbnailsForIdsAsync(failBatch),
            Times.Once);
        mockThumbnailService.Verify(
            s => s.GenerateThumbnailsForIdsAsync(okBatch),
            Times.Once);
    }

    [Fact]
    public void EmptyListIsNotEnqueued()
    {
        // Act
        queue.EnqueueBatch([]);

        // Assert
        queue.PendingCount.Should().Be(0);
    }

    [Fact]
    public void PendingCountReflectsBatches()
    {
        // Act
        queue.EnqueueBatch(new List<string> { "a" });
        queue.EnqueueBatch(new List<string> { "b", "c" });

        // Assert — each EnqueueBatch call is one item in the channel
        queue.PendingCount.Should().Be(2);
    }
}
