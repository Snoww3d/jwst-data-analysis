// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Net;

using FluentAssertions;

using JwstDataAnalysis.API.Services;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for <see cref="ProcessingErrorMessages.ToUserMessage"/>.
///
/// The async (auth'd) job path loses the HTTP 413 status code crossing SignalR;
/// the frontend only receives the error string. The MEMORY_BUDGET: prefix lets
/// the frontend distinguish a memory-budget refusal from other failures so the
/// "Continue anyway" override can be offered (matches the existing NO_PRODUCTS:
/// / S3_UNAVAILABLE: prefix convention used by the download flow).
/// </summary>
public class ProcessingErrorMessagesTests
{
    [Fact]
    public void ToUserMessage_CompositeBudgetExceededException_PrefixesWithMemoryBudget()
    {
        var detail = "Composite output would shrink to 38% of requested side length. "
                    + "Memory limit MAX_COMPOSITE_MEMORY_BYTES = 3000 MB.";
        var ex = new CompositeBudgetExceededException(detail);

        var result = ProcessingErrorMessages.ToUserMessage(ex);

        result.Should().StartWith("MEMORY_BUDGET:");
        result.Should().Contain(detail);
    }

    [Fact]
    public void ToUserMessage_ServiceUnavailable_KeepsExistingMessage()
    {
        var ex = new HttpRequestException("upstream", null, HttpStatusCode.ServiceUnavailable);

        var result = ProcessingErrorMessages.ToUserMessage(ex);

        result.Should().NotStartWith("MEMORY_BUDGET:");
        result.Should().Contain("temporarily unavailable");
    }

    /// <summary>
    /// A render-gate 429 on a queued job must not read as an engine failure —
    /// the job is retryable and the user's inputs were fine. The queued paths
    /// lose the HTTP status crossing the SignalR boundary, so the message is the
    /// only thing carrying that meaning (#1645).
    /// </summary>
    [Fact]
    public void ToUserMessage_TooManyRequests_SaysAtCapacity()
    {
        var ex = new HttpRequestException("busy", null, HttpStatusCode.TooManyRequests);

        var result = ProcessingErrorMessages.ToUserMessage(ex);

        result.Should().Contain("at capacity");
        result.Should().NotContain("Processing engine error");
    }

    [Fact]
    public void ToUserMessage_GenericException_FallsThroughToDefault()
    {
        var ex = new InvalidOperationException("something broke");

        var result = ProcessingErrorMessages.ToUserMessage(ex);

        result.Should().NotStartWith("MEMORY_BUDGET:");
        result.Should().Contain("unexpected error");
    }
}
