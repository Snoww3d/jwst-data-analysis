// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for EmbeddingBackgroundService.
/// </summary>
public class EmbeddingBackgroundServiceTests : IDisposable
{
    private readonly EmbeddingQueue queue;
    private readonly Mock<ISemanticSearchService> mockSemanticSearchService;
    private readonly Mock<IJobTracker> mockJobTracker;
    private readonly Mock<ILogger<EmbeddingBackgroundService>> mockLogger;
    private readonly EmbeddingBackgroundService sut;

    public EmbeddingBackgroundServiceTests()
    {
        queue = new EmbeddingQueue();
        mockSemanticSearchService = new Mock<ISemanticSearchService>();
        mockJobTracker = new Mock<IJobTracker>();
        mockLogger = new Mock<ILogger<EmbeddingBackgroundService>>();

        sut = new EmbeddingBackgroundService(
            queue,
            mockSemanticSearchService.Object,
            mockJobTracker.Object,
            mockLogger.Object);
    }

    public void Dispose()
    {
        sut.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task BatchEmbed_DequeuesAndCallsEmbedBatchAsync()
    {
        // Arrange
        var fileIds = new List<string> { "file-1", "file-2", "file-3" };
        var item = CreateItem("job-1", fileIds, isFullReindex: false);
        var embedResult = new EmbedBatchResponse { EmbeddedCount = 3, TotalIndexed = 10 };
        var completed = new TaskCompletionSource<bool>();

        mockSemanticSearchService
            .Setup(s => s.EmbedBatchAsync(fileIds))
            .ReturnsAsync(embedResult);
        mockJobTracker
            .Setup(j => j.CompleteJobAsync("job-1", It.IsAny<string?>()))
            .Callback(() => completed.TrySetResult(true))
            .Returns(Task.CompletedTask);

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await completed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cts.Cancel();

        try
        {
            await sut.StopAsync(CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            // expected
        }

        // Assert
        mockJobTracker.Verify(j => j.StartJobAsync("job-1"), Times.Once);
        mockJobTracker.Verify(
            j => j.UpdateProgressAsync("job-1", 10, "embedding", "Building semantic index..."),
            Times.Once);
        mockSemanticSearchService.Verify(s => s.EmbedBatchAsync(fileIds), Times.Once);
        mockSemanticSearchService.Verify(s => s.ReindexAllAsync(), Times.Never);
        mockJobTracker.Verify(
            j => j.UpdateProgressAsync("job-1", 100, "complete", "Indexed 3 files (10 total)"),
            Times.Once);
        mockJobTracker.Verify(
            j => j.CompleteJobAsync("job-1", "Embedded 3 files. Total indexed: 10"),
            Times.Once);
    }

    [Fact]
    public async Task FullReindex_DequeuesAndCallsReindexAllAsync()
    {
        // Arrange
        var item = CreateItem("job-reindex", [], isFullReindex: true);
        var embedResult = new EmbedBatchResponse { EmbeddedCount = 50, TotalIndexed = 50 };
        var completed = new TaskCompletionSource<bool>();

        mockSemanticSearchService
            .Setup(s => s.ReindexAllAsync())
            .ReturnsAsync(embedResult);
        mockJobTracker
            .Setup(j => j.CompleteJobAsync("job-reindex", It.IsAny<string?>()))
            .Callback(() => completed.TrySetResult(true))
            .Returns(Task.CompletedTask);

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await completed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cts.Cancel();

        try
        {
            await sut.StopAsync(CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            // expected
        }

        // Assert
        mockSemanticSearchService.Verify(s => s.ReindexAllAsync(), Times.Once);
        mockSemanticSearchService.Verify(s => s.EmbedBatchAsync(It.IsAny<List<string>>()), Times.Never);
        mockJobTracker.Verify(
            j => j.CompleteJobAsync("job-reindex", "Embedded 50 files. Total indexed: 50"),
            Times.Once);
    }

    [Fact]
    public async Task CancelBeforeProcessing_MarksCancelled()
    {
        // Arrange
        var item = CreateItem("job-cancel", ["file-1"], isFullReindex: false);
        var completed = new TaskCompletionSource<bool>();

        mockJobTracker.Setup(j => j.IsCancelRequested("job-cancel")).Returns(true);
        mockJobTracker
            .Setup(j => j.FailJobAsync("job-cancel", "Cancelled"))
            .Callback(() => completed.TrySetResult(true))
            .Returns(Task.CompletedTask);

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await completed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cts.Cancel();

        try
        {
            await sut.StopAsync(CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            // expected
        }

        // Assert
        mockJobTracker.Verify(j => j.FailJobAsync("job-cancel", "Cancelled"), Times.Once);
        mockJobTracker.Verify(j => j.StartJobAsync(It.IsAny<string>()), Times.Never);
        mockSemanticSearchService.Verify(s => s.EmbedBatchAsync(It.IsAny<List<string>>()), Times.Never);
        mockSemanticSearchService.Verify(s => s.ReindexAllAsync(), Times.Never);
    }

    [Fact]
    public async Task EmbedBatchThrows_MarksJobFailed()
    {
        // Arrange
        var fileIds = new List<string> { "file-1" };
        var item = CreateItem("job-fail", fileIds, isFullReindex: false);
        var completed = new TaskCompletionSource<bool>();

        mockSemanticSearchService
            .Setup(s => s.EmbedBatchAsync(fileIds))
            .ThrowsAsync(new HttpRequestException("Python engine unavailable"));
        mockJobTracker
            .Setup(j => j.FailJobAsync("job-fail", It.IsAny<string>()))
            .Callback(() => completed.TrySetResult(true))
            .Returns(Task.CompletedTask);

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await completed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cts.Cancel();

        try
        {
            await sut.StopAsync(CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            // expected
        }

        // Assert
        mockJobTracker.Verify(
            j => j.FailJobAsync("job-fail", "Python engine unavailable"),
            Times.Once);
        mockJobTracker.Verify(j => j.CompleteJobAsync(It.IsAny<string>(), It.IsAny<string?>()), Times.Never);
    }

    [Fact]
    public async Task ReindexAllThrows_MarksJobFailed()
    {
        // Arrange
        var item = CreateItem("job-reindex-fail", [], isFullReindex: true);
        var completed = new TaskCompletionSource<bool>();

        mockSemanticSearchService
            .Setup(s => s.ReindexAllAsync())
            .ThrowsAsync(new InvalidOperationException("Index corrupted"));
        mockJobTracker
            .Setup(j => j.FailJobAsync("job-reindex-fail", It.IsAny<string>()))
            .Callback(() => completed.TrySetResult(true))
            .Returns(Task.CompletedTask);

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await completed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cts.Cancel();

        try
        {
            await sut.StopAsync(CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            // expected
        }

        // Assert
        mockJobTracker.Verify(
            j => j.FailJobAsync("job-reindex-fail", "Index corrupted"),
            Times.Once);
    }

    [Fact]
    public async Task FirstJobFails_SecondJobStillProcessed()
    {
        // Arrange
        var failItem = CreateItem("job-fail-first", ["file-fail"], isFullReindex: false);
        var okItem = CreateItem("job-ok-second", ["file-ok"], isFullReindex: false);
        var okResult = new EmbedBatchResponse { EmbeddedCount = 1, TotalIndexed = 5 };
        var completed = new TaskCompletionSource<bool>();

        mockSemanticSearchService
            .Setup(s => s.EmbedBatchAsync(new List<string> { "file-fail" }))
            .ThrowsAsync(new InvalidOperationException("fail"));
        mockSemanticSearchService
            .Setup(s => s.EmbedBatchAsync(new List<string> { "file-ok" }))
            .ReturnsAsync(okResult);
        mockJobTracker
            .Setup(j => j.CompleteJobAsync("job-ok-second", It.IsAny<string?>()))
            .Callback(() => completed.TrySetResult(true))
            .Returns(Task.CompletedTask);

        queue.TryEnqueue(failItem);
        queue.TryEnqueue(okItem);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await completed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cts.Cancel();

        try
        {
            await sut.StopAsync(CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            // expected
        }

        // Assert
        mockJobTracker.Verify(j => j.FailJobAsync("job-fail-first", It.IsAny<string>()), Times.Once);
        mockJobTracker.Verify(j => j.CompleteJobAsync("job-ok-second", It.IsAny<string?>()), Times.Once);
    }

    [Fact]
    public async Task ServiceCancellation_StopsProcessingNewItems()
    {
        // Arrange — no items in queue; cancel immediately
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        // Act
        var act = async () =>
        {
            await sut.StartAsync(cts.Token);
            try
            {
                await sut.StopAsync(CancellationToken.None);
            }
            catch (OperationCanceledException)
            {
                // expected
            }
        };

        // Assert
        await act.Should().NotThrowAsync();
        mockSemanticSearchService.Verify(s => s.EmbedBatchAsync(It.IsAny<List<string>>()), Times.Never);
        mockSemanticSearchService.Verify(s => s.ReindexAllAsync(), Times.Never);
    }

    [Fact]
    public async Task BatchEmbed_ZeroResults_CompletesSuccessfully()
    {
        // Arrange
        var fileIds = new List<string> { "file-1" };
        var item = CreateItem("job-zero", fileIds, isFullReindex: false);
        var embedResult = new EmbedBatchResponse { EmbeddedCount = 0, TotalIndexed = 0 };
        var completed = new TaskCompletionSource<bool>();

        mockSemanticSearchService
            .Setup(s => s.EmbedBatchAsync(fileIds))
            .ReturnsAsync(embedResult);
        mockJobTracker
            .Setup(j => j.CompleteJobAsync("job-zero", It.IsAny<string?>()))
            .Callback(() => completed.TrySetResult(true))
            .Returns(Task.CompletedTask);

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await completed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cts.Cancel();

        try
        {
            await sut.StopAsync(CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            // expected
        }

        // Assert
        mockJobTracker.Verify(
            j => j.UpdateProgressAsync("job-zero", 100, "complete", "Indexed 0 files (0 total)"),
            Times.Once);
        mockJobTracker.Verify(
            j => j.CompleteJobAsync("job-zero", "Embedded 0 files. Total indexed: 0"),
            Times.Once);
    }

    private static EmbeddingJobItem CreateItem(string jobId, List<string> fileIds, bool isFullReindex) => new()
    {
        JobId = jobId,
        FileIds = fileIds,
        IsFullReindex = isFullReindex,
    };
}
