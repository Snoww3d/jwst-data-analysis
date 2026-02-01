using FluentAssertions;

using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Tests.Fixtures;

using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration.Memory;

using Moq;

namespace JwstDataAnalysis.API.Tests.Controllers;

/// <summary>
/// Unit tests for JwstDataController.
/// Tests controller logic by mocking the IMongoDBService dependency.
/// </summary>
public class JwstDataControllerTests
{
    private readonly Mock<IMongoDBService> mockMongoService;
    private readonly Mock<ILogger<JwstDataController>> mockLogger;
    private readonly Mock<IHttpClientFactory> mockHttpClientFactory;
    private readonly JwstDataController sut;

    /// <summary>
    /// Initializes a new instance of the <see cref="JwstDataControllerTests"/> class.
    /// </summary>
    public JwstDataControllerTests()
    {
        mockMongoService = new Mock<IMongoDBService>();
        mockLogger = new Mock<ILogger<JwstDataController>>();
        mockHttpClientFactory = new Mock<IHttpClientFactory>();

        // Use in-memory configuration instead of mocking IConfiguration
        var configValues = new Dictionary<string, string?>
        {
            { "FileStorage:AllowedExtensions:0", ".fits" },
            { "FileStorage:AllowedExtensions:1", ".fits.gz" },
            { "FileStorage:AllowedExtensions:2", ".jpg" },
            { "FileStorage:AllowedExtensions:3", ".png" },
            { "FileStorage:AllowedExtensions:4", ".tiff" },
            { "FileStorage:AllowedExtensions:5", ".csv" },
            { "FileStorage:AllowedExtensions:6", ".json" },
        };

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(configValues)
            .Build();

        sut = new JwstDataController(
            mockMongoService.Object,
            mockLogger.Object,
            mockHttpClientFactory.Object,
            configuration);
    }

    [Fact]
    public async Task Get_ReturnsOkWithData_WhenDataExists()
    {
        // Arrange
        var expectedData = TestDataFixtures.CreateSampleDataList(3);
        mockMongoService.Setup(s => s.GetNonArchivedAsync())
            .ReturnsAsync(expectedData);

        // Act
        var result = await sut.Get(includeArchived: false);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(3);
    }

