// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Services;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for StartupScanBackgroundService.
/// Uses the internal InitialDelay seam to eliminate the 5-second startup wait,
/// and drives ExecuteAsync directly via reflection.
/// </summary>
public class StartupScanBackgroundServiceTests : IDisposable
{
    private readonly Mock<IServiceScopeFactory> mockScopeFactory;
    private readonly Mock<IServiceScope> mockScope;
    private readonly Mock<IServiceProvider> mockServiceProvider;
    private readonly Mock<IDataScanService> mockDataScanService;
    private readonly Mock<IMongoDBService> mockMongoDBService;
    private readonly Mock<IThumbnailQueue> mockThumbnailQueue;
    private readonly Mock<ILogger<StartupScanBackgroundService>> mockLogger;
    private readonly StartupScanBackgroundService sut;

    public StartupScanBackgroundServiceTests()
    {
        mockScopeFactory = new Mock<IServiceScopeFactory>();
        mockScope = new Mock<IServiceScope>();
        mockServiceProvider = new Mock<IServiceProvider>();
        mockDataScanService = new Mock<IDataScanService>();
        mockMongoDBService = new Mock<IMongoDBService>();
        mockThumbnailQueue = new Mock<IThumbnailQueue>();
        mockLogger = new Mock<ILogger<StartupScanBackgroundService>>();

        mockScopeFactory
            .Setup(f => f.CreateScope())
            .Returns(mockScope.Object);
        mockScope
            .Setup(s => s.ServiceProvider)
            .Returns(mockServiceProvider.Object);

        // GetRequiredService<T> calls GetService internally.
        mockServiceProvider
            .Setup(p => p.GetService(typeof(IDataScanService)))
            .Returns(mockDataScanService.Object);
        mockServiceProvider
            .Setup(p => p.GetService(typeof(IMongoDBService)))
            .Returns(mockMongoDBService.Object);

        sut = new StartupScanBackgroundService(
            mockScopeFactory.Object,
            mockThumbnailQueue.Object,
            mockLogger.Object)
        {
            InitialDelay = TimeSpan.Zero,
        };
    }

    public void Dispose()
    {
        sut.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task ExecuteAsync_ScanSucceeds_EnqueuesMissingThumbnails()
    {
        // Arrange
        var scanResult = new BulkImportResponse { ImportedCount = 3, SkippedCount = 1, ErrorCount = 0 };
        var missingThumbnailIds = new List<string> { "id-1", "id-2" };

        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ReturnsAsync(scanResult);
        mockMongoDBService
            .Setup(m => m.GetViewableWithoutThumbnailIdsAsync())
            .ReturnsAsync(missingThumbnailIds);

        // Act
        await RunAsync();

        // Assert
        mockDataScanService.Verify(s => s.ScanAndImportAsync(), Times.Once);
        mockMongoDBService.Verify(m => m.GetViewableWithoutThumbnailIdsAsync(), Times.Once);
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(missingThumbnailIds), Times.Once);
    }

