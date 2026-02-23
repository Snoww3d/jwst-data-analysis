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
/// Unit tests for AuthController.
/// </summary>
public class AuthControllerTests
{
    private const string TestUserId = "test-user-123";
    private readonly Mock<IAuthService> mockAuthService;
    private readonly AuthController sut;

    public AuthControllerTests()
    {
        mockAuthService = new Mock<IAuthService>();
        var mockLogger = new Mock<ILogger<AuthController>>();
        sut = new AuthController(mockAuthService.Object, mockLogger.Object);
    }

    // --- Login ---
    [Fact]
    public async Task Login_ReturnsOk_WhenCredentialsValid()
    {
        var tokenResponse = new TokenResponse { AccessToken = "jwt-token", RefreshToken = "refresh" };
        mockAuthService.Setup(s => s.LoginAsync(It.IsAny<LoginRequest>()))
            .ReturnsAsync(tokenResponse);

        var result = await sut.Login(new LoginRequest { Username = "admin", Password = "pass" });

        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(tokenResponse);
    }

    [Fact]
    public async Task Login_ReturnsUnauthorized_WhenCredentialsInvalid()
    {
        mockAuthService.Setup(s => s.LoginAsync(It.IsAny<LoginRequest>()))
            .ReturnsAsync((TokenResponse?)null);

        var result = await sut.Login(new LoginRequest { Username = "bad", Password = "bad" });

        result.Result.Should().BeOfType<UnauthorizedObjectResult>();
    }

    [Fact]
    public async Task Login_Returns500_OnException()
    {
        mockAuthService.Setup(s => s.LoginAsync(It.IsAny<LoginRequest>()))
            .ThrowsAsync(new Exception("DB error"));

        var result = await sut.Login(new LoginRequest { Username = "a", Password = "b" });

        var statusResult = result.Result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(500);
    }

    // --- Register ---
    [Fact]
    public async Task Register_ReturnsCreated_WhenSuccessful()
    {
        var tokenResponse = new TokenResponse { AccessToken = "jwt" };
        mockAuthService.Setup(s => s.RegisterAsync(It.IsAny<RegisterRequest>()))
            .ReturnsAsync(tokenResponse);

        var result = await sut.Register(new RegisterRequest
        {
            Username = "new", Email = "new@test.com", Password = "Password1!",
        });

        result.Result.Should().BeOfType<CreatedAtActionResult>();
    }

