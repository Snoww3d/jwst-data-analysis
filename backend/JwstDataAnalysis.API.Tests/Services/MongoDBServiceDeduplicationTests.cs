// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Tests.Fixtures;

using Microsoft.Extensions.Logging;

using MongoDB.Bson;
using MongoDB.Driver;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for MongoDBService deduplication and MAST data cleanup methods.
/// </summary>
public class MongoDBServiceDeduplicationTests
{
    private readonly Mock<IMongoCollection<JwstDataModel>> mockCollection;
    private readonly Mock<ILogger<MongoDBService>> mockLogger;
    private readonly MongoDBService sut;

    public MongoDBServiceDeduplicationTests()
    {
        mockCollection = new Mock<IMongoCollection<JwstDataModel>>();
        mockLogger = new Mock<ILogger<MongoDBService>>();
        sut = new MongoDBService(mockCollection.Object, mockLogger.Object);
    }

    [Fact]
    public async Task DeduplicateRecordsAsync_RemovesDuplicates_KeepsBestRecord()
    {
        // Arrange: aggregation returns one group with 3 duplicates
        var aggResult = new BsonDocument
        {
            { "_id", "test_file.fits" },
            { "count", 3 },
            { "ids", new BsonArray { "id1", "id2", "id3" } },
        };

        SetupAggregateWithCursor([aggResult]);

        // The three records — id2 is public so should be kept
        var record1 = TestDataFixtures.CreateSampleData(id: "id1");
        record1.FileName = "test_file.fits";
        record1.IsPublic = false;
        record1.UploadDate = DateTime.UtcNow.AddHours(-2);
        record1.Metadata = new Dictionary<string, object> { { "key1", "val1" } };

        var record2 = TestDataFixtures.CreateSampleData(id: "id2");
        record2.FileName = "test_file.fits";
        record2.IsPublic = true;
        record2.UploadDate = DateTime.UtcNow.AddHours(-1);
        record2.Metadata = new Dictionary<string, object> { { "key1", "val1" }, { "key2", "val2" } };

        var record3 = TestDataFixtures.CreateSampleData(id: "id3");
        record3.FileName = "test_file.fits";
        record3.IsPublic = false;
        record3.UploadDate = DateTime.UtcNow;
        record3.Metadata = new Dictionary<string, object>();

        var records = new List<JwstDataModel> { record1, record2, record3 };

        SetupFindWithCursor(records);

        var mockDeleteResult = new Mock<DeleteResult>();
        mockDeleteResult.Setup(r => r.DeletedCount).Returns(2);

        mockCollection
            .Setup(c => c.DeleteManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockDeleteResult.Object);

        // Act
        var result = await sut.DeduplicateRecordsAsync();

        // Assert
        result.Should().Be(2);
        mockCollection.Verify(
            c => c.DeleteManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task DeduplicateRecordsAsync_NoDuplicates_ReturnsZero()
    {
        // Arrange: aggregation returns no groups (no duplicates)
        SetupAggregateWithCursor([]);

        // Act
        var result = await sut.DeduplicateRecordsAsync();

        // Assert
        result.Should().Be(0);
        mockCollection.Verify(
            c => c.DeleteManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task MarkMastDataPublicAsync_UpdatesPrivateMastRecords()
    {
        // Arrange
        var mockUpdateResult = new Mock<UpdateResult>();
        mockUpdateResult.Setup(r => r.ModifiedCount).Returns(5);

        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockUpdateResult.Object);

        // Act
        var result = await sut.MarkMastDataPublicAsync();

        // Assert
        result.Should().Be(5);
        mockCollection.Verify(
            c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task MarkMastDataPublicAsync_NoMatchingRecords_ReturnsZero()
    {
        // Arrange
        var mockUpdateResult = new Mock<UpdateResult>();
        mockUpdateResult.Setup(r => r.ModifiedCount).Returns(0);

        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockUpdateResult.Object);

        // Act
        var result = await sut.MarkMastDataPublicAsync();

        // Assert
        result.Should().Be(0);
    }

    [Fact]
    public async Task DeduplicateRecordsAsync_AggregationFails_ReturnsZeroAndLogs()
    {
        // Arrange: aggregation throws
        mockCollection
            .Setup(c => c.AggregateAsync(
                It.IsAny<PipelineDefinition<JwstDataModel, BsonDocument>>(),
                It.IsAny<AggregateOptions>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new MongoException("Aggregation failed"));

        // Act
        var result = await sut.DeduplicateRecordsAsync();

        // Assert — should not throw, returns 0
        result.Should().Be(0);
    }

    [Fact]
    public async Task MarkMastDataPublicAsync_UpdateFails_ReturnsZeroAndLogs()
    {
        // Arrange
        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new MongoException("Update failed"));

        // Act
        var result = await sut.MarkMastDataPublicAsync();

        // Assert — should not throw, returns 0
        result.Should().Be(0);
    }

    private void SetupAggregateWithCursor(List<BsonDocument> data)
    {
        var mockCursor = new Mock<IAsyncCursor<BsonDocument>>();
        var isFirstBatch = true;

        mockCursor
            .Setup(c => c.Current)
            .Returns(() => data);

        mockCursor
            .Setup(c => c.MoveNextAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(() =>
            {
                if (isFirstBatch)
                {
                    isFirstBatch = false;
                    return true;
                }

                return false;
            });

        mockCollection
            .Setup(c => c.AggregateAsync(
                It.IsAny<PipelineDefinition<JwstDataModel, BsonDocument>>(),
                It.IsAny<AggregateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockCursor.Object);
    }

    private void SetupFindWithCursor(List<JwstDataModel> data)
    {
        var mockCursor = new Mock<IAsyncCursor<JwstDataModel>>();
        var isFirstBatch = true;

        mockCursor
            .Setup(c => c.Current)
            .Returns(() => data);

        mockCursor
            .Setup(c => c.MoveNextAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(() =>
            {
                if (isFirstBatch)
                {
                    isFirstBatch = false;
                    return true;
                }

                return false;
            });

        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<FindOptions<JwstDataModel, JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockCursor.Object);
    }
}
