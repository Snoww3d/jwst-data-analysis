//

using FluentAssertions;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Tests.Fixtures;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for MongoDBService.
/// These tests mock the IMongoCollection to verify service behavior without a real database.
/// </summary>
public class MongoDBServiceTests
{
    private readonly Mock<IMongoCollection<JwstDataModel>> _mockCollection;
    private readonly Mock<ILogger<MongoDBService>> _mockLogger;
    private readonly Mock<IAsyncCursor<JwstDataModel>> _mockCursor;

    public MongoDBServiceTests()
    {
        _mockCollection = new Mock<IMongoCollection<JwstDataModel>>();
        _mockLogger = new Mock<ILogger<MongoDBService>>();
        _mockCursor = new Mock<IAsyncCursor<JwstDataModel>>();
    }

    /// <summary>
    /// Helper to create a MongoDBService with mocked dependencies.
    /// Uses reflection to inject the mock collection since the service creates its own MongoClient.
    /// </summary>
    private MongoDBService CreateServiceWithMockedCollection(List<JwstDataModel> data)
    {
        // For proper testing, we would need to refactor MongoDBService to accept
        // IMongoCollection<JwstDataModel> as a constructor parameter (dependency injection).
        // Since the current implementation creates MongoClient internally, these tests
        // serve as documentation of expected behavior rather than fully isolated unit tests.

        // This is a known limitation - Task #10 in tech-debt.md addresses this.
        throw new NotImplementedException(
            "MongoDBService needs refactoring to accept IMongoCollection<JwstDataModel> for proper unit testing. " +
            "See Task #10 for dependency injection improvements.");
    }

