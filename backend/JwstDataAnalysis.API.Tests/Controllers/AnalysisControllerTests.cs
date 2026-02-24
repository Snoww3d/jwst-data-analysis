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
/// Unit tests for AnalysisController.
/// </summary>
public class AnalysisControllerTests
{
    private readonly Mock<IAnalysisService> mockAnalysisService;
    private readonly Mock<IMongoDBService> mockMongoDBService;
    private readonly AnalysisController sut;

    public AnalysisControllerTests()
    {
        mockAnalysisService = new Mock<IAnalysisService>();
        mockMongoDBService = new Mock<IMongoDBService>();
        var mockLogger = new Mock<ILogger<AnalysisController>>();
        sut = new AnalysisController(mockAnalysisService.Object, mockMongoDBService.Object, mockLogger.Object);
        SetupAuthenticatedUser("test-user");
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsOk_WhenValid()
    {
        var request = new RegionStatisticsRequestDto { DataId = "data-1", RegionType = "rectangle" };
        var response = new RegionStatisticsResponseDto { Mean = 42.0, Median = 41.0, PixelCount = 100 };
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetRegionStatisticsAsync(request))
            .ReturnsAsync(response);

        var result = await sut.GetRegionStatistics(request);

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(response);
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsBadRequest_WhenDataIdEmpty()
    {
        var request = new RegionStatisticsRequestDto { DataId = string.Empty, RegionType = "rectangle" };

        var result = await sut.GetRegionStatistics(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsBadRequest_WhenRegionTypeEmpty()
    {
        var request = new RegionStatisticsRequestDto { DataId = "data-1", RegionType = string.Empty };

        var result = await sut.GetRegionStatistics(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsNotFound_WhenDataNotInDb()
    {
        var request = new RegionStatisticsRequestDto { DataId = "missing", RegionType = "rectangle" };
        mockMongoDBService.Setup(s => s.GetAsync("missing"))
            .ReturnsAsync((JwstDataModel?)null);

        var result = await sut.GetRegionStatistics(request);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsForbid_WhenNotAccessible()
    {
        var request = new RegionStatisticsRequestDto { DataId = "private-1", RegionType = "rectangle" };
        mockMongoDBService.Setup(s => s.GetAsync("private-1"))
            .ReturnsAsync(new JwstDataModel { Id = "private-1", UserId = "other-user", IsPublic = false });

        var result = await sut.GetRegionStatistics(request);

        result.Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsNotFound_WhenServiceThrowsKeyNotFound()
    {
        var request = new RegionStatisticsRequestDto { DataId = "data-1", RegionType = "rectangle" };
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetRegionStatisticsAsync(request))
            .ThrowsAsync(new KeyNotFoundException("Data not found"));

        var result = await sut.GetRegionStatistics(request);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsBadRequest_WhenInvalidOperation()
    {
        var request = new RegionStatisticsRequestDto { DataId = "data-1", RegionType = "invalid" };
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetRegionStatisticsAsync(request))
            .ThrowsAsync(new InvalidOperationException("Bad region"));

        var result = await sut.GetRegionStatistics(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetRegionStatistics_Returns503_WhenProcessingEngineDown()
    {
        var request = new RegionStatisticsRequestDto { DataId = "data-1", RegionType = "rectangle" };
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetRegionStatisticsAsync(request))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        var result = await sut.GetRegionStatistics(request);

        var statusResult = result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(503);
    }

    [Fact]
    public async Task GetRegionStatistics_Returns500_OnUnexpectedException()
    {
        var request = new RegionStatisticsRequestDto { DataId = "data-1", RegionType = "rectangle" };
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetRegionStatisticsAsync(request))
            .ThrowsAsync(new TimeoutException("Unexpected"));

        var result = await sut.GetRegionStatistics(request);

        var statusResult = result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(500);
    }

    [Fact]
    public async Task DetectSources_ReturnsOk_WhenValid()
    {
        var request = new SourceDetectionRequestDto { DataId = "data-1" };
        var response = new SourceDetectionResponseDto { NSources = 5, Method = "daofind" };
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.DetectSourcesAsync(request))
            .ReturnsAsync(response);

        var result = await sut.DetectSources(request);

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(response);
    }

    [Fact]
    public async Task DetectSources_ReturnsBadRequest_WhenDataIdEmpty()
    {
        var request = new SourceDetectionRequestDto { DataId = string.Empty };

        var result = await sut.DetectSources(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task DetectSources_ReturnsNotFound_WhenDataNotInDb()
    {
        var request = new SourceDetectionRequestDto { DataId = "missing" };
        mockMongoDBService.Setup(s => s.GetAsync("missing"))
            .ReturnsAsync((JwstDataModel?)null);

        var result = await sut.DetectSources(request);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task DetectSources_ReturnsForbid_WhenNotAccessible()
    {
        var request = new SourceDetectionRequestDto { DataId = "private-1" };
        mockMongoDBService.Setup(s => s.GetAsync("private-1"))
            .ReturnsAsync(new JwstDataModel { Id = "private-1", UserId = "other-user", IsPublic = false });

        var result = await sut.DetectSources(request);

        result.Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task DetectSources_ReturnsBadRequest_WhenThresholdSigmaOutOfRange()
    {
        var request = new SourceDetectionRequestDto { DataId = "data-1", ThresholdSigma = 0.5 };
        SetupAccessibleData("data-1");

        var result = await sut.DetectSources(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task DetectSources_ReturnsBadRequest_WhenInvalidMethod()
    {
        var request = new SourceDetectionRequestDto { DataId = "data-1", Method = "invalid" };
        SetupAccessibleData("data-1");

        var result = await sut.DetectSources(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    // === GetTableInfo Tests ===
    [Fact]
    public async Task GetTableInfo_ReturnsOk_WhenValid()
    {
        var response = new TableInfoResponseDto
        {
            FileName = "test.fits",
            TableHdus =
            [
                new TableHduInfoDto { Index = 1, Name = "EVENTS", HduType = "BinTableHDU", NRows = 100, NColumns = 3 },
            ],
        };
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetTableInfoAsync("data-1"))
            .ReturnsAsync(response);

        var result = await sut.GetTableInfo("data-1");

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(response);
    }

    [Fact]
    public async Task GetTableInfo_ReturnsBadRequest_WhenDataIdEmpty()
    {
        var result = await sut.GetTableInfo(string.Empty);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetTableInfo_ReturnsNotFound_WhenDataNotInDb()
    {
        mockMongoDBService.Setup(s => s.GetAsync("missing"))
            .ReturnsAsync((JwstDataModel?)null);

        var result = await sut.GetTableInfo("missing");

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetTableInfo_ReturnsForbid_WhenNotAccessible()
    {
        mockMongoDBService.Setup(s => s.GetAsync("private-1"))
            .ReturnsAsync(new JwstDataModel { Id = "private-1", UserId = "other-user", IsPublic = false });

        var result = await sut.GetTableInfo("private-1");

        result.Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task GetTableInfo_Returns503_WhenProcessingEngineDown()
    {
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetTableInfoAsync("data-1"))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        var result = await sut.GetTableInfo("data-1");

        var statusResult = result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(503);
    }

    [Fact]
    public async Task GetTableInfo_ReturnsNotFound_WhenServiceThrowsKeyNotFound()
    {
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetTableInfoAsync("data-1"))
            .ThrowsAsync(new KeyNotFoundException("Data not found"));

        var result = await sut.GetTableInfo("data-1");

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    // === GetTableData Tests ===
    [Fact]
    public async Task GetTableData_ReturnsOk_WhenValid()
    {
        var response = new TableDataResponseDto
        {
            HduIndex = 0,
            HduName = "EVENTS",
            TotalRows = 100,
            TotalColumns = 3,
            Page = 0,
            PageSize = 100,
            Columns = [new TableColumnInfoDto { Name = "TIME", Dtype = "float64" }],
            Rows = [new Dictionary<string, object?> { ["TIME"] = 1.0 }],
        };
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetTableDataAsync("data-1", 0, 0, 100, null, null, null))
            .ReturnsAsync(response);

        var result = await sut.GetTableData("data-1");

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(response);
    }

    [Fact]
    public async Task GetTableData_ReturnsBadRequest_WhenDataIdEmpty()
    {
        var result = await sut.GetTableData(string.Empty);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetTableData_ReturnsBadRequest_WhenPageSizeTooLarge()
    {
        var result = await sut.GetTableData("data-1", pageSize: 501);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetTableData_ReturnsBadRequest_WhenPageSizeZero()
    {
        var result = await sut.GetTableData("data-1", pageSize: 0);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetTableData_ReturnsBadRequest_WhenPageNegative()
    {
        var result = await sut.GetTableData("data-1", page: -1);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetTableData_ReturnsNotFound_WhenDataNotInDb()
    {
        mockMongoDBService.Setup(s => s.GetAsync("missing"))
            .ReturnsAsync((JwstDataModel?)null);

        var result = await sut.GetTableData("missing");

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetTableData_ReturnsForbid_WhenNotAccessible()
    {
        mockMongoDBService.Setup(s => s.GetAsync("private-1"))
            .ReturnsAsync(new JwstDataModel { Id = "private-1", UserId = "other-user", IsPublic = false });

        var result = await sut.GetTableData("private-1");

        result.Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task GetTableData_Returns503_WhenProcessingEngineDown()
    {
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetTableDataAsync("data-1", 0, 0, 100, null, null, null))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        var result = await sut.GetTableData("data-1");

        var statusResult = result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(503);
    }

    [Fact]
    public async Task GetTableData_ReturnsBadRequest_WhenHduIndexNegative()
    {
        var result = await sut.GetTableData("data-1", hduIndex: -1);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetTableInfo_ReturnsBadRequest_WhenInvalidOperation()
    {
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetTableInfoAsync("data-1"))
            .ThrowsAsync(new InvalidOperationException("No file path"));

        var result = await sut.GetTableInfo("data-1");

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetTableData_ReturnsNotFound_WhenServiceThrowsKeyNotFound()
    {
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetTableDataAsync("data-1", 0, 0, 100, null, null, null))
            .ThrowsAsync(new KeyNotFoundException("Data not found"));

        var result = await sut.GetTableData("data-1");

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetTableData_ReturnsBadRequest_WhenInvalidOperation()
    {
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetTableDataAsync("data-1", 0, 0, 100, null, null, null))
            .ThrowsAsync(new InvalidOperationException("No file path"));

        var result = await sut.GetTableData("data-1");

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetTableData_ReturnsBadRequest_WhenSortDirectionInvalid()
    {
        var result = await sut.GetTableData("data-1", sortDirection: "invalid");

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetTableData_ReturnsOk_WhenSortDirectionAsc()
    {
        var response = new TableDataResponseDto
        {
            HduIndex = 0,
            TotalRows = 10,
            TotalColumns = 1,
            Page = 0,
            PageSize = 100,
            Columns = [new TableColumnInfoDto { Name = "TIME", Dtype = "float64" }],
            Rows = [new Dictionary<string, object?> { ["TIME"] = 1.0 }],
        };
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetTableDataAsync("data-1", 0, 0, 100, null, "asc", null))
            .ReturnsAsync(response);

        var result = await sut.GetTableData("data-1", sortDirection: "asc");

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task GetTableData_ReturnsBadRequest_WhenSearchTooLong()
    {
        var result = await sut.GetTableData("data-1", search: new string('a', 501));

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    // === GetSpectralData Tests ===
    [Fact]
    public async Task GetSpectralData_ReturnsOk_WithValidDataId()
    {
        var response = new SpectralDataResponseDto
        {
            HduIndex = 1,
            HduName = "EXTRACT1D",
            NPoints = 100,
            Columns = [new SpectralColumnMetaDto { Name = "WAVELENGTH", Unit = "um", NPoints = 100 }],
            Data = new Dictionary<string, List<double?>> { ["WAVELENGTH"] = [1.0, 2.0, 3.0] },
        };
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetSpectralDataAsync(It.IsAny<string>(), 1))
            .ReturnsAsync(response);

        var result = await sut.GetSpectralData("data-1");

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(response);
    }

    [Fact]
    public async Task GetSpectralData_ReturnsBadRequest_WhenDataIdEmpty()
    {
        var result = await sut.GetSpectralData(string.Empty);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetSpectralData_ReturnsBadRequest_WhenHduIndexNegative()
    {
        var result = await sut.GetSpectralData("data-1", hduIndex: -1);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetSpectralData_ReturnsNotFound_WhenDataNotFound()
    {
        mockMongoDBService.Setup(s => s.GetAsync("missing"))
            .ReturnsAsync((JwstDataModel?)null);

        var result = await sut.GetSpectralData("missing");

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetSpectralData_ReturnsForbid_WhenNotAccessible()
    {
        mockMongoDBService.Setup(s => s.GetAsync("private-1"))
            .ReturnsAsync(new JwstDataModel { Id = "private-1", UserId = "other-user", IsPublic = false });

        var result = await sut.GetSpectralData("private-1");

        result.Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task GetSpectralData_Returns503_WhenProcessingEngineDown()
    {
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetSpectralDataAsync(It.IsAny<string>(), 1))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        var result = await sut.GetSpectralData("data-1");

        var statusResult = result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(503);
    }

    [Fact]
    public async Task GetSpectralData_ReturnsNotFound_WhenServiceThrowsKeyNotFound()
    {
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetSpectralDataAsync(It.IsAny<string>(), 1))
            .ThrowsAsync(new KeyNotFoundException("Data not found"));

        var result = await sut.GetSpectralData("data-1");

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetSpectralData_ReturnsBadRequest_WhenInvalidOperation()
    {
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetSpectralDataAsync(It.IsAny<string>(), 1))
            .ThrowsAsync(new InvalidOperationException("No file path"));

        var result = await sut.GetSpectralData("data-1");

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetSpectralData_Returns500_OnUnexpectedException()
    {
        SetupAccessibleData("data-1");
        mockAnalysisService.Setup(s => s.GetSpectralDataAsync(It.IsAny<string>(), 1))
            .ThrowsAsync(new TimeoutException("Unexpected"));

        var result = await sut.GetSpectralData("data-1");

        var statusResult = result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(500);
    }

    private void SetupAuthenticatedUser(string userId, bool isAdmin = false)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId),
        };
        if (isAdmin)
        {
            claims.Add(new Claim(ClaimTypes.Role, "Admin"));
        }

        var identity = new ClaimsIdentity(claims, "TestAuth");
        var principal = new ClaimsPrincipal(identity);
        sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = principal },
        };
    }

    private void SetupAccessibleData(string dataId, string ownerId = "test-user")
    {
        mockMongoDBService.Setup(s => s.GetAsync(dataId))
            .ReturnsAsync(new JwstDataModel { Id = dataId, UserId = ownerId, IsPublic = true, FilePath = "test/path.fits" });
    }
}
