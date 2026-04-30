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

    [Fact]
    public void ToUserMessage_GenericException_FallsThroughToDefault()
    {
        var ex = new InvalidOperationException("something broke");

        var result = ProcessingErrorMessages.ToUserMessage(ex);

        result.Should().NotStartWith("MEMORY_BUDGET:");
        result.Should().Contain("unexpected error");
    }
}
