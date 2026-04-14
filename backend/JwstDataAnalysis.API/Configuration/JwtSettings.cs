// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Configuration
{
    /// <summary>
    /// Configuration settings for JWT token generation and validation.
    /// </summary>
    public class JwtSettings
    {
        /// <summary>
        /// Gets or sets the secret key used to sign JWT tokens.
        /// Must be at least 32 characters for HS256.
        /// </summary>
        public string SecretKey { get; set; } = string.Empty;

        /// <summary>
        /// Gets or sets the issuer claim for JWT tokens.
        /// </summary>
        public string Issuer { get; set; } = "JwstDataAnalysis";

        /// <summary>
        /// Gets or sets the audience claim for JWT tokens.
        /// </summary>
        public string Audience { get; set; } = "JwstDataAnalysisClient";

        /// <summary>
        /// Gets or sets the access token expiration time in minutes.
        /// </summary>
        public int AccessTokenExpirationMinutes { get; set; } = 60;

        /// <summary>
        /// Gets or sets the refresh token expiration time in days.
        /// </summary>
        public int RefreshTokenExpirationDays { get; set; } = 7;

        /// <summary>
        /// Gets or sets the clock skew tolerance in seconds for JWT validation.
        /// Compensates for clock drift between server and client in containerized environments.
        /// </summary>
        public int ClockSkewSeconds { get; set; } = 30;

        /// <summary>
        /// Gets or sets the grace window in seconds during which a previous refresh token
        /// remains valid after token rotation. Prevents race conditions when concurrent
        /// requests use the old token during rotation.
        /// 60s accommodates the simplified 2-attempt client retry (try + 1s delay + retry)
        /// plus network latency margin.
        /// </summary>
        public int RefreshTokenGraceWindowSeconds { get; set; } = 60;

        /// <summary>
        /// Gets or sets the maximum number of consecutive failed login attempts
        /// before the account is temporarily locked.
        /// </summary>
        public int MaxFailedLoginAttempts { get; set; } = 5;

        /// <summary>
        /// Gets or sets the duration in minutes that an account remains locked
        /// after exceeding <see cref="MaxFailedLoginAttempts"/>.
        /// </summary>
        public int AccountLockoutMinutes { get; set; } = 15;
    }
}
