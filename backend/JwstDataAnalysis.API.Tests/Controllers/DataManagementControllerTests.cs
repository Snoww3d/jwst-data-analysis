// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using FluentAssertions;

using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Controllers;

/// <summary>
/// Unit tests for DataManagementController.
/// Covers search, statistics, bulk operations, export, import, and migration endpoints.
/// </summary>
public class DataManagementControllerTests
{
    private const string TestUserId = "test-user-123";
    private readonly Mock<IMongoDBService> mockMongoService = new();
    private readonly Mock<IDataScanService> mockDataScanService = new();
    private readonly Mock<ILogger<DataManagementController>> mockLogger = new();
    private readonly DataManagementController sut;

    public DataManagementControllerTests()
    {
        sut = new DataManagementController(mockMongoService.Object, mockDataScanService.Object, mockLogger.Object);
        SetupAuthenticatedUser(TestUserId);
    }

    // ========== Search Tests ==========
    [Fact]
    public async Task Search_ReturnsOk_WithResults()
    {
        // Arrange
        var request = new SearchRequest { SearchTerm = "NGC" };
        var response = new SearchResponse
        {
            Data = [new DataResponse { Id = "1", FileName = "test.fits", IsPublic = true, UserId = TestUserId }],
            TotalCount = 1,
            TotalPages = 1,
        };
        mockMongoService.Setup(s => s.SearchWithFacetsAsync(request))
            .ReturnsAsync(response);

        // Act
        var result = await sut.Search(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var searchResponse = okResult.Value.Should().BeOfType<SearchResponse>().Subject;
        searchResponse.Data.Should().HaveCount(1);
    }

    [Fact]
    public async Task Search_FiltersNonPublicData_ForNonAdminUser()
    {
        // Arrange
        var request = new SearchRequest { SearchTerm = "test" };
        var response = new SearchResponse
        {
            Data =
            [
                new DataResponse { Id = "1", FileName = "public.fits", IsPublic = true, UserId = "other-user" },
                new DataResponse { Id = "2", FileName = "private.fits", IsPublic = false, UserId = "other-user" },
                new DataResponse { Id = "3", FileName = "own.fits", IsPublic = false, UserId = TestUserId },
            ],
            TotalCount = 3,
            TotalPages = 1,
        };
        mockMongoService.Setup(s => s.SearchWithFacetsAsync(request))
            .ReturnsAsync(response);

        // Act
        var result = await sut.Search(request);

        // Assert — non-admin should only see public + own data
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var searchResponse = okResult.Value.Should().BeOfType<SearchResponse>().Subject;
        searchResponse.Data.Should().HaveCount(2);
        searchResponse.Data.Should().Contain(d => d.Id == "1"); // public
        searchResponse.Data.Should().Contain(d => d.Id == "3"); // own
        searchResponse.Data.Should().NotContain(d => d.Id == "2"); // other's private
        searchResponse.TotalCount.Should().Be(2);
    }

    [Fact]
    public async Task Search_ReturnsAllData_ForAdmin()
    {
        // Arrange
        SetupAdminUser(TestUserId);
        var request = new SearchRequest { SearchTerm = "test" };
        var response = new SearchResponse
        {
            Data =
            [
                new DataResponse { Id = "1", FileName = "public.fits", IsPublic = true, UserId = "other-user" },
                new DataResponse { Id = "2", FileName = "private.fits", IsPublic = false, UserId = "other-user" },
                new DataResponse { Id = "3", FileName = "own.fits", IsPublic = false, UserId = TestUserId },
            ],
            TotalCount = 3,
            TotalPages = 1,
        };
        mockMongoService.Setup(s => s.SearchWithFacetsAsync(request))
            .ReturnsAsync(response);

        // Act
        var result = await sut.Search(request);

        // Assert — admin should see all data
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var searchResponse = okResult.Value.Should().BeOfType<SearchResponse>().Subject;
        searchResponse.Data.Should().HaveCount(3);
    }

    [Fact]
    public async Task Search_Returns500_OnException()
    {
        // Arrange
        var request = new SearchRequest { SearchTerm = "test" };
        mockMongoService.Setup(s => s.SearchWithFacetsAsync(request))
            .ThrowsAsync(new InvalidOperationException("Database error"));

        // Act
        var result = await sut.Search(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== GetStatistics Tests ==========
    [Fact]
    public async Task GetStatistics_ReturnsOk()
    {
        // Arrange
        var stats = new DataStatistics { TotalFiles = 42, TotalSize = 1024 };
        mockMongoService.Setup(s => s.GetStatisticsAsync())
            .ReturnsAsync(stats);

        // Act
        var result = await sut.GetStatistics();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(stats);
    }

    [Fact]
    public async Task GetStatistics_Returns500_OnException()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetStatisticsAsync())
            .ThrowsAsync(new InvalidOperationException("Database error"));

        // Act
        var result = await sut.GetStatistics();

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== GetPublicData Tests ==========
    [Fact]
    public async Task GetPublicData_ReturnsOk()
    {
        // Arrange
        var data = new List<JwstDataModel>
        {
            new() { Id = "1", FileName = "public.fits", IsPublic = true },
        };
        mockMongoService.Setup(s => s.GetPublicDataAsync())
            .ReturnsAsync(data);

        // Act
        var result = await sut.GetPublicData();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var responseList = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        responseList.Should().HaveCount(1);
    }

    [Fact]
    public async Task GetPublicData_Returns500_OnException()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetPublicDataAsync())
            .ThrowsAsync(new InvalidOperationException("Database error"));

        // Act
        var result = await sut.GetPublicData();

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== GetValidatedData Tests ==========
    [Fact]
    public async Task GetValidatedData_ReturnsOk()
    {
        // Arrange
        var data = new List<JwstDataModel>
        {
            new() { Id = "1", FileName = "validated.fits", IsPublic = true, IsValidated = true },
        };
        mockMongoService.Setup(s => s.GetValidatedDataAsync())
            .ReturnsAsync(data);

        // Act
        var result = await sut.GetValidatedData();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var responseList = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        responseList.Should().HaveCount(1);
    }

    [Fact]
    public async Task GetValidatedData_FiltersInaccessibleData()
    {
        // Arrange — non-admin, non-owner, non-shared data should be filtered
        var data = new List<JwstDataModel>
        {
            new() { Id = "1", FileName = "public.fits", IsPublic = true, UserId = "other-user" },
            new() { Id = "2", FileName = "private.fits", IsPublic = false, UserId = "other-user" },
            new() { Id = "3", FileName = "own.fits", IsPublic = false, UserId = TestUserId },
            new() { Id = "4", FileName = "shared.fits", IsPublic = false, UserId = "other-user", SharedWith = [TestUserId] },
        };
        mockMongoService.Setup(s => s.GetValidatedDataAsync())
            .ReturnsAsync(data);

        // Act
        var result = await sut.GetValidatedData();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var responseList = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        responseList.Should().HaveCount(3); // public + own + shared
        responseList.Should().Contain(d => d.Id == "1");
        responseList.Should().Contain(d => d.Id == "3");
        responseList.Should().Contain(d => d.Id == "4");
        responseList.Should().NotContain(d => d.Id == "2");
    }

    // ========== GetByFileFormat Tests ==========
    [Fact]
    public async Task GetByFileFormat_ReturnsOk()
    {
        // Arrange
        var data = new List<JwstDataModel>
        {
            new() { Id = "1", FileName = "test.fits", FileFormat = "fits", IsPublic = true },
        };
        mockMongoService.Setup(s => s.GetByFileFormatAsync("fits"))
            .ReturnsAsync(data);

        // Act
        var result = await sut.GetByFileFormat("fits");

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var responseList = okResult.Value.Should().BeAssignableTo<List<DataResponse>>().Subject;
        responseList.Should().HaveCount(1);
    }

    [Fact]
    public async Task GetByFileFormat_Returns500_OnException()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetByFileFormatAsync("fits"))
            .ThrowsAsync(new InvalidOperationException("Database error"));

