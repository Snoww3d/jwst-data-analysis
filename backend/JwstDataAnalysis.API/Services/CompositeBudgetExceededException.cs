// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Thrown when the processing engine refuses a composite request because
    /// the projected output would shrink below the configured fail threshold
    /// (HTTP 413). Detail string is propagated verbatim from the engine and
    /// names the env vars an operator can tune to allow the request.
    /// </summary>
    public sealed class CompositeBudgetExceededException : Exception
    {
        public CompositeBudgetExceededException(string detail)
            : base(detail)
        {
        }
    }
}
