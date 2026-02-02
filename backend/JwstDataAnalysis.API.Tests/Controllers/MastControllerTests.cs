// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

using Moq;

namespace JwstDataAnalysis.API.Tests.Controllers;

/// <summary>
/// Unit tests for MastController.
/// Focuses on security validation and path traversal prevention.
/// </summary>
public class MastControllerTests
{
    private readonly MastService mastService;
    private readonly Mock<IMongoDBService> mockMongoService;
    private readonly ImportJobTracker jobTracker;
    private readonly IConfiguration configuration;
    private readonly MastController sut;

    /// <summary>
    /// Initializes a new instance of the <see cref="MastControllerTests"/> class.
    /// </summary>
    public MastControllerTests()
    {
        // Use in-memory configuration
        var configValues = new Dictionary<string, string?>
        {
            { "Downloads:BasePath", "/app/data/mast" },
            { "Downloads:PollIntervalMs", "500" },
            { "ProcessingEngine:BaseUrl", "http://localhost:8000" },
        };

        configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(configValues)
            .Build();

        // Create real services with null loggers (these tests only exercise validation logic)
        mastService = new MastService(
            new HttpClient(),
            NullLogger<MastService>.Instance,
            configuration);

        mockMongoService = new Mock<IMongoDBService>();

        jobTracker = new ImportJobTracker(NullLogger<ImportJobTracker>.Instance);

        sut = new MastController(
            mastService,
            mockMongoService.Object,
            jobTracker,
            NullLogger<MastController>.Instance,
            configuration);
    }

    /// <summary>
    /// Tests that CheckExistingFiles returns BadRequest for path traversal attempts.
    /// </summary>
    /// <param name="obsId">The malicious observation ID to test.</param>
    [Theory]
    [InlineData("../../../etc/passwd")]
    [InlineData("..\\..\\windows\\system32")]
    [InlineData("jw02733-o001/../../../etc")]
    [InlineData("..%2F..%2Fetc")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("simple-invalid-format")]
    [InlineData("12345")]
    [InlineData("jw-invalid")]
    public void CheckExistingFiles_WithInvalidObsId_ReturnsBadRequest(string obsId)
    {
        // Act
        var result = sut.CheckExistingFiles(obsId);

        // Assert
        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        badRequest.Value.Should().NotBeNull();
        badRequest.Value!.ToString().Should().Contain("Invalid");
    }

    /// <summary>
    /// Tests that CheckExistingFiles accepts valid JWST observation IDs.
    /// </summary>
    /// <param name="obsId">The valid observation ID to test.</param>
    [Theory]
    [InlineData("jw02733-o001_t001_nircam")]
    [InlineData("jw12345-o002_t003_miri")]
    [InlineData("jw02733-o001_t001_nircam_clear-f090w")]
    [InlineData("JW02733-O001_T001_NIRCAM")] // Case insensitive
    [InlineData("jw00001-o999_t999_nirspec_g140m-f070lp")]
    public void CheckExistingFiles_WithValidObsId_DoesNotReturnBadRequest(string obsId)
    {
        // Act
        var result = sut.CheckExistingFiles(obsId);

        // Assert - should return Ok (exists: false since dir doesn't exist), NOT BadRequest
        Assert.IsNotType<BadRequestObjectResult>(result);

        // Should be OkObjectResult with exists: false since the directory won't exist in tests
        var okResult = Assert.IsType<OkObjectResult>(result);
        okResult.Value.Should().NotBeNull();
    }

    /// <summary>
    /// Tests that ImportFromExistingFiles returns BadRequest for path traversal attempts.
    /// </summary>
    /// <param name="obsId">The malicious observation ID to test.</param>
    [Theory]
    [InlineData("../../../etc/passwd")]
    [InlineData("..\\..\\windows\\system32")]
    [InlineData("jw02733-o001/../../../etc")]
    [InlineData("..%2F..%2Fetc")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("simple-invalid-format")]
    public void ImportFromExistingFiles_WithInvalidObsId_ReturnsBadRequest(string obsId)
    {
        // Act
        var result = sut.ImportFromExistingFiles(obsId);

        // Assert
        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        badRequest.Value.Should().NotBeNull();
        badRequest.Value!.ToString().Should().Contain("Invalid");
    }

    /// <summary>
    /// Tests that ImportFromExistingFiles accepts valid JWST observation IDs.
    /// </summary>
    /// <param name="obsId">The valid observation ID to test.</param>
    [Theory]
    [InlineData("jw02733-o001_t001_nircam")]
    [InlineData("jw12345-o002_t003_miri")]
    [InlineData("jw02733-o001_t001_nircam_clear-f090w")]
    public void ImportFromExistingFiles_WithValidObsId_DoesNotReturnBadRequest(string obsId)
    {
        // Act
        var result = sut.ImportFromExistingFiles(obsId);

        // Assert - should return NotFound (since dir doesn't exist), NOT BadRequest
        Assert.IsNotType<BadRequestObjectResult>(result.Result);

        // Should be NotFoundObjectResult since the directory won't exist in tests
        var notFoundResult = Assert.IsType<NotFoundObjectResult>(result.Result);
        notFoundResult.Value.Should().NotBeNull();
    }

    /// <summary>
    /// Tests that ResumeImport returns NotFound when job doesn't exist.
    /// </summary>
    [Fact]
    public async Task ResumeImport_WithNonexistentJob_ReturnsNotFound()
    {
        // Act
        var result = await sut.ResumeImport("nonexistent-job");

        // Assert
        Assert.IsType<NotFoundObjectResult>(result);
    }

    /// <summary>
    /// Tests that the observation ID regex correctly validates JWST formats.
    /// </summary>
    /// <param name="obsId">The observation ID to test.</param>
    /// <param name="shouldBeValid">Whether the ID should be considered valid.</param>
    [Theory]
    [InlineData("jw02733-o001_t001_nircam", true)]
    [InlineData("jw12345-o002_t003_miri", true)]
    [InlineData("jw02733-o001_t001_nircam_clear-f090w", true)]
    [InlineData("JW02733-O001_T001_NIRCAM", true)] // Case insensitive
    [InlineData("jw00001-o999_t999_nirspec", true)]
    [InlineData("jw02733001001_02101_00001_nrca1", false)] // Exposure ID format, not obs ID
    [InlineData("../../../etc/passwd", false)]
    [InlineData("jw02733", false)] // Incomplete
    [InlineData("", false)]
    [InlineData("invalid", false)]
    public void ObservationIdValidation_WorksCorrectly(string obsId, bool shouldBeValid)
    {
        // This tests the validation indirectly through CheckExistingFiles
        // Valid IDs should not return BadRequest, invalid should return BadRequest
        var result = sut.CheckExistingFiles(obsId);

        if (shouldBeValid)
        {
            Assert.IsNotType<BadRequestObjectResult>(result);
        }
        else
        {
            Assert.IsType<BadRequestObjectResult>(result);
        }
    }
}
