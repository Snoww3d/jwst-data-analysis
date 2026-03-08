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
/// Unit tests for MosaicBackgroundService.
/// </summary>
public class MosaicBackgroundServiceTests : IDisposable
{
    private readonly MosaicQueue queue;
    private readonly Mock<IMosaicService> mockMosaicService;
    private readonly Mock<IJobTracker> mockJobTracker;
    private readonly ObservationMosaicTracker observationMosaicTracker;
    private readonly Mock<IStorageProvider> mockStorageProvider;
    private readonly Mock<ILogger<MosaicBackgroundService>> mockLogger;
    private readonly MosaicBackgroundService sut;

    public MosaicBackgroundServiceTests()
    {
        queue = new MosaicQueue();
        mockMosaicService = new Mock<IMosaicService>();
        mockJobTracker = new Mock<IJobTracker>();
        observationMosaicTracker = new ObservationMosaicTracker();
        mockStorageProvider = new Mock<IStorageProvider>();
        mockLogger = new Mock<ILogger<MosaicBackgroundService>>();

        sut = new MosaicBackgroundService(
            queue,
            mockMosaicService.Object,
            mockJobTracker.Object,
            observationMosaicTracker,
            mockStorageProvider.Object,
            mockLogger.Object);
    }

    public void Dispose()
    {
        sut.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task Export_DequeuesAndWritesToStorage()
    {
        // Arrange
        var imageBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 };
        var item = CreateItem("job-1", saveToLibrary: false);
        var completed = new TaskCompletionSource<bool>();
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin))
            .ReturnsAsync(imageBytes);
        mockJobTracker.Setup(j => j.CompleteBlobJobAsync(
                "job-1", It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), null))
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
        }

        // Assert
        mockJobTracker.Verify(j => j.StartJobAsync("job-1"), Times.Once);
        mockJobTracker.Verify(
            j => j.UpdateProgressAsync("job-1", 10, "generating", "Generating mosaic image..."),
            Times.Once);
        mockMosaicService.Verify(s => s.GenerateMosaicAsync(item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin), Times.Once);
        mockStorageProvider.Verify(
            s => s.WriteAsync(
                It.Is<string>(k => k.StartsWith("tmp/jobs/job-1/")),
                It.IsAny<Stream>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
        mockJobTracker.Verify(
            j => j.CompleteBlobJobAsync(
                "job-1",
                It.Is<string>(k => k.StartsWith("tmp/jobs/job-1/")),
                "image/png",
                "mosaic.png",
                null),
            Times.Once);
    }

    [Fact]
    public async Task SaveToLibrary_CallsGenerateAndSave()
    {
        // Arrange
        var item = CreateItem("job-save", saveToLibrary: true);
        var completed = new TaskCompletionSource<bool>();
        var savedResponse = new SavedMosaicResponseDto
        {
            DataId = "data-abc-123",
            FileName = "mosaic.fits",
            FileSize = 1024,
            FileFormat = "fits",
            ProcessingLevel = "L3",
            DerivedFrom = new List<string> { "id1", "id2" },
        };
        mockMosaicService.Setup(s => s.GenerateAndSaveMosaicAsync(
                item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin))
            .ReturnsAsync(savedResponse);
        mockJobTracker.Setup(j => j.CompleteDataIdJobAsync("job-save", "data-abc-123", "mosaic.fits|1024"))
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
        }

        // Assert
        mockJobTracker.Verify(j => j.StartJobAsync("job-save"), Times.Once);
        mockJobTracker.Verify(
            j => j.UpdateProgressAsync("job-save", 10, "generating", "Generating FITS mosaic..."),
            Times.Once);
        mockMosaicService.Verify(
            s => s.GenerateAndSaveMosaicAsync(
                item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin),
            Times.Once);
        mockJobTracker.Verify(
            j => j.CompleteDataIdJobAsync("job-save", "data-abc-123", "mosaic.fits|1024"),
            Times.Once);

        // Should NOT write to blob storage
        mockStorageProvider.Verify(
            s => s.WriteAsync(
                It.IsAny<string>(), It.IsAny<Stream>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task CancelBeforeProcessing_MarksCancelled()
    {
        // Arrange
        var item = CreateItem("job-cancel", saveToLibrary: false);
        var completed = new TaskCompletionSource<bool>();
        mockJobTracker.Setup(j => j.IsCancelRequested("job-cancel")).Returns(true);
        mockJobTracker.Setup(j => j.FailJobAsync("job-cancel", "Cancelled"))
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
        }

        // Assert
        mockJobTracker.Verify(j => j.FailJobAsync("job-cancel", "Cancelled"), Times.Once);
        mockMosaicService.Verify(s => s.GenerateMosaicAsync(It.IsAny<MosaicRequestDto>(), It.IsAny<string?>(), It.IsAny<bool>(), It.IsAny<bool>()), Times.Never);
    }

    [Fact]
    public async Task CancelAfterExport_SkipsStorageWrite()
    {
        // Arrange
        var item = CreateItem("job-cancel-after", saveToLibrary: false);
        var completed = new TaskCompletionSource<bool>();
        var callCount = 0;
        mockJobTracker.Setup(j => j.IsCancelRequested("job-cancel-after"))
            .Returns(() =>
            {
                callCount++;
                return callCount > 1; // false first time, true second time
            });
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin))
            .ReturnsAsync(new byte[] { 1, 2, 3 });
        mockJobTracker.Setup(j => j.FailJobAsync("job-cancel-after", "Cancelled"))
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
        }

        // Assert — storage write skipped, job failed as cancelled
        mockStorageProvider.Verify(
            s => s.WriteAsync(
                It.IsAny<string>(), It.IsAny<Stream>(), It.IsAny<CancellationToken>()),
            Times.Never);
        mockJobTracker.Verify(j => j.FailJobAsync("job-cancel-after", "Cancelled"), Times.Once);
    }

    [Fact]
    public async Task ServiceError_MarksFailed()
    {
        // Arrange
        var item = CreateItem("job-fail", saveToLibrary: false);
        var completed = new TaskCompletionSource<bool>();
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin))
            .ThrowsAsync(new InvalidOperationException("Processing failed"));
        mockJobTracker.Setup(j => j.FailJobAsync("job-fail", "An unexpected error occurred during processing. Please retry."))
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
        }

        // Assert
        mockJobTracker.Verify(j => j.FailJobAsync("job-fail", "An unexpected error occurred during processing. Please retry."), Times.Once);
    }

    [Fact]
    public async Task Export_JpegFormat_UsesCorrectContentType()
    {
        // Arrange
        var item = CreateItem("job-jpeg", saveToLibrary: false, outputFormat: "jpeg");
        var completed = new TaskCompletionSource<bool>();
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin))
            .ReturnsAsync(new byte[] { 0xFF, 0xD8, 0xFF });
        mockJobTracker.Setup(j => j.CompleteBlobJobAsync(
                "job-jpeg", It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), null))
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
        }

        // Assert
        mockJobTracker.Verify(
            j => j.CompleteBlobJobAsync(
                "job-jpeg",
                It.Is<string>(k => k.EndsWith("mosaic.jpeg")),
                "image/jpeg",
                "mosaic.jpeg",
                null),
            Times.Once);
    }

    [Fact]
    public async Task SaveToLibrary_CancelAfterGenerate_SkipsComplete()
    {
        // Arrange
        var item = CreateItem("job-save-cancel", saveToLibrary: true);
        var completed = new TaskCompletionSource<bool>();
        var savedResponse = new SavedMosaicResponseDto
        {
            DataId = "data-abc-123",
            FileName = "mosaic.fits",
            FileSize = 1024,
            FileFormat = "fits",
            ProcessingLevel = "L3",
            DerivedFrom = new List<string> { "id1", "id2" },
        };

        var callCount = 0;
        mockJobTracker.Setup(j => j.IsCancelRequested("job-save-cancel"))
            .Returns(() =>
            {
                callCount++;
                return callCount > 1;
            });
        mockMosaicService.Setup(s => s.GenerateAndSaveMosaicAsync(
                item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin))
            .ReturnsAsync(savedResponse);
        mockJobTracker.Setup(j => j.FailJobAsync("job-save-cancel", "Cancelled"))
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
        }

        // Assert — CompleteDataIdJobAsync should NOT be called
        mockJobTracker.Verify(
            j => j.CompleteDataIdJobAsync("job-save-cancel", It.IsAny<string>(), It.IsAny<string>()),
            Times.Never);
        mockJobTracker.Verify(j => j.FailJobAsync("job-save-cancel", "Cancelled"), Times.Once);
    }

    [Fact]
    public async Task SaveToLibrary_ServiceError_MarksFailed()
    {
        // Arrange
        var item = CreateItem("job-save-fail", saveToLibrary: true);
        var completed = new TaskCompletionSource<bool>();
        mockMosaicService.Setup(s => s.GenerateAndSaveMosaicAsync(
                item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin))
            .ThrowsAsync(new InvalidOperationException("Permission denied"));
        mockJobTracker.Setup(j => j.FailJobAsync("job-save-fail", "An unexpected error occurred during processing. Please retry."))
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
        }

        // Assert
        mockJobTracker.Verify(j => j.FailJobAsync("job-save-fail", "An unexpected error occurred during processing. Please retry."), Times.Once);
    }

    private static MosaicJobItem CreateItem(
        string jobId,
        bool saveToLibrary,
        string outputFormat = "png") => new()
    {
        JobId = jobId,
        Request = new MosaicRequestDto
        {
            Files = new List<MosaicFileConfigDto>
            {
                new() { DataId = "id1" },
                new() { DataId = "id2" },
            },
            OutputFormat = outputFormat,
            CombineMethod = "mean",
        },
        UserId = "test-user",
        IsAuthenticated = true,
        IsAdmin = false,
        SaveToLibrary = saveToLibrary,
    };
}
