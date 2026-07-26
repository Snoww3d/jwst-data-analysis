// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;
using System.Net.Http.Headers;

using FluentAssertions;

using JwstDataAnalysis.API.Services;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for <see cref="EngineHttpErrors"/> — the shim that keeps the
/// processing engine's Retry-After hint alive across the HttpRequestException
/// hop so controllers can re-emit it (#1645).
/// </summary>
public class EngineHttpErrorsTests
{
    /// <summary>
    /// The status code must survive so `when (IsAtCapacity(ex))` filters work.
    /// </summary>
    [Fact]
    public void FromResponse_PreservesStatusCode()
    {
        using var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);

        var ex = EngineHttpErrors.FromResponse("busy", response);

        ex.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        ex.Message.Should().Be("busy");
        EngineHttpErrors.IsAtCapacity(ex).Should().BeTrue();
    }

    /// <summary>
    /// A delta-seconds Retry-After is carried through verbatim.
    /// </summary>
    [Fact]
    public void FromResponse_CarriesDeltaSecondsRetryAfter()
    {
        using var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(42));

        var ex = EngineHttpErrors.FromResponse("busy", response);

        EngineHttpErrors.ReadRetryAfter(ex).Should().Be("42");
    }

    /// <summary>
    /// RFC 9110 also allows an HTTP-date; normalise it to a delta in seconds.
    /// </summary>
    [Fact]
    public void FromResponse_NormalisesHttpDateRetryAfterToSeconds()
    {
        using var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter = new RetryConditionHeaderValue(DateTimeOffset.UtcNow.AddSeconds(30));

        var ex = EngineHttpErrors.FromResponse("busy", response);

        var seconds = int.Parse(EngineHttpErrors.ReadRetryAfter(ex)!, System.Globalization.CultureInfo.InvariantCulture);
        seconds.Should().BeInRange(25, 31);
    }

    /// <summary>
    /// A past HTTP-date must floor at 0, never go negative.
    /// </summary>
    [Fact]
    public void FromResponse_FloorsPastHttpDateAtZero()
    {
        using var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter = new RetryConditionHeaderValue(DateTimeOffset.UtcNow.AddMinutes(-5));

        var ex = EngineHttpErrors.FromResponse("busy", response);

        EngineHttpErrors.ReadRetryAfter(ex).Should().Be("0");
    }

    /// <summary>
    /// No header → null, so callers can apply their own fallback.
    /// </summary>
    [Fact]
    public void ReadRetryAfter_ReturnsNull_WhenEngineSentNoHeader()
    {
        using var response = new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);

        var ex = EngineHttpErrors.FromResponse("down", response);

        EngineHttpErrors.ReadRetryAfter(ex).Should().BeNull();
    }

    /// <summary>
    /// Non-429 engine failures must not be mistaken for capacity shedding.
    /// </summary>
    [Fact]
    public void IsAtCapacity_IsFalse_ForOtherStatuses()
    {
        using var response = new HttpResponseMessage(HttpStatusCode.BadGateway);

        EngineHttpErrors.IsAtCapacity(EngineHttpErrors.FromResponse("bad", response)).Should().BeFalse();
        EngineHttpErrors.IsAtCapacity(new HttpRequestException("socket closed")).Should().BeFalse();
    }
}
