// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;
using JwstDataAnalysis.API.Services.Storage;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for <see cref="S3StorageProvider"/> Content-Disposition building (#1540).
/// </summary>
public class S3StorageProviderTests
{
    [Fact]
    public void BuildContentDisposition_PlainAsciiName_QuotedAsIs()
    {
        var result = S3StorageProvider.BuildContentDisposition("jw01234_nircam_i2d.fits");

        result.Should().Be("attachment; filename=\"jw01234_nircam_i2d.fits\"");
    }

    [Fact]
    public void BuildContentDisposition_NameWithDoubleQuote_EscapesIt()
    {
        // RFC 6266 §4.1: a double-quote inside the quoted-string must be escaped
        // as \" — otherwise S3 rejects the override header with HTTP 400.
        var result = S3StorageProvider.BuildContentDisposition("we\"ird.fits");

        result.Should().Be("attachment; filename=\"we\\\"ird.fits\"");
    }

    [Fact]
    public void BuildContentDisposition_NameWithBackslash_EscapesIt()
    {
        var result = S3StorageProvider.BuildContentDisposition("back\\slash.fits");

        result.Should().Be("attachment; filename=\"back\\\\slash.fits\"");
    }

    [Theory]
    [InlineData("evil\r\nSet-Cookie: x=1.fits")]
    [InlineData("line\rbreak.fits")]
    [InlineData("line\nbreak.fits")]
    public void BuildContentDisposition_NameWithCrlf_StripsControlChars(string input)
    {
        var result = S3StorageProvider.BuildContentDisposition(input);

        result.Should().NotContain("\r").And.NotContain("\n");
    }

    [Theory]
    [InlineData("tab\there.fits", '\t')]
    [InlineData("null\0byte.fits", '\0')]
    [InlineData("del\u007Fchar.fits", '\u007F')]
    public void BuildContentDisposition_NameWithOtherControlChars_StripsThem(string input, char control)
    {
        // RFC 7230 quoted-string forbids control chars beyond just CR/LF; a bare
        // TAB/NUL/DEL would still produce an invalid header (S3 400).
        var result = S3StorageProvider.BuildContentDisposition(input);

        result.Should().NotContain(control.ToString());
    }

    [Fact]
    public void BuildContentDisposition_NonAsciiNameWithQuoteAndApostrophe_EscapesAndEncodesBoth()
    {
        var result = S3StorageProvider.BuildContentDisposition("ná\"me's.fits");

        // ASCII fallback: the double-quote is backslash-escaped in the quoted-string.
        result.Should().Contain("filename=\"ná\\\"me's.fits\"");

        // RFC 5987 filename*: non-ASCII (%C3%A1), the double-quote (%22) and the
        // apostrophe (%27) are all percent-encoded so none can be mistaken for the
        // quoted-string or charset/language delimiters.
        result.Should().Contain("filename*=UTF-8''");
        result.Should().Contain("n%C3%A1%22me%27s.fits");
    }

    [Fact]
    public void BuildContentDisposition_NonAsciiName_EmitsRfc5987FilenameStar()
    {
        var result = S3StorageProvider.BuildContentDisposition("náme.fits");

        // ASCII fallback retained for legacy clients, plus a percent-encoded
        // UTF-8 filename* parameter (RFC 5987) for the real name.
        result.Should().StartWith("attachment; filename=");
        result.Should().Contain("filename*=UTF-8''");
        result.Should().Contain("n%C3%A1me.fits");
    }

    [Fact]
    public void BuildContentDisposition_AsciiName_DoesNotEmitFilenameStar()
    {
        var result = S3StorageProvider.BuildContentDisposition("plain.fits");

        result.Should().NotContain("filename*");
    }
}
