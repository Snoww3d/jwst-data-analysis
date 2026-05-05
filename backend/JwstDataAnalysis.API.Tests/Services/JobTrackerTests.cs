// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.Extensions.Logging;

using MongoDB.Driver;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for JobTracker.
/// Uses the internal constructor to inject a mock IMongoCollection,
/// bypassing the real MongoDB connection. After CreateJobAsync the job
/// lives in the in-memory cache, so most reads never hit the collection mock.
/// </summary>
public class JobTrackerTests
{
    private const string TestUserId = "user-1";
    private const string OtherUserId = "user-2";

    private readonly Mock<IMongoCollection<JobStatus>> mockCollection = new();
    private readonly Mock<IJobProgressNotifier> mockNotifier = new();
    private readonly Mock<ILogger<JobTracker>> mockLogger = new();
    private readonly JobTracker sut;

    public JobTrackerTests()
    {
        // InsertOneAsync and ReplaceOneAsync are called on every persist — allow them by default.
        mockCollection
            .Setup(c => c.InsertOneAsync(
                It.IsAny<JobStatus>(),
                It.IsAny<InsertOneOptions>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        mockCollection
            .Setup(c => c.ReplaceOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<JobStatus>(),
                It.IsAny<ReplaceOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Mock<ReplaceOneResult>().Object);

        // Mock Find() for cache-miss lookups — return an empty cursor so FirstOrDefaultAsync returns null.
        var mockCursor = new Mock<IAsyncCursor<JobStatus>>();
        mockCursor.Setup(c => c.MoveNextAsync(It.IsAny<CancellationToken>())).ReturnsAsync(false);
        mockCursor.Setup(c => c.Current).Returns(new List<JobStatus>());

        var mockFindFluent = new Mock<IAsyncCursorSource<JobStatus>>();
        mockFindFluent
            .Setup(f => f.ToCursorAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockCursor.Object);

        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<FindOptions<JobStatus, JobStatus>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockCursor.Object);

        // Default notifier stubs.
        mockNotifier
            .Setup(n => n.NotifyProgressAsync(It.IsAny<JobProgressUpdate>()))
            .Returns(Task.CompletedTask);
        mockNotifier
            .Setup(n => n.NotifyCompletedAsync(It.IsAny<JobCompletionUpdate>()))
            .Returns(Task.CompletedTask);
        mockNotifier
            .Setup(n => n.NotifyFailedAsync(It.IsAny<JobFailureUpdate>()))
            .Returns(Task.CompletedTask);

        sut = new JobTracker(mockCollection.Object, mockNotifier.Object, mockLogger.Object);
    }

    // ===== CreateJobAsync =====
    [Fact]
    public async Task CreateJobAsync_ReturnsJobWithGeneratedId()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import dataset", TestUserId);

        job.JobId.Should().NotBeNullOrEmpty();
        job.JobId.Should().HaveLength(12);
    }

    [Fact]
    public async Task CreateJobAsync_SetsInitialFields()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Build composite", TestUserId);

        job.JobType.Should().Be(JobTypes.Composite);
        job.State.Should().Be(JobStates.Queued);
        job.Description.Should().Be("Build composite");
        job.OwnerUserId.Should().Be(TestUserId);
        job.ProgressPercent.Should().Be(0);
        job.CreatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
        job.UpdatedAt.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task CreateJobAsync_PersistsToMongo()
    {
        await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        mockCollection.Verify(
            c => c.InsertOneAsync(
                It.Is<JobStatus>(j => j.OwnerUserId == TestUserId),
                It.IsAny<InsertOneOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task CreateJobAsync_GeneratesUniqueIds()
    {
        var job1 = await sut.CreateJobAsync(JobTypes.Import, "Job 1", TestUserId);
        var job2 = await sut.CreateJobAsync(JobTypes.Import, "Job 2", TestUserId);

        job1.JobId.Should().NotBe(job2.JobId);
    }

    // ===== UpdateProgressAsync =====
    [Fact]
    public async Task UpdateProgressAsync_UpdatesProgressAndStage()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.UpdateProgressAsync(job.JobId, 50, "downloading", "Downloading files");

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.ProgressPercent.Should().Be(50);
        updated.Stage.Should().Be("downloading");
        updated.Message.Should().Be("Downloading files");
    }

    [Theory]
    [InlineData(-10, 0)]
    [InlineData(0, 0)]
    [InlineData(50, 50)]
    [InlineData(100, 100)]
    [InlineData(150, 100)]
    public async Task UpdateProgressAsync_ClampsProgress(int input, int expected)
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.UpdateProgressAsync(job.JobId, input);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.ProgressPercent.Should().Be(expected);
    }

    [Fact]
    public async Task UpdateProgressAsync_AutoTransitionsFromQueuedToRunning()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);
        job.State.Should().Be(JobStates.Queued);

