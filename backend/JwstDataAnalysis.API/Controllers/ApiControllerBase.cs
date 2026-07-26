// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Globalization;
using System.Security.Claims;

using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.Mvc;

namespace JwstDataAnalysis.API.Controllers
{
    /// <summary>
    /// Base controller providing common auth helper methods.
    /// </summary>
    public abstract class ApiControllerBase : ControllerBase
    {
        /// <summary>
        /// Gets the current user's ID from JWT claims.
        /// Checks both <see cref="ClaimTypes.NameIdentifier"/> and the "sub" claim.
        /// </summary>
        protected string? GetCurrentUserId()
        {
            return User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                ?? User.FindFirst("sub")?.Value;
        }

        /// <summary>
        /// Gets the current user ID or throws. Use in [Authorize] endpoints where a user is guaranteed.
        /// </summary>
        protected string GetRequiredUserId()
        {
            return GetCurrentUserId()
                ?? throw new InvalidOperationException("User ID not found in JWT claims. This endpoint requires authentication.");
        }

        /// <summary>
        /// Checks if the current user has Admin role.
        /// </summary>
        protected bool IsCurrentUserAdmin() => User.IsInRole("Admin");

        /// <summary>
        /// Surfaces the processing engine's "render gate saturated" 429 to the
        /// caller verbatim, re-emitting its Retry-After hint.
        /// <para>
        /// Without this the exception falls through to the generic
        /// <see cref="HttpRequestException"/> handler and becomes a 503 with no
        /// Retry-After — which tells a client "the engine is down" (retry
        /// hopeless) when the truth is "come back in N seconds" (retry is the
        /// correct move). The whole contract of the engine's render gate is that
        /// backoff hint, so it must not die at the gateway. See #1645.
        /// </para>
        /// </summary>
        /// <param name="exception">The engine 429 exception.</param>
        /// <param name="error">User-facing message for the response body.</param>
        /// <returns>A 429 result carrying the Retry-After header.</returns>
        protected IActionResult RenderCapacityResult(HttpRequestException exception, string error)
        {
            // Fall back to the engine's default interactive window when the hint
            // is absent, so clients always get *some* backoff guidance. Clamped
            // to >= 1 to match the engine's own clamp: a client obeying
            // `Retry-After: 0` would hot-loop against a saturated renderer.
            var hint = EngineHttpErrors.ReadRetryAfter(exception);
            var seconds = int.TryParse(hint, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
                ? Math.Max(1, parsed)
                : 15;
            Response.Headers["Retry-After"] = seconds.ToString(CultureInfo.InvariantCulture);
            return StatusCode(
                StatusCodes.Status429TooManyRequests,
                new { error, retryAfterSeconds = seconds });
        }
    }
}
