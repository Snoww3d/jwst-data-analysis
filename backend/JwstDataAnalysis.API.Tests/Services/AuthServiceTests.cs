// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;

using JwstDataAnalysis.API.Configuration;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for AuthService refresh token grace window logic.
/// </summary>
public class AuthServiceTests
{
    private const string UserId = "user-123";
    private const string Username = "testuser";
    private const string Email = "test@example.com";
    private const int GraceWindowSeconds = 30;

    private readonly Mock<IMongoDBService> mockMongoDb = new();
    private readonly Mock<IJwtTokenService> mockJwtService = new();
    private readonly IOptions<JwtSettings> jwtSettings;
    private readonly AuthService sut;

    public AuthServiceTests()
    {
        jwtSettings = Options.Create(new JwtSettings
        {
            RefreshTokenGraceWindowSeconds = GraceWindowSeconds,
        });

        sut = new AuthService(
            mockMongoDb.Object,
            mockJwtService.Object,
            jwtSettings,
            Mock.Of<ILogger<AuthService>>());

        // Default JWT service behavior
        mockJwtService.Setup(j => j.GenerateAccessToken(It.IsAny<User>()))
            .Returns("new-access-token");
        mockJwtService.Setup(j => j.GenerateRefreshToken())
            .Returns("new-refresh-token");
        mockJwtService.Setup(j => j.GetRefreshTokenExpiration())
            .Returns(DateTime.UtcNow.AddDays(7));
        mockJwtService.Setup(j => j.GetAccessTokenExpiration())
            .Returns(DateTime.UtcNow.AddMinutes(15));
        mockJwtService.Setup(j => j.HashRefreshToken(It.IsAny<string>()))
            .Returns((string token) => $"hashed-{token}");
    }

    [Fact]
    public async Task RefreshToken_NormalRotation_StoresPreviousToken()
    {
        // Arrange
        var user = CreateTestUser();
        mockMongoDb.Setup(m => m.GetUserByRefreshTokenAsync("hashed-current-refresh-token"))
            .ReturnsAsync(user);

        var request = new RefreshTokenRequest { RefreshToken = "current-refresh-token" };

        // Act
        var result = await sut.RefreshTokenAsync(request);

        // Assert
        result.Should().NotBeNull();
        result!.AccessToken.Should().Be("new-access-token");
        result.RefreshToken.Should().Be("new-refresh-token");

        // Verify hashed tokens are stored
        mockMongoDb.Verify(
            m => m.UpdateRefreshTokenAsync(
                UserId,
                "hashed-new-refresh-token",
                It.IsAny<DateTime>(),
                "hashed-current-refresh-token",
                It.Is<DateTime?>(d => d.HasValue && d.Value > DateTime.UtcNow)),
            Times.Once);
    }

    [Fact]
    public async Task RefreshToken_GraceWindowHit_ReRotatesAndReturnsNewToken()
    {
        // Arrange — user already rotated, request comes with the OLD token
        var user = CreateTestUser(
            refreshToken: "hashed-new-refresh-token",
            previousRefreshToken: "hashed-old-refresh-token",
            previousRefreshTokenExpiresAt: DateTime.UtcNow.AddSeconds(20));

        mockMongoDb.Setup(m => m.GetUserByRefreshTokenAsync("hashed-old-refresh-token"))
            .ReturnsAsync(user);

        var request = new RefreshTokenRequest { RefreshToken = "old-refresh-token" };

        // Act
        var result = await sut.RefreshTokenAsync(request);

        // Assert
        result.Should().NotBeNull();
        result!.AccessToken.Should().Be("new-access-token");
        result.RefreshToken.Should().Be("new-refresh-token");

        // Grace window re-rotates: stores a new hashed token, clears previous
        mockMongoDb.Verify(
            m => m.UpdateRefreshTokenAsync(
                UserId,
                "hashed-new-refresh-token",
                It.IsAny<DateTime>(),
                null,
                null),
            Times.Once);
    }

