// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Interface for authentication operations.
    /// </summary>
    public interface IAuthService
    {
        /// <summary>
        /// Authenticates a user with username and password.
        /// </summary>
        /// <param name="request">The login request containing credentials.</param>
        /// <returns>A token response if successful, null if authentication fails.</returns>
        Task<TokenResponse?> LoginAsync(LoginRequest request);

        /// <summary>
        /// Registers a new user.
        /// </summary>
        /// <param name="request">The registration request.</param>
        /// <returns>A token response if successful.</returns>
        /// <exception cref="InvalidOperationException">Thrown when username or email already exists.</exception>
        Task<TokenResponse> RegisterAsync(RegisterRequest request);

        /// <summary>
        /// Refreshes an access token using a refresh token.
        /// </summary>
        /// <param name="request">The refresh token request.</param>
        /// <returns>A new token response if successful, null if refresh token is invalid.</returns>
        Task<TokenResponse?> RefreshTokenAsync(RefreshTokenRequest request);

        /// <summary>
        /// Revokes a user's refresh token (logout).
        /// </summary>
        /// <param name="userId">The user ID to revoke the token for.</param>
        /// <returns>True if successful.</returns>
        Task<bool> RevokeRefreshTokenAsync(string userId);

        /// <summary>
        /// Gets user information by user ID.
        /// </summary>
        /// <param name="userId">The user ID.</param>
        /// <returns>User information if found, null otherwise.</returns>
        Task<UserInfoResponse?> GetUserInfoAsync(string userId);

        /// <summary>
        /// Changes a user's password.
        /// </summary>
        /// <param name="userId">The user ID.</param>
        /// <param name="currentPassword">The current password.</param>
        /// <param name="newPassword">The new password.</param>
        /// <returns>True if successful, false if current password is incorrect.</returns>
        Task<bool> ChangePasswordAsync(string userId, string currentPassword, string newPassword);
    }
}
