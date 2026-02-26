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
    private readonly Mock<IStorageProvider> mockStorageProvider;
    private readonly Mock<ILogger<MosaicBackgroundService>> mockLogger;
    private readonly MosaicBackgroundService sut;

    public MosaicBackgroundServiceTests()
    {
        queue = new MosaicQueue();
        mockMosaicService = new Mock<IMosaicService>();
        mockJobTracker = new Mock<IJobTracker>();
        mockStorageProvider = new Mock<IStorageProvider>();
        mockLogger = new Mock<ILogger<MosaicBackgroundService>>();

        sut = new MosaicBackgroundService(
            queue,
            mockMosaicService.Object,
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
    public async Task Export_DequeuesAndWritesToStorage()
    {
        // Arrange
        var imageBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 };
        var item = CreateItem("job-1", saveToLibrary: false);
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(item.Request))
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
        mockJobTracker.Verify(j => j.UpdateProgressAsync("job-1", 10, "generating", "Generating mosaic image..."), Times.Once);
        mockMosaicService.Verify(s => s.GenerateMosaicAsync(item.Request), Times.Once);
        mockStorageProvider.Verify(s => s.WriteAsync(
            It.Is<string>(k => k.StartsWith("tmp/jobs/job-1/")),
            It.IsAny<Stream>(),
            It.IsAny<CancellationToken>()), Times.Once);
        mockJobTracker.Verify(j => j.CompleteBlobJobAsync(
            "job-1",
            It.Is<string>(k => k.StartsWith("tmp/jobs/job-1/")),
            "image/png",
            "mosaic.png",
            null), Times.Once);
    }

    [Fact]
    public async Task SaveToLibrary_CallsGenerateAndSave()
    {
        // Arrange
        var item = CreateItem("job-save", saveToLibrary: true);
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

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await Task.Delay(300);
        cts.Cancel();

        try { await sut.StopAsync(CancellationToken.None); }
        catch (OperationCanceledException) { }

        // Assert
        mockJobTracker.Verify(j => j.StartJobAsync("job-save"), Times.Once);
        mockJobTracker.Verify(j => j.UpdateProgressAsync("job-save", 10, "generating", "Generating FITS mosaic..."), Times.Once);
        mockMosaicService.Verify(s => s.GenerateAndSaveMosaicAsync(
            item.Request, item.UserId, item.IsAuthenticated, item.IsAdmin), Times.Once);
        mockJobTracker.Verify(j => j.CompleteDataIdJobAsync("job-save", "data-abc-123", null), Times.Once);
        // Should NOT write to blob storage
        mockStorageProvider.Verify(s => s.WriteAsync(
            It.IsAny<string>(), It.IsAny<Stream>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CancelBeforeProcessing_MarksCancelled()
    {
        // Arrange
        var item = CreateItem("job-cancel", saveToLibrary: false);
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
        mockMosaicService.Verify(s => s.GenerateMosaicAsync(It.IsAny<MosaicRequestDto>()), Times.Never);
    }

    [Fact]
    public async Task CancelAfterExport_SkipsStorageWrite()
    {
        // Arrange
        var item = CreateItem("job-cancel-after", saveToLibrary: false);
        var callCount = 0;
        mockJobTracker.Setup(j => j.IsCancelRequested("job-cancel-after"))
            .Returns(() =>
            {
                callCount++;
                return callCount > 1; // false first time, true second time
            });
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(item.Request))
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
        var item = CreateItem("job-fail", saveToLibrary: false);
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(item.Request))
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

    [Fact]
    public async Task Export_JpegFormat_UsesCorrectContentType()
    {
        // Arrange
        var item = CreateItem("job-jpeg", saveToLibrary: false, outputFormat: "jpeg");
        mockMosaicService.Setup(s => s.GenerateMosaicAsync(item.Request))
            .ReturnsAsync(new byte[] { 0xFF, 0xD8, 0xFF });

        queue.TryEnqueue(item);
        using var cts = new CancellationTokenSource();

        // Act
        var serviceTask = sut.StartAsync(cts.Token);
        await Task.Delay(300);
        cts.Cancel();

        try { await sut.StopAsync(CancellationToken.None); }
        catch (OperationCanceledException) { }

        // Assert
        mockJobTracker.Verify(j => j.CompleteBlobJobAsync(
            "job-jpeg",
            It.Is<string>(k => k.EndsWith("mosaic.jpeg")),
            "image/jpeg",
            "mosaic.jpeg",
            null), Times.Once);
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