        // Act
        var result = await sut.GetByFileFormat("fits");

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== GetCommonTags Tests ==========
    [Fact]
    public async Task GetCommonTags_ReturnsOk()
    {
        // Arrange
        var stats = new DataStatistics
        {
            MostCommonTags = ["mast-import", "NIRCam", "MIRI", "galaxy", "nebula"],
        };
        mockMongoService.Setup(s => s.GetStatisticsAsync())
            .ReturnsAsync(stats);

        // Act
        var result = await sut.GetCommonTags();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var tags = okResult.Value.Should().BeAssignableTo<List<string>>().Subject;
        tags.Should().HaveCount(5);
    }

    [Fact]
    public async Task GetCommonTags_RespectsLimit()
    {
        // Arrange
        var stats = new DataStatistics
        {
            MostCommonTags = ["tag1", "tag2", "tag3", "tag4", "tag5"],
        };
        mockMongoService.Setup(s => s.GetStatisticsAsync())
            .ReturnsAsync(stats);

        // Act
        var result = await sut.GetCommonTags(limit: 2);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var tags = okResult.Value.Should().BeAssignableTo<List<string>>().Subject;
        tags.Should().HaveCount(2);
        tags.Should().ContainInOrder("tag1", "tag2");
    }

    // ========== BulkUpdateTags Tests ==========
    [Fact]
    public async Task BulkUpdateTags_ReturnsBadRequest_WhenNoDataIds()
    {
        // Arrange
        var request = new BulkTagsRequest { DataIds = [], Tags = ["new-tag"] };

        // Act
        var result = await sut.BulkUpdateTags(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task BulkUpdateTags_ReturnsOk_WhenValid()
    {
        // Arrange
        var request = new BulkTagsRequest
        {
            DataIds = ["id-1", "id-2"],
            Tags = ["new-tag"],
            Append = true,
        };
        mockMongoService.Setup(s => s.BulkUpdateTagsAsync(request.DataIds, request.Tags, true))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.BulkUpdateTags(request);

        // Assert
        Assert.IsType<OkObjectResult>(result);
        mockMongoService.Verify(s => s.BulkUpdateTagsAsync(request.DataIds, request.Tags, true), Times.Once);
    }

    [Fact]
    public async Task BulkUpdateTags_Returns500_OnException()
    {
        // Arrange
        var request = new BulkTagsRequest { DataIds = ["id-1"], Tags = ["tag"] };
        mockMongoService.Setup(s => s.BulkUpdateTagsAsync(It.IsAny<List<string>>(), It.IsAny<List<string>>(), It.IsAny<bool>()))
            .ThrowsAsync(new InvalidOperationException("Database error"));

        // Act
        var result = await sut.BulkUpdateTags(request);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== BulkUpdateStatus Tests ==========
    [Fact]
    public async Task BulkUpdateStatus_ReturnsBadRequest_WhenNoDataIds()
    {
        // Arrange
        var request = new BulkStatusRequest { DataIds = [], Status = "completed" };

        // Act
        var result = await sut.BulkUpdateStatus(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task BulkUpdateStatus_ReturnsOk_WhenValid()
    {
        // Arrange
        var request = new BulkStatusRequest
        {
            DataIds = ["id-1", "id-2"],
            Status = "completed",
        };
        mockMongoService.Setup(s => s.BulkUpdateStatusAsync(request.DataIds, "completed"))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.BulkUpdateStatus(request);

        // Assert
        Assert.IsType<OkObjectResult>(result);
        mockMongoService.Verify(s => s.BulkUpdateStatusAsync(request.DataIds, "completed"), Times.Once);
    }

    // ========== ExportData Tests ==========
    [Fact]
    public async Task ExportData_ReturnsBadRequest_WhenNoDataIds()
    {
        // Arrange
        var request = new ExportRequest { DataIds = [] };

        // Act
        var result = await sut.ExportData(request);

        // Assert
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task ExportData_ReturnsOk_WithExportId()
    {
        // Arrange
        var request = new ExportRequest { DataIds = ["id-1"] };
        var data = new List<JwstDataModel>
        {
            new() { Id = "id-1", FileName = "test.fits", IsPublic = true },
        };
        mockMongoService.Setup(s => s.GetManyAsync(request.DataIds))
            .ReturnsAsync(data);

        // Act
        var result = await sut.ExportData(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var exportResponse = okResult.Value.Should().BeOfType<ExportResponse>().Subject;
        exportResponse.ExportId.Should().NotBeNullOrEmpty();
        exportResponse.Status.Should().Be("completed");
        exportResponse.TotalRecords.Should().Be(1);
        exportResponse.DownloadUrl.Should().Contain(exportResponse.ExportId);
    }

    // ========== DownloadExport Tests ==========
    [Fact]
    public async Task DownloadExport_ReturnsBadRequest_ForInvalidGuid()
    {
        // Act
        var result = await sut.DownloadExport("not-a-guid");

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task DownloadExport_ReturnsBadRequest_ForPathTraversal()
    {
        // Act
        var result = await sut.DownloadExport("../../../etc/passwd");

        // Assert
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task DownloadExport_ReturnsNotFound_WhenFileDoesntExist()
    {
        // Arrange — valid GUID format but file does not exist
        var exportId = Guid.NewGuid().ToString();

        // Act
        var result = await sut.DownloadExport(exportId);

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    // ========== ScanAndImportFiles Tests ==========
    [Fact]
    public async Task ScanAndImportFiles_ReturnsOk()
    {
        // Arrange
        var importResponse = new BulkImportResponse
        {
            ImportedCount = 5,
            SkippedCount = 2,
            ErrorCount = 0,
            Message = "Imported 5 files",
        };
        mockDataScanService.Setup(s => s.ScanAndImportAsync())
            .ReturnsAsync(importResponse);

        // Act
        var result = await sut.ScanAndImportFiles(null);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        okResult.Value.Should().Be(importResponse);
    }

    [Fact]
    public async Task ScanAndImportFiles_Returns500_OnException()
    {
        // Arrange
        mockDataScanService.Setup(s => s.ScanAndImportAsync())
            .ThrowsAsync(new InvalidOperationException("Scan failed"));

        // Act
        var result = await sut.ScanAndImportFiles(null);

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== ClaimOrphanedData Tests ==========
    [Fact]
    public async Task ClaimOrphanedData_ReturnsUnauthorized_WhenNoUserId()
    {
        // Arrange — set up context without NameIdentifier
        var identity = new ClaimsIdentity("TestAuth"); // no claims
        var principal = new ClaimsPrincipal(identity);
        sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = principal },
        };

        // Act
        var result = await sut.ClaimOrphanedData();

        // Assert
        Assert.IsType<UnauthorizedObjectResult>(result.Result);
    }

    [Fact]
    public async Task ClaimOrphanedData_ReturnsOk_WhenValid()
    {
        // Arrange
        mockMongoService.Setup(s => s.ClaimOrphanedDataAsync(TestUserId))
            .ReturnsAsync(3L);

        // Act
        var result = await sut.ClaimOrphanedData();

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = okResult.Value.Should().BeOfType<ClaimOrphanedResponse>().Subject;
        response.ClaimedCount.Should().Be(3);
        response.Message.Should().Contain("3");
    }

    // ========== MigrateStorageKeys Tests ==========
    [Fact]
    public async Task MigrateStorageKeys_ReturnsOk()
    {
        // Arrange — records with /app/data/ prefixed paths
        var data = new List<JwstDataModel>
        {
            new()
            {
                Id = "1",
                FileName = "test.fits",
                FilePath = "/app/data/mast/obs1/test.fits",
                ProcessingResults = [],
            },
            new()
            {
                Id = "2",
                FileName = "clean.fits",
                FilePath = "mast/obs2/clean.fits", // already relative
                ProcessingResults = [],
            },
        };
        mockMongoService.Setup(s => s.GetAsync())
            .ReturnsAsync(data);
        mockMongoService.Setup(s => s.UpdateAsync(It.IsAny<string>(), It.IsAny<JwstDataModel>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await sut.MigrateStorageKeys();

        // Assert
        Assert.IsType<OkObjectResult>(result);
        mockMongoService.Verify(s => s.UpdateAsync("1", It.Is<JwstDataModel>(d => d.FilePath == "mast/obs1/test.fits")), Times.Once);
        mockMongoService.Verify(s => s.UpdateAsync("2", It.IsAny<JwstDataModel>()), Times.Never);
    }

    [Fact]
    public async Task MigrateStorageKeys_Returns500_OnException()
    {
        // Arrange
        mockMongoService.Setup(s => s.GetAsync())
            .ThrowsAsync(new InvalidOperationException("Database error"));

        // Act
        var result = await sut.MigrateStorageKeys();

        // Assert
        var statusResult = Assert.IsType<ObjectResult>(result);
        statusResult.StatusCode.Should().Be(500);
    }

    // ========== #565: Search SharedWith Authorization Tests ==========
    [Fact]
    public async Task Search_IncludesSharedData_ForAuthenticatedUser()
    {
        // Arrange
        var request = new SearchRequest { SearchTerm = "test" };
        var response = new SearchResponse
        {
            Data =
            [
                new DataResponse { Id = "1", FileName = "public.fits", IsPublic = true, UserId = "other-user" },
                new DataResponse { Id = "2", FileName = "private.fits", IsPublic = false, UserId = "other-user" },
                new DataResponse { Id = "3", FileName = "own.fits", IsPublic = false, UserId = TestUserId },
                new DataResponse { Id = "4", FileName = "shared.fits", IsPublic = false, UserId = "other-user", SharedWith = [TestUserId] },
            ],
            TotalCount = 4,
            TotalPages = 1,
        };
        mockMongoService.Setup(s => s.SearchWithFacetsAsync(request))
            .ReturnsAsync(response);

        // Act
        var result = await sut.Search(request);

        // Assert — user should see public + own + shared
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var searchResponse = okResult.Value.Should().BeOfType<SearchResponse>().Subject;
        searchResponse.Data.Should().HaveCount(3);
        searchResponse.Data.Should().Contain(d => d.Id == "1"); // public
        searchResponse.Data.Should().Contain(d => d.Id == "3"); // own
        searchResponse.Data.Should().Contain(d => d.Id == "4"); // shared
        searchResponse.Data.Should().NotContain(d => d.Id == "2"); // other's private
        searchResponse.TotalCount.Should().Be(3);
    }

    [Fact]
    public async Task Search_ReturnsOnlyPublicData_ForAnonymousUser()
    {
        // Arrange
        SetupAnonymousUser();
        var request = new SearchRequest { SearchTerm = "test" };
        var response = new SearchResponse
        {
            Data =
            [
                new DataResponse { Id = "1", FileName = "public.fits", IsPublic = true, UserId = "other-user" },
                new DataResponse { Id = "2", FileName = "private.fits", IsPublic = false, UserId = "other-user" },
                new DataResponse { Id = "3", FileName = "shared.fits", IsPublic = false, UserId = "other-user", SharedWith = ["anon-user"] },
            ],
            TotalCount = 3,
            TotalPages = 1,
        };
        mockMongoService.Setup(s => s.SearchWithFacetsAsync(request))
            .ReturnsAsync(response);

        // Act
        var result = await sut.Search(request);

        // Assert — anonymous should only see public data
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var searchResponse = okResult.Value.Should().BeOfType<SearchResponse>().Subject;
        searchResponse.Data.Should().HaveCount(1);
        searchResponse.Data.Should().Contain(d => d.Id == "1"); // public
        searchResponse.TotalCount.Should().Be(1);
    }

    [Fact]
    public async Task Search_DoesNotShowOthersPrivate_ForAuthenticatedUser()
    {
        // Arrange
        var request = new SearchRequest { SearchTerm = "test" };
        var response = new SearchResponse
        {
            Data =
            [
                new DataResponse { Id = "1", FileName = "other-private.fits", IsPublic = false, UserId = "other-user" },
                new DataResponse { Id = "2", FileName = "another-private.fits", IsPublic = false, UserId = "another-user" },
            ],
            TotalCount = 2,
            TotalPages = 1,
        };
        mockMongoService.Setup(s => s.SearchWithFacetsAsync(request))
            .ReturnsAsync(response);

        // Act
        var result = await sut.Search(request);

        // Assert — user should not see others' private data
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var searchResponse = okResult.Value.Should().BeOfType<SearchResponse>().Subject;
        searchResponse.Data.Should().BeEmpty();
        searchResponse.TotalCount.Should().Be(0);
    }

    // ========== #570: Export Download Authorization Tests ==========
    [Fact]
    public async Task ExportData_WritesOwnershipMetadata()
    {
        // Arrange
        var request = new ExportRequest { DataIds = ["id-1"] };
        var data = new List<JwstDataModel>
        {
            new() { Id = "id-1", FileName = "test.fits", IsPublic = true },
        };
        mockMongoService.Setup(s => s.GetManyAsync(request.DataIds))
            .ReturnsAsync(data);

        // Act
        var result = await sut.ExportData(request);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var exportResponse = okResult.Value.Should().BeOfType<ExportResponse>().Subject;

        // Verify metadata file was created
        var exportsDir = Path.Combine(Directory.GetCurrentDirectory(), "exports");
        var metaPath = Path.Combine(exportsDir, $"{exportResponse.ExportId}.meta.json");
        System.IO.File.Exists(metaPath).Should().BeTrue();

        // Verify metadata contains the user ID
        var metaJson = await System.IO.File.ReadAllTextAsync(metaPath);
        using var metaDoc = System.Text.Json.JsonDocument.Parse(metaJson);
        metaDoc.RootElement.GetProperty("UserId").GetString().Should().Be(TestUserId);

        // Cleanup
        System.IO.File.Delete(metaPath);
        System.IO.File.Delete(Path.Combine(exportsDir, $"{exportResponse.ExportId}.json"));
    }

    [Fact]
    public async Task DownloadExport_ReturnsNotFound_WhenNotOwner()
    {
        // Arrange — create an export owned by a different user
        var exportId = Guid.NewGuid().ToString();
        var exportsDir = Path.Combine(Directory.GetCurrentDirectory(), "exports");
        Directory.CreateDirectory(exportsDir);

        await System.IO.File.WriteAllTextAsync(
            Path.Combine(exportsDir, $"{exportId}.json"), "{}");
        await System.IO.File.WriteAllTextAsync(
            Path.Combine(exportsDir, $"{exportId}.meta.json"),
            System.Text.Json.JsonSerializer.Serialize(new { UserId = "other-user", CreatedAt = DateTime.UtcNow }));

        try
        {
            // Act
            var result = await sut.DownloadExport(exportId);

            // Assert — non-owner should get 404
            Assert.IsType<NotFoundObjectResult>(result);
        }
        finally
        {
            // Cleanup
            System.IO.File.Delete(Path.Combine(exportsDir, $"{exportId}.json"));
            System.IO.File.Delete(Path.Combine(exportsDir, $"{exportId}.meta.json"));
        }
    }

    [Fact]
    public async Task DownloadExport_ReturnsFile_WhenOwner()
    {
        // Arrange — create an export owned by the current user
        var exportId = Guid.NewGuid().ToString();
        var exportsDir = Path.Combine(Directory.GetCurrentDirectory(), "exports");
        Directory.CreateDirectory(exportsDir);

        await System.IO.File.WriteAllTextAsync(
            Path.Combine(exportsDir, $"{exportId}.json"), "{\"test\": true}");
        await System.IO.File.WriteAllTextAsync(
            Path.Combine(exportsDir, $"{exportId}.meta.json"),
            System.Text.Json.JsonSerializer.Serialize(new { UserId = TestUserId, CreatedAt = DateTime.UtcNow }));

        try
        {
            // Act
            var result = await sut.DownloadExport(exportId);

            // Assert — owner should get the file
            Assert.IsType<FileContentResult>(result);
        }
        finally
        {
            // Cleanup
            System.IO.File.Delete(Path.Combine(exportsDir, $"{exportId}.json"));
            System.IO.File.Delete(Path.Combine(exportsDir, $"{exportId}.meta.json"));
        }
    }

    [Fact]
    public async Task DownloadExport_AdminCanDownloadAnyExport()
    {
        // Arrange
        SetupAdminUser(TestUserId);
        var exportId = Guid.NewGuid().ToString();
        var exportsDir = Path.Combine(Directory.GetCurrentDirectory(), "exports");
        Directory.CreateDirectory(exportsDir);

        await System.IO.File.WriteAllTextAsync(
            Path.Combine(exportsDir, $"{exportId}.json"), "{\"test\": true}");
        await System.IO.File.WriteAllTextAsync(
            Path.Combine(exportsDir, $"{exportId}.meta.json"),
            System.Text.Json.JsonSerializer.Serialize(new { UserId = "other-user", CreatedAt = DateTime.UtcNow }));

        try
        {
            // Act
            var result = await sut.DownloadExport(exportId);

            // Assert — admin can download anyone's export
            Assert.IsType<FileContentResult>(result);
        }
        finally
        {
            // Cleanup
            System.IO.File.Delete(Path.Combine(exportsDir, $"{exportId}.json"));
            System.IO.File.Delete(Path.Combine(exportsDir, $"{exportId}.meta.json"));
        }
    }

    [Fact]
    public async Task DownloadExport_LegacyExportWithoutMetadata_IsAccessible()
    {
        // Arrange — create an export without metadata (legacy)
        var exportId = Guid.NewGuid().ToString();
        var exportsDir = Path.Combine(Directory.GetCurrentDirectory(), "exports");
        Directory.CreateDirectory(exportsDir);

        await System.IO.File.WriteAllTextAsync(
            Path.Combine(exportsDir, $"{exportId}.json"), "{\"test\": true}");

        try
        {
            // Act
            var result = await sut.DownloadExport(exportId);

            // Assert — legacy exports without metadata remain accessible
            Assert.IsType<FileContentResult>(result);
        }
        finally
        {
            // Cleanup
            System.IO.File.Delete(Path.Combine(exportsDir, $"{exportId}.json"));
        }
    }

    // ========== Helper Methods ==========
    private void SetupAuthenticatedUser(string userId)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId),
            new("sub", userId),
        };

        var identity = new ClaimsIdentity(claims, "TestAuth");
        var principal = new ClaimsPrincipal(identity);

        sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = principal },
        };
    }

    private void SetupAdminUser(string userId)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId),
            new("sub", userId),
            new(ClaimTypes.Role, "Admin"),
        };

        var identity = new ClaimsIdentity(claims, "TestAuth");
        var principal = new ClaimsPrincipal(identity);

        sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = principal },
        };
    }

    private void SetupAnonymousUser()
    {
        var identity = new ClaimsIdentity(); // no auth type = anonymous
        var principal = new ClaimsPrincipal(identity);

        sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = principal },
        };
    }
}
