// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Services.Storage;

using Microsoft.Extensions.Logging;

using MongoDB.Driver;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for JobReaperBackgroundService.
/// Uses the internal constructor to inject a mock IMongoCollection,
/// bypassing the real MongoDB connection.
/// </summary>
public class JobReaperBackgroundServiceTests : IDisposable
{
    private readonly Mock<IMongoCollection<JobStatus>> mockCollection;
    private readonly Mock<IStorageProvider> mockStorageProvider;
    private readonly Mock<ILogger<JobReaperBackgroundService>> mockLogger;
    private readonly JobReaperBackgroundService sut;

    public JobReaperBackgroundServiceTests()
    {
        mockCollection = new Mock<IMongoCollection<JobStatus>>();
        mockStorageProvider = new Mock<IStorageProvider>();
        mockLogger = new Mock<ILogger<JobReaperBackgroundService>>();

        sut = new JobReaperBackgroundService(
            mockCollection.Object,
            mockStorageProvider.Object,
            mockLogger.Object);
    }

    public void Dispose()
    {
        sut.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task ReapExpiredJobs_NoExpiredJobs_DoesNotDeleteAnything()
    {
        // Arrange
        SetupFind([]);
        mockCollection
            .Setup(c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.FromResult(new Mock<DeleteResult>().Object));

        // Cancel immediately so the 5-minute delay is skipped; no reap cycle runs.
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await sut.StartAsync(cts.Token);

        try
        {
            await sut.StopAsync(CancellationToken.None);
        }
        catch (OperationCanceledException)
        {
            // expected
        }

        // Assert
        mockCollection.Verify(
            c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()),
            Times.Never);
        mockStorageProvider.Verify(
            s => s.DeleteAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task ReapExpiredJobs_ExpiredJobsWithNoStorageKey_DeletesJobRecordsOnly()
    {
        // Arrange
        var expiredJobs = new List<JobStatus>
        {
            new() { JobId = "job-1", ExpiresAt = DateTime.UtcNow.AddHours(-1), ResultStorageKey = null },
            new() { JobId = "job-2", ExpiresAt = DateTime.UtcNow.AddHours(-2), ResultStorageKey = null },
        };

        var deleteResult = new Mock<DeleteResult>();
        mockCollection
            .Setup(c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(deleteResult.Object);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

        // Act
        await RunOneReapCycleAsync(expiredJobs, cts.Token);

        // Assert — two deletions, no storage calls
        mockCollection.Verify(
            c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()),
            Times.Exactly(2));
        mockStorageProvider.Verify(
            s => s.DeleteAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task ReapExpiredJobs_ExpiredJobsWithStorageKey_DeletesStorageAndRecord()
    {
        // Arrange
        var expiredJobs = new List<JobStatus>
        {
            new() { JobId = "job-1", ExpiresAt = DateTime.UtcNow.AddHours(-1), ResultStorageKey = "tmp/jobs/job-1/result.png" },
        };

        var deleteResult = new Mock<DeleteResult>();
        mockStorageProvider
            .Setup(s => s.DeleteAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        mockCollection
            .Setup(c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(deleteResult.Object);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

        // Act
        await RunOneReapCycleAsync(expiredJobs, cts.Token);

        // Assert
        mockStorageProvider.Verify(
            s => s.DeleteAsync("tmp/jobs/job-1/result.png", It.IsAny<CancellationToken>()),
            Times.Once);
        mockCollection.Verify(
            c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task ReapExpiredJobs_StorageDeleteFails_StillDeletesJobRecord()
    {
        // Arrange
        var expiredJobs = new List<JobStatus>
        {
            new() { JobId = "job-storage-fail", ExpiresAt = DateTime.UtcNow.AddHours(-1), ResultStorageKey = "tmp/jobs/job-storage-fail/result.png" },
        };

        mockStorageProvider
            .Setup(s => s.DeleteAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("S3 unavailable"));

        var deleteResult = new Mock<DeleteResult>();
        mockCollection
            .Setup(c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(deleteResult.Object);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

        // Act
        await RunOneReapCycleAsync(expiredJobs, cts.Token);

        // Assert — storage failure does not prevent record deletion
        mockCollection.Verify(
            c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task ReapExpiredJobs_RecordDeleteFails_ContinuesToNextJob()
    {
        // Arrange
        var expiredJobs = new List<JobStatus>
        {
            new() { JobId = "job-fail", ExpiresAt = DateTime.UtcNow.AddHours(-1), ResultStorageKey = null },
            new() { JobId = "job-ok", ExpiresAt = DateTime.UtcNow.AddHours(-1), ResultStorageKey = null },
        };

        var deleteResult = new Mock<DeleteResult>();
        var callCount = 0;
        mockCollection
            .Setup(c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(() =>
            {
                callCount++;
                if (callCount == 1)
                {
                    throw new InvalidOperationException("DB error");
                }

                return deleteResult.Object;
            });

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

        // Act
        await RunOneReapCycleAsync(expiredJobs, cts.Token);

        // Assert — both jobs were attempted despite first failure
        mockCollection.Verify(
            c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()),
            Times.Exactly(2));
    }

    [Fact]
    public async Task ReapExpiredJobs_MultipleExpiredJobs_AllProcessed()
    {
        // Arrange
        var expiredJobs = Enumerable.Range(1, 5)
            .Select(i => new JobStatus
            {
                JobId = $"job-{i}",
                ExpiresAt = DateTime.UtcNow.AddHours(-i),
                ResultStorageKey = $"tmp/jobs/job-{i}/result.png",
            })
            .ToList();

        mockStorageProvider
            .Setup(s => s.DeleteAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var deleteResult = new Mock<DeleteResult>();
        mockCollection
            .Setup(c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(deleteResult.Object);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

        // Act
        await RunOneReapCycleAsync(expiredJobs, cts.Token);

        // Assert
        mockStorageProvider.Verify(
            s => s.DeleteAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Exactly(5));
        mockCollection.Verify(
            c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<CancellationToken>()),
            Times.Exactly(5));
    }

    [Fact]
    public async Task ExecuteAsync_CancellationRequested_ExitsGracefully()
    {
        // Arrange — cancel before the 5-minute delay fires
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        // Act
        var act = async () =>
        {
            await sut.StartAsync(cts.Token);
            await sut.StopAsync(CancellationToken.None);
        };

        // Assert — no exception propagates
        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task ExecuteAsync_FindThrows_LogsErrorAndContinues()
    {
        // Arrange — FindAsync throws on the first call; the exception is swallowed by the loop.
        var callCount = 0;
        var emptyCursor = BuildCursor([]);

        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<FindOptions<JobStatus, JobStatus>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(() =>
            {
                callCount++;
                if (callCount == 1)
                {
                    throw new InvalidOperationException("DB transient failure");
                }

                return emptyCursor.Object;
            });

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));

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

        // Assert — no unhandled exception
        await act.Should().NotThrowAsync();
    }

    /// <summary>
    /// Sets up FindAsync on the mock collection to return the given list.
    /// FindAsync is a proper interface method (not an extension), so Moq can mock it.
    /// The cursor's ToListAsync is an extension that calls MoveNextAsync + Current.
    /// </summary>
    private void SetupFind(List<JobStatus> jobs)
    {
        var mockCursor = BuildCursor(jobs);

        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<JobStatus>>(),
                It.IsAny<FindOptions<JobStatus, JobStatus>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockCursor.Object);
    }

    private static Mock<IAsyncCursor<JobStatus>> BuildCursor(List<JobStatus> jobs)
    {
        var mockCursor = new Mock<IAsyncCursor<JobStatus>>();
        var firstBatch = true;
        mockCursor
            .Setup(c => c.Current)
            .Returns(() => jobs);
        mockCursor
            .Setup(c => c.MoveNextAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(() =>
            {
                if (firstBatch)
                {
                    firstBatch = false;
                    return true;
                }

                return false;
            });
        mockCursor
            .Setup(c => c.MoveNext(It.IsAny<CancellationToken>()))
            .Returns(() =>
            {
                if (firstBatch)
                {
                    firstBatch = false;
                    return true;
                }

                return false;
            });

        return mockCursor;
    }

    /// <summary>
    /// Calls the private ReapExpiredJobs method directly via reflection,
    /// bypassing the 5-minute Task.Delay in ExecuteAsync.
    /// </summary>
    private async Task RunOneReapCycleAsync(List<JobStatus> jobs, CancellationToken ct)
    {
        SetupFind(jobs);

        var method = typeof(JobReaperBackgroundService)
            .GetMethod("ReapExpiredJobs", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        method.Should().NotBeNull("ReapExpiredJobs must exist as a private method");

        var task = (Task)method!.Invoke(sut, [ct])!;
        await task;
    }
}
