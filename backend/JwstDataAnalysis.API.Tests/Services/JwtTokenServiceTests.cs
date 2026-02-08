// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

using FluentAssertions;

using JwstDataAnalysis.API.Configuration;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for JwtTokenService.
/// Includes regression tests for clock skew tolerance (GitHub issue: session expiry after minutes).
/// </summary>
public class JwtTokenServiceTests
{
    private const string TestSecretKey = "ThisIsATestSecretKeyThatIsAtLeast32Characters!";
    private const string TestIssuer = "TestIssuer";
    private const string TestAudience = "TestAudience";

    [Fact]
    public void GenerateAccessToken_ReturnsValidJwt()
    {
        var service = CreateService();
        var user = CreateTestUser();

        var token = service.GenerateAccessToken(user);

        token.Should().NotBeNullOrEmpty();
        var handler = new JwtSecurityTokenHandler();
        handler.CanReadToken(token).Should().BeTrue();
    }

    [Fact]
    public void GenerateAccessToken_ContainsCorrectClaims()
    {
        var service = CreateService();
        var user = CreateTestUser();

        var token = service.GenerateAccessToken(user);

        var handler = new JwtSecurityTokenHandler();
        var jwt = handler.ReadJwtToken(token);
        jwt.Claims.Should().Contain(c => c.Type == JwtRegisteredClaimNames.Sub && c.Value == user.Id);
        jwt.Claims.Should().Contain(c => c.Type == JwtRegisteredClaimNames.UniqueName && c.Value == user.Username);
        jwt.Claims.Should().Contain(c => c.Type == JwtRegisteredClaimNames.Email && c.Value == user.Email);
    }

    [Fact]
    public void ValidateTokenAndGetUserId_ReturnsUserId_ForValidToken()
    {
        var service = CreateService();
        var user = CreateTestUser();
        var token = service.GenerateAccessToken(user);

        var userId = service.ValidateTokenAndGetUserId(token);

        userId.Should().Be(user.Id);
    }

    [Fact]
    public void ValidateTokenAndGetUserId_ReturnsNull_ForTamperedToken()
    {
        var service = CreateService();
        var user = CreateTestUser();
        var token = service.GenerateAccessToken(user);

        // Tamper with the token payload
        var parts = token.Split('.');
        parts[1] = Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"sub\":\"hacked\"}"));
        var tamperedToken = string.Join('.', parts);

        var userId = service.ValidateTokenAndGetUserId(tamperedToken);

        userId.Should().BeNull();
    }

    [Fact]
    public void ValidateTokenAndGetUserId_ReturnsNull_ForGarbageToken()
    {
        var service = CreateService();

        var userId = service.ValidateTokenAndGetUserId("not.a.token");

        userId.Should().BeNull();
    }

    [Fact]
    public void GenerateRefreshToken_ReturnsUniqueTokens()
    {
        var service = CreateService();

        var token1 = service.GenerateRefreshToken();
        var token2 = service.GenerateRefreshToken();

        token1.Should().NotBeNullOrEmpty();
        token2.Should().NotBeNullOrEmpty();
        token1.Should().NotBe(token2);
    }

    // --- Clock skew regression tests ---
    // These verify the fix for premature session expiry in Docker environments
    // where clock drift between container and host caused immediate token rejection.
    [Fact]
    public void ValidateTokenAndGetUserId_ToleratesClockSkew_WithinConfiguredTolerance()
    {
        // Regression: With ClockSkew = TimeSpan.Zero, any clock drift caused 401s.
        // A token that expired 10 seconds ago should still validate with 30s tolerance.
        var service = CreateService(clockSkewSeconds: 30);
        var user = CreateTestUser();

        // Generate a token that's already expired by 10 seconds
        var token = GenerateTokenWithCustomExpiry(TimeSpan.FromSeconds(-10));

        var userId = service.ValidateTokenAndGetUserId(token);

        userId.Should().Be("user-123", "token expired 10s ago should pass with 30s clock skew tolerance");
    }

    [Fact]
    public void ValidateTokenAndGetUserId_RejectsToken_BeyondClockSkewTolerance()
    {
        // A token expired 60 seconds ago should NOT validate with 30s tolerance.
        var service = CreateService(clockSkewSeconds: 30);

        var token = GenerateTokenWithCustomExpiry(TimeSpan.FromSeconds(-60));

        var userId = service.ValidateTokenAndGetUserId(token);

        userId.Should().BeNull("token expired 60s ago should fail with only 30s clock skew tolerance");
    }

    [Fact]
    public void ValidateTokenAndGetUserId_WithZeroClockSkew_RejectsSlightlyExpiredToken()
    {
        // Documents the old broken behavior: zero tolerance rejects tokens expired by even 1 second.
        var service = CreateService(clockSkewSeconds: 0);

        var token = GenerateTokenWithCustomExpiry(TimeSpan.FromSeconds(-2));

        var userId = service.ValidateTokenAndGetUserId(token);

        userId.Should().BeNull("zero clock skew should reject any expired token");
    }

    [Fact]
    public void Constructor_ThrowsForShortSecretKey()
    {
        var settings = Options.Create(new JwtSettings
        {
            SecretKey = "tooshort",
            Issuer = TestIssuer,
            Audience = TestAudience,
        });

        var act = () => new JwtTokenService(settings);

        act.Should().Throw<ArgumentException>().WithMessage("*at least 32 characters*");
    }

    [Fact]
    public void ClockSkewSeconds_DefaultsTo30()
    {
        var settings = new JwtSettings();

        settings.ClockSkewSeconds.Should().Be(30);
    }

    private static JwtTokenService CreateService(int clockSkewSeconds = 30, int accessTokenMinutes = 15)
    {
        var settings = Options.Create(new JwtSettings
        {
            SecretKey = TestSecretKey,
            Issuer = TestIssuer,
            Audience = TestAudience,
            AccessTokenExpirationMinutes = accessTokenMinutes,
            RefreshTokenExpirationDays = 7,
            ClockSkewSeconds = clockSkewSeconds,
        });
        return new JwtTokenService(settings);
    }

    private static User CreateTestUser() => new()
    {
        Id = "user-123",
        Username = "testuser",
        Email = "test@example.com",
        Role = "User",
        PasswordHash = "hash",
    };

    /// <summary>
    /// Generates a JWT with a custom expiry offset from now.
    /// Negative offset = already expired, positive = future expiry.
    /// </summary>
    private static string GenerateTokenWithCustomExpiry(TimeSpan expiryOffset)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(TestSecretKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, "user-123"),
            new(JwtRegisteredClaimNames.UniqueName, "testuser"),
            new(JwtRegisteredClaimNames.Email, "test@example.com"),
            new(ClaimTypes.Role, "User"),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };

        var token = new JwtSecurityToken(
            issuer: TestIssuer,
            audience: TestAudience,
            claims: claims,
            expires: DateTime.UtcNow.Add(expiryOffset),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
