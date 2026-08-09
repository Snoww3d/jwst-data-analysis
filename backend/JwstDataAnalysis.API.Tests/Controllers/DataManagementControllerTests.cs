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
