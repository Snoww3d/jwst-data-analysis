// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using Microsoft.Extensions.Logging;
using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for ImportJobTracker.
/// </summary>
public class ImportJobTrackerTests
{
    private const string TestUserId = "test-user-123";
    private readonly Mock<IJobTracker> mockUnifiedTracker;
    private readonly ImportJobTracker sut;

    public ImportJobTrackerTests()
    {
        var mockLogger = new Mock<ILogger<ImportJobTracker>>();
        mockUnifiedTracker = new Mock<IJobTracker>();

        // Setup unified tracker to return a dummy job on create (fire-and-forget, but avoids exceptions)
        mockUnifiedTracker
            .Setup(t => t.CreateJobAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>()))
            .ReturnsAsync(new JobStatus { JobId = "dummy" });
        mockUnifiedTracker
            .Setup(t => t.StartJobAsync(It.IsAny<string>()))
            .Returns(Task.CompletedTask);
        mockUnifiedTracker
            .Setup(t => t.UpdateProgressAsync(It.IsAny<string>(), It.IsAny<int>(), It.IsAny<string?>(), It.IsAny<string?>()))
            .Returns(Task.CompletedTask);
        mockUnifiedTracker
            .Setup(t => t.UpdateByteProgressAsync(
                It.IsAny<string>(), It.IsAny<long>(), It.IsAny<long>(),
                It.IsAny<double>(), It.IsAny<double?>(), It.IsAny<List<FileDownloadProgress>?>()))
            .Returns(Task.CompletedTask);
        mockUnifiedTracker
            .Setup(t => t.CompleteJobAsync(It.IsAny<string>(), It.IsAny<string?>()))
            .Returns(Task.CompletedTask);
        mockUnifiedTracker
            .Setup(t => t.FailJobAsync(It.IsAny<string>(), It.IsAny<string>()))
            .Returns(Task.CompletedTask);
        mockUnifiedTracker
            .Setup(t => t.CancelJobAsync(It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync(true);

        sut = new ImportJobTracker(mockLogger.Object, mockUnifiedTracker.Object);
    }

    [Fact]
    public void CreateJob_ReturnsValidJobId()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);

