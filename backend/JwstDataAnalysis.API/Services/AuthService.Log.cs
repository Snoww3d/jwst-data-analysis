// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    public partial class AuthService
    {
        // Event IDs: 2xxx for Auth Service operations

        // Login operations (20xx)
        [LoggerMessage(EventId = 2001, Level = LogLevel.Warning,
            Message = "Login failed: user not found: {Username}")]
        private partial void LogLoginFailedUserNotFound(string username);

        [LoggerMessage(EventId = 2002, Level = LogLevel.Warning,
            Message = "Login failed: user inactive: {Username}")]
        private partial void LogLoginFailedUserInactive(string username);

        [LoggerMessage(EventId = 2003, Level = LogLevel.Warning,
            Message = "Login failed: invalid password for: {Username}")]
        private partial void LogLoginFailedInvalidPassword(string username);

        [LoggerMessage(EventId = 2004, Level = LogLevel.Information,
            Message = "Login successful for user {UserId} ({Username})")]
        private partial void LogLoginSuccessful(string userId, string username);

        // Registration operations (21xx)
        [LoggerMessage(EventId = 2101, Level = LogLevel.Warning,
            Message = "Registration failed: username already exists: {Username}")]
        private partial void LogRegistrationFailedUsernameTaken(string username);

        [LoggerMessage(EventId = 2102, Level = LogLevel.Warning,
            Message = "Registration failed: email already exists: {Email}")]
        private partial void LogRegistrationFailedEmailTaken(string email);

        [LoggerMessage(EventId = 2103, Level = LogLevel.Information,
            Message = "Registration successful for user {UserId} ({Username})")]
        private partial void LogRegistrationSuccessful(string userId, string username);

        // Token operations (22xx)
        [LoggerMessage(EventId = 2201, Level = LogLevel.Warning,
            Message = "Refresh token not found in database")]
        private partial void LogRefreshTokenNotFound();

        [LoggerMessage(EventId = 2202, Level = LogLevel.Warning,
            Message = "Refresh token expired for user: {UserId}")]
        private partial void LogRefreshTokenExpired(string userId);

        [LoggerMessage(EventId = 2203, Level = LogLevel.Warning,
            Message = "Token refresh failed: user inactive: {UserId}")]
        private partial void LogRefreshFailedUserInactive(string userId);

        [LoggerMessage(EventId = 2204, Level = LogLevel.Information,
            Message = "Token refresh successful for user: {UserId}")]
        private partial void LogTokenRefreshSuccessful(string userId);

        [LoggerMessage(EventId = 2205, Level = LogLevel.Information,
            Message = "Refresh token revoked for user: {UserId}")]
        private partial void LogRefreshTokenRevoked(string userId);

        [LoggerMessage(EventId = 2206, Level = LogLevel.Information,
            Message = "Grace window refresh for user: {UserId} — returning current tokens without re-rotation")]
        private partial void LogGraceWindowRefresh(string userId);

        // Password operations (23xx)
        [LoggerMessage(EventId = 2301, Level = LogLevel.Warning,
            Message = "Password change failed: invalid current password for user: {UserId}")]
        private partial void LogPasswordChangeFailedInvalidCurrent(string userId);

        [LoggerMessage(EventId = 2302, Level = LogLevel.Information,
            Message = "Password changed successfully for user: {UserId}")]
        private partial void LogPasswordChangeSuccessful(string userId);
    }
}
