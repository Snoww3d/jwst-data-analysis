// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Configuration;
using JwstDataAnalysis.API.Models;

using Microsoft.Extensions.Options;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Service for authentication operations.
    /// </summary>
    public partial class AuthService(
        IMongoDBService mongoDBService,
        IJwtTokenService jwtTokenService,
        IOptions<JwtSettings> jwtSettings,
        ILogger<AuthService> logger) : IAuthService
    {
        private readonly IMongoDBService mongoDBService = mongoDBService;
        private readonly IJwtTokenService jwtTokenService = jwtTokenService;
        private readonly JwtSettings jwtSettings = jwtSettings.Value;
        private readonly ILogger<AuthService> logger = logger;

        /// <inheritdoc/>
        public async Task<TokenResponse?> LoginAsync(LoginRequest request)
        {
            // Try to find user by username first, then by email
            var user = await mongoDBService.GetUserByUsernameAsync(request.Username);
            if (user == null && request.Username.Contains('@'))
            {
                // Input looks like an email, try email lookup
                user = await mongoDBService.GetUserByEmailAsync(request.Username);
            }

            if (user == null)
            {
                LogLoginFailedUserNotFound(request.Username);
                return null;
            }

            if (!user.IsActive)
            {
                LogLoginFailedUserInactive(request.Username);
                return null;
            }

            if (!BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            {
                LogLoginFailedInvalidPassword(request.Username);
                return null;
            }

            // Generate tokens
            var accessToken = jwtTokenService.GenerateAccessToken(user);
            var refreshToken = jwtTokenService.GenerateRefreshToken();
            var refreshTokenExpiry = jwtTokenService.GetRefreshTokenExpiration();

            // Store refresh token
            await mongoDBService.UpdateRefreshTokenAsync(user.Id, refreshToken, refreshTokenExpiry);

            // Update last login time
            user.LastLoginAt = DateTime.UtcNow;
            await mongoDBService.UpdateUserAsync(user);

            LogLoginSuccessful(user.Id, user.Username);

            return new TokenResponse
            {
                AccessToken = accessToken,
                RefreshToken = refreshToken,
                ExpiresAt = jwtTokenService.GetAccessTokenExpiration(),
                User = MapToUserInfoResponse(user),
            };
        }

        /// <inheritdoc/>
        public async Task<TokenResponse> RegisterAsync(RegisterRequest request)
        {
            // Check if username already exists
            var existingUser = await mongoDBService.GetUserByUsernameAsync(request.Username);
            if (existingUser != null)
            {
                LogRegistrationFailedUsernameTaken(request.Username);
                throw new InvalidOperationException("Username already exists");
            }

            // Check if email already exists (case-insensitive)
            var existingEmail = await mongoDBService.GetUserByEmailAsync(request.Email.ToLowerInvariant());
            if (existingEmail != null)
            {
                LogRegistrationFailedEmailTaken(request.Email);
                throw new InvalidOperationException("Email already exists");
            }

            // Hash password with bcrypt
            var passwordHash = BCrypt.Net.BCrypt.HashPassword(request.Password, workFactor: 12);

            // Create new user
            var user = new User
            {
                Username = request.Username,
                Email = request.Email.ToLowerInvariant(),
                PasswordHash = passwordHash,
                Role = UserRoles.User, // Default to User role
                DisplayName = request.DisplayName,
                Organization = request.Organization,
                CreatedAt = DateTime.UtcNow,
                IsActive = true,
            };

            await mongoDBService.CreateUserAsync(user);

            // Generate tokens
            var accessToken = jwtTokenService.GenerateAccessToken(user);
            var refreshToken = jwtTokenService.GenerateRefreshToken();
            var refreshTokenExpiry = jwtTokenService.GetRefreshTokenExpiration();

            // Store refresh token
            await mongoDBService.UpdateRefreshTokenAsync(user.Id, refreshToken, refreshTokenExpiry);

            LogRegistrationSuccessful(user.Id, user.Username);

            return new TokenResponse
            {
                AccessToken = accessToken,
                RefreshToken = refreshToken,
                ExpiresAt = jwtTokenService.GetAccessTokenExpiration(),
                User = MapToUserInfoResponse(user),
            };
        }

        /// <inheritdoc/>
        public async Task<TokenResponse?> RefreshTokenAsync(RefreshTokenRequest request)
        {
            var user = await mongoDBService.GetUserByRefreshTokenAsync(request.RefreshToken);

            if (user == null)
            {
                LogRefreshTokenNotFound();
                return null;
            }

            if (!user.IsActive)
            {
                LogRefreshFailedUserInactive(user.Id);
                return null;
            }

            // Check if the request matched the previous (grace window) token
            var matchedPreviousToken = user.PreviousRefreshToken == request.RefreshToken
                && user.PreviousRefreshTokenExpiresAt > DateTime.UtcNow;

            if (matchedPreviousToken)
            {
                // Grace window hit: return a fresh access token with the CURRENT refresh token.
                // Don't rotate again — all concurrent callers converge on the same token.
                LogGraceWindowRefresh(user.Id);
                var accessToken = jwtTokenService.GenerateAccessToken(user);

                return new TokenResponse
                {
                    AccessToken = accessToken,
                    RefreshToken = user.RefreshToken!,
                    ExpiresAt = jwtTokenService.GetAccessTokenExpiration(),
                    User = MapToUserInfoResponse(user),
                };
            }

            // Matched current token — check expiry
            if (user.RefreshTokenExpiresAt < DateTime.UtcNow)
            {
                LogRefreshTokenExpired(user.Id);
                return null;
            }

            // Normal rotation: generate new tokens and store old token in grace window
            var newAccessToken = jwtTokenService.GenerateAccessToken(user);
            var newRefreshToken = jwtTokenService.GenerateRefreshToken();
            var refreshTokenExpiry = jwtTokenService.GetRefreshTokenExpiration();
            var graceWindowExpiry = DateTime.UtcNow.AddSeconds(jwtSettings.RefreshTokenGraceWindowSeconds);

            // Store new refresh token with previous token in grace window
            await mongoDBService.UpdateRefreshTokenAsync(
                user.Id,
                newRefreshToken,
                refreshTokenExpiry,
                previousRefreshToken: request.RefreshToken,
                previousRefreshTokenExpiresAt: graceWindowExpiry);

            LogTokenRefreshSuccessful(user.Id);

            return new TokenResponse
            {
                AccessToken = newAccessToken,
                RefreshToken = newRefreshToken,
                ExpiresAt = jwtTokenService.GetAccessTokenExpiration(),
                User = MapToUserInfoResponse(user),
            };
        }

        /// <inheritdoc/>
        public async Task<bool> RevokeRefreshTokenAsync(string userId)
        {
            await mongoDBService.UpdateRefreshTokenAsync(userId, null, null);
            LogRefreshTokenRevoked(userId);
            return true;
        }

        /// <inheritdoc/>
        public async Task<UserInfoResponse?> GetUserInfoAsync(string userId)
        {
            var user = await mongoDBService.GetUserByIdAsync(userId);
            return user == null ? null : MapToUserInfoResponse(user);
        }

        /// <inheritdoc/>
        public async Task<bool> ChangePasswordAsync(string userId, string currentPassword, string newPassword)
        {
            var user = await mongoDBService.GetUserByIdAsync(userId);

            if (user == null)
            {
                return false;
            }

            if (!BCrypt.Net.BCrypt.Verify(currentPassword, user.PasswordHash))
            {
                LogPasswordChangeFailedInvalidCurrent(userId);
                return false;
            }

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(newPassword, workFactor: 12);
            await mongoDBService.UpdateUserAsync(user);

            // Revoke refresh token to force re-login
            await mongoDBService.UpdateRefreshTokenAsync(userId, null, null);

            LogPasswordChangeSuccessful(userId);
            return true;
        }

        private static UserInfoResponse MapToUserInfoResponse(User user)
        {
            return new UserInfoResponse
            {
                Id = user.Id,
                Username = user.Username,
                Email = user.Email,
                Role = user.Role,
                DisplayName = user.DisplayName,
                Organization = user.Organization,
                CreatedAt = user.CreatedAt,
                LastLoginAt = user.LastLoginAt,
            };
        }
    }
}
