// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public partial class AuthController : ControllerBase
    {
        private readonly IAuthService authService;
        private readonly ILogger<AuthController> logger;

        public AuthController(IAuthService authService, ILogger<AuthController> logger)
        {
            this.authService = authService;
            this.logger = logger;
        }

        /// <summary>
        /// Authenticate a user with username and password.
        /// </summary>
        [HttpPost("login")]
        [AllowAnonymous]
        public async Task<ActionResult<TokenResponse>> Login([FromBody] LoginRequest request)
        {
            try
            {
                var result = await authService.LoginAsync(request);

                if (result == null)
                {
                    return Unauthorized(new { error = "Invalid username or password" });
                }

                return Ok(result);
            }
            catch (Exception ex)
            {
                LogLoginError(ex);
                return StatusCode(500, new { error = "An error occurred during login" });
            }
        }

        /// <summary>
        /// Register a new user account.
        /// </summary>
        [HttpPost("register")]
        [AllowAnonymous]
        public async Task<ActionResult<TokenResponse>> Register([FromBody] RegisterRequest request)
        {
            try
            {
                var result = await authService.RegisterAsync(request);
                return CreatedAtAction(nameof(GetCurrentUser), null, result);
            }
            catch (InvalidOperationException ex)
            {
                LogRegistrationValidationError(ex.Message);
                return BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                LogRegistrationError(ex);
                return StatusCode(500, new { error = "An error occurred during registration" });
            }
        }

        /// <summary>
        /// Refresh an access token using a refresh token.
        /// </summary>
        [HttpPost("refresh")]
        [AllowAnonymous]
        public async Task<ActionResult<TokenResponse>> RefreshToken([FromBody] RefreshTokenRequest request)
        {
            try
            {
                var result = await authService.RefreshTokenAsync(request);

                if (result == null)
                {
                    return Unauthorized(new { error = "Invalid or expired refresh token" });
                }

                return Ok(result);
            }
            catch (Exception ex)
            {
                LogRefreshTokenError(ex);
                return StatusCode(500, new { error = "An error occurred during token refresh" });
            }
        }

        /// <summary>
        /// Logout the current user (revoke refresh token).
        /// </summary>
        [HttpPost("logout")]
        [Authorize]
        public async Task<IActionResult> Logout()
        {
            try
            {
                var userId = GetCurrentUserId();
                if (userId == null)
                {
                    return Unauthorized();
                }

                await authService.RevokeRefreshTokenAsync(userId);
                return Ok(new { message = "Logged out successfully" });
            }
            catch (Exception ex)
            {
                LogLogoutError(ex);
                return StatusCode(500, new { error = "An error occurred during logout" });
            }
        }

        /// <summary>
        /// Get the current user's information.
        /// </summary>
        [HttpGet("me")]
        [Authorize]
        public async Task<ActionResult<UserInfoResponse>> GetCurrentUser()
        {
            try
            {
                var userId = GetCurrentUserId();
                if (userId == null)
                {
                    return Unauthorized();
                }

                var user = await authService.GetUserInfoAsync(userId);
                if (user == null)
                {
                    return NotFound(new { error = "User not found" });
                }

                return Ok(user);
            }
            catch (Exception ex)
            {
                LogGetCurrentUserError(ex);
                return StatusCode(500, new { error = "An error occurred while fetching user info" });
            }
        }

        /// <summary>
        /// Change the current user's password.
        /// </summary>
        [HttpPost("change-password")]
        [Authorize]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
        {
            try
            {
                var userId = GetCurrentUserId();
                if (userId == null)
                {
                    return Unauthorized();
                }

                var success = await authService.ChangePasswordAsync(
                    userId,
                    request.CurrentPassword,
                    request.NewPassword);

                if (!success)
                {
                    return BadRequest(new { error = "Current password is incorrect" });
                }

                return Ok(new { message = "Password changed successfully. Please log in again." });
            }
            catch (Exception ex)
            {
                LogChangePasswordError(ex);
                return StatusCode(500, new { error = "An error occurred while changing password" });
            }
        }

        /// <summary>
        /// Gets the current user's ID from the JWT claims.
        /// </summary>
        private string? GetCurrentUserId()
        {
            return User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                ?? User.FindFirst("sub")?.Value;
        }
    }
}