        await sut.UpdateProgressAsync(job.JobId, 10);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.State.Should().Be(JobStates.Running);
        updated.StartedAt.Should().NotBeNull();
    }

    // #1471 — Messages rolling buffer behavior
    [Fact]
    public async Task UpdateProgressAsync_AppendsToMessagesBuffer()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);

        await sut.UpdateProgressAsync(job.JobId, 10, "reproject", "Reprojecting R (1 of 3)");
        await sut.UpdateProgressAsync(job.JobId, 20, "reproject", "Reprojecting G (2 of 3)");
        await sut.UpdateProgressAsync(job.JobId, 30, "reproject", "Reprojecting B (3 of 3)");

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.Messages.Should().HaveCount(3);
        updated.Messages[0].Should().Be("Reprojecting R (1 of 3)");
        updated.Messages[2].Should().Be("Reprojecting B (3 of 3)");
    }

    [Fact]
    public async Task UpdateProgressAsync_DedupesConsecutiveDuplicateMessages()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);

        // Same message fired three times in a row — should only land once.
        await sut.UpdateProgressAsync(job.JobId, 10, "reproject", "Reprojecting R (1 of 3)");
        await sut.UpdateProgressAsync(job.JobId, 11, "reproject", "Reprojecting R (1 of 3)");
        await sut.UpdateProgressAsync(job.JobId, 12, "reproject", "Reprojecting R (1 of 3)");
        await sut.UpdateProgressAsync(job.JobId, 13, "reproject", "Reprojecting G (2 of 3)");

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.Messages.Should().HaveCount(2);
        updated.Messages[0].Should().Be("Reprojecting R (1 of 3)");
        updated.Messages[1].Should().Be("Reprojecting G (2 of 3)");
    }

    [Fact]
    public async Task UpdateProgressAsync_CapsBufferAtMaxMessages()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);

        // Push 60 distinct messages — only the most recent MaxMessages (50) should remain.
        for (var i = 0; i < 60; i++)
        {
            await sut.UpdateProgressAsync(job.JobId, i % 100, "stretch", $"step {i}");
        }

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.Messages.Should().HaveCount(JobTracker.MaxMessages);
        // Oldest 10 should have been dropped — first remaining is "step 10".
        updated.Messages[0].Should().Be("step 10");
        updated.Messages[^1].Should().Be("step 59");
    }

    // Regression test for round 3/4 of the self-review: concurrent writers
    // (UpdateProgressAsync + UpdateByteProgressAsync) and readers
    // (GetJobAsync, which serializes the snapshot for HTTP/SignalR) must not
    // race on the shared Messages or Metadata. Without round 3/4's locks +
    // snapshot copies, this test would intermittently throw
    // `InvalidOperationException: Collection was modified` from either
    // ToList() over the snapshot's Messages or from the Metadata enumerator.
    [Fact]
    public async Task UpdateProgressAndGetSnapshot_AreConcurrencySafe()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);

        const int writers = 25;
        const int readers = 25;
        const int iterations = 50;

        var writeTasks = Enumerable.Range(0, writers).Select(w => Task.Run(async () =>
        {
            for (var i = 0; i < iterations; i++)
            {
                await sut.UpdateProgressAsync(job.JobId, i % 100, "stretch", $"writer-{w}-step-{i}");
            }
        }));

        var byteWriteTasks = Enumerable.Range(0, writers).Select(_ => Task.Run(async () =>
        {
            for (var i = 0; i < iterations; i++)
            {
                await sut.UpdateByteProgressAsync(job.JobId, i, 100, 1.0, null);
            }
        }));

        var readTasks = Enumerable.Range(0, readers).Select(_ => Task.Run(async () =>
        {
            for (var i = 0; i < iterations; i++)
            {
                var snapshot = await sut.GetJobAsync(job.JobId, TestUserId);
                if (snapshot is null) continue;

                // Force enumeration of both fields — these are the paths
                // System.Text.Json takes when serializing the response.
                _ = snapshot.Messages.Count;
                foreach (var _msg in snapshot.Messages)
                {
                    // observe each entry — would throw on torn enumeration
                }

                if (snapshot.Metadata is not null)
                {
                    foreach (var _kv in snapshot.Metadata)
                    {
                        // ditto for the byte-progress dictionary
                    }
                }
            }
        }));

        await Task.WhenAll(writeTasks.Concat(byteWriteTasks).Concat(readTasks));

        // Final state shouldn't have grown beyond MaxMessages and the lock-protected fields.
        var final = await sut.GetJobAsync(job.JobId, TestUserId);
        final.Should().NotBeNull();
        final!.Messages.Count.Should().BeLessThanOrEqualTo(JobTracker.MaxMessages);
    }

    [Fact]
    public async Task UpdateProgressAsync_DoesNotAppendNullOrEmptyMessage()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);

        await sut.UpdateProgressAsync(job.JobId, 10, "reproject", "real message");
        await sut.UpdateProgressAsync(job.JobId, 20, "reproject", null);
        await sut.UpdateProgressAsync(job.JobId, 30, "reproject", string.Empty);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.Messages.Should().ContainSingle().Which.Should().Be("real message");
    }

    [Fact]
    public async Task UpdateProgressAsync_PreservesStageWhenNull()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);
        await sut.UpdateProgressAsync(job.JobId, 10, "downloading");
        await sut.UpdateProgressAsync(job.JobId, 50);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.Stage.Should().Be("downloading");
    }

    [Fact]
    public async Task UpdateProgressAsync_NoOpsForTerminalJob()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);
        await sut.CompleteJobAsync(job.JobId);

        await sut.UpdateProgressAsync(job.JobId, 10);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.ProgressPercent.Should().Be(100);
        updated.State.Should().Be(JobStates.Completed);
    }

    [Fact]
    public async Task UpdateProgressAsync_NotifiesViaSignalR()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.UpdateProgressAsync(job.JobId, 30, "stage1", "msg");

        mockNotifier.Verify(
            n => n.NotifyProgressAsync(It.Is<JobProgressUpdate>(u =>
                u.JobId == job.JobId &&
                u.ProgressPercent == 30 &&
                u.Stage == "stage1")),
            Times.Once);
    }

    // ===== UpdateByteProgressAsync =====
    [Fact]
    public async Task UpdateByteProgressAsync_SetsMetadataAndProgress()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.UpdateByteProgressAsync(job.JobId, 500, 1000, 100.0, 5.0);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.ProgressPercent.Should().Be(50);
        updated.Metadata.Should().NotBeNull();
        updated.Metadata!["DownloadedBytes"].Should().Be(500L);
        updated.Metadata["TotalBytes"].Should().Be(1000L);
        updated.Metadata["SpeedBytesPerSec"].Should().Be(100.0);
        updated.Metadata["EtaSeconds"].Should().Be(5.0);
    }

    [Fact]
    public async Task UpdateByteProgressAsync_HandlesZeroTotalBytes()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.UpdateByteProgressAsync(job.JobId, 0, 0, 0.0, null);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.ProgressPercent.Should().Be(0);
    }

    [Fact]
    public async Task UpdateByteProgressAsync_SetsFileProgress()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);
        var files = new List<FileDownloadProgress>
        {
            new() { Filename = "file1.fits" },
        };

        await sut.UpdateByteProgressAsync(job.JobId, 500, 1000, 100.0, 5.0, files);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.Metadata.Should().ContainKey("FileProgress");
    }

    // ===== StartJobAsync =====
    [Fact]
    public async Task StartJobAsync_TransitionsToRunning()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.StartJobAsync(job.JobId);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.State.Should().Be(JobStates.Running);
        updated.StartedAt.Should().NotBeNull();
    }

    // ===== CompleteJobAsync =====
    [Fact]
    public async Task CompleteJobAsync_SetsTerminalState()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.CompleteJobAsync(job.JobId, "All done");

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.State.Should().Be(JobStates.Completed);
        updated.ProgressPercent.Should().Be(100);
        updated.Message.Should().Be("All done");
        updated.CompletedAt.Should().NotBeNull();
        updated.ExpiresAt.Should().NotBeNull();
        updated.ExpiresAt.Should().BeAfter(DateTime.UtcNow);
    }

    [Fact]
    public async Task CompleteJobAsync_DefaultsMessageToCompleted()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.CompleteJobAsync(job.JobId);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.Message.Should().Be("Completed");
    }

    [Fact]
    public async Task CompleteJobAsync_NotifiesCompletion()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.CompleteJobAsync(job.JobId);

        mockNotifier.Verify(
            n => n.NotifyCompletedAsync(It.Is<JobCompletionUpdate>(u => u.JobId == job.JobId)),
            Times.Once);
    }

    // ===== CompleteBlobJobAsync =====
    [Fact]
    public async Task CompleteBlobJobAsync_SetsBlobResultFields()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);

        await sut.CompleteBlobJobAsync(
            job.JobId,
            "results/composite.png",
            "image/png",
            "composite.png",
            "Done");

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.State.Should().Be(JobStates.Completed);
        updated.ResultKind.Should().Be(ResultKinds.Blob);
        updated.ResultStorageKey.Should().Be("results/composite.png");
        updated.ResultContentType.Should().Be("image/png");
        updated.ResultFilename.Should().Be("composite.png");
        updated.Message.Should().Be("Done");
        updated.ExpiresAt.Should().NotBeNull();
        updated.LastAccessedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task CompleteBlobJobAsync_DefaultsMessageToCompleted()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);

        await sut.CompleteBlobJobAsync(job.JobId, "key", "type", "file");

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.Message.Should().Be("Completed");
    }

    [Fact]
    public async Task CompleteBlobJobAsync_PersistsWarningHeaders()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);
        var warningHeaders = new Dictionary<string, string>
        {
            ["X-Composite-Budget-Status"] = "warn",
            ["X-Composite-Was-Downscaled"] = "true",
            ["X-Composite-Side-Factor"] = "0.950",
        };

        await sut.CompleteBlobJobAsync(
            job.JobId,
            "results/composite.png",
            "image/png",
            "composite.png",
            warningHeaders: warningHeaders);

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.ResultWarningHeaders.Should().BeEquivalentTo(warningHeaders);
    }

    [Fact]
    public async Task CompleteBlobJobAsync_NullWarningHeaders_LeavesFieldNull()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);

        await sut.CompleteBlobJobAsync(job.JobId, "key", "type", "file");

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.ResultWarningHeaders.Should().BeNull();
    }

    [Fact]
    public async Task CompleteBlobJobAsync_EmptyWarningHeaders_LeavesFieldNull()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);

        await sut.CompleteBlobJobAsync(
            job.JobId,
            "key",
            "type",
            "file",
            warningHeaders: new Dictionary<string, string>());

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.ResultWarningHeaders.Should().BeNull();
    }

    // ===== CompleteDataIdJobAsync =====
    [Fact]
    public async Task CompleteDataIdJobAsync_SetsDataIdResultFields()
    {
        var job = await sut.CreateJobAsync(JobTypes.Mosaic, "Mosaic", TestUserId);

        await sut.CompleteDataIdJobAsync(job.JobId, "data-abc-123", "Mosaic saved");

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.State.Should().Be(JobStates.Completed);
        updated.ResultKind.Should().Be(ResultKinds.DataId);
        updated.ResultDataId.Should().Be("data-abc-123");
        updated.Message.Should().Be("Mosaic saved");
        updated.ExpiresAt.Should().NotBeNull();
    }

    [Fact]
    public async Task CompleteDataIdJobAsync_DefaultsMessageToCompleted()
    {
        var job = await sut.CreateJobAsync(JobTypes.Mosaic, "Mosaic", TestUserId);

        await sut.CompleteDataIdJobAsync(job.JobId, "data-123");

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.Message.Should().Be("Completed");
    }

    // ===== FailJobAsync =====
    [Fact]
    public async Task FailJobAsync_SetsFailedState()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.FailJobAsync(job.JobId, "Connection timed out");

        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.State.Should().Be(JobStates.Failed);
        updated.Error.Should().Be("Connection timed out");
        updated.CompletedAt.Should().NotBeNull();
        updated.ExpiresAt.Should().NotBeNull();
    }

    [Fact]
    public async Task FailJobAsync_NotifiesFailure()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.FailJobAsync(job.JobId, "Boom");

        mockNotifier.Verify(
            n => n.NotifyFailedAsync(It.Is<JobFailureUpdate>(u =>
                u.JobId == job.JobId &&
                u.Error == "Boom")),
            Times.Once);
    }

    // ===== CancelJobAsync =====
    [Fact]
    public async Task CancelJobAsync_OwnerCanCancel()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        var result = await sut.CancelJobAsync(job.JobId, TestUserId);

        result.Should().BeTrue();
        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.State.Should().Be(JobStates.Cancelled);
        updated.CancelRequested.Should().BeTrue();
        updated.CompletedAt.Should().NotBeNull();
        updated.ExpiresAt.Should().NotBeNull();
    }

    [Fact]
    public async Task CancelJobAsync_NonOwnerCannotCancel()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        var result = await sut.CancelJobAsync(job.JobId, OtherUserId);

        result.Should().BeFalse();
        var updated = await sut.GetJobAsync(job.JobId, TestUserId);
        updated!.State.Should().Be(JobStates.Queued);
    }

    [Fact]
    public async Task CancelJobAsync_CannotCancelCompletedJob()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);
        await sut.CompleteJobAsync(job.JobId);

        var result = await sut.CancelJobAsync(job.JobId, TestUserId);

        result.Should().BeFalse();
    }

    [Fact]
    public async Task CancelJobAsync_CannotCancelFailedJob()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);
        await sut.FailJobAsync(job.JobId, "Error");

        var result = await sut.CancelJobAsync(job.JobId, TestUserId);

        result.Should().BeFalse();
    }

    [Fact]
    public async Task CancelJobAsync_CannotCancelAlreadyCancelledJob()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);
        await sut.CancelJobAsync(job.JobId, TestUserId);

        var result = await sut.CancelJobAsync(job.JobId, TestUserId);

        result.Should().BeFalse();
    }

    [Fact]
    public async Task CancelJobAsync_ReturnsFalse_WhenJobNotFound()
    {
        var result = await sut.CancelJobAsync("nonexistent", TestUserId);

        result.Should().BeFalse();
    }

    [Fact]
    public async Task CancelJobAsync_NotifiesCancellation()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        await sut.CancelJobAsync(job.JobId, TestUserId);

        mockNotifier.Verify(
            n => n.NotifyFailedAsync(It.Is<JobFailureUpdate>(u =>
                u.JobId == job.JobId &&
                u.State == "cancelled")),
            Times.Once);
    }

    // ===== GetJobAsync =====
    [Fact]
    public async Task GetJobAsync_ReturnsJobForOwner()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        var result = await sut.GetJobAsync(job.JobId, TestUserId);

        result.Should().NotBeNull();
        result!.JobId.Should().Be(job.JobId);
    }

    [Fact]
    public async Task GetJobAsync_ReturnsNull_ForWrongUser()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        var result = await sut.GetJobAsync(job.JobId, OtherUserId);

        result.Should().BeNull();
    }

    [Fact]
    public async Task GetJobAsync_ReturnsNull_WhenNotFound()
    {
        var result = await sut.GetJobAsync("nonexistent", TestUserId);

        result.Should().BeNull();
    }

    // ===== GetJobInternalAsync =====
    [Fact]
    public async Task GetJobInternalAsync_ReturnsJobWithoutOwnershipCheck()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        var result = await sut.GetJobInternalAsync(job.JobId);

        result.Should().NotBeNull();
        result!.JobId.Should().Be(job.JobId);
    }

    // ===== IsCancelRequested =====
    [Fact]
    public async Task IsCancelRequested_ReturnsTrueAfterCancel()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);
        await sut.CancelJobAsync(job.JobId, TestUserId);

        sut.IsCancelRequested(job.JobId).Should().BeTrue();
    }

    [Fact]
    public async Task IsCancelRequested_ReturnsFalseBeforeCancel()
    {
        var job = await sut.CreateJobAsync(JobTypes.Import, "Import", TestUserId);

        sut.IsCancelRequested(job.JobId).Should().BeFalse();
    }

    [Fact]
    public void IsCancelRequested_ReturnsFalse_WhenJobNotInCache()
    {
        sut.IsCancelRequested("nonexistent").Should().BeFalse();
    }

    // ===== RecordResultAccessAsync =====
    [Fact]
    public async Task RecordResultAccessAsync_ExtendsExpiresAt()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);
        await sut.CompleteJobAsync(job.JobId);

        var beforeAccess = (await sut.GetJobAsync(job.JobId, TestUserId))!.ExpiresAt;

        // Small delay so the new ExpiresAt is measurably different.
        await Task.Delay(50);
        await sut.RecordResultAccessAsync(job.JobId);

        var afterAccess = await sut.GetJobAsync(job.JobId, TestUserId);
        afterAccess!.ExpiresAt.Should().BeOnOrAfter(beforeAccess!.Value);
        afterAccess.LastAccessedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task RecordResultAccessAsync_PersistsToMongo()
    {
        var job = await sut.CreateJobAsync(JobTypes.Composite, "Composite", TestUserId);
        await sut.CompleteJobAsync(job.JobId);

        // Reset invocation count after Complete's persist call.
        mockCollection.Invocations.Clear();

        await sut.RecordResultAccessAsync(job.JobId);

        mockCollection.Verify(
            c => c.ReplaceOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<JobStatus>(),
                It.IsAny<ReplaceOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    // ===== Edge cases =====
    [Fact]
    public async Task UpdateProgressAsync_NoOps_WhenJobNotFound()
    {
        // Should not throw.
        await sut.UpdateProgressAsync("nonexistent", 50);
    }

    [Fact]
    public async Task CompleteJobAsync_NoOps_WhenJobNotFound()
    {
        // Should not throw.
        await sut.CompleteJobAsync("nonexistent");
    }

    [Fact]
    public async Task FailJobAsync_NoOps_WhenJobNotFound()
    {
        // Should not throw.
        await sut.FailJobAsync("nonexistent", "Error");
    }

    [Fact]
    public async Task StartJobAsync_NoOps_WhenJobNotFound()
    {
        // Should not throw.
        await sut.StartJobAsync("nonexistent");
    }

    [Fact]
    public async Task RecordResultAccessAsync_NoOps_WhenJobNotFound()
    {
        // Should not throw.
        await sut.RecordResultAccessAsync("nonexistent");
    }
}