    [Fact]
    public async Task ExecuteAsync_NoMissingThumbnails_DoesNotEnqueue()
    {
        // Arrange
        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ReturnsAsync(new BulkImportResponse { ImportedCount = 0, SkippedCount = 5, ErrorCount = 0 });
        mockMongoDBService
            .Setup(m => m.GetViewableWithoutThumbnailIdsAsync())
            .ReturnsAsync(new List<string>());

        // Act
        await RunAsync();

        // Assert
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(It.IsAny<List<string>>()), Times.Never);
    }

    [Fact]
    public async Task ExecuteAsync_AllSkipped_StillRunsPhase2()
    {
        // Arrange — nothing imported but phase 2 (thumbnail check) should still run
        var thumbnailIds = new List<string> { "id-existing" };
        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ReturnsAsync(new BulkImportResponse { ImportedCount = 0, SkippedCount = 10, ErrorCount = 0 });
        mockMongoDBService
            .Setup(m => m.GetViewableWithoutThumbnailIdsAsync())
            .ReturnsAsync(thumbnailIds);

        // Act
        await RunAsync();

        // Assert
        mockMongoDBService.Verify(m => m.GetViewableWithoutThumbnailIdsAsync(), Times.Once);
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(thumbnailIds), Times.Once);
    }

    [Fact]
    public async Task ExecuteAsync_ScanThrows_DoesNotPropagate()
    {
        // Arrange
        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ThrowsAsync(new InvalidOperationException("Disk scan failed"));

        // Act
        var act = async () => await RunAsync();

        // Assert — exception is swallowed by the outer catch
        await act.Should().NotThrowAsync();

        // Phase 2 is skipped when phase 1 throws
        mockMongoDBService.Verify(m => m.GetViewableWithoutThumbnailIdsAsync(), Times.Never);
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(It.IsAny<List<string>>()), Times.Never);
    }

    [Fact]
    public async Task ExecuteAsync_ThumbnailQueryThrows_DoesNotPropagate()
    {
        // Arrange
        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ReturnsAsync(new BulkImportResponse { ImportedCount = 2, SkippedCount = 0, ErrorCount = 0 });
        mockMongoDBService
            .Setup(m => m.GetViewableWithoutThumbnailIdsAsync())
            .ThrowsAsync(new InvalidOperationException("MongoDB unavailable"));

        // Act
        var act = async () => await RunAsync();

        // Assert
        await act.Should().NotThrowAsync();
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(It.IsAny<List<string>>()), Times.Never);
    }

    [Fact]
    public async Task ExecuteAsync_AlwaysDisposesScope()
    {
        // Arrange
        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ReturnsAsync(new BulkImportResponse { ImportedCount = 1, SkippedCount = 0, ErrorCount = 0 });
        mockMongoDBService
            .Setup(m => m.GetViewableWithoutThumbnailIdsAsync())
            .ReturnsAsync(new List<string>());

        // Act
        await RunAsync();

        // Assert
        mockScopeFactory.Verify(f => f.CreateScope(), Times.Once);
        mockScope.Verify(s => s.Dispose(), Times.Once);
    }

    [Fact]
    public async Task ExecuteAsync_ScanThrows_ScopeStillDisposed()
    {
        // Arrange
        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ThrowsAsync(new InvalidOperationException("fail"));

        // Act
        await RunAsync();

        // Assert — using block guarantees disposal even on exception
        mockScope.Verify(s => s.Dispose(), Times.Once);
    }

    [Fact]
    public async Task ExecuteAsync_CancelledBeforeDelay_SkipsAllWork()
    {
        // Arrange — restore the real delay and cancel the token immediately so the
        // Task.Delay throws OperationCanceledException, causing an early return.
        sut.InitialDelay = TimeSpan.FromSeconds(5);
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

        // Assert — no exception and no work done
        await act.Should().NotThrowAsync();
        mockScopeFactory.Verify(f => f.CreateScope(), Times.Never);
        mockDataScanService.Verify(s => s.ScanAndImportAsync(), Times.Never);
    }

    [Fact]
    public async Task ExecuteAsync_CancelledAfterScan_SkipsPhase2()
    {
        // Arrange — cancel the stoppingToken from inside the mock, between phase 1 and 2.
        using var cts = new CancellationTokenSource();

        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ReturnsAsync(() =>
            {
                cts.Cancel();
                return new BulkImportResponse { ImportedCount = 2, SkippedCount = 0, ErrorCount = 0 };
            });

        // Act
        await RunAsync(cts.Token);

        // Assert — stoppingToken.IsCancellationRequested is true so phase 2 is skipped
        mockMongoDBService.Verify(m => m.GetViewableWithoutThumbnailIdsAsync(), Times.Never);
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(It.IsAny<List<string>>()), Times.Never);
    }

    [Fact]
    public async Task ExecuteAsync_ScanHasErrors_StillRunsPhase2()
    {
        // Arrange — ErrorCount in the result does not prevent phase 2 from running
        var thumbnailIds = new List<string> { "id-1" };
        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ReturnsAsync(new BulkImportResponse { ImportedCount = 1, SkippedCount = 0, ErrorCount = 3 });
        mockMongoDBService
            .Setup(m => m.GetViewableWithoutThumbnailIdsAsync())
            .ReturnsAsync(thumbnailIds);

        // Act
        await RunAsync();

        // Assert
        mockMongoDBService.Verify(m => m.GetViewableWithoutThumbnailIdsAsync(), Times.Once);
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(thumbnailIds), Times.Once);
    }

    [Fact]
    public async Task ExecuteAsync_LargeThumbnailBacklog_EnqueuedAsSingleBatch()
    {
        // Arrange
        var largeBatch = Enumerable.Range(1, 200).Select(i => $"id-{i}").ToList();
        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ReturnsAsync(new BulkImportResponse { ImportedCount = 0, SkippedCount = 0, ErrorCount = 0 });
        mockMongoDBService
            .Setup(m => m.GetViewableWithoutThumbnailIdsAsync())
            .ReturnsAsync(largeBatch);

        // Act
        await RunAsync();

        // Assert — entire list passed as one batch
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(largeBatch), Times.Once);
    }

    [Fact]
    public async Task ExecuteAsync_ScanThrowsOperationCanceledException_IsNotSwallowed()
    {
        // The outer catch uses `when (ex is not OperationCanceledException)`,
        // so OCE thrown inside the body propagates out of ExecuteAsync.
        mockDataScanService
            .Setup(s => s.ScanAndImportAsync())
            .ThrowsAsync(new OperationCanceledException("cancelled internally"));

        // Act
        var act = async () => await RunAsync();

        // Assert — OCE is not swallowed
        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    /// <summary>
    /// Calls protected ExecuteAsync directly via reflection, bypassing the StartAsync wrapper
    /// so we can supply a specific CancellationToken. The InitialDelay seam ensures the
    /// 5-second startup wait does not block tests.
    /// </summary>
    private async Task RunAsync(CancellationToken? token = null)
    {
        var ct = token ?? CancellationToken.None;

        var method = typeof(StartupScanBackgroundService)
            .GetMethod("ExecuteAsync", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        method.Should().NotBeNull("ExecuteAsync must exist as a protected method");

        var task = (Task)method!.Invoke(sut, [ct])!;
        await task;
    }
}
