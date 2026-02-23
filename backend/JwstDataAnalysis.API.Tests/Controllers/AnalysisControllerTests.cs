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
            .ReturnsAsync(new JwstDataModel { Id = dataId, UserId = ownerId, IsPublic = true });
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
            .ThrowsAsync(new Exception("Unexpected"));

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
}
