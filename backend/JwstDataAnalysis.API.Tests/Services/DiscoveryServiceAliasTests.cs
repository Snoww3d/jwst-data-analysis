// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text.Json;

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

#pragma warning disable CA1869 // Cache and reuse JsonSerializerOptions — test code only

/// <summary>
/// Unit tests for DiscoveryService.ResolveTargetAlias.
/// </summary>
public class DiscoveryServiceAliasTests : IDisposable
{
    private readonly string tempDir;
    private readonly DiscoveryService sut;

    public DiscoveryServiceAliasTests()
    {
        // Create a temporary directory with a featured-targets.json file
        tempDir = Path.Combine(Path.GetTempPath(), $"alias-tests-{Guid.NewGuid():N}");
        var configDir = Path.Combine(tempDir, "Configuration");
        Directory.CreateDirectory(configDir);

        var targets = new[]
        {
            new
            {
                name = "Pillars of Creation",
                catalogId = "NGC 6611",
                category = "nebula",
                description = "Iconic columns of gas and dust",
                instruments = new[] { "NIRCam" },
                filterCount = 8,
                compositePotential = "great",
                mastSearchParams = new { target = "M16", instrument = "NIRCAM", productLevel = "2b" },
            },
            new
            {
                name = "Carina Nebula",
                catalogId = "NGC 3372",
                category = "nebula",
                description = "Massive star-forming region",
                instruments = new[] { "NIRCam" },
                filterCount = 6,
                compositePotential = "great",
                mastSearchParams = new { target = "Carina Nebula", instrument = "NIRCAM", productLevel = "2b" },
            },
            new
            {
                name = "Stephan's Quintet",
                catalogId = "HCG 92",
                category = "galaxy",
                description = "Compact galaxy group",
                instruments = new[] { "NIRCam" },
                filterCount = 7,
                compositePotential = "great",
                mastSearchParams = new { target = "Stephan's Quintet", instrument = "NIRCAM", productLevel = "2b" },
            },
            new
            {
                name = "Horsehead Nebula",
                catalogId = "Barnard 33",
                category = "nebula",
                description = "Iconic dark nebula in Orion",
                instruments = new[] { "NIRCam" },
                filterCount = 6,
                compositePotential = "great",
                mastSearchParams = new { target = "Horsehead", instrument = "NIRCAM", productLevel = "2b" },
            },
        };

        var json = JsonSerializer.Serialize(targets, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        });
        File.WriteAllText(Path.Combine(configDir, "featured-targets.json"), json);

        var mockEnv = new Mock<IWebHostEnvironment>();
        mockEnv.Setup(e => e.ContentRootPath).Returns(tempDir);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "ProcessingEngine:BaseUrl", "http://localhost:8000" },
            })
            .Build();

        sut = new DiscoveryService(
            new HttpClient(),
            new Mock<ILogger<DiscoveryService>>().Object,
            config,
            mockEnv.Object);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempDir))
        {
            Directory.Delete(tempDir, recursive: true);
        }

        GC.SuppressFinalize(this);
    }

    [Fact]
    public void ResolveTargetAlias_ExactNameMatch_ReturnsTarget()
    {
        var result = sut.ResolveTargetAlias("Pillars of Creation");

        result.Should().Be("M16");
    }

    [Fact]
    public void ResolveTargetAlias_CaseInsensitiveMatch_ReturnsTarget()
    {
        var result = sut.ResolveTargetAlias("pillars of creation");

        result.Should().Be("M16");
    }

    [Theory]
    [InlineData("PILLARS OF CREATION")]
    [InlineData("Pillars Of Creation")]
    [InlineData("pIlLaRs oF cReAtIoN")]
    public void ResolveTargetAlias_VariousCasings_ReturnsTarget(string input)
    {
        var result = sut.ResolveTargetAlias(input);

        result.Should().Be("M16");
    }

    [Fact]
    public void ResolveTargetAlias_CatalogIdMatch_ReturnsTarget()
    {
        // NGC 6611 is the catalogId for Pillars of Creation → should resolve to M16
        var result = sut.ResolveTargetAlias("NGC 6611");

        result.Should().Be("M16");
    }

    [Fact]
    public void ResolveTargetAlias_CatalogIdCaseInsensitive_ReturnsTarget()
    {
        var result = sut.ResolveTargetAlias("ngc 6611");

        result.Should().Be("M16");
    }

    [Fact]
    public void ResolveTargetAlias_HorseheadCatalogId_ReturnsTarget()
    {
        // Barnard 33 is the catalogId for Horsehead Nebula → should resolve to "Horsehead"
        var result = sut.ResolveTargetAlias("Barnard 33");

        result.Should().Be("Horsehead");
    }

    [Fact]
    public void ResolveTargetAlias_NoMatch_ReturnsNull()
    {
        var result = sut.ResolveTargetAlias("Random Galaxy");

        result.Should().BeNull();
    }

    [Fact]
    public void ResolveTargetAlias_AlreadyCatalogTarget_ReturnsNull()
    {
        // M16 is already the MAST target — should not double-resolve
        var result = sut.ResolveTargetAlias("M16");

        result.Should().BeNull();
    }

    [Fact]
    public void ResolveTargetAlias_NameMatchesMastTarget_ReturnsNull()
    {
        // "Carina Nebula" is both the name and the mastSearchParams.target — no alias needed
        var result = sut.ResolveTargetAlias("Carina Nebula");

        result.Should().BeNull();
    }

    [Fact]
    public void ResolveTargetAlias_CatalogIdMatchesMastTarget_ReturnsNull()
    {
        // "HCG 92" is the catalogId for Stephan's Quintet, whose MAST target is "Stephan's Quintet"
        // Since catalogId != target, this should resolve
        var result = sut.ResolveTargetAlias("HCG 92");

        result.Should().Be("Stephan's Quintet");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ResolveTargetAlias_NullOrWhitespace_ReturnsNull(string? input)
    {
        var result = sut.ResolveTargetAlias(input!);

        result.Should().BeNull();
    }

    [Fact]
    public void ResolveTargetAlias_WhitespaceAroundInput_TrimsAndResolves()
    {
        var result = sut.ResolveTargetAlias("  Pillars of Creation  ");

        result.Should().Be("M16");
    }
}
