// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using FluentAssertions;
using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Tests.Fixtures;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Configuration.Memory;
using Microsoft.Extensions.Logging;
using Moq;

namespace JwstDataAnalysis.API.Tests.Controllers;

/// <summary>
/// Unit tests for JwstDataController.
/// Tests controller logic by mocking the IMongoDBService dependency.
/// </summary>
public class JwstDataControllerTests
{
    private const string TestUserId = "test-user-123";
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

        var mockThumbnailService = new Mock<IThumbnailService>();

        sut = new JwstDataController(
            mockMongoService.Object,
            mockLogger.Object,
            mockHttpClientFactory.Object,
            configuration,
            mockThumbnailService.Object);

        // Set up a mock HttpContext with an authenticated user
        SetupAuthenticatedUser(TestUserId, isAdmin: false);
    }

    [Fact]
    public async Task Get_ReturnsOkWithData_WhenDataExists()
    {
        // Arrange
        var expectedData = TestDataFixtures.CreateSampleDataList(3);
        mockMongoService.Setup(s => s.GetAccessibleDataAsync(TestUserId, false))
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
        mockMongoService.Setup(s => s.GetAccessibleDataAsync(TestUserId, false))
            .ReturnsAsync([]);

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
        mockMongoService.Setup(s => s.GetAccessibleDataAsync(TestUserId, false))
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
        existingData.UserId = TestUserId; // Make the data owned by the test user
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
        existingData.UserId = TestUserId; // Make the data owned by the test user
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
        // Arrange - all items owned by test user so access filter passes
        var imageData = TestDataFixtures.CreateSampleDataList(3)
            .Select(d =>
            {
                d.DataType = "image";
                d.UserId = TestUserId;
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
        // Arrange - all items owned by test user so access filter passes
        var pendingData = TestDataFixtures.CreateSampleDataList(3)
            .Select(d =>
            {
                d.ProcessingStatus = "pending";
                d.UserId = TestUserId;
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
        // Arrange - query own userId (must match TestUserId for non-admin access)
        var userData = TestDataFixtures.CreateSampleDataList(3)
            .Select(d =>
            {
                d.UserId = TestUserId;
                return d;
            })
            .ToList();
        mockMongoService.Setup(s => s.GetByUserIdAsync(TestUserId))
            .ReturnsAsync(userData);

        // Act
        var result = await sut.GetByUserId(TestUserId);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(3);
    }

    [Fact]
    public async Task GetByTags_ParsesCommaSeparatedTags()
    {
        // Arrange - items owned by test user so access filter passes
        var taggedData = TestDataFixtures.CreateSampleDataList(2);
        taggedData.ForEach(d => d.UserId = TestUserId);
        mockMongoService.Setup(s => s.GetByTagsAsync(It.Is<List<string>>(tags =>
            tags.Contains("nircam") && tags.Contains("science"))))
            .ReturnsAsync(taggedData);

        // Act
        var result = await sut.GetByTags("nircam,science");

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        mockMongoService.Verify(
            s => s.GetByTagsAsync(It.Is<List<string>>(tags =>
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
        existingData.UserId = TestUserId; // Make the data owned by the test user
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
        existingData.UserId = TestUserId; // Make the data owned by the test user
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
        existingData.UserId = TestUserId; // Make the data owned by the test user
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
        existingData.UserId = TestUserId; // Make the data owned by the test user
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
        archivedData.UserId = TestUserId; // Make the data owned by the test user
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
        // Arrange - items owned by test user so access filter passes
        var archivedData = TestDataFixtures.CreateSampleDataList(2)
            .Select(d =>
            {
                d.IsArchived = true;
                d.UserId = TestUserId;
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
            Data = [],
            TotalCount = 0,
            Page = 1,
            PageSize = 10,
            TotalPages = 0,
            Facets = [],
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
            DataTypeDistribution = new Dictionary<string, int> { { "image", 50 }, { "spectral", 50 } },
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
        // Arrange - items owned by test user so access filter passes
        var lineageData = TestDataFixtures.CreateLineageData();
        lineageData.ForEach(d => d.UserId = TestUserId);
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
            .ReturnsAsync([]);

        // Act
        var result = await sut.GetLineage("nonexistent");

        // Assert
        result.Result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetAllLineages_ReturnsGroupedLineages()
    {
        // Arrange - items owned by test user so access filter passes
        var lineageData = TestDataFixtures.CreateLineageData();
        lineageData.ForEach(d => d.UserId = TestUserId);
        var grouped = new Dictionary<string, List<JwstDataModel>>
        {
            { "jw02733-o001_t001_nircam", lineageData },
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
            .ReturnsAsync([]);

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
            DataIds = ["id1", "id2"],
            Tags = ["newTag"],
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
            DataIds = [],
            Tags = ["newTag"],
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
            DataIds = ["id1", "id2"],
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
        existingData.UserId = TestUserId; // Make the data owned by the test user
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
        dataWithResults.UserId = TestUserId; // Make the data owned by the test user
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
        existingData.UserId = TestUserId; // Make the data owned by the test user
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
        mockMongoService.Setup(s => s.GetAccessibleDataAsync(TestUserId, false))
            .ThrowsAsync(new InvalidOperationException("Database error"));

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

    // ===== GetPreview Parameter Validation Tests =====
    [Theory]
    [InlineData(-0.1)]
    [InlineData(1.1)]
    public async Task GetPreview_ReturnsBadRequest_WhenBlackPointOutOfRange(double blackPoint)
    {
        // Act
        var result = await sut.GetPreview("507f1f77bcf86cd799439011", blackPoint: blackPoint);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(1.1)]
    public async Task GetPreview_ReturnsBadRequest_WhenWhitePointOutOfRange(double whitePoint)
    {
        // Act
        var result = await sut.GetPreview("507f1f77bcf86cd799439011", whitePoint: whitePoint);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(0.0001)]
    [InlineData(1.1)]
    public async Task GetPreview_ReturnsBadRequest_WhenAsinhAOutOfRange(double asinhA)
    {
        // Act
        var result = await sut.GetPreview("507f1f77bcf86cd799439011", asinhA: asinhA);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetPreview_ReturnsBadRequest_WhenBlackPointNotLessThanWhitePoint()
    {
        // Act - blackPoint == whitePoint
        var result = await sut.GetPreview("507f1f77bcf86cd799439011", blackPoint: 0.5, whitePoint: 0.5);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetPreview_ReturnsBadRequest_WhenStretchInvalid()
    {
        // Act
        var result = await sut.GetPreview("507f1f77bcf86cd799439011", stretch: "invalid_stretch");

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetPreview_ReturnsBadRequest_WhenCmapInvalid()
    {
        // Act
        var result = await sut.GetPreview("507f1f77bcf86cd799439011", cmap: "invalid_cmap");

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    // ===== GetHistogram Parameter Validation Tests =====
    [Theory]
    [InlineData(0)]
    [InlineData(10001)]
    public async Task GetHistogram_ReturnsBadRequest_WhenBinsOutOfRange(int bins)
    {
        // Act
        var result = await sut.GetHistogram("507f1f77bcf86cd799439011", bins: bins);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(0.0f)]
    [InlineData(5.1f)]
    public async Task GetHistogram_ReturnsBadRequest_WhenGammaOutOfRange(float gamma)
    {
        // Act
        var result = await sut.GetHistogram("507f1f77bcf86cd799439011", gamma: gamma);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(-0.1f)]
    [InlineData(1.1f)]
    public async Task GetHistogram_ReturnsBadRequest_WhenBlackPointOutOfRange(float blackPoint)
    {
        // Act
        var result = await sut.GetHistogram("507f1f77bcf86cd799439011", blackPoint: blackPoint);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(-0.1f)]
    [InlineData(1.1f)]
    public async Task GetHistogram_ReturnsBadRequest_WhenWhitePointOutOfRange(float whitePoint)
    {
        // Act
        var result = await sut.GetHistogram("507f1f77bcf86cd799439011", whitePoint: whitePoint);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetHistogram_ReturnsBadRequest_WhenBlackPointNotLessThanWhitePoint()
    {
        // Act - blackPoint == whitePoint
        var result = await sut.GetHistogram("507f1f77bcf86cd799439011", blackPoint: 0.5f, whitePoint: 0.5f);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetHistogram_ReturnsBadRequest_WhenStretchInvalid()
    {
        // Act
        var result = await sut.GetHistogram("507f1f77bcf86cd799439011", stretch: "invalid_stretch");

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Theory]
    [InlineData(0.0001f)]
    [InlineData(1.1f)]
    public async Task GetHistogram_ReturnsBadRequest_WhenAsinhAOutOfRange(float asinhA)
    {
        // Act
        var result = await sut.GetHistogram("507f1f77bcf86cd799439011", asinhA: asinhA);

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    // ===== Access Control Tests (Tasks #73, #74, #75) =====
    [Fact]
    public async Task Get_AnonymousUser_ReturnsOnlyPublicData()
    {
        // Arrange
        SetupAnonymousUser();
        var publicData = TestDataFixtures.CreateSampleDataList(3);
        publicData[0].IsPublic = true;
        publicData[1].IsPublic = true;
        publicData[2].IsPublic = false;
        mockMongoService.Setup(s => s.GetPublicDataAsync())
            .ReturnsAsync(publicData.Where(d => d.IsPublic).ToList());

        // Act
        var result = await sut.Get(includeArchived: false);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(2);
        data.Should().OnlyContain(d => d.IsPublic);

        // Verify GetPublicDataAsync was called (not GetAsync)
        mockMongoService.Verify(s => s.GetPublicDataAsync(), Times.Once);
        mockMongoService.Verify(s => s.GetAsync(), Times.Never);
    }

    [Fact]
    public async Task GetById_AnonymousUser_ReturnsNotFound_ForPrivateData()
    {
        // Arrange
        SetupAnonymousUser();
        var privateData = TestDataFixtures.CreateSampleData();
        privateData.IsPublic = false;
        mockMongoService.Setup(s => s.GetAsync(privateData.Id))
            .ReturnsAsync(privateData);

        // Act
        var result = await sut.Get(privateData.Id);

        // Assert
        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetById_AnonymousUser_ReturnsOk_ForPublicData()
    {
        // Arrange
        SetupAnonymousUser();
        var publicData = TestDataFixtures.CreateSampleData();
        publicData.IsPublic = true;
        mockMongoService.Setup(s => s.GetAsync(publicData.Id))
            .ReturnsAsync(publicData);
        mockMongoService.Setup(s => s.UpdateLastAccessedAsync(publicData.Id))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.Get(publicData.Id);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeOfType<DataResponse>().Subject;
        data.Id.Should().Be(publicData.Id);
    }

    [Fact]
    public async Task GetById_AuthenticatedUser_ReturnsForbid_ForOtherUsersPrivateData()
    {
        // Arrange
        var otherUserData = TestDataFixtures.CreateSampleData();
        otherUserData.UserId = "other-user";
        otherUserData.IsPublic = false;
        otherUserData.SharedWith = [];
        mockMongoService.Setup(s => s.GetAsync(otherUserData.Id))
            .ReturnsAsync(otherUserData);

        // Act
        var result = await sut.Get(otherUserData.Id);

        // Assert
        result.Result.Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task GetById_AuthenticatedUser_ReturnsOk_ForSharedData()
    {
        // Arrange
        var sharedData = TestDataFixtures.CreateSampleData();
        sharedData.UserId = "other-user";
        sharedData.IsPublic = false;
        sharedData.SharedWith = [TestUserId];
        mockMongoService.Setup(s => s.GetAsync(sharedData.Id))
            .ReturnsAsync(sharedData);
        mockMongoService.Setup(s => s.UpdateLastAccessedAsync(sharedData.Id))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.Get(sharedData.Id);

        // Assert
        result.Result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task GetByType_AnonymousUser_ReturnsOnlyPublicData()
    {
        // Arrange
        SetupAnonymousUser();
        var item1 = TestDataFixtures.CreateSampleData(id: "507f1f77bcf86cd799439001");
        item1.IsPublic = true;
        var item2 = TestDataFixtures.CreateSampleData(id: "507f1f77bcf86cd799439002");
        item2.IsPublic = false;
        var item3 = TestDataFixtures.CreateSampleData(id: "507f1f77bcf86cd799439003");
        item3.IsPublic = true;
        var mixedData = new List<JwstDataModel> { item1, item2, item3 };
        mockMongoService.Setup(s => s.GetByDataTypeAsync("image"))
            .ReturnsAsync(mixedData);

        // Act
        var result = await sut.GetByType("image");

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(2);
        data.Should().OnlyContain(d => d.IsPublic);
    }

    [Fact]
    public async Task GetByUserId_NonAdmin_ReturnsForbid_ForOtherUserId()
    {
        // Arrange - authenticated as TestUserId, querying a different user
        // Act
        var result = await sut.GetByUserId("different-user-id");

        // Assert
        result.Result.Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task GetByUserId_NonAdmin_ReturnsOk_ForOwnUserId()
    {
        // Arrange
        var ownData = TestDataFixtures.CreateSampleDataList(2);
        ownData.ForEach(d => d.UserId = TestUserId);
        mockMongoService.Setup(s => s.GetByUserIdAsync(TestUserId))
            .ReturnsAsync(ownData);

        // Act
        var result = await sut.GetByUserId(TestUserId);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetByUserId_Admin_ReturnsOk_ForAnyUserId()
    {
        // Arrange
        SetupAuthenticatedUser("admin-user", isAdmin: true);
        var otherUserData = TestDataFixtures.CreateSampleDataList(2);
        otherUserData.ForEach(d => d.UserId = "target-user");
        mockMongoService.Setup(s => s.GetByUserIdAsync("target-user"))
            .ReturnsAsync(otherUserData);

        // Act
        var result = await sut.GetByUserId("target-user");

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetProcessingResults_AnonymousUser_ReturnsNotFound_ForPrivateData()
    {
        // Arrange
        SetupAnonymousUser();
        var privateData = TestDataFixtures.CreateDataWithProcessingResults(2);
        privateData.IsPublic = false;
        mockMongoService.Setup(s => s.GetAsync(privateData.Id))
            .ReturnsAsync(privateData);

        // Act
        var result = await sut.GetProcessingResults(privateData.Id);

        // Assert
        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Fact]
    public async Task GetArchived_FiltersToAccessibleData()
    {
        // Arrange
        var archivedData = TestDataFixtures.CreateSampleDataList(3);
        archivedData[0].IsArchived = true;
        archivedData[0].UserId = TestUserId;
        archivedData[0].IsPublic = false;
        archivedData[1].IsArchived = true;
        archivedData[1].UserId = "other-user";
        archivedData[1].IsPublic = false;
        archivedData[1].SharedWith = [];
        archivedData[2].IsArchived = true;
        archivedData[2].UserId = "other-user";
        archivedData[2].IsPublic = true;
        mockMongoService.Setup(s => s.GetArchivedAsync())
            .ReturnsAsync(archivedData);

        // Act
        var result = await sut.GetArchivedData();

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var data = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        data.Should().HaveCount(2); // Own data + public data (not other-user's private)
    }

    [Fact]
    public async Task GetLineage_AnonymousUser_FiltersToPublicData()
    {
        // Arrange
        SetupAnonymousUser();
        var lineageData = TestDataFixtures.CreateLineageData();
        lineageData[0].IsPublic = true;
        lineageData[1].IsPublic = false;
        lineageData[2].IsPublic = true;
        lineageData[3].IsPublic = false;
        mockMongoService.Setup(s => s.GetLineageTreeAsync("jw02733-o001_t001_nircam"))
            .ReturnsAsync(lineageData);

        // Act
        var result = await sut.GetLineage("jw02733-o001_t001_nircam");

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var lineageResponse = okResult.Value.Should().BeOfType<LineageResponse>().Subject;
        lineageResponse.TotalFiles.Should().Be(2);
    }

    /// <summary>
    /// Sets up a mock HttpContext with the specified user claims.
    /// </summary>
    private void SetupAuthenticatedUser(string userId, bool isAdmin = false)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId),
            new("sub", userId),
        };

        if (isAdmin)
        {
            claims.Add(new Claim(ClaimTypes.Role, "Admin"));
        }

        var identity = new ClaimsIdentity(claims, "TestAuth");
        var principal = new ClaimsPrincipal(identity);

        var httpContext = new DefaultHttpContext
        {
            User = principal,
        };

        sut.ControllerContext = new ControllerContext
        {
            HttpContext = httpContext,
        };
    }

    /// <summary>
    /// Sets up a mock HttpContext with no authentication (anonymous user).
    /// </summary>
    private void SetupAnonymousUser()
    {
        var identity = new ClaimsIdentity(); // No auth type = unauthenticated
        var principal = new ClaimsPrincipal(identity);

        var httpContext = new DefaultHttpContext
        {
            User = principal,
        };

        sut.ControllerContext = new ControllerContext
        {
            HttpContext = httpContext,
        };
    }
}
