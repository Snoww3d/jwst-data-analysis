// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for CompositeQueue.
/// </summary>
public class CompositeQueueTests
{
    private readonly CompositeQueue sut = new();

    [Fact]
    public void TryEnqueue_ReturnsTrueWhenNotFull()
    {
        var item = CreateItem("job-1");

        sut.TryEnqueue(item).Should().BeTrue();
    }

    [Fact]
    public void TryEnqueue_ReturnsFalseWhenFull()
    {
        // Fill queue to capacity (10)
        for (int i = 0; i < 10; i++)
        {
            sut.TryEnqueue(CreateItem($"job-{i}")).Should().BeTrue();
        }

        // 11th should fail
        sut.TryEnqueue(CreateItem("overflow")).Should().BeFalse();
    }

    [Fact]
    public async Task Reader_ReturnsEnqueuedItem()
    {
        var item = CreateItem("job-1");
        sut.TryEnqueue(item);

        var result = await sut.Reader.ReadAsync();

        result.JobId.Should().Be("job-1");
    }

    [Fact]
    public async Task Reader_ReturnsItemsInOrder()
    {
        sut.TryEnqueue(CreateItem("first"));
        sut.TryEnqueue(CreateItem("second"));

        var first = await sut.Reader.ReadAsync();
        var second = await sut.Reader.ReadAsync();

        first.JobId.Should().Be("first");
        second.JobId.Should().Be("second");
    }

    private static CompositeJobItem CreateItem(string jobId) => new()
    {
        JobId = jobId,
        Request = new NChannelCompositeRequestDto
        {
            Channels =
            [
                new NChannelConfigDto
                {
                    DataIds = ["id1"],
                    Color = new ChannelColorDto { Hue = 0 },
                },
            ],
        },
    };
}
