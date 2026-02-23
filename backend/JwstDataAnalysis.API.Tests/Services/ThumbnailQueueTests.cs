// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;
using JwstDataAnalysis.API.Services;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for ThumbnailQueue.
/// </summary>
public class ThumbnailQueueTests
{
    private readonly ThumbnailQueue sut = new();

    [Fact]
    public void PendingCount_StartsAtZero()
    {
        sut.PendingCount.Should().Be(0);
    }

    [Fact]
    public void EnqueueBatch_IncrementsPendingCount()
    {
        sut.EnqueueBatch(["id-1", "id-2"]);

        sut.PendingCount.Should().Be(1);
    }

    [Fact]
    public void EnqueueBatch_EmptyList_DoesNotEnqueue()
    {
        sut.EnqueueBatch([]);

        sut.PendingCount.Should().Be(0);
    }

    [Fact]
    public void EnqueueBatch_MultipleBatches_IncrementsPendingCountEachTime()
    {
        sut.EnqueueBatch(["id-1"]);
        sut.EnqueueBatch(["id-2"]);
        sut.EnqueueBatch(["id-3"]);

        sut.PendingCount.Should().Be(3);
    }

    [Fact]
    public void DecrementPending_DecreasesPendingCount()
    {
        sut.EnqueueBatch(["id-1"]);
        sut.EnqueueBatch(["id-2"]);

        sut.DecrementPending();

        sut.PendingCount.Should().Be(1);
    }

    [Fact]
    public async Task EnqueueBatch_WritesToChannel()
    {
        var batch = new List<string> { "id-1", "id-2" };
        sut.EnqueueBatch(batch);

        var result = await sut.Reader.ReadAsync();

        result.Should().BeEquivalentTo(batch);
    }

    [Fact]
    public async Task Reader_ReturnsMultipleBatchesInOrder()
    {
        sut.EnqueueBatch(["a"]);
        sut.EnqueueBatch(["b"]);

        var first = await sut.Reader.ReadAsync();
        var second = await sut.Reader.ReadAsync();

        first.Should().ContainSingle().Which.Should().Be("a");
        second.Should().ContainSingle().Which.Should().Be("b");
    }
}
