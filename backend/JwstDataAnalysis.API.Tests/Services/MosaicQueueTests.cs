// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for MosaicQueue.
/// </summary>
public class MosaicQueueTests
{
    [Fact]
    public void TryEnqueue_Succeeds_WhenNotFull()
    {
        var queue = new MosaicQueue();
        var item = CreateItem("job-1");

        var result = queue.TryEnqueue(item);

        result.Should().BeTrue();
    }

    [Fact]
    public void TryEnqueue_ReturnsFalse_WhenFull()
    {
        var queue = new MosaicQueue();

        // Bounded capacity is 10
        for (var i = 0; i < 10; i++)
        {
            queue.TryEnqueue(CreateItem($"job-{i}")).Should().BeTrue();
        }

        var result = queue.TryEnqueue(CreateItem("job-overflow"));

        result.Should().BeFalse();
    }

    [Fact]
    public async Task Reader_ReturnsEnqueuedItem()
    {
        var queue = new MosaicQueue();
        var item = CreateItem("job-read");

        queue.TryEnqueue(item);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        var read = await queue.Reader.ReadAsync(cts.Token);

        read.JobId.Should().Be("job-read");
        read.SaveToLibrary.Should().BeFalse();
    }

    private static MosaicJobItem CreateItem(string jobId) => new()
    {
        JobId = jobId,
        Request = new MosaicRequestDto
        {
            Files = new List<MosaicFileConfigDto>
            {
                new() { DataId = "id1" },
                new() { DataId = "id2" },
            },
            CombineMethod = "mean",
        },
        UserId = "test-user",
        IsAuthenticated = true,
        IsAdmin = false,
        SaveToLibrary = false,
    };
}
