// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;
using JwstDataAnalysis.API.Services;
using Microsoft.Extensions.Logging;
using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for ThumbnailQueue.
/// </summary>
public class ThumbnailQueueTests
{
    private readonly Mock<ILogger<ThumbnailQueue>> logger = new();
    private readonly ThumbnailQueue sut;

    public ThumbnailQueueTests()
    {
        sut = new ThumbnailQueue(logger.Object);
    }

    [Fact]
    public void PendingCount_StartsAtZero()
    {
        sut.PendingCount.Should().Be(0);
    }

    [Fact]
    public async Task EnqueueBatch_IncrementsPendingCount()
    {
        await sut.EnqueueBatchAsync(["id-1", "id-2"]);

        sut.PendingCount.Should().Be(1);
    }

    [Fact]
    public async Task EnqueueBatch_EmptyList_DoesNotEnqueue()
    {
        await sut.EnqueueBatchAsync([]);

        sut.PendingCount.Should().Be(0);
    }

    [Fact]
    public async Task EnqueueBatch_MultipleBatches_IncrementsPendingCountEachTime()
    {
        await sut.EnqueueBatchAsync(["id-1"]);
        await sut.EnqueueBatchAsync(["id-2"]);
        await sut.EnqueueBatchAsync(["id-3"]);

        sut.PendingCount.Should().Be(3);
    }

    [Fact]
    public async Task DecrementPending_DecreasesPendingCount()
    {
        await sut.EnqueueBatchAsync(["id-1"]);
        await sut.EnqueueBatchAsync(["id-2"]);

        sut.DecrementPending();

        sut.PendingCount.Should().Be(1);
    }

    [Fact]
    public async Task EnqueueBatch_WritesToChannel()
    {
        var batch = new List<string> { "id-1", "id-2" };
        await sut.EnqueueBatchAsync(batch);

        var result = await sut.Reader.ReadAsync();

        result.Should().BeEquivalentTo(batch);
    }

    [Fact]
    public async Task Reader_ReturnsMultipleBatchesInOrder()
    {
        await sut.EnqueueBatchAsync(["a"]);
        await sut.EnqueueBatchAsync(["b"]);

        var first = await sut.Reader.ReadAsync();
        var second = await sut.Reader.ReadAsync();

        first.Should().ContainSingle().Which.Should().Be("a");
        second.Should().ContainSingle().Which.Should().Be("b");
    }

    [Fact]
    public async Task EnqueueBatchAsync_WhenFull_WaitsForSpaceWithoutDroppingBatches()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        for (var i = 0; i < 50; i++)
        {
            await sut.EnqueueBatchAsync([$"id-{i}"], timeout.Token);
        }

        var waiting = sut.EnqueueBatchAsync(["id-50"], timeout.Token);
        waiting.IsCompleted.Should().BeFalse();
        sut.Reader.Count.Should().Be(50);
        sut.PendingCount.Should().Be(51);

        var first = await sut.Reader.ReadAsync(timeout.Token);
        first.Should().ContainSingle().Which.Should().Be("id-0");
        sut.DecrementPending();
        await waiting.WaitAsync(timeout.Token);

        for (var i = 1; i <= 50; i++)
        {
            var batch = await sut.Reader.ReadAsync(timeout.Token);
            batch.Should().ContainSingle().Which.Should().Be($"id-{i}");
            sut.DecrementPending();
        }

        sut.Reader.TryRead(out _).Should().BeFalse();
        sut.PendingCount.Should().Be(0);
    }

    [Fact]
    public async Task EnqueueBatchAsync_WhenCancelledWhileFull_DoesNotLeavePhantomBatch()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        for (var i = 0; i < 50; i++)
        {
            await sut.EnqueueBatchAsync(["accepted"], timeout.Token);
        }

        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token);
        var waiting = sut.EnqueueBatchAsync(["cancelled"], cancellation.Token);
        waiting.IsCompleted.Should().BeFalse();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiting.WaitAsync(timeout.Token));
        sut.PendingCount.Should().Be(50);
        for (var i = 0; i < 50; i++)
        {
            var batch = await sut.Reader.ReadAsync(timeout.Token);
            batch.Should().ContainSingle().Which.Should().Be("accepted");
            sut.DecrementPending();
        }

        sut.Reader.TryRead(out _).Should().BeFalse();
        sut.PendingCount.Should().Be(0);
        await sut.EnqueueBatchAsync(["after-cancellation"], timeout.Token);
        sut.PendingCount.Should().Be(1);
    }

    [Fact]
    public async Task EnqueueBatchAsync_NearCapacity_LogsOccupancyWarning()
    {
        logger.Setup(l => l.IsEnabled(LogLevel.Warning)).Returns(true);
        string? warning = null;
        logger.Setup(l => l.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()))
            .Callback(new InvocationAction(invocation =>
            {
                // Generated logging reuses its state; capture before it is cleared.
                var formatter = (Delegate)invocation.Arguments[4];
                warning = (string?)formatter.DynamicInvoke(invocation.Arguments[2], invocation.Arguments[3]);
            }));
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        for (var i = 0; i < 40; i++)
        {
            await sut.EnqueueBatchAsync(["id"], timeout.Token);
        }

        logger.Verify(
            l => l.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Never);

        await sut.EnqueueBatchAsync(["near-capacity"], timeout.Token);

        logger.Verify(
            l => l.Log(
                LogLevel.Warning,
                It.Is<EventId>(id => id.Id == 8005),
                It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
        warning.Should().Contain("40/50");
    }
}
