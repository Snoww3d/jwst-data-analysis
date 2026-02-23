// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;
using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
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
    private readonly AnalysisController sut;

    public AnalysisControllerTests()
    {
        mockAnalysisService = new Mock<IAnalysisService>();
        var mockLogger = new Mock<ILogger<AnalysisController>>();
        sut = new AnalysisController(mockAnalysisService.Object, mockLogger.Object);
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsOk_WhenValid()
    {
        var request = new RegionStatisticsRequestDto { DataId = "data-1", RegionType = "rectangle" };
        var response = new RegionStatisticsResponseDto { Mean = 42.0, Median = 41.0, PixelCount = 100 };
        mockAnalysisService.Setup(s => s.GetRegionStatisticsAsync(request))
            .ReturnsAsync(response);

        var result = await sut.GetRegionStatistics(request);

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(response);
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsBadRequest_WhenDataIdEmpty()
    {
        var request = new RegionStatisticsRequestDto { DataId = "", RegionType = "rectangle" };

        var result = await sut.GetRegionStatistics(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsBadRequest_WhenRegionTypeEmpty()
    {
        var request = new RegionStatisticsRequestDto { DataId = "data-1", RegionType = "" };

        var result = await sut.GetRegionStatistics(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsNotFound_WhenDataMissing()
    {
        var request = new RegionStatisticsRequestDto { DataId = "missing", RegionType = "rectangle" };
        mockAnalysisService.Setup(s => s.GetRegionStatisticsAsync(request))
            .ThrowsAsync(new KeyNotFoundException("Data not found"));

        var result = await sut.GetRegionStatistics(request);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetRegionStatistics_ReturnsBadRequest_WhenInvalidOperation()
    {
        var request = new RegionStatisticsRequestDto { DataId = "data-1", RegionType = "invalid" };
        mockAnalysisService.Setup(s => s.GetRegionStatisticsAsync(request))
            .ThrowsAsync(new InvalidOperationException("Bad region"));

        var result = await sut.GetRegionStatistics(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetRegionStatistics_Returns503_WhenProcessingEngineDown()
    {
        var request = new RegionStatisticsRequestDto { DataId = "data-1", RegionType = "rectangle" };
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
        mockAnalysisService.Setup(s => s.GetRegionStatisticsAsync(request))
            .ThrowsAsync(new Exception("Unexpected"));

        var result = await sut.GetRegionStatistics(request);

        var statusResult = result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(500);
    }
}