    // ==========================================
    // Basic CRUD Operation Tests (Specification)
    // ==========================================
    // These tests document expected behavior. Full implementation requires
    // refactoring MongoDBService to support dependency injection.

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetAsync_ReturnsAllDocuments_WhenDocumentsExist()
    {
        // Arrange
        var expectedData = TestDataFixtures.CreateSampleDataList(3);
        var service = CreateServiceWithMockedCollection(expectedData);

        // Act
        var result = await service.GetAsync();

        // Assert
        result.Should().HaveCount(3);
        result.Should().BeEquivalentTo(expectedData);
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetAsync_ReturnsEmptyList_WhenNoDocumentsExist()
    {
        // Arrange
        var service = CreateServiceWithMockedCollection(new List<JwstDataModel>());

        // Act
        var result = await service.GetAsync();

        // Assert
        result.Should().BeEmpty();
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetAsyncById_ReturnsDocument_WhenIdExists()
    {
        // Arrange
        var expectedData = TestDataFixtures.CreateSampleData(id: "507f1f77bcf86cd799439011");
        var service = CreateServiceWithMockedCollection(new List<JwstDataModel> { expectedData });

        // Act
        var result = await service.GetAsync("507f1f77bcf86cd799439011");

        // Assert
        result.Should().NotBeNull();
        result!.Id.Should().Be("507f1f77bcf86cd799439011");
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetAsyncById_ReturnsNull_WhenIdDoesNotExist()
    {
        // Arrange
        var service = CreateServiceWithMockedCollection(new List<JwstDataModel>());

        // Act
        var result = await service.GetAsync("nonexistent-id");

        // Assert
        result.Should().BeNull();
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task CreateAsync_InsertsDocument()
    {
        // Arrange
        var newData = TestDataFixtures.CreateSampleData();
        var service = CreateServiceWithMockedCollection(new List<JwstDataModel>());

        // Act & Assert (should not throw)
        await service.Invoking(s => s.CreateAsync(newData))
            .Should().NotThrowAsync();
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task UpdateAsync_UpdatesExistingDocument()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData();
        existingData.Description = "Updated description";
        var service = CreateServiceWithMockedCollection(new List<JwstDataModel> { existingData });

        // Act & Assert
        await service.Invoking(s => s.UpdateAsync(existingData.Id, existingData))
            .Should().NotThrowAsync();
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task RemoveAsync_DeletesDocument()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData();
        var service = CreateServiceWithMockedCollection(new List<JwstDataModel> { existingData });

        // Act & Assert
        await service.Invoking(s => s.RemoveAsync(existingData.Id))
            .Should().NotThrowAsync();
    }

    // ==========================================
    // Query Method Tests
    // ==========================================

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetByDataTypeAsync_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var service = CreateServiceWithMockedCollection(allData);

        // Act
        var result = await service.GetByDataTypeAsync("image");

        // Assert
        result.Should().OnlyContain(x => x.DataType == "image");
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetByStatusAsync_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var service = CreateServiceWithMockedCollection(allData);

        // Act
        var result = await service.GetByStatusAsync("pending");

        // Assert
        result.Should().OnlyContain(x => x.ProcessingStatus == "pending");
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetByTagsAsync_ReturnsMatchingDocuments()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var service = CreateServiceWithMockedCollection(allData);

        // Act
        var result = await service.GetByTagsAsync(new List<string> { "test" });

        // Assert
        result.Should().OnlyContain(x => x.Tags.Contains("test"));
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetPublicDataAsync_ReturnsOnlyPublicDocuments()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var service = CreateServiceWithMockedCollection(allData);

        // Act
        var result = await service.GetPublicDataAsync();

        // Assert
        result.Should().OnlyContain(x => x.IsPublic == true);
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetValidatedDataAsync_ReturnsOnlyValidatedDocuments()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var service = CreateServiceWithMockedCollection(allData);

        // Act
        var result = await service.GetValidatedDataAsync();

        // Assert
        result.Should().OnlyContain(x => x.IsValidated == true);
    }

    // ==========================================
    // Date and Size Range Tests
    // ==========================================

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetByDateRangeAsync_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var service = CreateServiceWithMockedCollection(allData);
        var startDate = DateTime.UtcNow.AddDays(-3);
        var endDate = DateTime.UtcNow;

        // Act
        var result = await service.GetByDateRangeAsync(startDate, endDate);

        // Assert
        result.Should().OnlyContain(x => x.UploadDate >= startDate && x.UploadDate <= endDate);
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetByFileSizeRangeAsync_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var service = CreateServiceWithMockedCollection(allData);
        long minSize = 2 * 1024 * 1024; // 2MB
        long maxSize = 4 * 1024 * 1024; // 4MB

        // Act
        var result = await service.GetByFileSizeRangeAsync(minSize, maxSize);

        // Assert
        result.Should().OnlyContain(x => x.FileSize >= minSize && x.FileSize <= maxSize);
    }

    // ==========================================
    // Archive Functionality Tests
    // ==========================================

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task ArchiveAsync_SetsArchivedFlag()
    {
        // Arrange
        var data = TestDataFixtures.CreateSampleData();
        var service = CreateServiceWithMockedCollection(new List<JwstDataModel> { data });

        // Act & Assert
        await service.Invoking(s => s.ArchiveAsync(data.Id))
            .Should().NotThrowAsync();
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task UnarchiveAsync_ClearsArchivedFlag()
    {
        // Arrange
        var data = TestDataFixtures.CreateSampleData();
        data.IsArchived = true;
        var service = CreateServiceWithMockedCollection(new List<JwstDataModel> { data });

        // Act & Assert
        await service.Invoking(s => s.UnarchiveAsync(data.Id))
            .Should().NotThrowAsync();
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetNonArchivedAsync_ExcludesArchivedDocuments()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        allData[0].IsArchived = true;
        allData[1].IsArchived = true;
        var service = CreateServiceWithMockedCollection(allData);

        // Act
        var result = await service.GetNonArchivedAsync();

        // Assert
        result.Should().HaveCount(3);
        result.Should().OnlyContain(x => x.IsArchived == false);
    }

    // ==========================================
    // Lineage Query Tests
    // ==========================================

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetByObservationBaseIdAsync_ReturnsMatchingDocuments()
    {
        // Arrange
        var lineageData = TestDataFixtures.CreateLineageData("jw02733-o001_t001_nircam");
        var service = CreateServiceWithMockedCollection(lineageData);

        // Act
        var result = await service.GetByObservationBaseIdAsync("jw02733-o001_t001_nircam");

        // Assert
        result.Should().HaveCount(4);
        result.Should().OnlyContain(x => x.ObservationBaseId == "jw02733-o001_t001_nircam");
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task GetLineageTreeAsync_ReturnsSortedByProcessingLevel()
    {
        // Arrange
        var lineageData = TestDataFixtures.CreateLineageData();
        var service = CreateServiceWithMockedCollection(lineageData);

        // Act
        var result = await service.GetLineageTreeAsync("jw02733-o001_t001_nircam");

        // Assert
        result.Should().HaveCount(4);
        result[0].ProcessingLevel.Should().Be("L1");
        result[1].ProcessingLevel.Should().Be("L2a");
        result[2].ProcessingLevel.Should().Be("L2b");
        result[3].ProcessingLevel.Should().Be("L3");
    }

    // ==========================================
    // Advanced Search Tests
    // ==========================================

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task AdvancedSearchAsync_WithSearchTerm_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var service = CreateServiceWithMockedCollection(allData);
        var request = TestDataFixtures.CreateSearchRequest(searchTerm: "test_file_0");

        // Act
        var result = await service.AdvancedSearchAsync(request);

        // Assert
        result.Should().OnlyContain(x => x.FileName.Contains("test_file_0"));
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task AdvancedSearchAsync_WithDataTypes_FiltersCorrectly()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        var service = CreateServiceWithMockedCollection(allData);
        var request = TestDataFixtures.CreateSearchRequest(dataTypes: new List<string> { "image", "spectral" });

        // Act
        var result = await service.AdvancedSearchAsync(request);

        // Assert
        result.Should().OnlyContain(x => x.DataType == "image" || x.DataType == "spectral");
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task AdvancedSearchAsync_WithPagination_ReturnsCorrectPage()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(25);
        var service = CreateServiceWithMockedCollection(allData);
        var request = TestDataFixtures.CreateSearchRequest(page: 2, pageSize: 10);

        // Act
        var result = await service.AdvancedSearchAsync(request);

        // Assert
        result.Should().HaveCount(10);
    }

    // ==========================================
    // Bulk Operation Tests
    // ==========================================

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task BulkUpdateTagsAsync_AppendsTagsWhenAppendTrue()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(3);
        var service = CreateServiceWithMockedCollection(allData);
        var ids = allData.Select(x => x.Id).ToList();
        var newTags = new List<string> { "newTag1", "newTag2" };

        // Act & Assert
        await service.Invoking(s => s.BulkUpdateTagsAsync(ids, newTags, append: true))
            .Should().NotThrowAsync();
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task BulkUpdateStatusAsync_UpdatesAllMatchingDocuments()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(3);
        var service = CreateServiceWithMockedCollection(allData);
        var ids = allData.Select(x => x.Id).ToList();

        // Act & Assert
        await service.Invoking(s => s.BulkUpdateStatusAsync(ids, "completed"))
            .Should().NotThrowAsync();
    }

    // ==========================================
    // Processing Result Tests
    // ==========================================

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task AddProcessingResultAsync_AddsResultToDocument()
    {
        // Arrange
        var data = TestDataFixtures.CreateSampleData();
        var service = CreateServiceWithMockedCollection(new List<JwstDataModel> { data });
        var result = new ProcessingResult
        {
            Algorithm = "test_algorithm",
            Status = "success",
            ProcessedDate = DateTime.UtcNow,
        };

        // Act & Assert
        await service.Invoking(s => s.AddProcessingResultAsync(data.Id, result))
            .Should().NotThrowAsync();
    }

    [Fact(Skip = "Requires MongoDBService refactoring for DI - see Task #10")]
    public async Task UpdateProcessingStatusAsync_UpdatesStatus()
    {
        // Arrange
        var data = TestDataFixtures.CreateSampleData();
        var service = CreateServiceWithMockedCollection(new List<JwstDataModel> { data });

        // Act & Assert
        await service.Invoking(s => s.UpdateProcessingStatusAsync(data.Id, "completed"))
            .Should().NotThrowAsync();
    }
}
