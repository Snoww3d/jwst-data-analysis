// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;
using JwstDataAnalysis.API.Configuration;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for SeedDataService.
/// </summary>
public class SeedDataServiceTests
{
    private static readonly List<SeedUser> DefaultSeedUsers =
    [
        new() { Username = "admin", Email = "admin@jwst.local", Password = "TestPass1!", DisplayName = "Administrator" },
        new() { Username = "demo", Email = "demo@jwst.local", Password = "TestPass2!", DisplayName = "Demo User" },
    ];

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
    public async Task SeedUsersAsync_WhenEnabled_SeedsConfiguredUsers()
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

    [Fact]
    public async Task SeedUsersAsync_BlockedInNonDevelopmentEnvironment()
    {
        mockEnv.Setup(e => e.EnvironmentName).Returns("Production");

        var sut = CreateSut();
        await sut.SeedUsersAsync();

        mockAuth.Verify(a => a.RegisterAsync(It.IsAny<RegisterRequest>()), Times.Never);
    }

    [Fact]
    public async Task SeedUsersAsync_BlockedInStagingEnvironment()
    {
        mockEnv.Setup(e => e.EnvironmentName).Returns("Staging");

        var sut = CreateSut();
        await sut.SeedUsersAsync();

        mockAuth.Verify(a => a.RegisterAsync(It.IsAny<RegisterRequest>()), Times.Never);
    }

    [Fact]
    public async Task SeedUsersAsync_NoUsersConfigured_DoesNothing()
    {
        var sut = CreateSut(users: []);
        await sut.SeedUsersAsync();

        mockAuth.Verify(a => a.RegisterAsync(It.IsAny<RegisterRequest>()), Times.Never);
    }

    [Fact]
    public async Task SeedUsersAsync_SkipsUsersWithEmptyPassword()
    {
        var users = new List<SeedUser>
        {
            new() { Username = "nopass", Email = "nopass@test.local", Password = string.Empty, DisplayName = "No Password" },
            new() { Username = "haspass", Email = "haspass@test.local", Password = "ValidPass1!", DisplayName = "Has Password" },
        };

        mockMongo.Setup(m => m.GetUserByUsernameAsync(It.IsAny<string>()))
            .ReturnsAsync((User?)null);
        mockAuth.Setup(a => a.RegisterAsync(It.IsAny<RegisterRequest>()))
            .ReturnsAsync(new TokenResponse());

        var sut = CreateSut(users: users);
        await sut.SeedUsersAsync();

        mockAuth.Verify(a => a.RegisterAsync(It.Is<RegisterRequest>(r => r.Username == "nopass")), Times.Never);
        mockAuth.Verify(a => a.RegisterAsync(It.Is<RegisterRequest>(r => r.Username == "haspass")), Times.Once);
    }

    [Fact]
    public async Task SeedUsersAsync_UsesCredentialsFromConfig()
    {
        var customUsers = new List<SeedUser>
        {
            new() { Username = "custom", Email = "custom@test.local", Password = "CustomPass1!", DisplayName = "Custom User" },
        };

        mockMongo.Setup(m => m.GetUserByUsernameAsync(It.IsAny<string>()))
            .ReturnsAsync((User?)null);
        mockAuth.Setup(a => a.RegisterAsync(It.IsAny<RegisterRequest>()))
            .ReturnsAsync(new TokenResponse());

        var sut = CreateSut(users: customUsers);
        await sut.SeedUsersAsync();

        mockAuth.Verify(
            a => a.RegisterAsync(It.Is<RegisterRequest>(r =>
                r.Username == "custom" &&
                r.Email == "custom@test.local" &&
                r.Password == "CustomPass1!" &&
                r.DisplayName == "Custom User")),
            Times.Once);
    }

    private SeedDataService CreateSut(bool enabled = true, List<SeedUser>? users = null)
    {
        var settings = Options.Create(new SeedingSettings
        {
            Enabled = enabled,
            Users = users ?? DefaultSeedUsers,
        });
        return new SeedDataService(
            mockMongo.Object,
            mockAuth.Object,
            settings,
            mockEnv.Object,
            mockLogger.Object);
    }
}
