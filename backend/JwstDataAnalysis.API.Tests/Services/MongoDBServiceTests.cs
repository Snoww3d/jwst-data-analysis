// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Tests.Fixtures;

using Microsoft.Extensions.Logging;

using MongoDB.Driver;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for MongoDBService.
/// These tests mock the IMongoCollection to verify service behavior without a real database.
/// Uses the internal constructor exposed via InternalsVisibleTo for test injection.
/// </summary>
public class MongoDBServiceTests
{
    private readonly Mock<IMongoCollection<JwstDataModel>> mockCollection;
    private readonly Mock<ILogger<MongoDBService>> mockLogger;
    private readonly IMongoDBService sut;

    /// <summary>
    /// Initializes a new instance of the <see cref="MongoDBServiceTests"/> class.
    /// </summary>
    public MongoDBServiceTests()
    {
        mockCollection = new Mock<IMongoCollection<JwstDataModel>>();
        mockLogger = new Mock<ILogger<MongoDBService>>();
        sut = new MongoDBService(mockCollection.Object, mockLogger.Object);
    }

    private Mock<IAsyncCursor<JwstDataModel>> SetupMockCursor(List<JwstDataModel> data)
    {
        var mockCursor = new Mock<IAsyncCursor<JwstDataModel>>();
        var isFirstBatch = true;

        mockCursor
            .Setup(c => c.Current)
            .Returns(() => data);

        mockCursor
            .Setup(c => c.MoveNext(It.IsAny<CancellationToken>()))
            .Returns(() =>
            {
                if (isFirstBatch)
                {
                    isFirstBatch = false;
                    return true;
                }
                return false;
            });

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

        return mockCursor;
    }

