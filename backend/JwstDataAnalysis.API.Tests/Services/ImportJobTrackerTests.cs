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
    private readonly ImportJobTracker sut;

    public ImportJobTrackerTests()
    {
        var mockLogger = new Mock<ILogger<ImportJobTracker>>();
        sut = new ImportJobTracker(mockLogger.Object);
    }

    [Fact]
    public void CreateJob_ReturnsValidJobId()
    {
        var jobId = sut.CreateJob("obs-123");

        jobId.Should().NotBeNullOrEmpty();
        jobId.Should().HaveLength(12);
    }

    [Fact]
    public void CreateJob_SetsInitialState()
    {
        var jobId = sut.CreateJob("obs-123");
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
        var id1 = sut.CreateJob("obs-1");
        var id2 = sut.CreateJob("obs-2");

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
        var jobId = sut.CreateJob("obs-123");
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
        var jobId = sut.CreateJob("obs-123");
        var token = sut.GetCancellationToken(jobId);

        sut.CancelJob(jobId).Should().BeTrue();

        token.IsCancellationRequested.Should().BeTrue();
    }

    [Fact]
    public void CancelJob_UpdatesJobState()
    {
        var jobId = sut.CreateJob("obs-123");
        sut.CancelJob(jobId);

        var job = sut.GetJob(jobId);
        job!.Stage.Should().Be(ImportStages.Cancelled);
        job.IsComplete.Should().BeTrue();
        job.CompletedAt.Should().NotBeNull();
    }

    [Fact]
    public void CancelJob_ReturnsFalse_WhenNotFound()
    {
        sut.CancelJob("nonexistent").Should().BeFalse();
    }

    [Fact]
    public void CancelJob_DoesNotUpdateCompletedJob()
    {
        var jobId = sut.CreateJob("obs-123");
        sut.CompleteJob(jobId, new MastImportResponse { ImportedCount = 1 });
        sut.CancelJob(jobId);

        var job = sut.GetJob(jobId);
        job!.Stage.Should().Be(ImportStages.Complete);
    }

    [Fact]
    public void UpdateProgress_SetsValues()
    {
        var jobId = sut.CreateJob("obs-123");
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
        var jobId = sut.CreateJob("obs-123");
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
        var jobId = sut.CreateJob("obs-123");
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
        var jobId = sut.CreateJob("obs-123");
        sut.UpdateByteProgress(jobId, 0, 0, 0.0, null);

        sut.GetJob(jobId)!.DownloadProgressPercent.Should().Be(0);
    }

    [Fact]
    public void UpdateByteProgress_SetsFileProgress()
    {
        var jobId = sut.CreateJob("obs-123");
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
        var jobId = sut.CreateJob("obs-123");
        sut.SetDownloadJobId(jobId, "download-456");

        sut.GetJob(jobId)!.DownloadJobId.Should().Be("download-456");
    }

    [Fact]
    public void SetResumable_SetsValue()
    {
        var jobId = sut.CreateJob("obs-123");
        sut.SetResumable(jobId, true);

        sut.GetJob(jobId)!.IsResumable.Should().BeTrue();
    }

    [Fact]
    public void CompleteJob_SetsCompletionState()
    {
        var jobId = sut.CreateJob("obs-123");
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
        var jobId = sut.CreateJob("obs-123");
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
        var jobId = sut.CreateJob("obs-123");
        sut.RemoveJob(jobId).Should().BeTrue();
        sut.GetJob(jobId).Should().BeNull();
    }

    [Fact]
    public void RemoveJob_ReturnsFalse_WhenNotFound()
    {
        sut.RemoveJob("nonexistent").Should().BeFalse();
    }
}