    [Fact]
    public async Task RefreshToken_ExpiredGraceWindow_ReturnsNull()
    {
        // Arrange — previous token's grace window has expired
        // GetUserByRefreshTokenAsync won't match because the DB query filters by expiry
        mockMongoDb.Setup(m => m.GetUserByRefreshTokenAsync("hashed-expired-old-token"))
            .ReturnsAsync((User?)null);

        var request = new RefreshTokenRequest { RefreshToken = "expired-old-token" };

        // Act
        var result = await sut.RefreshTokenAsync(request);

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task RefreshToken_ConcurrentRequests_BothGetFreshTokens()
    {
        // Arrange — simulate two concurrent requests with the old token
        // Both hit the grace window and each gets a re-rotation
        var user = CreateTestUser(
            refreshToken: "hashed-rotated-refresh-token",
            previousRefreshToken: "hashed-original-refresh-token",
            previousRefreshTokenExpiresAt: DateTime.UtcNow.AddSeconds(20));

        mockMongoDb.Setup(m => m.GetUserByRefreshTokenAsync("hashed-original-refresh-token"))
            .ReturnsAsync(user);

        var request = new RefreshTokenRequest { RefreshToken = "original-refresh-token" };

        // Act — two "concurrent" calls with the same old token
        var result1 = await sut.RefreshTokenAsync(request);
        var result2 = await sut.RefreshTokenAsync(request);

        // Assert — both succeed with fresh tokens (each re-rotation generates new ones)
        result1.Should().NotBeNull();
        result2.Should().NotBeNull();
        result1!.RefreshToken.Should().Be("new-refresh-token");
        result2!.RefreshToken.Should().Be("new-refresh-token");

        // Each grace window hit triggers a re-rotation
        mockMongoDb.Verify(
            m => m.UpdateRefreshTokenAsync(
                UserId,
                "hashed-new-refresh-token",
                It.IsAny<DateTime>(),
                null,
                null),
            Times.Exactly(2));
    }

    [Fact]
    public async Task RevokeRefreshToken_ClearsBothTokens()
    {
        // Act
        var result = await sut.RevokeRefreshTokenAsync(UserId);

        // Assert
        result.Should().BeTrue();

        // UpdateRefreshTokenAsync is called with null for all token fields
        // The optional params default to null, so both current and previous tokens are cleared
        mockMongoDb.Verify(
            m => m.UpdateRefreshTokenAsync(
                UserId,
                null,
                null,
                null,
                null),
            Times.Once);
    }

    [Fact]
    public async Task RefreshToken_InactiveUser_ReturnsNull()
    {
        // Arrange
        var user = CreateTestUser();
        user.IsActive = false;
        mockMongoDb.Setup(m => m.GetUserByRefreshTokenAsync("hashed-current-refresh-token"))
            .ReturnsAsync(user);

        var request = new RefreshTokenRequest { RefreshToken = "current-refresh-token" };

        // Act
        var result = await sut.RefreshTokenAsync(request);

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task RefreshToken_ExpiredCurrentToken_ReturnsNull()
    {
        // Arrange
        var user = CreateTestUser();
        user.RefreshTokenExpiresAt = DateTime.UtcNow.AddHours(-1); // expired
        mockMongoDb.Setup(m => m.GetUserByRefreshTokenAsync("hashed-current-refresh-token"))
            .ReturnsAsync(user);

        var request = new RefreshTokenRequest { RefreshToken = "current-refresh-token" };

        // Act
        var result = await sut.RefreshTokenAsync(request);

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task Login_StoresHashedToken_ReturnsRawToken()
    {
        // Arrange
        var user = CreateTestUser();
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword("correct-password");
        mockMongoDb.Setup(m => m.GetUserByUsernameAsync(Username))
            .ReturnsAsync(user);

        var request = new LoginRequest { Username = Username, Password = "correct-password" };

        // Act
        var result = await sut.LoginAsync(request);

        // Assert
        result.Should().NotBeNull();

        // Raw token returned to client
        result!.RefreshToken.Should().Be("new-refresh-token");

        // Hashed token stored in DB
        mockMongoDb.Verify(
            m => m.UpdateRefreshTokenAsync(
                UserId,
                "hashed-new-refresh-token",
                It.IsAny<DateTime>(),
                null,
                null),
            Times.Once);
    }

    private static User CreateTestUser(
        string? refreshToken = "hashed-current-refresh-token",
        string? previousRefreshToken = null,
        DateTime? previousRefreshTokenExpiresAt = null)
    {
        return new User
        {
            Id = UserId,
            Username = Username,
            Email = Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("password"),
            Role = UserRoles.User,
            IsActive = true,
            RefreshToken = refreshToken,
            RefreshTokenExpiresAt = DateTime.UtcNow.AddDays(7),
            PreviousRefreshToken = previousRefreshToken,
            PreviousRefreshTokenExpiresAt = previousRefreshTokenExpiresAt,
        };
    }
}