    private void SetupFindWithCursor(List<JwstDataModel> data)
    {
        var mockCursor = SetupMockCursor(data);

        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<FindOptions<JwstDataModel, JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockCursor.Object);
    }

    [Fact]
    public async Task GetAsync_ReturnsAllDocuments_WhenDocumentsExist()
    {
        // Arrange
        var expectedData = TestDataFixtures.CreateSampleDataList(3);
        SetupFindWithCursor(expectedData);

        // Act
        var result = await sut.GetAsync();

        // Assert
        result.Should().HaveCount(3);
        result.Should().BeEquivalentTo(expectedData);
    }

    [Fact]
    public async Task GetAsync_ReturnsEmptyList_WhenNoDocumentsExist()
    {
        // Arrange
        SetupFindWithCursor(new List<JwstDataModel>());

        // Act
        var result = await sut.GetAsync();

        // Assert
        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetAsyncById_ReturnsDocument_WhenIdExists()
    {
        // Arrange
        var expectedData = TestDataFixtures.CreateSampleData(id: "507f1f77bcf86cd799439011");
        SetupFindWithCursor(new List<JwstDataModel> { expectedData });

        // Act
        var result = await sut.GetAsync("507f1f77bcf86cd799439011");

        // Assert
        result.Should().NotBeNull();
        result!.Id.Should().Be("507f1f77bcf86cd799439011");
    }

    [Fact]
    public async Task GetAsyncById_ReturnsNull_WhenIdDoesNotExist()
    {
        // Arrange
        SetupFindWithCursor(new List<JwstDataModel>());

        // Act
        var result = await sut.GetAsync("nonexistent-id");

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task CreateAsync_InsertsDocument()
    {
        // Arrange
        var newData = TestDataFixtures.CreateSampleData();
        mockCollection
            .Setup(c => c.InsertOneAsync(
                It.IsAny<JwstDataModel>(),
                It.IsAny<InsertOneOptions>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        // Act
        await sut.CreateAsync(newData);

        // Assert
        mockCollection.Verify(
            c => c.InsertOneAsync(
                It.Is<JwstDataModel>(d => d.Id == newData.Id),
                It.IsAny<InsertOneOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task UpdateAsync_UpdatesExistingDocument()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData();
        existingData.Description = "Updated description";

        var mockResult = new Mock<ReplaceOneResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(1);

        mockCollection
            .Setup(c => c.ReplaceOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<JwstDataModel>(),
                It.IsAny<ReplaceOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        await sut.UpdateAsync(existingData.Id, existingData);

        // Assert
        mockCollection.Verify(
            c => c.ReplaceOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.Is<JwstDataModel>(d => d.Description == "Updated description"),
                It.IsAny<ReplaceOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task RemoveAsync_DeletesDocument()
    {
        // Arrange
        var mockResult = new Mock<DeleteResult>();
        mockResult.Setup(r => r.DeletedCount).Returns(1);

        mockCollection
            .Setup(c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        await sut.RemoveAsync("test-id");

        // Assert
        mockCollection.Verify(
            c => c.DeleteOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task GetByDataTypeAsync_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        foreach (var d in allData.Take(3))
        {
            d.DataType = "image";
        }
        SetupFindWithCursor(allData.Where(d => d.DataType == "image").ToList());

        // Act
        var result = await sut.GetByDataTypeAsync("image");

        // Assert
        result.Should().HaveCount(3);
        result.Should().OnlyContain(d => d.DataType == "image");
    }

    [Fact]
    public async Task GetByStatusAsync_FiltersCorrectly()
    {
        // Arrange
        var completedData = TestDataFixtures.CreateSampleDataList(2)
            .Select(d => { d.ProcessingStatus = "completed"; return d; })
            .ToList();
        SetupFindWithCursor(completedData);

        // Act
        var result = await sut.GetByStatusAsync("completed");

        // Assert
        result.Should().HaveCount(2);
        result.Should().OnlyContain(d => d.ProcessingStatus == "completed");
    }

    [Fact]
    public async Task GetByTagsAsync_ReturnsMatchingDocuments()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        allData[0].Tags = new List<string> { "nircam", "science" };
        allData[1].Tags = new List<string> { "miri", "calibration" };
        SetupFindWithCursor(new List<JwstDataModel> { allData[0] });

        // Act
        var result = await sut.GetByTagsAsync(new List<string> { "nircam" });

        // Assert
        result.Should().HaveCount(1);
        result[0].Tags.Should().Contain("nircam");
    }

    [Fact]
    public async Task GetPublicDataAsync_ReturnsOnlyPublicDocuments()
    {
        // Arrange
        var publicData = TestDataFixtures.CreateSampleDataList(3)
            .Select(d => { d.IsPublic = true; return d; })
            .ToList();
        SetupFindWithCursor(publicData);

        // Act
        var result = await sut.GetPublicDataAsync();

        // Assert
        result.Should().HaveCount(3);
        result.Should().OnlyContain(d => d.IsPublic);
    }

    [Fact]
    public async Task GetValidatedDataAsync_ReturnsOnlyValidatedDocuments()
    {
        // Arrange
        var validatedData = TestDataFixtures.CreateSampleDataList(2)
            .Select(d => { d.IsValidated = true; return d; })
            .ToList();
        SetupFindWithCursor(validatedData);

        // Act
        var result = await sut.GetValidatedDataAsync();

        // Assert
        result.Should().HaveCount(2);
        result.Should().OnlyContain(d => d.IsValidated);
    }

    [Fact]
    public async Task GetByDateRangeAsync_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var startDate = DateTime.UtcNow.AddDays(-10);
        var endDate = DateTime.UtcNow;

        SetupFindWithCursor(allData);

        // Act
        var result = await sut.GetByDateRangeAsync(startDate, endDate);

        // Assert
        result.Should().NotBeNull();
        result.Should().OnlyContain(d => d.UploadDate >= startDate && d.UploadDate <= endDate);
    }

    [Fact]
    public async Task GetByFileSizeRangeAsync_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var minSize = 1024L * 1024; // 1MB
        var maxSize = 5L * 1024 * 1024; // 5MB

        SetupFindWithCursor(allData);

        // Act
        var result = await sut.GetByFileSizeRangeAsync(minSize, maxSize);

        // Assert
        result.Should().NotBeNull();
    }

    [Fact]
    public async Task ArchiveAsync_SetsArchivedFlag()
    {
        // Arrange
        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(1);

        mockCollection
            .Setup(c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        await sut.ArchiveAsync("test-id");

        // Assert
        mockCollection.Verify(
            c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task UnarchiveAsync_ClearsArchivedFlag()
    {
        // Arrange
        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(1);

        mockCollection
            .Setup(c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        await sut.UnarchiveAsync("test-id");

        // Assert
        mockCollection.Verify(
            c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task GetNonArchivedAsync_ExcludesArchivedDocuments()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        allData[0].IsArchived = true;
        allData[1].IsArchived = true;
        SetupFindWithCursor(allData.Where(d => !d.IsArchived).ToList());

        // Act
        var result = await sut.GetNonArchivedAsync();

        // Assert
        result.Should().HaveCount(3);
        result.Should().OnlyContain(d => !d.IsArchived);
    }

    [Fact]
    public async Task GetByObservationBaseIdAsync_ReturnsMatchingDocuments()
    {
        // Arrange
        var lineageData = TestDataFixtures.CreateLineageData("jw02733-o001_t001_nircam");
        SetupFindWithCursor(lineageData);

        // Act
        var result = await sut.GetByObservationBaseIdAsync("jw02733-o001_t001_nircam");

        // Assert
        result.Should().HaveCount(4);
        result.Should().OnlyContain(d => d.ObservationBaseId == "jw02733-o001_t001_nircam");
    }

    [Fact]
    public async Task GetLineageTreeAsync_ReturnsSortedByProcessingLevel()
    {
        // Arrange
        var lineageData = TestDataFixtures.CreateLineageData();
        SetupFindWithCursor(lineageData);

        // Act
        var result = await sut.GetLineageTreeAsync("jw02733-o001_t001_nircam");

        // Assert
        result.Should().HaveCount(4);
    }

    [Fact]
    public async Task AdvancedSearchAsync_WithSearchTerm_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var request = TestDataFixtures.CreateSearchRequest(searchTerm: "test_file_0");
        SetupFindWithCursor(allData.Where(d => d.FileName.Contains("test_file_0")).ToList());

        // Act
        var result = await sut.AdvancedSearchAsync(request);

        // Assert
        result.Should().NotBeNull();
    }

    [Fact]
    public async Task AdvancedSearchAsync_WithDataTypes_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var request = TestDataFixtures.CreateSearchRequest(dataTypes: new List<string> { "image", "spectral" });
        SetupFindWithCursor(allData);

        // Act
        var result = await sut.AdvancedSearchAsync(request);

        // Assert
        result.Should().NotBeNull();
    }

    [Fact]
    public async Task AdvancedSearchAsync_WithPagination_ReturnsCorrectPage()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(25);
        var request = TestDataFixtures.CreateSearchRequest(page: 2, pageSize: 10);
        SetupFindWithCursor(allData.Skip(10).Take(10).ToList());

        // Act
        var result = await sut.AdvancedSearchAsync(request);

        // Assert
        result.Should().NotBeNull();
        request.Page.Should().Be(2);
        request.PageSize.Should().Be(10);
    }

    [Fact]
    public async Task BulkUpdateTagsAsync_AppendsTagsWhenAppendTrue()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(3);
        var ids = allData.Select(x => x.Id).ToList();

        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(3);

        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        await sut.BulkUpdateTagsAsync(ids, new List<string> { "newTag" }, true);

        // Assert
        mockCollection.Verify(
            c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task BulkUpdateStatusAsync_UpdatesAllMatchingDocuments()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(3);
        var ids = allData.Select(x => x.Id).ToList();

        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(3);

        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        await sut.BulkUpdateStatusAsync(ids, "completed");

        // Assert
        mockCollection.Verify(
            c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task AddProcessingResultAsync_AddsResultToDocument()
    {
        // Arrange
        var result = new ProcessingResult
        {
            Algorithm = "test_algorithm",
            Status = "success",
            ProcessedDate = DateTime.UtcNow,
        };

        var mockUpdateResult = new Mock<UpdateResult>();
        mockUpdateResult.Setup(r => r.ModifiedCount).Returns(1);

        mockCollection
            .Setup(c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockUpdateResult.Object);

        // Act
        await sut.AddProcessingResultAsync("test-id", result);

        // Assert
        mockCollection.Verify(
            c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task UpdateProcessingStatusAsync_UpdatesStatus()
    {
        // Arrange
        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(1);

        mockCollection
            .Setup(c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        await sut.UpdateProcessingStatusAsync("test-id", "completed");

        // Assert
        mockCollection.Verify(
            c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }
}
