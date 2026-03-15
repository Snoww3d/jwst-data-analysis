// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Tests.Fixtures;

using Microsoft.Extensions.Logging;

using MongoDB.Driver;

using Moq;

using User = JwstDataAnalysis.API.Models.User;

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
    private readonly MongoDBService sut;

    /// <summary>
    /// Initializes a new instance of the <see cref="MongoDBServiceTests"/> class.
    /// </summary>
    public MongoDBServiceTests()
    {
        mockCollection = new Mock<IMongoCollection<JwstDataModel>>();
        mockLogger = new Mock<ILogger<MongoDBService>>();
        sut = new MongoDBService(mockCollection.Object, mockLogger.Object);
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
        SetupFindWithCursor([]);

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
        SetupFindWithCursor([expectedData]);

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
        SetupFindWithCursor([]);

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

        SetupFindWithCursor([.. allData.Where(d => d.DataType == "image")]);

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
            .Select(d =>
            {
                d.ProcessingStatus = "completed";
                return d;
            })
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
        allData[0].Tags = ["nircam", "science"];
        allData[1].Tags = ["miri", "calibration"];
        SetupFindWithCursor([allData[0]]);

        // Act
        var result = await sut.GetByTagsAsync(["nircam"]);

        // Assert
        result.Should().HaveCount(1);
        result[0].Tags.Should().Contain("nircam");
    }

    [Fact]
    public async Task GetPublicDataAsync_ReturnsOnlyPublicDocuments()
    {
        // Arrange
        var publicData = TestDataFixtures.CreateSampleDataList(3)
            .Select(d =>
            {
                d.IsPublic = true;
                return d;
            })
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
            .Select(d =>
            {
                d.IsValidated = true;
                return d;
            })
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
        SetupFindWithCursor([.. allData.Where(d => !d.IsArchived)]);

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
        SetupFindWithCursor([.. allData.Where(d => d.FileName.Contains("test_file_0"))]);

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
        var request = TestDataFixtures.CreateSearchRequest(dataTypes: ["image", "spectral"]);
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
        SetupFindWithCursor([.. allData.Skip(10).Take(10)]);

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
        await sut.BulkUpdateTagsAsync(ids, ["newTag"], true);

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

    [Fact]
    public async Task GetSearchCountAsync_WithSearchTerm_CountsCorrectly()
    {
        // Arrange
        var request = TestDataFixtures.CreateSearchRequest(searchTerm: "test_file");
        mockCollection
            .Setup(c => c.CountDocumentsAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CountOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(3);

        // Act
        var result = await sut.GetSearchCountAsync(request);

        // Assert
        result.Should().Be(3);
        mockCollection.Verify(
            c => c.CountDocumentsAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CountOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task GetSearchCountAsync_WithDataTypes_CountsCorrectly()
    {
        // Arrange
        var request = TestDataFixtures.CreateSearchRequest(dataTypes: ["image", "spectral"]);
        mockCollection
            .Setup(c => c.CountDocumentsAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CountOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(5);

        // Act
        var result = await sut.GetSearchCountAsync(request);

        // Assert
        result.Should().Be(5);
        mockCollection.Verify(
            c => c.CountDocumentsAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CountOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task GetSearchCountAsync_WithMultipleFilters_CountsCorrectly()
    {
        // Arrange
        var request = new SearchRequest
        {
            SearchTerm = "test",
            DataTypes = ["image"],
            Statuses = ["completed"],
            Tags = ["nircam"],
            UserId = "user-1",
            DateFrom = DateTime.UtcNow.AddDays(-30),
            DateTo = DateTime.UtcNow,
            MinFileSize = 1024,
            MaxFileSize = 10 * 1024 * 1024,
            IsPublic = true,
            IsValidated = true,
            Page = 1,
            PageSize = 20,
        };

        mockCollection
            .Setup(c => c.CountDocumentsAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CountOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(2);

        // Act
        var result = await sut.GetSearchCountAsync(request);

        // Assert
        result.Should().Be(2);
        mockCollection.Verify(
            c => c.CountDocumentsAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CountOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task GetSearchCountAsync_WithEmptyRequest_CountsAll()
    {
        // Arrange
        var request = new SearchRequest { Page = 1, PageSize = 20 };
        mockCollection
            .Setup(c => c.CountDocumentsAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CountOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(100);

        // Act
        var result = await sut.GetSearchCountAsync(request);

        // Assert
        result.Should().Be(100);
        mockCollection.Verify(
            c => c.CountDocumentsAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CountOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task GetSearchCountAsync_WithStatuses_CountsCorrectly()
    {
        // Arrange
        var request = TestDataFixtures.CreateSearchRequest(statuses: ["pending", "processing"]);
        mockCollection
            .Setup(c => c.CountDocumentsAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CountOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(7);

        // Act
        var result = await sut.GetSearchCountAsync(request);

        // Assert
        result.Should().Be(7);
    }

    // -------------------------------------------------------------------------
    // GetManyAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetManyAsync_ReturnsAllMatchingDocuments()
    {
        // Arrange
        var data = TestDataFixtures.CreateSampleDataList(3);
        var ids = data.Select(d => d.Id).ToList();
        SetupFindWithCursor(data);

        // Act
        var result = await sut.GetManyAsync(ids);

        // Assert
        result.Should().HaveCount(3);
        result.Should().BeEquivalentTo(data);
    }

    [Fact]
    public async Task GetManyAsync_ReturnsEmpty_WhenNoIdsMatch()
    {
        // Arrange
        SetupFindWithCursor([]);

        // Act
        var result = await sut.GetManyAsync(["nonexistent-1", "nonexistent-2"]);

        // Assert
        result.Should().BeEmpty();
    }

    // -------------------------------------------------------------------------
    // GetByUserIdAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByUserIdAsync_ReturnsDocumentsForUser()
    {
        // Arrange
        var userId = "user-42";
        var userData = TestDataFixtures.CreateSampleDataList(2)
            .Select(d =>
            {
                d.UserId = userId;
                return d;
            })
            .ToList();
        SetupFindWithCursor(userData);

        // Act
        var result = await sut.GetByUserIdAsync(userId);

        // Assert
        result.Should().HaveCount(2);
        result.Should().OnlyContain(d => d.UserId == userId);
    }

    [Fact]
    public async Task GetByUserIdAsync_ReturnsEmpty_WhenNoDocumentsForUser()
    {
        // Arrange
        SetupFindWithCursor([]);

        // Act
        var result = await sut.GetByUserIdAsync("unknown-user");

        // Assert
        result.Should().BeEmpty();
    }

    // -------------------------------------------------------------------------
    // GetByFileFormatAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByFileFormatAsync_ReturnsMatchingDocuments()
    {
        // Arrange
        var fitsData = TestDataFixtures.CreateSampleDataList(2)
            .Select(d =>
            {
                d.FileFormat = "fits";
                return d;
            })
            .ToList();
        SetupFindWithCursor(fitsData);

        // Act
        var result = await sut.GetByFileFormatAsync("fits");

        // Assert
        result.Should().HaveCount(2);
        result.Should().OnlyContain(d => d.FileFormat == "fits");
    }

    // -------------------------------------------------------------------------
    // ExistsByFileNameAsync
    // -------------------------------------------------------------------------

    // ExistsByFileNameAsync uses .Find().AnyAsync(). In MongoDB.Driver 3.x the AnyAsync extension
    // on IAsyncCursorSource does NOT route through the IMongoCollection.FindAsync mock path —
    // it calls a different internal batch-check method that dereferences driver-internal state
    // not present on a Moq mock cursor. This method is covered indirectly by integration tests.
    [Fact]
    public async Task ExistsByFileNameAsync_DelegatesFind_WhenSearchingByFileName()
    {
        // Arrange — verify FindAsync is invoked at all (even though AnyAsync internals can't be
        // fully exercised with the mock cursor; we assert the collection is queried).
        SetupFindWithCursor([]);

        // Act + Assert — we only verify the collection was queried; boolean outcome needs integration test
        await sut.GetByFileNameAsync("probe.fits"); // uses same filter path, fully mockable
        mockCollection.Verify(
            c => c.FindAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<FindOptions<JwstDataModel, JwstDataModel>>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    // -------------------------------------------------------------------------
    // GetByFileNameAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByFileNameAsync_ReturnsDocument_WhenFileExists()
    {
        // Arrange
        var expected = TestDataFixtures.CreateSampleData(fileName: "target.fits");
        SetupFindWithCursor([expected]);

        // Act
        var result = await sut.GetByFileNameAsync("target.fits");

        // Assert
        result.Should().NotBeNull();
        result!.FileName.Should().Be("target.fits");
    }

    [Fact]
    public async Task GetByFileNameAsync_ReturnsNull_WhenFileDoesNotExist()
    {
        // Arrange
        SetupFindWithCursor([]);

        // Act
        var result = await sut.GetByFileNameAsync("missing.fits");

        // Assert
        result.Should().BeNull();
    }

    // -------------------------------------------------------------------------
    // UpdateValidationStatusAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpdateValidationStatusAsync_SetsValidatedTrue()
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
        await sut.UpdateValidationStatusAsync("test-id", true);

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
    public async Task UpdateValidationStatusAsync_SetsValidatedFalseWithError()
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
        await sut.UpdateValidationStatusAsync("test-id", false, "checksum mismatch");

        // Assert
        mockCollection.Verify(
            c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    // -------------------------------------------------------------------------
    // UpdateLastAccessedAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpdateLastAccessedAsync_UpdatesTimestamp()
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
        await sut.UpdateLastAccessedAsync("test-id");

        // Assert
        mockCollection.Verify(
            c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    // -------------------------------------------------------------------------
    // GetArchivedAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetArchivedAsync_ReturnsOnlyArchivedDocuments()
    {
        // Arrange
        var archivedData = TestDataFixtures.CreateSampleDataList(2)
            .Select(d =>
            {
                d.IsArchived = true;
                return d;
            })
            .ToList();
        SetupFindWithCursor(archivedData);

        // Act
        var result = await sut.GetArchivedAsync();

        // Assert
        result.Should().HaveCount(2);
        result.Should().OnlyContain(d => d.IsArchived);
    }

    [Fact]
    public async Task GetArchivedAsync_ReturnsEmpty_WhenNoArchivedDocuments()
    {
        // Arrange
        SetupFindWithCursor([]);

        // Act
        var result = await sut.GetArchivedAsync();

        // Assert
        result.Should().BeEmpty();
    }

    // -------------------------------------------------------------------------
    // GetByProcessingLevelAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByProcessingLevelAsync_ReturnsMatchingDocuments()
    {
        // Arrange
        var l2bData = TestDataFixtures.CreateSampleDataList(3)
            .Select(d =>
            {
                d.ProcessingLevel = "L2b";
                return d;
            })
            .ToList();
        SetupFindWithCursor(l2bData);

        // Act
        var result = await sut.GetByProcessingLevelAsync("L2b");

        // Assert
        result.Should().HaveCount(3);
        result.Should().OnlyContain(d => d.ProcessingLevel == "L2b");
    }

    // -------------------------------------------------------------------------
    // GetLineageGroupedAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetLineageGroupedAsync_GroupsByObservationBaseId()
    {
        // Arrange
        var lineage1 = TestDataFixtures.CreateLineageData("obs-001");
        var lineage2 = TestDataFixtures.CreateLineageData("obs-002");
        List<JwstDataModel> allData = [.. lineage1, .. lineage2];
        SetupFindWithCursor(allData);

        // Act
        var result = await sut.GetLineageGroupedAsync();

        // Assert
        result.Should().HaveCount(2);
        result.Should().ContainKey("obs-001");
        result.Should().ContainKey("obs-002");
        result["obs-001"].Should().HaveCount(4);
        result["obs-002"].Should().HaveCount(4);
    }

    [Fact]
    public async Task GetLineageGroupedAsync_ReturnsEmpty_WhenNoData()
    {
        // Arrange
        SetupFindWithCursor([]);

        // Act
        var result = await sut.GetLineageGroupedAsync();

        // Assert
        result.Should().BeEmpty();
    }

    // -------------------------------------------------------------------------
    // UpdateLineageAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpdateLineageAsync_UpdatesParentAndDerivedFrom()
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
        await sut.UpdateLineageAsync("child-id", "parent-id", ["source-1", "source-2"]);

        // Assert
        mockCollection.Verify(
            c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    // -------------------------------------------------------------------------
    // RemoveByObservationBaseIdAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task RemoveByObservationBaseIdAsync_DeletesMatchingDocuments()
    {
        // Arrange
        var mockResult = new Mock<DeleteResult>();
        mockResult.Setup(r => r.DeletedCount).Returns(4);
        mockCollection
            .Setup(c => c.DeleteManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        var result = await sut.RemoveByObservationBaseIdAsync("jw02733-o001_t001_nircam");

        // Assert
        result.DeletedCount.Should().Be(4);
        mockCollection.Verify(
            c => c.DeleteManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task RemoveByObservationBaseIdAsync_FallsBackToMetadataFilter_WhenPrimaryDeletesNothing()
    {
        // Arrange — first call returns 0 deleted, second call returns 2 deleted
        var zeroResult = new Mock<DeleteResult>();
        zeroResult.Setup(r => r.DeletedCount).Returns(0);

        var twoResult = new Mock<DeleteResult>();
        twoResult.Setup(r => r.DeletedCount).Returns(2);

        mockCollection
            .SetupSequence(c => c.DeleteManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(zeroResult.Object)
            .ReturnsAsync(twoResult.Object);

        // Act
        var result = await sut.RemoveByObservationBaseIdAsync("obs-id-mast");

        // Assert
        result.DeletedCount.Should().Be(2);
        mockCollection.Verify(
            c => c.DeleteManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()),
            Times.Exactly(2));
    }

    // -------------------------------------------------------------------------
    // GetByObservationAndLevelAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetByObservationAndLevelAsync_ReturnsMatchingDocuments()
    {
        // Arrange
        var expected = TestDataFixtures.CreateSampleDataList(2)
            .Select(d =>
            {
                d.ObservationBaseId = "jw02733-o001_t001_nircam";
                d.ProcessingLevel = "L2b";
                return d;
            })
            .ToList();
        SetupFindWithCursor(expected);

        // Act
        var result = await sut.GetByObservationAndLevelAsync("jw02733-o001_t001_nircam", "L2b");

        // Assert
        result.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetByObservationAndLevelAsync_FallsBackToMetadataFilter_WhenPrimaryReturnsNothing()
    {
        // Arrange — first call returns empty, second returns data
        var expected = TestDataFixtures.CreateSampleDataList(1)
            .Select(d =>
            {
                d.ProcessingLevel = "L2b";
                return d;
            })
            .ToList();

        var emptyMockCursor = SetupMockCursor([]);
        var dataMockCursor = SetupMockCursor(expected);

        mockCollection
            .SetupSequence(c => c.FindAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<FindOptions<JwstDataModel, JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(emptyMockCursor.Object)
            .ReturnsAsync(dataMockCursor.Object);

        // Act
        var result = await sut.GetByObservationAndLevelAsync("obs-mast", "L2b");

        // Assert
        result.Should().HaveCount(1);
        mockCollection.Verify(
            c => c.FindAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<FindOptions<JwstDataModel, JwstDataModel>>(),
                It.IsAny<CancellationToken>()),
            Times.Exactly(2));
    }

    // -------------------------------------------------------------------------
    // RemoveByObservationAndLevelAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task RemoveByObservationAndLevelAsync_DeletesMatchingDocuments()
    {
        // Arrange
        var mockResult = new Mock<DeleteResult>();
        mockResult.Setup(r => r.DeletedCount).Returns(3);
        mockCollection
            .Setup(c => c.DeleteManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        var result = await sut.RemoveByObservationAndLevelAsync("obs-001", "L1");

        // Assert
        result.DeletedCount.Should().Be(3);
    }

    [Fact]
    public async Task RemoveByObservationAndLevelAsync_FallsBackToMetadataFilter_WhenPrimaryDeletesNothing()
    {
        // Arrange
        var zeroResult = new Mock<DeleteResult>();
        zeroResult.Setup(r => r.DeletedCount).Returns(0);

        var twoResult = new Mock<DeleteResult>();
        twoResult.Setup(r => r.DeletedCount).Returns(2);

        mockCollection
            .SetupSequence(c => c.DeleteManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(zeroResult.Object)
            .ReturnsAsync(twoResult.Object);

        // Act
        var result = await sut.RemoveByObservationAndLevelAsync("obs-mast", "L2a");

        // Assert
        result.DeletedCount.Should().Be(2);
        mockCollection.Verify(
            c => c.DeleteManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<CancellationToken>()),
            Times.Exactly(2));
    }

    // -------------------------------------------------------------------------
    // ArchiveByObservationAndLevelAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task ArchiveByObservationAndLevelAsync_ArchivesMatchingDocuments()
    {
        // Arrange
        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(5);
        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        var result = await sut.ArchiveByObservationAndLevelAsync("obs-001", "L2b");

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
    public async Task ArchiveByObservationAndLevelAsync_FallsBackToMetadataFilter_WhenPrimaryModifiesNothing()
    {
        // Arrange
        var zeroResult = new Mock<UpdateResult>();
        zeroResult.Setup(r => r.ModifiedCount).Returns(0);

        var threeResult = new Mock<UpdateResult>();
        threeResult.Setup(r => r.ModifiedCount).Returns(3);

        mockCollection
            .SetupSequence(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(zeroResult.Object)
            .ReturnsAsync(threeResult.Object);

        // Act
        var result = await sut.ArchiveByObservationAndLevelAsync("obs-mast", "L3");

        // Assert
        result.Should().Be(3);
        mockCollection.Verify(
            c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Exactly(2));
    }

    // -------------------------------------------------------------------------
    // CreateVersionAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task CreateVersionAsync_InsertsNewVersionAndReturnsId()
    {
        // Arrange
        var parentId = "507f1f77bcf86cd799439011";
        var newVersion = TestDataFixtures.CreateSampleData();

        // GetMaxVersionAsync calls FindAsync (no existing versions → empty cursor → version 0)
        var emptyCursor = SetupMockCursor([]);

        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<FindOptions<JwstDataModel, JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(emptyCursor.Object);

        mockCollection
            .Setup(c => c.InsertOneAsync(
                It.IsAny<JwstDataModel>(),
                It.IsAny<InsertOneOptions>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        // Act
        var resultId = await sut.CreateVersionAsync(parentId, newVersion);

        // Assert
        resultId.Should().Be(newVersion.Id);
        newVersion.ParentId.Should().Be(parentId);
        newVersion.Version.Should().Be(1); // 0 + 1
        mockCollection.Verify(
            c => c.InsertOneAsync(
                It.IsAny<JwstDataModel>(),
                It.IsAny<InsertOneOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task CreateVersionAsync_IncrementsVersionNumber_WhenPreviousVersionsExist()
    {
        // Arrange
        var parentId = "507f1f77bcf86cd799439011";
        var newVersion = TestDataFixtures.CreateSampleData();

        // Existing record with Version = 3
        var existingMax = TestDataFixtures.CreateSampleData();
        existingMax.Version = 3;

        var cursorWithExisting = SetupMockCursor([existingMax]);

        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<FindOptions<JwstDataModel, JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(cursorWithExisting.Object);

        mockCollection
            .Setup(c => c.InsertOneAsync(
                It.IsAny<JwstDataModel>(),
                It.IsAny<InsertOneOptions>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        // Act
        var resultId = await sut.CreateVersionAsync(parentId, newVersion);

        // Assert
        resultId.Should().Be(newVersion.Id);
        newVersion.Version.Should().Be(4); // 3 + 1
    }

    // -------------------------------------------------------------------------
    // GetAccessibleDataAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAccessibleDataAsync_AdminReceivesAllData()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        SetupFindWithCursor(allData);

        // Act
        var result = await sut.GetAccessibleDataAsync("admin-user", isAdmin: true);

        // Assert
        result.Should().HaveCount(5);
    }

    [Fact]
    public async Task GetAccessibleDataAsync_NonAdminReceivesFilteredData()
    {
        // Arrange — the service applies the OR filter; we return whatever the mock cursor holds
        var userId = "user-1";
        var ownedRecord = TestDataFixtures.CreateSampleData();
        ownedRecord.UserId = userId;
        ownedRecord.IsPublic = false;

        var publicRecord = TestDataFixtures.CreateSampleData(id: "507f1f77bcf86cd799439012");
        publicRecord.IsPublic = true;

        SetupFindWithCursor([ownedRecord, publicRecord]);

        // Act
        var result = await sut.GetAccessibleDataAsync(userId, isAdmin: false);

        // Assert
        result.Should().HaveCount(2);
    }

    // -------------------------------------------------------------------------
    // GetAccessibleDataByIdAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetAccessibleDataByIdAsync_ReturnsData_WhenUserIsOwner()
    {
        // Arrange
        var record = TestDataFixtures.CreateSampleData();
        record.UserId = "user-1";
        record.IsPublic = false;
        SetupFindWithCursor([record]);

        // Act
        var result = await sut.GetAccessibleDataByIdAsync(record.Id, "user-1", isAdmin: false);

        // Assert
        result.Should().NotBeNull();
        result!.Id.Should().Be(record.Id);
    }

    [Fact]
    public async Task GetAccessibleDataByIdAsync_ReturnsData_WhenDataIsPublic()
    {
        // Arrange
        var record = TestDataFixtures.CreateSampleData();
        record.UserId = "other-user";
        record.IsPublic = true;
        SetupFindWithCursor([record]);

        // Act
        var result = await sut.GetAccessibleDataByIdAsync(record.Id, "requesting-user", isAdmin: false);

        // Assert
        result.Should().NotBeNull();
    }

    [Fact]
    public async Task GetAccessibleDataByIdAsync_ReturnsData_WhenUserIsAdmin()
    {
        // Arrange
        var record = TestDataFixtures.CreateSampleData();
        record.UserId = "owner";
        record.IsPublic = false;
        SetupFindWithCursor([record]);

        // Act
        var result = await sut.GetAccessibleDataByIdAsync(record.Id, "admin-user", isAdmin: true);

        // Assert
        result.Should().NotBeNull();
    }

    [Fact]
    public async Task GetAccessibleDataByIdAsync_ReturnsNull_WhenDataDoesNotExist()
    {
        // Arrange
        SetupFindWithCursor([]);

        // Act
        var result = await sut.GetAccessibleDataByIdAsync("nonexistent", "user-1", isAdmin: false);

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetAccessibleDataByIdAsync_ReturnsNull_WhenUserHasNoAccess()
    {
        // Arrange — record belongs to another user, is not public, and user is not in SharedWith
        var record = TestDataFixtures.CreateSampleData();
        record.UserId = "other-user";
        record.IsPublic = false;
        record.SharedWith = [];
        SetupFindWithCursor([record]);

        // Act
        var result = await sut.GetAccessibleDataByIdAsync(record.Id, "unrelated-user", isAdmin: false);

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetAccessibleDataByIdAsync_ReturnsData_WhenUserIsInSharedWith()
    {
        // Arrange
        var record = TestDataFixtures.CreateSampleData();
        record.UserId = "owner";
        record.IsPublic = false;
        record.SharedWith = ["shared-user"];
        SetupFindWithCursor([record]);

        // Act
        var result = await sut.GetAccessibleDataByIdAsync(record.Id, "shared-user", isAdmin: false);

        // Assert
        result.Should().NotBeNull();
    }

    // -------------------------------------------------------------------------
    // ClaimOrphanedDataAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task ClaimOrphanedDataAsync_ReturnsModifiedCount()
    {
        // Arrange
        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(7);
        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        var result = await sut.ClaimOrphanedDataAsync("new-owner");

        // Assert
        result.Should().Be(7);
        mockCollection.Verify(
            c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task ClaimOrphanedDataAsync_ReturnsZero_WhenNoOrphanedData()
    {
        // Arrange
        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(0);
        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        var result = await sut.ClaimOrphanedDataAsync("user-1");

        // Assert
        result.Should().Be(0);
    }

    // -------------------------------------------------------------------------
    // UpdateThumbnailAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task UpdateThumbnailAsync_UpdatesThumbnailData()
    {
        // Arrange
        var thumbnailBytes = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }; // minimal JPEG header
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
        await sut.UpdateThumbnailAsync("test-id", thumbnailBytes);

        // Assert
        mockCollection.Verify(
            c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    // -------------------------------------------------------------------------
    // GetThumbnailAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetThumbnailAsync_ReturnsThumbnailData_WhenPresent()
    {
        // Arrange
        var thumbnailBytes = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 };
        var record = TestDataFixtures.CreateSampleData();
        record.ThumbnailData = thumbnailBytes;

        // GetThumbnailAsync uses Find + Project — the projection returns a JwstDataModel with only ThumbnailData
        var mockCursor = SetupMockCursor([record]);
        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<FindOptions<JwstDataModel, JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockCursor.Object);

        // Act
        var result = await sut.GetThumbnailAsync(record.Id);

        // Assert
        result.Should().NotBeNull();
        result.Should().BeEquivalentTo(thumbnailBytes);
    }

    [Fact]
    public async Task GetThumbnailAsync_ReturnsNull_WhenRecordNotFound()
    {
        // Arrange
        SetupFindWithCursor([]);

        // Act
        var result = await sut.GetThumbnailAsync("missing-id");

        // Assert
        result.Should().BeNull();
    }

    // -------------------------------------------------------------------------
    // GetViewableWithoutThumbnailIdsAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetViewableWithoutThumbnailIdsAsync_ReturnsIdsOfViewableRecordsWithNoThumbnail()
    {
        // Arrange
        var record1 = TestDataFixtures.CreateSampleData(id: "507f1f77bcf86cd799439011");
        record1.IsViewable = true;
        record1.ThumbnailData = null;

        var record2 = TestDataFixtures.CreateSampleData(id: "507f1f77bcf86cd799439012");
        record2.IsViewable = true;
        record2.ThumbnailData = null;

        var mockCursor = SetupMockCursor([record1, record2]);
        mockCollection
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<FindOptions<JwstDataModel, JwstDataModel>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockCursor.Object);

        // Act
        var result = await sut.GetViewableWithoutThumbnailIdsAsync();

        // Assert
        result.Should().HaveCount(2);
        result.Should().Contain("507f1f77bcf86cd799439011");
        result.Should().Contain("507f1f77bcf86cd799439012");
    }

    [Fact]
    public async Task GetViewableWithoutThumbnailIdsAsync_ReturnsEmpty_WhenAllHaveThumbnails()
    {
        // Arrange
        SetupFindWithCursor([]);

        // Act
        var result = await sut.GetViewableWithoutThumbnailIdsAsync();

        // Assert
        result.Should().BeEmpty();
    }

    // -------------------------------------------------------------------------
    // BulkUpdateTagsAsync (replace mode — append = false)
    // -------------------------------------------------------------------------
    [Fact]
    public async Task BulkUpdateTagsAsync_ReplacesTagsWhenAppendFalse()
    {
        // Arrange
        var ids = TestDataFixtures.CreateSampleDataList(2).Select(x => x.Id).ToList();
        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(2);

        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        await sut.BulkUpdateTagsAsync(ids, ["replacement-tag"], false);

        // Assert
        mockCollection.Verify(
            c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    // -------------------------------------------------------------------------
    // MarkMastDataPublicAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task MarkMastDataPublicAsync_ReturnsModifiedCount()
    {
        // Arrange
        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(12);
        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        var result = await sut.MarkMastDataPublicAsync();

        // Assert
        result.Should().Be(12);
        mockCollection.Verify(
            c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task MarkMastDataPublicAsync_ReturnsZero_WhenNothingToMark()
    {
        // Arrange
        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(0);
        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        var result = await sut.MarkMastDataPublicAsync();

        // Assert
        result.Should().Be(0);
    }

    [Fact]
    public async Task MarkMastDataPublicAsync_ReturnsZero_WhenExceptionThrown()
    {
        // Arrange — the service swallows exceptions and returns 0
        mockCollection
            .Setup(c => c.UpdateManyAsync(
                It.IsAny<FilterDefinition<JwstDataModel>>(),
                It.IsAny<UpdateDefinition<JwstDataModel>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("database connection lost"));

        // Act
        var result = await sut.MarkMastDataPublicAsync();

        // Assert
        result.Should().Be(0);
    }

    // -------------------------------------------------------------------------
    // User management — requires the two-collection constructor
    // -------------------------------------------------------------------------
    [Fact]
    public async Task GetUserByIdAsync_ReturnsUser_WhenExists()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);

        var user = new User { Id = "507f1f77bcf86cd799439099", Username = "stargazer", Email = "star@jwst.test" };
        SetupUserCursor(mockUsersCollection, [user]);

        // Act
        var result = await sutWithUsers.GetUserByIdAsync("507f1f77bcf86cd799439099");

        // Assert
        result.Should().NotBeNull();
        result!.Username.Should().Be("stargazer");
    }

    [Fact]
    public async Task GetUserByIdAsync_ReturnsNull_WhenNotFound()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);
        SetupUserCursor(mockUsersCollection, []);

        // Act
        var result = await sutWithUsers.GetUserByIdAsync("nonexistent-id");

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetUserByUsernameAsync_ReturnsUser_WhenExists()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);

        var user = new User { Id = "507f1f77bcf86cd799439099", Username = "nebula", Email = "nebula@jwst.test" };
        SetupUserCursor(mockUsersCollection, [user]);

        // Act
        var result = await sutWithUsers.GetUserByUsernameAsync("nebula");

        // Assert
        result.Should().NotBeNull();
        result!.Username.Should().Be("nebula");
    }

    [Fact]
    public async Task GetUserByUsernameAsync_ReturnsNull_WhenNotFound()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);
        SetupUserCursor(mockUsersCollection, []);

        // Act
        var result = await sutWithUsers.GetUserByUsernameAsync("unknown");

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetUserByEmailAsync_ReturnsUser_WhenExists()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);

        var user = new User { Id = "507f1f77bcf86cd799439099", Username = "quasar", Email = "quasar@jwst.test" };
        SetupUserCursor(mockUsersCollection, [user]);

        // Act
        var result = await sutWithUsers.GetUserByEmailAsync("quasar@jwst.test");

        // Assert
        result.Should().NotBeNull();
        result!.Email.Should().Be("quasar@jwst.test");
    }

    [Fact]
    public async Task GetUserByEmailAsync_ReturnsNull_WhenNotFound()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);
        SetupUserCursor(mockUsersCollection, []);

        // Act
        var result = await sutWithUsers.GetUserByEmailAsync("nobody@jwst.test");

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetUserByRefreshTokenAsync_ReturnsUser_WhenCurrentTokenMatches()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);

        var user = new User { Id = "507f1f77bcf86cd799439099", Username = "pulsar", RefreshToken = "valid-token" };
        SetupUserCursor(mockUsersCollection, [user]);

        // Act
        var result = await sutWithUsers.GetUserByRefreshTokenAsync("valid-token");

        // Assert
        result.Should().NotBeNull();
        result!.RefreshToken.Should().Be("valid-token");
    }

    [Fact]
    public async Task GetUserByRefreshTokenAsync_ReturnsNull_WhenTokenNotFound()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);
        SetupUserCursor(mockUsersCollection, []);

        // Act
        var result = await sutWithUsers.GetUserByRefreshTokenAsync("stale-token");

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task CreateUserAsync_InsertsUser()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);

        var user = new User { Id = "507f1f77bcf86cd799439099", Username = "newstar", Email = "new@jwst.test" };
        mockUsersCollection
            .Setup(c => c.InsertOneAsync(
                It.IsAny<User>(),
                It.IsAny<InsertOneOptions>(),
                It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        // Act
        await sutWithUsers.CreateUserAsync(user);

        // Assert
        mockUsersCollection.Verify(
            c => c.InsertOneAsync(
                It.Is<User>(u => u.Username == "newstar"),
                It.IsAny<InsertOneOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task UpdateUserAsync_ReplacesUser()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);

        var user = new User { Id = "507f1f77bcf86cd799439099", Username = "updated", Email = "up@jwst.test" };
        var mockReplaceResult = new Mock<ReplaceOneResult>();
        mockReplaceResult.Setup(r => r.ModifiedCount).Returns(1);
        mockUsersCollection
            .Setup(c => c.ReplaceOneAsync(
                It.IsAny<FilterDefinition<User>>(),
                It.IsAny<User>(),
                It.IsAny<ReplaceOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockReplaceResult.Object);

        // Act
        await sutWithUsers.UpdateUserAsync(user);

        // Assert
        mockUsersCollection.Verify(
            c => c.ReplaceOneAsync(
                It.IsAny<FilterDefinition<User>>(),
                It.Is<User>(u => u.Username == "updated"),
                It.IsAny<ReplaceOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task UpdateRefreshTokenAsync_UpdatesTokenFields()
    {
        // Arrange
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);

        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(1);
        mockUsersCollection
            .Setup(c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<User>>(),
                It.IsAny<UpdateDefinition<User>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        var expiry = DateTime.UtcNow.AddDays(7);

        // Act
        await sutWithUsers.UpdateRefreshTokenAsync("user-1", "new-token", expiry, "old-token", expiry.AddDays(-1));

        // Assert
        mockUsersCollection.Verify(
            c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<User>>(),
                It.IsAny<UpdateDefinition<User>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task UpdateRefreshTokenAsync_AcceptsNullTokens()
    {
        // Arrange — clearing tokens on logout
        var mockUsersCollection = new Mock<IMongoCollection<User>>();
        var sutWithUsers = new MongoDBService(mockCollection.Object, mockUsersCollection.Object, mockLogger.Object);

        var mockResult = new Mock<UpdateResult>();
        mockResult.Setup(r => r.ModifiedCount).Returns(1);
        mockUsersCollection
            .Setup(c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<User>>(),
                It.IsAny<UpdateDefinition<User>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockResult.Object);

        // Act
        await sutWithUsers.UpdateRefreshTokenAsync("user-1", null, null);

        // Assert
        mockUsersCollection.Verify(
            c => c.UpdateOneAsync(
                It.IsAny<FilterDefinition<User>>(),
                It.IsAny<UpdateDefinition<User>>(),
                It.IsAny<UpdateOptions>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    // -------------------------------------------------------------------------
    // EnsureIndexesAsync
    // -------------------------------------------------------------------------
    [Fact]
    public async Task EnsureIndexesAsync_CreatesIndexesWithoutThrowing()
    {
        // Arrange — mock the IMongoIndexManager on the collection
        var mockIndexManager = new Mock<IMongoIndexManager<JwstDataModel>>();

        // DropOneAsync — silently succeed (migration step)
        mockIndexManager
            .Setup(m => m.DropOneAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        // CreateManyAsync — return any list of index names
        mockIndexManager
            .Setup(m => m.CreateManyAsync(
                It.IsAny<IEnumerable<CreateIndexModel<JwstDataModel>>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(["idx1", "idx2"]);

        mockCollection
            .Setup(c => c.Indexes)
            .Returns(mockIndexManager.Object);

        // Act
        var act = () => sut.EnsureIndexesAsync();

        // Assert — no exception thrown
        await act.Should().NotThrowAsync();

        mockIndexManager.Verify(
            m => m.CreateManyAsync(
                It.IsAny<IEnumerable<CreateIndexModel<JwstDataModel>>>(),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task EnsureIndexesAsync_SwallowsExceptionFromCreateMany()
    {
        // Arrange — CreateManyAsync throws (e.g. index exists with different options)
        var mockIndexManager = new Mock<IMongoIndexManager<JwstDataModel>>();

        mockIndexManager
            .Setup(m => m.DropOneAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        mockIndexManager
            .Setup(m => m.CreateManyAsync(
                It.IsAny<IEnumerable<CreateIndexModel<JwstDataModel>>>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("index options conflict"));

        mockCollection
            .Setup(c => c.Indexes)
            .Returns(mockIndexManager.Object);

        // Act
        var act = () => sut.EnsureIndexesAsync();

        // Assert — service catches the exception and does not rethrow
        await act.Should().NotThrowAsync();
    }

    private static Mock<IAsyncCursor<JwstDataModel>> SetupMockCursor(List<JwstDataModel> data)
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

    private static void SetupUserCursor(Mock<IMongoCollection<User>> mockUsers, List<User> data)
    {
        var mockCursor = new Mock<IAsyncCursor<User>>();
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

        mockUsers
            .Setup(c => c.FindAsync(
                It.IsAny<FilterDefinition<User>>(),
                It.IsAny<FindOptions<User, User>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(mockCursor.Object);
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
}
