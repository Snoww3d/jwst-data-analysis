// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Text;

using FluentAssertions;
using JwstDataAnalysis.API.Services.Storage;
using Microsoft.Extensions.Configuration;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for LocalStorageProvider.
/// </summary>
public class LocalStorageProviderTests : IDisposable
{
    private readonly string tempDir;
    private readonly LocalStorageProvider sut;

    public LocalStorageProviderTests()
    {
        tempDir = Path.Combine(Path.GetTempPath(), $"jwst-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                { "Storage:BasePath", tempDir },
            })
            .Build();

        sut = new LocalStorageProvider(config);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempDir))
        {
            Directory.Delete(tempDir, recursive: true);
        }

        GC.SuppressFinalize(this);
    }

    [Fact]
    public void SupportsLocalPath_ReturnsTrue()
    {
        sut.SupportsLocalPath.Should().BeTrue();
    }

    [Fact]
    public async Task WriteAsync_CreatesFileWithContent()
    {
        var data = Encoding.UTF8.GetBytes("hello world");
        using var stream = new MemoryStream(data);

        await sut.WriteAsync("test/file.txt", stream);

        File.Exists(Path.Combine(tempDir, "test", "file.txt")).Should().BeTrue();
        var content = await File.ReadAllTextAsync(Path.Combine(tempDir, "test", "file.txt"));
        content.Should().Be("hello world");
    }

    [Fact]
    public async Task WriteAsync_CreatesDirectoryStructure()
    {
        using var stream = new MemoryStream(new byte[] { 1, 2, 3 });
        await sut.WriteAsync("deep/nested/dir/file.dat", stream);

        File.Exists(Path.Combine(tempDir, "deep", "nested", "dir", "file.dat")).Should().BeTrue();
    }

    [Fact]
    public async Task ReadStreamAsync_ReturnsFileContent()
    {
        var filePath = Path.Combine(tempDir, "read-test.txt");
        await File.WriteAllTextAsync(filePath, "test content");

        using var stream = await sut.ReadStreamAsync("read-test.txt");
        using var reader = new StreamReader(stream);
        var content = await reader.ReadToEndAsync();

        content.Should().Be("test content");
    }

    [Fact]
    public async Task ReadStreamAsync_ThrowsForMissingFile()
    {
        var act = () => sut.ReadStreamAsync("nonexistent.txt");

        await act.Should().ThrowAsync<FileNotFoundException>();
    }

    [Fact]
    public async Task ExistsAsync_ReturnsTrue_WhenFileExists()
    {
        await File.WriteAllTextAsync(Path.Combine(tempDir, "exists.txt"), "data");

        var result = await sut.ExistsAsync("exists.txt");

        result.Should().BeTrue();
    }

    [Fact]
    public async Task ExistsAsync_ReturnsFalse_WhenFileMissing()
    {
        var result = await sut.ExistsAsync("missing.txt");

        result.Should().BeFalse();
    }

    [Fact]
    public async Task DeleteAsync_RemovesFile()
    {
        var filePath = Path.Combine(tempDir, "delete-me.txt");
        await File.WriteAllTextAsync(filePath, "data");

        await sut.DeleteAsync("delete-me.txt");

        File.Exists(filePath).Should().BeFalse();
    }

    [Fact]
    public async Task DeleteAsync_DoesNotThrow_WhenFileMissing()
    {
        var act = () => sut.DeleteAsync("nonexistent.txt");

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task GetSizeAsync_ReturnsCorrectSize()
    {
        var data = new byte[1024];
        await File.WriteAllBytesAsync(Path.Combine(tempDir, "sized.dat"), data);

        var size = await sut.GetSizeAsync("sized.dat");

        size.Should().Be(1024);
    }

    [Fact]
    public async Task GetPresignedUrlAsync_ReturnsNull()
    {
        var url = await sut.GetPresignedUrlAsync("any-key", TimeSpan.FromMinutes(5));

        url.Should().BeNull();
    }

    [Fact]
    public async Task ListAsync_ReturnsAllFiles()
    {
        // Create some files in a subdirectory
        var subDir = Path.Combine(tempDir, "list-test");
        Directory.CreateDirectory(subDir);
        await File.WriteAllTextAsync(Path.Combine(subDir, "a.txt"), "a");
        await File.WriteAllTextAsync(Path.Combine(subDir, "b.txt"), "b");
        var nestedDir = Path.Combine(subDir, "nested");
        Directory.CreateDirectory(nestedDir);
        await File.WriteAllTextAsync(Path.Combine(nestedDir, "c.txt"), "c");

        var keys = new List<string>();
        await foreach (var key in sut.ListAsync("list-test"))
        {
            keys.Add(key);
        }

        keys.Should().HaveCount(3);
        keys.Should().Contain(k => k.Contains("a.txt"));
        keys.Should().Contain(k => k.Contains("b.txt"));
        keys.Should().Contain(k => k.Contains("c.txt"));
    }

    [Fact]
    public async Task ListAsync_ReturnsEmpty_WhenDirectoryMissing()
    {
        var keys = new List<string>();
        await foreach (var key in sut.ListAsync("nonexistent"))
        {
            keys.Add(key);
        }

        keys.Should().BeEmpty();
    }

    [Fact]
    public void ResolveLocalPath_ReturnsFullPath()
    {
        var path = sut.ResolveLocalPath("subdir/file.fits");

        path.Should().Be(Path.Combine(tempDir, "subdir", "file.fits"));
    }

    [Fact]
    public void ResolveLocalPath_ThrowsForPathTraversal()
    {
        var act = () => sut.ResolveLocalPath("../../etc/passwd");

        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public async Task WriteAndRead_RoundTrip()
    {
        var original = Encoding.UTF8.GetBytes("round trip data");
        using var writeStream = new MemoryStream(original);
        await sut.WriteAsync("roundtrip/data.bin", writeStream);

        using var readStream = await sut.ReadStreamAsync("roundtrip/data.bin");
        using var ms = new MemoryStream();
        await readStream.CopyToAsync(ms);

        ms.ToArray().Should().BeEquivalentTo(original);
    }
}
