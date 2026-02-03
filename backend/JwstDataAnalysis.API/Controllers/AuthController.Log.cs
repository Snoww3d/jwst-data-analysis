// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Controllers
{
    public partial class AuthController
    {
        // Event IDs: 20xx for Auth Controller operations
        [LoggerMessage(EventId = 2010, Level = LogLevel.Error,
            Message = "Error during login")]
        private partial void LogLoginError(Exception ex);

        [LoggerMessage(EventId = 2011, Level = LogLevel.Warning,
            Message = "Registration validation error: {Message}")]
        private partial void LogRegistrationValidationError(string message);

        [LoggerMessage(EventId = 2012, Level = LogLevel.Error,
            Message = "Error during registration")]
        private partial void LogRegistrationError(Exception ex);

        [LoggerMessage(EventId = 2013, Level = LogLevel.Error,
            Message = "Error during token refresh")]
        private partial void LogRefreshTokenError(Exception ex);

        [LoggerMessage(EventId = 2014, Level = LogLevel.Error,
            Message = "Error during logout")]
        private partial void LogLogoutError(Exception ex);

        [LoggerMessage(EventId = 2015, Level = LogLevel.Error,
            Message = "Error getting current user info")]
        private partial void LogGetCurrentUserError(Exception ex);

        [LoggerMessage(EventId = 2016, Level = LogLevel.Error,
            Message = "Error changing password")]
        private partial void LogChangePasswordError(Exception ex);
    }
}