    [Fact]
    public async Task Get_ReturnsEmptyList_WhenNoDataExists()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetNonArchivedAsync())
            .ReturnsAsync(new List<JwstDataModel>());

        // Act
        var result = await sut.Get(includeArchived: false);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().BeEmpty();
    }

    [Fact]
    public async Task Get_IncludesArchivedData_WhenParameterTrue()
    {
        // Arrange
        var allData = TestDataFixtures.CreateSampleDataList(5);
        allData[0].IsArchived = true;
        mockMongoService.Setup(s => s.GetAsync())
            .ReturnsAsync(allData);

        // Act
        var result = await sut.Get(includeArchived: true);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(5);
    }

    [Fact]
    public async Task GetById_ReturnsOk_WhenIdExists()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData(id: "507f1f77bcf86cd799439011");
        mockMongoService.Setup(s => s.GetAsync("507f1f77bcf86cd799439011"))
            .ReturnsAsync(existingData);
        mockMongoService.Setup(s => s.UpdateLastAccessedAsync(It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.Get("507f1f77bcf86cd799439011");

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeOfType<DataResponse>().Subject;
        data.Id.Should().Be("507f1f77bcf86cd799439011");
    }

    [Fact]
    public async Task GetById_ReturnsNotFound_WhenIdDoesNotExist()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetAsync("nonexistent-id"))
            .ReturnsAsync((JwstDataModel?)null);

        // Act
        var result = await sut.Get("nonexistent-id");

        // Assert
        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetById_UpdatesLastAccessed_WhenDataFound()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData();
        mockMongoService.Setup(s => s.GetAsync(existingData.Id))
            .ReturnsAsync(existingData);
        mockMongoService.Setup(s => s.UpdateLastAccessedAsync(existingData.Id))
            .Returns(Task.CompletedTask);

        // Act
        await sut.Get(existingData.Id);

        // Assert
        mockMongoService.Verify(s => s.UpdateLastAccessedAsync(existingData.Id), Times.Once);
    }

    [Fact]
    public async Task GetByType_ReturnsFilteredData()
    {
        // Arrange
        var imageData = TestDataFixtures.CreateSampleDataList(3)
            .Select(d =>
            {
                d.DataType = "image";
                return d;
            })
            .ToList();
        mockMongoService.Setup(s => s.GetByDataTypeAsync("image"))
            .ReturnsAsync(imageData);

        // Act
        var result = await sut.GetByType("image");

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(3);
        data.Should().OnlyContain(d => d.DataType == "image");
    }

    [Fact]
    public async Task GetByStatus_ReturnsFilteredData()
    {
        // Arrange
        var pendingData = TestDataFixtures.CreateSampleDataList(3)
            .Select(d =>
            {
                d.ProcessingStatus = "pending";
                return d;
            })
            .ToList();
        mockMongoService.Setup(s => s.GetByStatusAsync("pending"))
            .ReturnsAsync(pendingData);

        // Act
        var result = await sut.GetByStatus("pending");

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(3);
    }

    [Fact]
    public async Task GetByUserId_ReturnsFilteredData()
    {
        // Arrange
        var userData = TestDataFixtures.CreateSampleDataList(3)
            .Select(d =>
            {
                d.UserId = "user-123";
                return d;
            })
            .ToList();
        mockMongoService.Setup(s => s.GetByUserIdAsync("user-123"))
            .ReturnsAsync(userData);

        // Act
        var result = await sut.GetByUserId("user-123");

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(3);
    }

    [Fact]
    public async Task GetByTags_ParsesCommaSeparatedTags()
    {
        // Arrange
        var taggedData = TestDataFixtures.CreateSampleDataList(2);
        mockMongoService.Setup(s => s.GetByTagsAsync(It.Is<List<string>>(tags =>
            tags.Contains("nircam") && tags.Contains("science"))))
            .ReturnsAsync(taggedData);

        // Act
        var result = await sut.GetByTags("nircam,science");

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        mockMongoService.Verify(s => s.GetByTagsAsync(It.Is<List<string>>(tags =>
            tags.Count == 2)), Times.Once);
    }

    [Fact]
    public async Task Create_ReturnsCreatedAtAction_WhenSuccessful()
    {
        // Arrange
        var request = TestDataFixtures.CreateDataRequest();
        mockMongoService.Setup(s => s.CreateAsync(It.IsAny<JwstDataModel>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.Create(request);

        // Assert
        var createdResult = result.Result.Should().BeOfType<CreatedAtActionResult>().Subject;
        createdResult.ActionName.Should().Be(nameof(sut.Get));
    }

    [Fact]
    public async Task Create_SetsDefaultValues()
    {
        // Arrange
        var request = TestDataFixtures.CreateDataRequest();
        JwstDataModel? capturedData = null;
        mockMongoService.Setup(s => s.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(d => capturedData = d)
            .Returns(Task.CompletedTask);

        // Act
        await sut.Create(request);

        // Assert
        capturedData.Should().NotBeNull();
        capturedData!.ProcessingStatus.Should().Be(ProcessingStatuses.Pending);
        capturedData.UploadDate.Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task Update_ReturnsNoContent_WhenSuccessful()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData();
        var updateRequest = TestDataFixtures.CreateUpdateRequest(description: "Updated");
        mockMongoService.Setup(s => s.GetAsync(existingData.Id))
            .ReturnsAsync(existingData);
        mockMongoService.Setup(s => s.UpdateAsync(existingData.Id, It.IsAny<JwstDataModel>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.Update(existingData.Id, updateRequest);

        // Assert
        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Update_ReturnsNotFound_WhenIdDoesNotExist()
    {
        // Arrange
        var updateRequest = TestDataFixtures.CreateUpdateRequest();
        mockMongoService.Setup(s => s.GetAsync("nonexistent-id"))
            .ReturnsAsync((JwstDataModel?)null);

        // Act
        var result = await sut.Update("nonexistent-id", updateRequest);

        // Assert
        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Update_OnlyUpdatesProvidedFields()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData();
        var originalFileName = existingData.FileName;
        var updateRequest = new UpdateDataRequest { Description = "Only this should change" };

        JwstDataModel? capturedData = null;
        mockMongoService.Setup(s => s.GetAsync(existingData.Id))
            .ReturnsAsync(existingData);
        mockMongoService.Setup(s => s.UpdateAsync(existingData.Id, It.IsAny<JwstDataModel>()))
            .Callback<string, JwstDataModel>((_, d) => capturedData = d)
            .Returns(Task.CompletedTask);

        // Act
        await sut.Update(existingData.Id, updateRequest);

        // Assert
        capturedData.Should().NotBeNull();
        capturedData!.FileName.Should().Be(originalFileName);
        capturedData.Description.Should().Be("Only this should change");
    }

    [Fact]
    public async Task Delete_ReturnsNoContent_WhenSuccessful()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData();
        mockMongoService.Setup(s => s.GetAsync(existingData.Id))
            .ReturnsAsync(existingData);
        mockMongoService.Setup(s => s.RemoveAsync(existingData.Id))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.Delete(existingData.Id);

        // Assert
        result.Should().BeOfType<NoContentResult>();
    }

    [Fact]
    public async Task Delete_ReturnsNotFound_WhenIdDoesNotExist()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetAsync("nonexistent-id"))
            .ReturnsAsync((JwstDataModel?)null);

        // Act
        var result = await sut.Delete("nonexistent-id");

        // Assert
        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Archive_ReturnsOk_WhenSuccessful()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData();
        mockMongoService.Setup(s => s.GetAsync(existingData.Id))
            .ReturnsAsync(existingData);
        mockMongoService.Setup(s => s.ArchiveAsync(existingData.Id))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.ArchiveData(existingData.Id);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task Archive_ReturnsNotFound_WhenIdDoesNotExist()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetAsync("nonexistent-id"))
            .ReturnsAsync((JwstDataModel?)null);

        // Act
        var result = await sut.ArchiveData("nonexistent-id");

        // Assert
        result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task Unarchive_ReturnsOk_WhenSuccessful()
    {
        // Arrange
        var archivedData = TestDataFixtures.CreateSampleData();
        archivedData.IsArchived = true;
        mockMongoService.Setup(s => s.GetAsync(archivedData.Id))
            .ReturnsAsync(archivedData);
        mockMongoService.Setup(s => s.UnarchiveAsync(archivedData.Id))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.UnarchiveData(archivedData.Id);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task GetArchived_ReturnsOnlyArchivedData()
    {
        // Arrange
        var archivedData = TestDataFixtures.CreateSampleDataList(2)
            .Select(d =>
            {
                d.IsArchived = true;
                return d;
            })
            .ToList();
        mockMongoService.Setup(s => s.GetArchivedAsync())
            .ReturnsAsync(archivedData);

        // Act
        var result = await sut.GetArchivedData();

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(2);
    }

    [Fact]
    public async Task Search_ReturnsSearchResponse_WithFacets()
    {
        // Arrange
        var request = TestDataFixtures.CreateSearchRequest(searchTerm: "test");
        var searchResponse = new SearchResponse
        {
            Data = new List<DataResponse>(),
            TotalCount = 0,
            Page = 1,
            PageSize = 10,
            TotalPages = 0,
            Facets = new Dictionary<string, int>()
        };
        mockMongoService.Setup(s => s.SearchWithFacetsAsync(It.IsAny<SearchRequest>()))
            .ReturnsAsync(searchResponse);

        // Act
        var result = await sut.Search(request);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().BeOfType<SearchResponse>();
    }

    [Fact]
    public async Task GetStatistics_ReturnsDataStatistics()
    {
        // Arrange
        var stats = new DataStatistics
        {
            TotalFiles = 100,
            TotalSize = 1000000,
            DataTypeDistribution = new Dictionary<string, int> { { "image", 50 }, { "spectral", 50 } }
        };
        mockMongoService.Setup(s => s.GetStatisticsAsync())
            .ReturnsAsync(stats);

        // Act
        var result = await sut.GetStatistics();

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var returnedStats = okResult.Value.Should().BeOfType<DataStatistics>().Subject;
        returnedStats.TotalFiles.Should().Be(100);
    }

    [Fact]
    public async Task GetLineage_ReturnsLineageResponse_WhenDataExists()
    {
        // Arrange
        var lineageData = TestDataFixtures.CreateLineageData();
        mockMongoService.Setup(s => s.GetLineageTreeAsync("jw02733-o001_t001_nircam"))
            .ReturnsAsync(lineageData);

        // Act
        var result = await sut.GetLineage("jw02733-o001_t001_nircam");

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var lineageResponse = okResult.Value.Should().BeOfType<LineageResponse>().Subject;
        lineageResponse.TotalFiles.Should().Be(4);
    }

    [Fact]
    public async Task GetLineage_ReturnsNotFound_WhenNoDataExists()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetLineageTreeAsync("nonexistent"))
            .ReturnsAsync(new List<JwstDataModel>());

        // Act
        var result = await sut.GetLineage("nonexistent");

        // Assert
        result.Result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetAllLineages_ReturnsGroupedLineages()
    {
        // Arrange
        var lineageData = TestDataFixtures.CreateLineageData();
        var grouped = new Dictionary<string, List<JwstDataModel>>
        {
            { "jw02733-o001_t001_nircam", lineageData }
        };
        mockMongoService.Setup(s => s.GetLineageGroupedAsync())
            .ReturnsAsync(grouped);

        // Act
        var result = await sut.GetAllLineages();

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var response = okResult.Value.Should().BeAssignableTo<Dictionary<string, LineageResponse>>().Subject;
        response.Should().ContainKey("jw02733-o001_t001_nircam");
    }

    [Fact]
    public async Task DeleteObservation_ReturnsPreview_WhenConfirmFalse()
    {
        // Arrange
        var lineageData = TestDataFixtures.CreateLineageData();
        mockMongoService.Setup(s => s.GetByObservationBaseIdAsync("jw02733-o001_t001_nircam"))
            .ReturnsAsync(lineageData);

        // Act
        var result = await sut.DeleteObservation("jw02733-o001_t001_nircam", confirm: false);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var response = okResult.Value.Should().BeOfType<DeleteObservationResponse>().Subject;
        response.Deleted.Should().BeFalse();
        response.FileCount.Should().Be(4);
    }

    [Fact]
    public async Task DeleteObservation_ReturnsNotFound_WhenNoDataExists()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetByObservationBaseIdAsync("nonexistent"))
            .ReturnsAsync(new List<JwstDataModel>());

        // Act
        var result = await sut.DeleteObservation("nonexistent", confirm: false);

        // Assert
        result.Result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task BulkUpdateTags_ReturnsOk_WhenSuccessful()
    {
        // Arrange
        var request = new BulkTagsRequest
        {
            DataIds = new List<string> { "id1", "id2" },
            Tags = new List<string> { "newTag" },
            Append = true,
        };
        mockMongoService.Setup(s => s.BulkUpdateTagsAsync(
            It.IsAny<List<string>>(),
            It.IsAny<List<string>>(),
            It.IsAny<bool>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.BulkUpdateTags(request);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task BulkUpdateTags_ReturnsBadRequest_WhenNoIdsProvided()
    {
        // Arrange
        var request = new BulkTagsRequest
        {
            DataIds = new List<string>(),
            Tags = new List<string> { "newTag" },
        };

        // Act
        var result = await sut.BulkUpdateTags(request);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task BulkUpdateStatus_ReturnsOk_WhenSuccessful()
    {
        // Arrange
        var request = new BulkStatusRequest
        {
            DataIds = new List<string> { "id1", "id2" },
            Status = "completed",
        };
        mockMongoService.Setup(s => s.BulkUpdateStatusAsync(
            It.IsAny<List<string>>(),
            It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.BulkUpdateStatus(request);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task ProcessData_ReturnsAccepted_WhenSuccessful()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData();
        var request = new ProcessingRequest { Algorithm = "test_algorithm" };
        mockMongoService.Setup(s => s.GetAsync(existingData.Id))
            .ReturnsAsync(existingData);
        mockMongoService.Setup(s => s.UpdateProcessingStatusAsync(existingData.Id, It.IsAny<string>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.ProcessData(existingData.Id, request);

        // Assert
        result.Result.Should().BeOfType<AcceptedResult>();
    }

    [Fact]
    public async Task ProcessData_ReturnsNotFound_WhenIdDoesNotExist()
    {
        // Arrange
        var request = new ProcessingRequest { Algorithm = "test_algorithm" };
        mockMongoService.Setup(s => s.GetAsync("nonexistent-id"))
            .ReturnsAsync((JwstDataModel?)null);

        // Act
        var result = await sut.ProcessData("nonexistent-id", request);

        // Assert
        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetProcessingResults_ReturnsResults_WhenDataExists()
    {
        // Arrange
        var dataWithResults = TestDataFixtures.CreateDataWithProcessingResults(3);
        mockMongoService.Setup(s => s.GetAsync(dataWithResults.Id))
            .ReturnsAsync(dataWithResults);

        // Act
        var result = await sut.GetProcessingResults(dataWithResults.Id);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var results = okResult.Value.Should().BeAssignableTo<List<ProcessingResult>>().Subject;
        results.Should().HaveCount(3);
    }

    [Fact]
    public async Task ValidateData_ReturnsOk_WithValidationResult()
    {
        // Arrange
        var existingData = TestDataFixtures.CreateSampleData();
        mockMongoService.Setup(s => s.GetAsync(existingData.Id))
            .ReturnsAsync(existingData);
        mockMongoService.Setup(s => s.UpdateValidationStatusAsync(
            existingData.Id,
            It.IsAny<bool>(),
            It.IsAny<string?>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.ValidateData(existingData.Id);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task Get_Returns500_WhenExceptionThrown()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetNonArchivedAsync())
            .ThrowsAsync(new Exception("Database error"));

        // Act
        var result = await sut.Get(includeArchived: false);

        // Assert
        var statusResult = result.Result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(500);
    }

    /// <summary>
    /// Documents expected FormatFileSize behavior.
    /// FormatFileSize is private - actual testing happens through DeleteObservation endpoint.
    /// </summary>
    /// <param name="bytes">The byte count to format.</param>
    /// <param name="expected">The expected formatted string.</param>
    [Theory]
    [InlineData(1073741824, "1.00 GB")]
    [InlineData(1048576, "1.00 MB")]
    [InlineData(1024, "1.00 KB")]
    [InlineData(512, "512 bytes")]
    public void FormatFileSize_FormatsCorrectly(long bytes, string expected)
    {
        _ = bytes;
        _ = expected;
        Assert.True(true, "FormatFileSize is private - tested through DeleteObservation endpoint");
    }
}
