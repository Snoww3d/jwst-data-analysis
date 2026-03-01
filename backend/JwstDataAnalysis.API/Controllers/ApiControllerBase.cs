// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Security.Claims;

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
    }
}
