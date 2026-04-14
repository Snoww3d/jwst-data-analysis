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
        // Pre-hashed dummy value for timing normalization on user-not-found path.
        // The actual hash value doesn't matter — it just ensures BCrypt.Verify
        // runs in constant time regardless of whether the user exists.
        private static readonly string DummyPasswordHash =
            BCrypt.Net.BCrypt.HashPassword("dummy-timing-normalization", workFactor: 12);

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
                // Run dummy BCrypt.Verify to normalize response timing and prevent
                // user enumeration via timing side-channel
                BCrypt.Net.BCrypt.Verify(request.Password, DummyPasswordHash);
                LogLoginFailedUserNotFound(request.Username);
                return null;
            }

            // Always run BCrypt.Verify before any early-return to normalize response
            // timing — prevents user enumeration via timing side-channel on
            // inactive/locked accounts
            var passwordValid = BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash);

            if (!user.IsActive)
            {
                LogLoginFailedUserInactive(request.Username);
                return null;
            }

            // Check account lockout
            if (user.LockedUntil.HasValue && user.LockedUntil.Value > DateTime.UtcNow)
            {
                LogAccountLocked(request.Username);
                return null;
            }

            // Reset counter when lockout has expired so the user gets fresh attempts
            if (user.LockedUntil.HasValue && user.LockedUntil.Value <= DateTime.UtcNow)
            {
                await mongoDBService.ResetFailedLoginAttemptsAsync(user.Id);
                user.FailedLoginAttempts = 0;
                user.LockedUntil = null;
                LogAccountLockoutExpired(request.Username);
            }

            if (!passwordValid)
            {
                var newAttemptCount = user.FailedLoginAttempts + 1;
                LogFailedLoginAttempt(newAttemptCount, request.Username);

                DateTime? lockedUntil = null;
                if (newAttemptCount >= jwtSettings.MaxFailedLoginAttempts)
                {
                    lockedUntil = DateTime.UtcNow.AddMinutes(jwtSettings.AccountLockoutMinutes);
                    LogAccountLocked(request.Username);
                }

                await mongoDBService.IncrementFailedLoginAttemptsAsync(user.Id, lockedUntil);
                return null;
            }

            // Successful login — reset any failed attempt counter
            if (user.FailedLoginAttempts > 0)
            {
                await mongoDBService.ResetFailedLoginAttemptsAsync(user.Id);
                user.FailedLoginAttempts = 0;
                user.LockedUntil = null;
            }

            // Generate tokens
            var accessToken = jwtTokenService.GenerateAccessToken(user);
            var refreshToken = jwtTokenService.GenerateRefreshToken();
            var hashedRefreshToken = jwtTokenService.HashRefreshToken(refreshToken);
            var refreshTokenExpiry = jwtTokenService.GetRefreshTokenExpiration();

            // Store hashed refresh token
            await mongoDBService.UpdateRefreshTokenAsync(user.Id, hashedRefreshToken, refreshTokenExpiry);

            // Sync in-memory user before ReplaceOneAsync to avoid overwriting
            // the refresh token we just stored above
            user.RefreshToken = hashedRefreshToken;
            user.RefreshTokenExpiresAt = refreshTokenExpiry;
            user.PreviousRefreshToken = null;
            user.PreviousRefreshTokenExpiresAt = null;
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
            // Error messages are intentionally generic to prevent user enumeration
            var existingUser = await mongoDBService.GetUserByUsernameAsync(request.Username);
            if (existingUser != null)
            {
                LogRegistrationFailedUsernameTaken(request.Username);
                throw new InvalidOperationException(
                    "An account with these details already exists. Please try different credentials.");
            }

            // Check if email already exists (case-insensitive)
            var existingEmail = await mongoDBService.GetUserByEmailAsync(request.Email.ToLowerInvariant());
            if (existingEmail != null)
            {
                LogRegistrationFailedEmailTaken(request.Email);
                throw new InvalidOperationException(
                    "An account with these details already exists. Please try different credentials.");
            }

            // Enforce password complexity at the service layer (defense in depth)
            if (!PasswordPolicy.IsValid(request.Password))
            {
                throw new ArgumentException(PasswordPolicy.ComplexityMessage, nameof(request));
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
            var hashedRefreshToken = jwtTokenService.HashRefreshToken(refreshToken);
            var refreshTokenExpiry = jwtTokenService.GetRefreshTokenExpiration();

            // Store hashed refresh token
            await mongoDBService.UpdateRefreshTokenAsync(user.Id, hashedRefreshToken, refreshTokenExpiry);

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
            // Hash the incoming token before DB lookup — DB stores hashes, not raw tokens
            var hashedIncomingToken = jwtTokenService.HashRefreshToken(request.RefreshToken);
            var user = await mongoDBService.GetUserByRefreshTokenAsync(hashedIncomingToken);

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
            var matchedPreviousToken = user.PreviousRefreshToken == hashedIncomingToken
                && user.PreviousRefreshTokenExpiresAt > DateTime.UtcNow;

            if (matchedPreviousToken)
            {
                // Grace window hit: re-rotate since stored token is a hash (can't return it raw).
                // Generate a fresh token pair, hash and store, return raw to client.
                LogGraceWindowRefresh(user.Id);
                var accessToken = jwtTokenService.GenerateAccessToken(user);
                var graceRefreshToken = jwtTokenService.GenerateRefreshToken();
                var hashedGraceRefreshToken = jwtTokenService.HashRefreshToken(graceRefreshToken);
                var refreshTokenExpiry = jwtTokenService.GetRefreshTokenExpiration();

                await mongoDBService.UpdateRefreshTokenAsync(
                    user.Id,
                    hashedGraceRefreshToken,
                    refreshTokenExpiry);

                return new TokenResponse
                {
                    AccessToken = accessToken,
                    RefreshToken = graceRefreshToken,
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
            var hashedNewRefreshToken = jwtTokenService.HashRefreshToken(newRefreshToken);
            var refreshTokenExpiry2 = jwtTokenService.GetRefreshTokenExpiration();
            var graceWindowExpiry = DateTime.UtcNow.AddSeconds(jwtSettings.RefreshTokenGraceWindowSeconds);

            // Store hashed new refresh token with hashed previous token in grace window
            await mongoDBService.UpdateRefreshTokenAsync(
                user.Id,
                hashedNewRefreshToken,
                refreshTokenExpiry2,
                previousRefreshToken: hashedIncomingToken,
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

            // Enforce password complexity at the service layer (defense in depth)
            if (!PasswordPolicy.IsValid(newPassword))
            {
                throw new ArgumentException(PasswordPolicy.ComplexityMessage, nameof(newPassword));
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
