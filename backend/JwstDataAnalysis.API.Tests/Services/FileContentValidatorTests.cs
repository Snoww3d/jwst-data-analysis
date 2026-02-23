// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;

using FluentAssertions;
using JwstDataAnalysis.API.Services;
using Microsoft.AspNetCore.Http;
using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for FileContentValidator.
/// </summary>
public class FileContentValidatorTests
{
    // --- FITS validation ---
    [Fact]
    public async Task ValidateFileContentAsync_ValidFits_ReturnsValid()
    {
        // FITS files start with "SIMPLE"
        var content = Encoding.ASCII.GetBytes("SIMPLE  =                    T / Standard FITS");
        var file = CreateFormFile("test.fits", content);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
        error.Should().BeNull();
    }

    [Fact]
    public async Task ValidateFileContentAsync_InvalidFits_ReturnsError()
    {
        var content = new byte[] { 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07 };
        var file = CreateFormFile("test.fits", content);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeFalse();
        error.Should().Contain(".fits");
    }

    [Fact]
    public async Task ValidateFileContentAsync_TooSmallFits_ReturnsError()
    {
        var file = CreateFormFile("test.fits", new byte[] { 0x01, 0x02 });

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeFalse();
        error.Should().Contain("too small");
    }

    // --- Gzipped FITS validation ---
    [Fact]
    public async Task ValidateFileContentAsync_ValidGzipFits_ReturnsValid()
    {
        // Gzip magic bytes: 1F 8B
        var content = new byte[] { 0x1F, 0x8B, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00 };
        var file = CreateFormFile("test.fits.gz", content);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateFileContentAsync_InvalidGzipFits_ReturnsError()
    {
        var content = Encoding.ASCII.GetBytes("not a gzip file at all");
        var file = CreateFormFile("test.fits.gz", content);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeFalse();
    }

    // --- Image format validation ---
    [Fact]
    public async Task ValidateFileContentAsync_ValidPng_ReturnsValid()
    {
        var content = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00 };
        var file = CreateFormFile("image.png", content);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateFileContentAsync_ValidJpeg_ReturnsValid()
    {
        var content = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46 };
        var file = CreateFormFile("photo.jpg", content);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateFileContentAsync_ValidTiffLittleEndian_ReturnsValid()
    {
        var content = new byte[] { 0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00 };
        var file = CreateFormFile("image.tiff", content);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateFileContentAsync_ValidTiffBigEndian_ReturnsValid()
    {
        var content = new byte[] { 0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08 };
        var file = CreateFormFile("image.tif", content);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateFileContentAsync_PngAsFits_ReturnsError()
    {
        // PNG magic bytes but with .fits extension
        var content = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        var file = CreateFormFile("renamed.fits", content);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeFalse();
        error.Should().Contain("does not match");
    }

    // --- JSON validation ---
    [Fact]
    public async Task ValidateFileContentAsync_ValidJson_ReturnsValid()
    {
        var file = CreateFormFile("data.json", "{\"key\": \"value\"}");

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateFileContentAsync_ValidJsonArray_ReturnsValid()
    {
        var file = CreateFormFile("data.json", "[1, 2, 3]");

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateFileContentAsync_InvalidJson_ReturnsError()
    {
        var file = CreateFormFile("data.json", "this is not json at all");

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeFalse();
        error.Should().Contain("JSON");
    }

    // --- CSV validation ---
    [Fact]
    public async Task ValidateFileContentAsync_ValidCsv_ReturnsValid()
    {
        var csv = "name,value,count\nfoo,1,10\nbar,2,20\n";
        var file = CreateFormFile("data.csv", csv);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateFileContentAsync_SingleColumnCsv_ReturnsValid()
    {
        var csv = "header\nrow1\nrow2\n";
        var file = CreateFormFile("data.csv", csv);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateFileContentAsync_InconsistentCsv_ReturnsError()
    {
        var csv = "a,b,c,d,e\nonly_one\nonly_one\nonly_one\nonly_one\nonly_one\nonly_one\nonly_one\nonly_one\nonly_one\n";
        var file = CreateFormFile("data.csv", csv);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeFalse();
        error.Should().Contain("inconsistent");
    }

    [Fact]
    public async Task ValidateFileContentAsync_EmptyCsv_ReturnsError()
    {
        var file = CreateFormFile("data.csv", string.Empty);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeFalse();
        error.Should().Contain("empty");
    }

    [Fact]
    public async Task ValidateFileContentAsync_BinaryAsCsv_ReturnsError()
    {
        var content = new byte[] { 0x00, 0x01, 0x02, 0x03 };
        var file = CreateFormFile("data.csv", content);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeFalse();
        error.Should().Contain("binary");
    }

    // --- Unknown extension ---
    [Fact]
    public async Task ValidateFileContentAsync_UnknownExtension_ReturnsValid()
    {
        var file = CreateFormFile("data.xyz", new byte[] { 0x01, 0x02, 0x03 });

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    // --- Semicolon and tab delimited CSV ---
    [Fact]
    public async Task ValidateFileContentAsync_SemicolonCsv_ReturnsValid()
    {
        var csv = "name;value;count\nfoo;1;10\nbar;2;20\n";
        var file = CreateFormFile("data.csv", csv);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    [Fact]
    public async Task ValidateFileContentAsync_TabCsv_ReturnsValid()
    {
        var csv = "name\tvalue\tcount\nfoo\t1\t10\nbar\t2\t20\n";
        var file = CreateFormFile("data.csv", csv);

        var (isValid, error) = await FileContentValidator.ValidateFileContentAsync(file);

        isValid.Should().BeTrue();
    }

    private static IFormFile CreateFormFile(string fileName, byte[] content)
    {
        var stream = new MemoryStream(content);
        var mock = new Mock<IFormFile>();
        mock.Setup(f => f.FileName).Returns(fileName);
        mock.Setup(f => f.Length).Returns(content.Length);
        mock.Setup(f => f.OpenReadStream()).Returns(() => new MemoryStream(content));
        return mock.Object;
    }

    private static IFormFile CreateFormFile(string fileName, string textContent)
    {
        return CreateFormFile(fileName, Encoding.UTF8.GetBytes(textContent));
    }
}
