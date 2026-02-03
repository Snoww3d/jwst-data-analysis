// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Interface for JWT token operations.
    /// </summary>
    public interface IJwtTokenService
    {
        /// <summary>
        /// Generates a JWT access token for the specified user.
        /// </summary>
        /// <param name="user">The user to generate the token for.</param>
        /// <returns>The JWT access token string.</returns>
        string GenerateAccessToken(User user);

        /// <summary>
        /// Generates a secure refresh token.
        /// </summary>
        /// <returns>A cryptographically secure refresh token string.</returns>
        string GenerateRefreshToken();

        /// <summary>
        /// Gets the expiration time for access tokens.
        /// </summary>
        /// <returns>The DateTime when the access token expires.</returns>
        DateTime GetAccessTokenExpiration();

        /// <summary>
        /// Gets the expiration time for refresh tokens.
        /// </summary>
        /// <returns>The DateTime when the refresh token expires.</returns>
        DateTime GetRefreshTokenExpiration();

        /// <summary>
        /// Validates a JWT access token and extracts the user ID.
        /// </summary>
        /// <param name="token">The JWT token to validate.</param>
        /// <returns>The user ID if valid, null otherwise.</returns>
        string? ValidateTokenAndGetUserId(string token);
    }
}
