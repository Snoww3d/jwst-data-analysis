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
/// Unit tests for DiscoveryController.
/// </summary>
public class DiscoveryControllerTests
{
    private const string TestUserId = "user-1";

    private readonly Mock<IDiscoveryService> mockDiscoveryService = new();
    private readonly Mock<ILogger<DiscoveryController>> mockLogger = new();
    private readonly DiscoveryController sut;

    public DiscoveryControllerTests()
    {
        sut = new DiscoveryController(mockDiscoveryService.Object, mockLogger.Object);
        SetupAuthenticatedUser(TestUserId);
    }

    // ===== GetFeaturedTargets =====
    [Fact]
    public void GetFeaturedTargets_ReturnsOk_WithTargetsList()
    {
        var targets = new List<FeaturedTarget>
        {
            new()
            {
                Name = "Carina Nebula",
                CatalogId = "NGC 3372",
                Category = "nebula",
                Description = "Star-forming region",
                Instruments = ["NIRCam"],
                MastSearchParams = new MastSearchParams { Target = "Carina Nebula" },
            },
            new()
            {
                Name = "Pillars of Creation",
                CatalogId = "M16",
                Category = "nebula",
                Description = "Eagle Nebula",
                Instruments = ["NIRCam", "MIRI"],
                MastSearchParams = new MastSearchParams { Target = "M16" },
            },
        };
        mockDiscoveryService.Setup(s => s.GetFeaturedTargets()).Returns(targets);

        var result = sut.GetFeaturedTargets();

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        var returned = okResult.Value.Should().BeAssignableTo<List<FeaturedTarget>>().Subject;
        returned.Should().HaveCount(2);
        returned[0].Name.Should().Be("Carina Nebula");
    }

    [Fact]
    public void GetFeaturedTargets_ReturnsOk_WhenEmpty()
    {
        mockDiscoveryService.Setup(s => s.GetFeaturedTargets()).Returns([]);

        var result = sut.GetFeaturedTargets();

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        var returned = okResult.Value.Should().BeAssignableTo<List<FeaturedTarget>>().Subject;
        returned.Should().BeEmpty();
    }

    // ===== SuggestRecipes =====
    [Fact]
    public async Task SuggestRecipes_ReturnsOk_WithRecipes()
    {
        var request = new SuggestRecipesRequestDto { TargetName = "Carina Nebula" };
        var response = new SuggestRecipesResponseDto
        {
            Target = new TargetInfoDto { Name = "Carina Nebula" },
            Recipes =
            [
                new RecipeDto
                {
                    Name = "6-filter NIRCam",
                    Rank = 1,
                    Filters = ["F090W", "F187N", "F200W", "F335M", "F444W", "F470N"],
                    ColorMapping = new Dictionary<string, string>
                    {
                        ["F090W"] = "#0000ff",
                        ["F187N"] = "#00ccff",
                        ["F200W"] = "#00ff00",
                        ["F335M"] = "#ffff00",
                        ["F444W"] = "#ff8000",
                        ["F470N"] = "#ff0000",
                    },
                    Instruments = ["NIRCam"],
                    RequiresMosaic = false,
                    EstimatedTimeSeconds = 45,
                },
            ],
        };
        mockDiscoveryService
            .Setup(s => s.SuggestRecipesAsync(It.IsAny<SuggestRecipesRequestDto>()))
            .ReturnsAsync(response);

        var result = await sut.SuggestRecipes(request);

        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        var returned = okResult.Value.Should().BeOfType<SuggestRecipesResponseDto>().Subject;
        returned.Recipes.Should().HaveCount(1);
        returned.Recipes[0].Name.Should().Be("6-filter NIRCam");
    }

    [Fact]
    public async Task SuggestRecipes_ReturnsBadRequest_WhenNoTargetOrObservations()
    {
        var request = new SuggestRecipesRequestDto();

        var result = await sut.SuggestRecipes(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task SuggestRecipes_ReturnsBadRequest_WhenEmptyObservationsList()
    {
        var request = new SuggestRecipesRequestDto { Observations = [] };

        var result = await sut.SuggestRecipes(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task SuggestRecipes_AcceptsObservationsWithoutTargetName()
    {
        var request = new SuggestRecipesRequestDto
        {
            Observations =
            [
                new ObservationDto { Filter = "F444W", Instrument = "NIRCAM" },
                new ObservationDto { Filter = "F200W", Instrument = "NIRCAM" },
            ],
        };
        var response = new SuggestRecipesResponseDto
        {
            Recipes =
            [
                new RecipeDto
                {
                    Name = "2-filter NIRCam",
                    Rank = 1,
                    Filters = ["F200W", "F444W"],
                    ColorMapping = new Dictionary<string, string>
                    {
                        ["F200W"] = "#0000ff",
                        ["F444W"] = "#ff0000",
                    },
                    Instruments = ["NIRCam"],
                },
            ],
        };
        mockDiscoveryService
            .Setup(s => s.SuggestRecipesAsync(It.IsAny<SuggestRecipesRequestDto>()))
            .ReturnsAsync(response);

        var result = await sut.SuggestRecipes(request);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task SuggestRecipes_Returns503_WhenEngineUnavailable()
    {
        var request = new SuggestRecipesRequestDto { TargetName = "Carina Nebula" };
        mockDiscoveryService
            .Setup(s => s.SuggestRecipesAsync(It.IsAny<SuggestRecipesRequestDto>()))
            .ThrowsAsync(new HttpRequestException("Connection refused"));

        var result = await sut.SuggestRecipes(request);

        var statusResult = result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(503);
    }

    [Fact]
    public async Task SuggestRecipes_ReturnsBadRequest_OnInvalidOperation()
    {
        var request = new SuggestRecipesRequestDto { TargetName = "Test" };
        mockDiscoveryService
            .Setup(s => s.SuggestRecipesAsync(It.IsAny<SuggestRecipesRequestDto>()))
            .ThrowsAsync(new InvalidOperationException("Bad response"));

        var result = await sut.SuggestRecipes(request);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    // ===== Helpers =====
    private void SetupAuthenticatedUser(string userId)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId),
            new("sub", userId),
        };

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
}
