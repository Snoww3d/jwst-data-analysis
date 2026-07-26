// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Globalization;
using System.Net;

namespace JwstDataAnalysis.API.Services
{
    /// <summary>
    /// Helpers for turning a failed processing-engine response into an
    /// <see cref="HttpRequestException"/> that keeps the bits the gateway needs
    /// to answer the caller faithfully.
    /// <para>
    /// The engine's render gate answers 429 + <c>Retry-After</c> when its global
    /// render semaphore is saturated (#1645). <see cref="HttpRequestException"/>
    /// carries the status code but nothing else, so the header would be lost on
    /// the way through the gateway — and "back off for N seconds" is the entire
    /// point of that response. It is stashed in <see cref="System.Exception.Data"/>
    /// under <see cref="RetryAfterKey"/> so controllers can re-emit it.
    /// </para>
    /// </summary>
    public static class EngineHttpErrors
    {
        /// <summary>
        /// Key under which the engine's Retry-After delta (in seconds, as a
        /// string) is stashed on the exception's Data dictionary.
        /// </summary>
        public const string RetryAfterKey = "Retry-After";

        /// <summary>
        /// Builds an <see cref="HttpRequestException"/> for a failed engine
        /// response, preserving the status code and any Retry-After hint.
        /// </summary>
        /// <param name="message">Exception message (already-parsed engine detail).</param>
        /// <param name="response">The failed engine response.</param>
        /// <returns>The exception to throw.</returns>
        public static HttpRequestException FromResponse(string message, HttpResponseMessage response)
        {
            ArgumentNullException.ThrowIfNull(response);

            var exception = new HttpRequestException(message, null, response.StatusCode);

            var seconds = ReadRetryAfterSeconds(response);
            if (seconds is not null)
            {
                exception.Data[RetryAfterKey] = seconds;
            }

            return exception;
        }

        /// <summary>
        /// Reads the Retry-After hint off an exception previously built by
        /// <see cref="FromResponse"/>, or null when the engine sent none.
        /// </summary>
        /// <param name="exception">The exception to inspect.</param>
        /// <returns>The retry delay in seconds, or null.</returns>
        public static string? ReadRetryAfter(Exception exception)
        {
            ArgumentNullException.ThrowIfNull(exception);
            return exception.Data[RetryAfterKey] as string;
        }

        /// <summary>
        /// True when the exception represents an engine 429 (render gate saturated).
        /// </summary>
        /// <param name="exception">The exception to inspect.</param>
        /// <returns>Whether the engine answered 429.</returns>
        public static bool IsAtCapacity(HttpRequestException exception)
        {
            ArgumentNullException.ThrowIfNull(exception);
            return exception.StatusCode == HttpStatusCode.TooManyRequests;
        }

        /// <summary>
        /// Normalises the response's Retry-After header to whole seconds.
        /// Handles both forms in RFC 9110: a delta-seconds value and an
        /// HTTP-date (converted to a delta from now, floored at 0).
        /// </summary>
        private static string? ReadRetryAfterSeconds(HttpResponseMessage response)
        {
            var retryAfter = response.Headers.RetryAfter;
            if (retryAfter is null)
            {
                return null;
            }

            if (retryAfter.Delta is { } delta)
            {
                var seconds = Math.Max(0, (long)Math.Ceiling(delta.TotalSeconds));
                return seconds.ToString(CultureInfo.InvariantCulture);
            }

            if (retryAfter.Date is { } date)
            {
                var seconds = Math.Max(0, (long)Math.Ceiling((date - DateTimeOffset.UtcNow).TotalSeconds));
                return seconds.ToString(CultureInfo.InvariantCulture);
            }

            return null;
        }
    }
}
