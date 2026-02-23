// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using FluentAssertions;
using JwstDataAnalysis.API.Services.Storage;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for StorageKeyHelper.
/// </summary>
public class StorageKeyHelperTests
{
    [Fact]
    public void ToRelativeKey_AbsolutePathWithPrefix_ReturnsRelativePart()
    {
        var result = StorageKeyHelper.ToRelativeKey("/app/data/mast/jw02733/file.fits");

        result.Should().Be("mast/jw02733/file.fits");
    }

    [Fact]
    public void ToRelativeKey_AlreadyRelative_ReturnsSamePath()
    {
        var result = StorageKeyHelper.ToRelativeKey("mast/jw02733/file.fits");

        result.Should().Be("mast/jw02733/file.fits");
    }

    [Fact]
    public void ToRelativeKey_ExactPrefix_ReturnsEmptyString()
    {
        var result = StorageKeyHelper.ToRelativeKey("/app/data/");

        result.Should().BeEmpty();
    }

    [Theory]
    [InlineData("/APP/DATA/mast/file.fits", "mast/file.fits")]
    [InlineData("/App/Data/mast/file.fits", "mast/file.fits")]
    public void ToRelativeKey_CaseInsensitivePrefix(string input, string expected)
    {
        var result = StorageKeyHelper.ToRelativeKey(input);

        result.Should().Be(expected);
    }

    [Fact]
    public void ToRelativeKey_DifferentAbsolutePath_ReturnsSamePath()
    {
        var result = StorageKeyHelper.ToRelativeKey("/other/path/file.fits");

        result.Should().Be("/other/path/file.fits");
    }
}