    [Fact]
    public async Task Register_ReturnsBadRequest_WhenValidationFails()
    {
        mockAuthService.Setup(s => s.RegisterAsync(It.IsAny<RegisterRequest>()))
            .ThrowsAsync(new InvalidOperationException("Username taken"));

        var result = await sut.Register(new RegisterRequest
        {
            Username = "taken", Email = "x@x.com", Password = "Password1!",
        });

        result.Result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task Register_Returns500_OnException()
    {
        mockAuthService.Setup(s => s.RegisterAsync(It.IsAny<RegisterRequest>()))
            .ThrowsAsync(new Exception("DB error"));

        var result = await sut.Register(new RegisterRequest
        {
            Username = "u", Email = "e@e.com", Password = "Password1!",
        });

        var statusResult = result.Result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(500);
    }

    // --- RefreshToken ---
    [Fact]
    public async Task RefreshToken_ReturnsOk_WhenValid()
    {
        var tokenResponse = new TokenResponse { AccessToken = "new-jwt" };
        mockAuthService.Setup(s => s.RefreshTokenAsync(It.IsAny<RefreshTokenRequest>()))
            .ReturnsAsync(tokenResponse);

        var result = await sut.RefreshToken(new RefreshTokenRequest { RefreshToken = "valid" });

        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(tokenResponse);
    }

    [Fact]
    public async Task RefreshToken_ReturnsUnauthorized_WhenInvalid()
    {
        mockAuthService.Setup(s => s.RefreshTokenAsync(It.IsAny<RefreshTokenRequest>()))
            .ReturnsAsync((TokenResponse?)null);

        var result = await sut.RefreshToken(new RefreshTokenRequest { RefreshToken = "expired" });

        result.Result.Should().BeOfType<UnauthorizedObjectResult>();
    }

    [Fact]
    public async Task RefreshToken_Returns500_OnException()
    {
        mockAuthService.Setup(s => s.RefreshTokenAsync(It.IsAny<RefreshTokenRequest>()))
            .ThrowsAsync(new Exception("fail"));

        var result = await sut.RefreshToken(new RefreshTokenRequest { RefreshToken = "x" });

        var statusResult = result.Result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(500);
    }

    // --- Logout ---
    [Fact]
    public async Task Logout_ReturnsOk_WhenAuthenticated()
    {
        SetupAuthenticatedUser(TestUserId);
        mockAuthService.Setup(s => s.RevokeRefreshTokenAsync(TestUserId))
            .ReturnsAsync(true);

        var result = await sut.Logout();

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task Logout_ReturnsUnauthorized_WhenNoUserId()
    {
        // No claims set up — user not authenticated
        sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext(),
        };

        var result = await sut.Logout();

        result.Should().BeOfType<UnauthorizedResult>();
    }

    [Fact]
    public async Task Logout_Returns500_OnException()
    {
        SetupAuthenticatedUser(TestUserId);
        mockAuthService.Setup(s => s.RevokeRefreshTokenAsync(TestUserId))
            .ThrowsAsync(new Exception("fail"));

        var result = await sut.Logout();

        var statusResult = result.Should().BeOfType<ObjectResult>().Subject;
        statusResult.StatusCode.Should().Be(500);
    }

    // --- GetCurrentUser ---
    [Fact]
    public async Task GetCurrentUser_ReturnsOk_WhenUserFound()
    {
        SetupAuthenticatedUser(TestUserId);
        var userInfo = new UserInfoResponse { Id = TestUserId, Username = "admin" };
        mockAuthService.Setup(s => s.GetUserInfoAsync(TestUserId))
            .ReturnsAsync(userInfo);

        var result = await sut.GetCurrentUser();

        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().Be(userInfo);
    }

    [Fact]
    public async Task GetCurrentUser_ReturnsNotFound_WhenUserMissing()
    {
        SetupAuthenticatedUser(TestUserId);
        mockAuthService.Setup(s => s.GetUserInfoAsync(TestUserId))
            .ReturnsAsync((UserInfoResponse?)null);

        var result = await sut.GetCurrentUser();

        result.Result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetCurrentUser_ReturnsUnauthorized_WhenNoUserId()
    {
        sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext(),
        };

        var result = await sut.GetCurrentUser();

        result.Result.Should().BeOfType<UnauthorizedResult>();
    }

    // --- ChangePassword ---
    [Fact]
    public async Task ChangePassword_ReturnsOk_WhenSuccessful()
    {
        SetupAuthenticatedUser(TestUserId);
        mockAuthService.Setup(s => s.ChangePasswordAsync(TestUserId, "old", "new12345"))
            .ReturnsAsync(true);

        var result = await sut.ChangePassword(new ChangePasswordRequest
        {
            CurrentPassword = "old", NewPassword = "new12345",
        });

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task ChangePassword_ReturnsBadRequest_WhenCurrentPasswordWrong()
    {
        SetupAuthenticatedUser(TestUserId);
        mockAuthService.Setup(s => s.ChangePasswordAsync(TestUserId, "wrong", "new12345"))
            .ReturnsAsync(false);

        var result = await sut.ChangePassword(new ChangePasswordRequest
        {
            CurrentPassword = "wrong", NewPassword = "new12345",
        });

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task ChangePassword_ReturnsUnauthorized_WhenNoUserId()
    {
        sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext(),
        };

        var result = await sut.ChangePassword(new ChangePasswordRequest
        {
            CurrentPassword = "x", NewPassword = "y",
        });

        result.Should().BeOfType<UnauthorizedResult>();
    }

    private void SetupAuthenticatedUser(string userId)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId),
            new("sub", userId),
        };

        var identity = new ClaimsIdentity(claims, "TestAuth");
        var principal = new ClaimsPrincipal(identity);

        sut.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = principal },
        };
    }
}