        jobId.Should().NotBeNullOrEmpty();
        jobId.Should().HaveLength(12);
    }

    [Fact]
    public void CreateJob_SetsInitialState()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        var job = sut.GetJob(jobId);

        job.Should().NotBeNull();
        job!.JobId.Should().Be(jobId);
        job.ObsId.Should().Be("obs-123");
        job.Progress.Should().Be(0);
        job.Stage.Should().Be(ImportStages.Starting);
        job.IsComplete.Should().BeFalse();
        job.StartedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void CreateJob_CreatesUniquIds()
    {
        var id1 = sut.CreateJob("obs-1", TestUserId);
        var id2 = sut.CreateJob("obs-2", TestUserId);

        id1.Should().NotBe(id2);
    }

    [Fact]
    public void GetJob_ReturnsNull_WhenNotFound()
    {
        sut.GetJob("nonexistent").Should().BeNull();
    }

    [Fact]
    public void GetCancellationToken_ReturnsValidToken()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        var token = sut.GetCancellationToken(jobId);

        token.Should().NotBe(CancellationToken.None);
        token.IsCancellationRequested.Should().BeFalse();
    }

    [Fact]
    public void GetCancellationToken_ReturnsNone_WhenNotFound()
    {
        var token = sut.GetCancellationToken("nonexistent");
        token.Should().Be(CancellationToken.None);
    }

    [Fact]
    public void CancelJob_SetsCancellationToken()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        var token = sut.GetCancellationToken(jobId);

        sut.CancelJob(jobId, TestUserId).Should().BeTrue();

        token.IsCancellationRequested.Should().BeTrue();
    }

    [Fact]
    public void CancelJob_UpdatesJobState()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.CancelJob(jobId, TestUserId);

        var job = sut.GetJob(jobId);
        job!.Stage.Should().Be(ImportStages.Cancelled);
        job.IsComplete.Should().BeTrue();
        job.CompletedAt.Should().NotBeNull();
    }

    [Fact]
    public void CancelJob_ReturnsFalse_WhenNotFound()
    {
        sut.CancelJob("nonexistent", TestUserId).Should().BeFalse();
    }

    [Fact]
    public void CancelJob_DoesNotUpdateCompletedJob()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.CompleteJob(jobId, new MastImportResponse { ImportedCount = 1 });
        sut.CancelJob(jobId, TestUserId);

        var job = sut.GetJob(jobId);
        job!.Stage.Should().Be(ImportStages.Complete);
    }

    [Fact]
    public void UpdateProgress_SetsValues()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.UpdateProgress(jobId, 50, ImportStages.Downloading, "Downloading files...");

        var job = sut.GetJob(jobId);
        job!.Progress.Should().Be(50);
        job.Stage.Should().Be(ImportStages.Downloading);
        job.Message.Should().Be("Downloading files...");
    }

    [Theory]
    [InlineData(-10, 0)]
    [InlineData(0, 0)]
    [InlineData(50, 50)]
    [InlineData(100, 100)]
    [InlineData(150, 100)]
    public void UpdateProgress_ClampsValue(int input, int expected)
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.UpdateProgress(jobId, input, "stage", "msg");

        sut.GetJob(jobId)!.Progress.Should().Be(expected);
    }

    [Fact]
    public void UpdateProgress_IgnoresUnknownJob()
    {
        // Should not throw
        sut.UpdateProgress("nonexistent", 50, "stage", "msg");
    }

    [Fact]
    public void UpdateByteProgress_SetsValues()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.UpdateByteProgress(jobId, 500, 1000, 100.0, 5.0);

        var job = sut.GetJob(jobId);
        job!.DownloadedBytes.Should().Be(500);
        job.TotalBytes.Should().Be(1000);
        job.SpeedBytesPerSec.Should().Be(100.0);
        job.EtaSeconds.Should().Be(5.0);
        job.DownloadProgressPercent.Should().Be(50.0);
    }

    [Fact]
    public void UpdateByteProgress_HandlesZeroTotal()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.UpdateByteProgress(jobId, 0, 0, 0.0, null);

        sut.GetJob(jobId)!.DownloadProgressPercent.Should().Be(0);
    }

    [Fact]
    public void UpdateByteProgress_SetsFileProgress()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        var fileProgress = new List<FileDownloadProgress>
        {
            new() { FileName = "file1.fits" },
        };
        sut.UpdateByteProgress(jobId, 500, 1000, 100.0, 5.0, fileProgress);

        sut.GetJob(jobId)!.FileProgress.Should().HaveCount(1);
    }

    [Fact]
    public void SetDownloadJobId_SetsValue()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.SetDownloadJobId(jobId, "download-456");

        sut.GetJob(jobId)!.DownloadJobId.Should().Be("download-456");
    }

    [Fact]
    public void SetResumable_SetsValue()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.SetResumable(jobId, true);

        sut.GetJob(jobId)!.IsResumable.Should().BeTrue();
    }

    [Fact]
    public void CompleteJob_SetsCompletionState()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        var result = new MastImportResponse { ImportedCount = 5 };

        sut.CompleteJob(jobId, result);

        var job = sut.GetJob(jobId);
        job!.Progress.Should().Be(100);
        job.Stage.Should().Be(ImportStages.Complete);
        job.IsComplete.Should().BeTrue();
        job.CompletedAt.Should().NotBeNull();
        job.Result.Should().Be(result);
        job.Message.Should().Contain("5");
    }

    [Fact]
    public void FailJob_SetsFailureState()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.FailJob(jobId, "Something went wrong");

        var job = sut.GetJob(jobId);
        job!.Stage.Should().Be(ImportStages.Failed);
        job.IsComplete.Should().BeTrue();
        job.Error.Should().Be("Something went wrong");
        job.CompletedAt.Should().NotBeNull();
    }

    [Fact]
    public void RemoveJob_ReturnsTrue_WhenExists()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.RemoveJob(jobId).Should().BeTrue();
        sut.GetJob(jobId).Should().BeNull();
    }

    [Fact]
    public void RemoveJob_ReturnsFalse_WhenNotFound()
    {
        sut.RemoveJob("nonexistent").Should().BeFalse();
    }

    // --- Dual-write adapter tests ---

    [Fact]
    public async Task CreateJob_DualWritesToUnifiedTracker()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);

        // Give fire-and-forget time to execute
        await Task.Delay(100);

        mockUnifiedTracker.Verify(
            t => t.CreateJobAsync("import", It.Is<string>(d => d.Contains("obs-123")), TestUserId, jobId),
            Times.Once);
        mockUnifiedTracker.Verify(t => t.StartJobAsync(jobId), Times.Once);
    }

    [Fact]
    public async Task UpdateProgress_DualWritesToUnifiedTracker()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.UpdateProgress(jobId, 50, ImportStages.Downloading, "Downloading...");

        await Task.Delay(100);

        mockUnifiedTracker.Verify(
            t => t.UpdateProgressAsync(jobId, 50, ImportStages.Downloading, "Downloading..."),
            Times.Once);
    }

    [Fact]
    public async Task CompleteJob_DualWritesToUnifiedTracker()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.CompleteJob(jobId, new MastImportResponse { ImportedCount = 3 });

        await Task.Delay(100);

        mockUnifiedTracker.Verify(
            t => t.CompleteJobAsync(jobId, It.Is<string?>(m => m != null && m.Contains('3'))),
            Times.Once);
    }

    [Fact]
    public async Task FailJob_DualWritesToUnifiedTracker()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.FailJob(jobId, "Download failed");

        await Task.Delay(100);

        mockUnifiedTracker.Verify(
            t => t.FailJobAsync(jobId, "Download failed"),
            Times.Once);
    }

    [Fact]
    public async Task CancelJob_DualWritesToUnifiedTracker()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);
        sut.CancelJob(jobId, TestUserId);

        await Task.Delay(100);

        mockUnifiedTracker.Verify(
            t => t.CancelJobAsync(jobId, TestUserId),
            Times.Once);
    }

    [Fact]
    public async Task UpdateByteProgress_ThrottlesDualWrite()
    {
        var jobId = sut.CreateJob("obs-123", TestUserId);

        // First call should dual-write
        sut.UpdateByteProgress(jobId, 100, 1000, 50.0, 10.0);
        await Task.Delay(50);

        // Second call immediately after should be throttled
        sut.UpdateByteProgress(jobId, 200, 1000, 50.0, 8.0);
        await Task.Delay(50);

        // Only one dual-write should have occurred
        mockUnifiedTracker.Verify(
            t => t.UpdateByteProgressAsync(jobId, It.IsAny<long>(), It.IsAny<long>(),
                It.IsAny<double>(), It.IsAny<double?>(), It.IsAny<List<FileDownloadProgress>?>()),
            Times.Once);
    }

    [Fact]
    public void DualWriteFailure_DoesNotBlockImportJobTracker()
    {
        // Setup unified tracker to throw on all calls
        mockUnifiedTracker
            .Setup(t => t.CreateJobAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>()))
            .ThrowsAsync(new InvalidOperationException("DB connection failed"));

        // CreateJob should still succeed (in-memory is primary)
        var jobId = sut.CreateJob("obs-123", TestUserId);
        jobId.Should().NotBeNullOrEmpty();

        var job = sut.GetJob(jobId);
        job.Should().NotBeNull();
        job!.ObsId.Should().Be("obs-123");
    }
}
