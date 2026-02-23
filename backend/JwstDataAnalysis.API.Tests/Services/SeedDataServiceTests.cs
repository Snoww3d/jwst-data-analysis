// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;
using JwstDataAnalysis.API.Configuration;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for SeedDataService.
/// </summary>
public class SeedDataServiceTests
{
    private readonly Mock<IMongoDBService> mockMongo;
    private readonly Mock<IAuthService> mockAuth;
    private readonly Mock<IWebHostEnvironment> mockEnv;
    private readonly Mock<ILogger<SeedDataService>> mockLogger;

    public SeedDataServiceTests()
    {
        mockMongo = new Mock<IMongoDBService>();
        mockAuth = new Mock<IAuthService>();
        mockEnv = new Mock<IWebHostEnvironment>();
        mockLogger = new Mock<ILogger<SeedDataService>>();

        mockEnv.Setup(e => e.EnvironmentName).Returns("Development");
    }

    [Fact]
    public async Task SeedUsersAsync_WhenDisabled_DoesNothing()
    {
        var sut = CreateSut(enabled: false);

        await sut.SeedUsersAsync();

        mockAuth.Verify(a => a.RegisterAsync(It.IsAny<RegisterRequest>()), Times.Never);
    }

    [Fact]
    public async Task SeedUsersAsync_WhenEnabled_SeedsAdminAndDemoUsers()
    {
        mockMongo.Setup(m => m.GetUserByUsernameAsync(It.IsAny<string>()))
            .ReturnsAsync((User?)null);
        mockAuth.Setup(a => a.RegisterAsync(It.IsAny<RegisterRequest>()))
            .ReturnsAsync(new TokenResponse());

        var sut = CreateSut();
        await sut.SeedUsersAsync();

        mockAuth.Verify(a => a.RegisterAsync(It.Is<RegisterRequest>(r => r.Username == "admin")), Times.Once);
        mockAuth.Verify(a => a.RegisterAsync(It.Is<RegisterRequest>(r => r.Username == "demo")), Times.Once);
    }

    [Fact]
    public async Task SeedUsersAsync_SkipsExistingUsers()
    {
        mockMongo.Setup(m => m.GetUserByUsernameAsync("admin"))
            .ReturnsAsync(new User { Username = "admin" });
        mockMongo.Setup(m => m.GetUserByUsernameAsync("demo"))
            .ReturnsAsync((User?)null);
        mockAuth.Setup(a => a.RegisterAsync(It.IsAny<RegisterRequest>()))
            .ReturnsAsync(new TokenResponse());

        var sut = CreateSut();
        await sut.SeedUsersAsync();

        mockAuth.Verify(a => a.RegisterAsync(It.Is<RegisterRequest>(r => r.Username == "admin")), Times.Never);
        mockAuth.Verify(a => a.RegisterAsync(It.Is<RegisterRequest>(r => r.Username == "demo")), Times.Once);
    }

    [Fact]
    public async Task SeedUsersAsync_ContinuesAfterRegistrationFailure()
    {
        mockMongo.Setup(m => m.GetUserByUsernameAsync(It.IsAny<string>()))
            .ReturnsAsync((User?)null);
        mockAuth.SetupSequence(a => a.RegisterAsync(It.IsAny<RegisterRequest>()))
            .ThrowsAsync(new InvalidOperationException("Admin already exists"))
            .ReturnsAsync(new TokenResponse());

        var sut = CreateSut();

        var act = () => sut.SeedUsersAsync();
        await act.Should().NotThrowAsync();

        mockAuth.Verify(a => a.RegisterAsync(It.IsAny<RegisterRequest>()), Times.Exactly(2));
    }

    private SeedDataService CreateSut(bool enabled = true)
    {
        var settings = Options.Create(new SeedingSettings { Enabled = enabled });
        return new SeedDataService(mockMongo.Object, mockAuth.Object, settings, mockEnv.Object, mockLogger.Object);
    }
}
