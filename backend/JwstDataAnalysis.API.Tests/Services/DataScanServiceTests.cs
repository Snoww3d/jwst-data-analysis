// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;

using FluentAssertions;

using JwstDataAnalysis.API.Controllers;
using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;
using JwstDataAnalysis.API.Services.Storage;

using Microsoft.Extensions.Logging;

using Moq;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for DataScanService — both the static helper methods (accessible via
/// InternalsVisibleTo) and the async ScanAndImportAsync orchestration logic.
/// </summary>
public class DataScanServiceTests
{
    // ── Shared constant used in ConvertJsonElement array test ──────────────────
    private static readonly int[] TestArray = [1, 2, 3];

    // ── Mocks used by ScanAndImportAsync tests ─────────────────────────────────
    private readonly Mock<IMongoDBService> mockMongo = new();
    private readonly Mock<IMastService> mockMast = new();
    private readonly Mock<IStorageProvider> mockStorage = new();
    private readonly Mock<IThumbnailQueue> mockThumbnailQueue = new();
    private readonly EmbeddingQueue embeddingQueue = new();
    private readonly Mock<ILogger<DataScanService>> mockLogger = new();

    // =========================================================================
    // ScanAndImportAsync — S3 path (SupportsLocalPath = false)
    // =========================================================================
    [Fact]
    public async Task ScanAndImportAsync_S3_NoFitsFilesFound_ReturnsEarlyWithZeroCounts()
    {
        // Arrange — S3 with no FITS keys
        SetupS3Storage([]);
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert
        result.ImportedCount.Should().Be(0);
        result.SkippedCount.Should().Be(0);
        result.ErrorCount.Should().Be(0);
        result.Message.Should().Contain("No FITS files found");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_NonFitsKeysIgnored_ReturnsZero()
    {
        // Arrange — S3 returns keys that are not FITS
        SetupS3Storage(["mast/obs1/catalog.csv", "mast/obs1/readme.txt"]);
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert — non-FITS files should be silently ignored, triggering the "empty" early return
        result.ImportedCount.Should().Be(0);
        result.Message.Should().Contain("No FITS files found");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_NewFile_ImportsAndEnqueuesJobs()
    {
        // Arrange
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>())).Returns(Task.CompletedTask);
        mockStorage.Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>())).ReturnsAsync(2048L);

        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert
        result.ImportedCount.Should().Be(1);
        result.SkippedCount.Should().Be(0);
        result.ErrorCount.Should().Be(0);
        result.ImportedFiles.Should().ContainSingle()
            .Which.Should().Be("jw02733001001_02101_00001_nrca1_cal.fits");

        // Verify MongoDB create was called with correct data
        mockMongo.Verify(
            m => m.CreateAsync(It.Is<JwstDataModel>(d =>
                d.FilePath == storageKey &&
                d.IsPublic == true &&
                d.FileFormat == FileFormats.FITS)),
            Times.Once);

        // Thumbnail queue should have been poked
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(It.IsAny<List<string>>()), Times.Once);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_DuplicateFile_SkipsImport()
    {
        // Arrange — database already contains the file
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        var existing = new JwstDataModel
        {
            Id = "existing-id",
            FilePath = storageKey,
            IsPublic = true,
            ProcessingLevel = ProcessingLevels.Level2b,
            ImageInfo = new ImageMetadata { TargetName = "NGC-3132" },
        };
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([existing]);

        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert
        result.ImportedCount.Should().Be(0);
        result.SkippedCount.Should().Be(1);
        result.SkippedFiles.Should().ContainSingle()
            .Which.Should().Be("jw02733001001_02101_00001_nrca1_cal.fits");

        // No creates, no thumbnail queue
        mockMongo.Verify(m => m.CreateAsync(It.IsAny<JwstDataModel>()), Times.Never);
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(It.IsAny<List<string>>()), Times.Never);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_ExistingFileWithMissingMetadata_RefreshesMetadata()
    {
        // Arrange — file exists but lacks ImageInfo.TargetName (metadata refresh candidate)
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        var existing = new JwstDataModel
        {
            Id = "existing-id",
            FilePath = storageKey,
            IsPublic = true,
            ProcessingLevel = ProcessingLevels.Unknown,       // triggers refresh
            ImageInfo = new ImageMetadata { TargetName = null }, // triggers refresh
        };
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([existing]);
        mockMongo.Setup(m => m.UpdateAsync(It.IsAny<string>(), It.IsAny<JwstDataModel>())).Returns(Task.CompletedTask);

        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert — file was skipped for import but metadata was refreshed
        result.ImportedCount.Should().Be(0);
        result.SkippedCount.Should().Be(1);
        result.Message.Should().Contain("refreshed metadata for 1");

        mockMongo.Verify(m => m.UpdateAsync("existing-id", It.IsAny<JwstDataModel>()), Times.Once);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_ExistingFileWithIsPublicFalseAndNoOwner_FixesVisibility()
    {
        // Arrange — record imported before IsPublic was set (IsPublic=false, no UserId)
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        var existing = new JwstDataModel
        {
            Id = "legacy-id",
            FilePath = storageKey,
            IsPublic = false,
            UserId = null,
            ProcessingLevel = ProcessingLevels.Level2b,
            ImageInfo = new ImageMetadata { TargetName = "NGC-3132" },
        };
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([existing]);
        mockMongo.Setup(m => m.UpdateAsync(It.IsAny<string>(), It.IsAny<JwstDataModel>())).Returns(Task.CompletedTask);

        // No MAST metadata — no metadata refresh, only visibility fix
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync((MastSearchResponse?)null!);

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert — visibility was fixed
        mockMongo.Verify(m => m.UpdateAsync("legacy-id", It.Is<JwstDataModel>(d => d.IsPublic)), Times.Once);
        result.SkippedCount.Should().Be(1);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_StorageGetSizeThrows_RecordsError()
    {
        // Arrange
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        mockStorage
            .Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new IOException("S3 unreachable"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert — error captured, not thrown
        result.ImportedCount.Should().Be(0);
        result.ErrorCount.Should().Be(1);
        result.Errors.Should().ContainSingle()
            .Which.Should().Contain("S3 unreachable");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_MongoCreateThrows_RecordsError()
    {
        // Arrange
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockStorage.Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>())).ReturnsAsync(1024L);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        mockMongo
            .Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .ThrowsAsync(new InvalidOperationException("MongoDB write failed"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert
        result.ImportedCount.Should().Be(0);
        result.ErrorCount.Should().Be(1);
        result.Errors.Should().ContainSingle()
            .Which.Should().Contain("MongoDB write failed");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_MastServiceThrows_ContinuesWithBasicMetadata()
    {
        // Arrange — MAST throws, file should still be imported with basic metadata
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>())).Returns(Task.CompletedTask);
        mockStorage.Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>())).ReturnsAsync(512L);

        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ThrowsAsync(new HttpRequestException("MAST unreachable"));

        var sut = CreateSut();

        // Act — should not throw
        var result = await sut.ScanAndImportAsync();

        // Assert — file imported despite MAST failure
        result.ImportedCount.Should().Be(1);
        result.ErrorCount.Should().Be(0);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_MultipleFiles_SameObservation_AllImported()
    {
        // Arrange — two files under the same observation ID
        var key1 = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        var key2 = "mast/jw02733001001/jw02733001001_02101_00002_nrca2_cal.fits";
        SetupS3Storage([key1, key2]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>())).Returns(Task.CompletedTask);
        mockStorage.Setup(s => s.GetSizeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(1024L);

        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert
        result.ImportedCount.Should().Be(2);

        // MAST should only be called once per observation group, not once per file
        mockMast.Verify(
            m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()),
            Times.Once);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_MultipleObservations_MastCalledPerObservation()
    {
        // Arrange — two files under different observation IDs
        var key1 = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        var key2 = "mast/jw02734001001/jw02734001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([key1, key2]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>())).Returns(Task.CompletedTask);
        mockStorage.Setup(s => s.GetSizeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(1024L);

        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("obs"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert — MAST called once per distinct observation group
        result.ImportedCount.Should().Be(2);
        mockMast.Verify(
            m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()),
            Times.Exactly(2));
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_NircamKeyword_AddsNircamTag()
    {
        // Arrange
        var storageKey = "mast/jw02733001001/jw02733001001_nircam_cal.fits";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockStorage.Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>())).ReturnsAsync(1024L);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        JwstDataModel? capturedModel = null;
        mockMongo
            .Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => capturedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateSut();

        // Act
        await sut.ScanAndImportAsync();

        // Assert
        capturedModel.Should().NotBeNull();
        capturedModel!.Tags.Should().Contain("NIRCam");
        capturedModel.Tags.Should().Contain("mast-import");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_MiriKeyword_AddsMiriTag()
    {
        // Arrange
        var storageKey = "mast/jw02733001001/jw02733001001_miri_cal.fits";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockStorage.Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>())).ReturnsAsync(1024L);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        JwstDataModel? capturedModel = null;
        mockMongo
            .Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => capturedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateSut();

        // Act
        await sut.ScanAndImportAsync();

        // Assert
        capturedModel!.Tags.Should().Contain("MIRI");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_NirspecKeyword_AddsNirspecTag()
    {
        // Arrange
        var storageKey = "mast/jw02733001001/jw02733001001_nirspec_cal.fits";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockStorage.Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>())).ReturnsAsync(1024L);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        JwstDataModel? capturedModel = null;
        mockMongo
            .Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => capturedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateSut();
        await sut.ScanAndImportAsync();

        capturedModel!.Tags.Should().Contain("NIRSpec");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_NirissKeyword_AddsNirissTag()
    {
        // Arrange
        var storageKey = "mast/jw02733001001/jw02733001001_niriss_cal.fits";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockStorage.Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>())).ReturnsAsync(1024L);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        JwstDataModel? capturedModel = null;
        mockMongo
            .Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => capturedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateSut();
        await sut.ScanAndImportAsync();

        capturedModel!.Tags.Should().Contain("NIRISS");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_NewFile_SetsObsIdTag()
    {
        // Arrange
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockStorage.Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>())).ReturnsAsync(1024L);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        JwstDataModel? capturedModel = null;
        mockMongo
            .Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => capturedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateSut();
        await sut.ScanAndImportAsync();

        capturedModel!.Tags.Should().Contain("jw02733001001");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_NewFile_SetsProcessingStatusPending()
    {
        // Arrange
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_i2d.fits";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockStorage.Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>())).ReturnsAsync(1024L);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        JwstDataModel? capturedModel = null;
        mockMongo
            .Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>()))
            .Callback<JwstDataModel>(m => capturedModel = m)
            .Returns(Task.CompletedTask);

        var sut = CreateSut();
        await sut.ScanAndImportAsync();

        capturedModel!.ProcessingStatus.Should().Be(ProcessingStatuses.Pending);
        capturedModel.ProcessingLevel.Should().Be(ProcessingLevels.Level3);
        capturedModel.DataType.Should().Be(DataTypes.Image);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_GzFitsFile_IsImported()
    {
        // Arrange — .fits.gz extension
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_uncal.fits.gz";
        SetupS3Storage([storageKey]);

        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>())).Returns(Task.CompletedTask);
        mockStorage.Setup(s => s.GetSizeAsync(storageKey, It.IsAny<CancellationToken>())).ReturnsAsync(512L);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert
        result.ImportedCount.Should().Be(1);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_ImportedFilesExceed50_ResponseCappedAt50()
    {
        // Arrange — 55 unique files
        var keys = Enumerable.Range(1, 55)
            .Select(i => $"mast/obs{i:D3}/file{i:D3}_cal.fits")
            .ToList();

        SetupS3Storage(keys);
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockMongo.Setup(m => m.CreateAsync(It.IsAny<JwstDataModel>())).Returns(Task.CompletedTask);
        mockStorage
            .Setup(s => s.GetSizeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(1024L);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(new MastSearchResponse { Results = [] });
        mockThumbnailQueue
            .Setup(q => q.EnqueueBatch(It.IsAny<List<string>>()));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert — all 55 imported but ImportedFiles list is capped at 50
        result.ImportedCount.Should().Be(55);
        result.ImportedFiles.Should().HaveCount(50);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_SkippedFilesExceed20_ResponseCappedAt20()
    {
        // Arrange — 25 pre-existing files
        var keys = Enumerable.Range(1, 25)
            .Select(i => $"mast/obs/file{i:D3}_cal.fits")
            .ToList();

        var existingRecords = keys.Select(k => new JwstDataModel
        {
            Id = $"id-{k}",
            FilePath = k,
            IsPublic = true,
            ProcessingLevel = ProcessingLevels.Level2b,
            ImageInfo = new ImageMetadata { TargetName = "X" },
        }).ToList();

        SetupS3Storage(keys);
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync(existingRecords);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("obs"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert — all 25 skipped but SkippedFiles list is capped at 20
        result.SkippedCount.Should().Be(25);
        result.SkippedFiles.Should().HaveCount(20);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_NoNewFiles_DoesNotEnqueueThumbnails()
    {
        // Arrange — all files already in DB
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        var existing = new JwstDataModel
        {
            Id = "exists",
            FilePath = storageKey,
            IsPublic = true,
            ProcessingLevel = ProcessingLevels.Level2b,
            ImageInfo = new ImageMetadata { TargetName = "NGC-3132" },
        };
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([existing]);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        var sut = CreateSut();

        // Act
        await sut.ScanAndImportAsync();

        // Assert — no new IDs means no queue calls
        mockThumbnailQueue.Verify(q => q.EnqueueBatch(It.IsAny<List<string>>()), Times.Never);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_MessageIncludesRefreshedCount_WhenRefreshOccurs()
    {
        // Arrange
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        var existing = new JwstDataModel
        {
            Id = "old-id",
            FilePath = storageKey,
            IsPublic = true,
            ProcessingLevel = ProcessingLevels.Unknown, // triggers refresh
            ImageInfo = new ImageMetadata { TargetName = null },
        };
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([existing]);
        mockMongo.Setup(m => m.UpdateAsync(It.IsAny<string>(), It.IsAny<JwstDataModel>())).Returns(Task.CompletedTask);

        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("jw02733001001"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert
        result.Message.Should().Contain("refreshed metadata for 1");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_MessageDoesNotMentionRefresh_WhenNoneOccur()
    {
        // Arrange — nothing imported, nothing refreshed
        SetupS3Storage([]);
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert
        result.Message.Should().NotContain("refreshed metadata");
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_ExistingFileAlreadyPublicWithOwner_NoUpdate()
    {
        // Arrange — record is already correctly public with an owner, no refresh needed
        var storageKey = "mast/jw02733001001/jw02733001001_02101_00001_nrca1_cal.fits";
        SetupS3Storage([storageKey]);

        var existing = new JwstDataModel
        {
            Id = "clean-id",
            FilePath = storageKey,
            IsPublic = true,
            UserId = "some-user",
            ProcessingLevel = ProcessingLevels.Level2b,
            ImageInfo = new ImageMetadata { TargetName = "NGC-3132" },
        };
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([existing]);

        // Return null results (no obsMeta) so metadata refresh path won't apply
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(new MastSearchResponse { Results = [] });

        var sut = CreateSut();

        // Act
        await sut.ScanAndImportAsync();

        // Assert — no update triggered
        mockMongo.Verify(m => m.UpdateAsync(It.IsAny<string>(), It.IsAny<JwstDataModel>()), Times.Never);
    }

    [Fact]
    public async Task ScanAndImportAsync_S3_ErrorsExceed10_ResponseCappedAt10()
    {
        // Arrange — 15 files all fail with storage errors
        var keys = Enumerable.Range(1, 15)
            .Select(i => $"mast/obs/file{i:D3}_cal.fits")
            .ToList();

        SetupS3Storage(keys);
        mockMongo.Setup(m => m.GetAsync()).ReturnsAsync([]);
        mockMast
            .Setup(m => m.SearchByObservationIdAsync(It.IsAny<MastObservationSearchRequest>()))
            .ReturnsAsync(BuildMastResponse("obs"));

        mockStorage
            .Setup(s => s.GetSizeAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new IOException("Storage failure"));

        var sut = CreateSut();

        // Act
        var result = await sut.ScanAndImportAsync();

        // Assert
        result.ErrorCount.Should().Be(15);
        result.Errors.Should().HaveCount(10);
    }

    // =========================================================================
    // ParseFileInfo — processing level and data type classification
    // =========================================================================
    [Theory]
    [InlineData("jw02733001001_02101_00001_nrca1_uncal.fits", "L1", "raw", true)]
    [InlineData("jw02733001001_02101_00001_nrca1_rate.fits", "L2a", "sensor", true)]
    [InlineData("jw02733001001_02101_00001_nrca1_rateints.fits", "L2a", "sensor", true)]
    [InlineData("jw02733001001_02101_00001_nrca1_cal.fits", "L2b", "image", true)]
    [InlineData("jw02733001001_02101_00001_nrca1_calints.fits", "L2b", "image", true)]
    [InlineData("jw02733001001_02101_00001_nrca1_i2d.fits", "L3", "image", true)]
    [InlineData("jw02733001001_02101_00001_nrca1_s2d.fits", "L3", "image", true)]
    [InlineData("jw02733001001_02101_00001_nrca1_crf.fits", "L2b", "image", true)]
    [InlineData("jw02733001001_02101_00001_nrca1_asn.json", "unknown", "metadata", false)]
    [InlineData("jw02733001001_02101_00001_nrca1_asn.fits", "unknown", "metadata", false)]
    [InlineData("jw02733001001_02101_00001_nrca1_x1d.fits", "L3", "spectral", false)]
    [InlineData("jw02733001001_02101_00001_nrca1_x1dints.fits", "L3", "spectral", false)]
    [InlineData("jw02733001001_02101_00001_nrca1_cat.fits", "L3", "metadata", false)]
    [InlineData("jw02733001001_02101_00001_nrca1_pool.fits", "unknown", "metadata", false)]
    [InlineData("jw02733001001_02101_00001_nrca1_foo.fits", "unknown", "image", true)]
    public void ParseFileInfo_ReturnsCorrectDataTypeAndLevel(
        string fileName, string expectedLevel, string expectedDataType, bool expectedIsViewable)
    {
        // Act
        var result = DataScanService.ParseFileInfo(fileName, null);

        // Assert
        result.ProcessingLevel.Should().Be(expectedLevel);
        result.DataType.Should().Be(expectedDataType);
        result.IsViewable.Should().Be(expectedIsViewable);
    }

    [Fact]
    public void ParseFileInfo_ExtractsObservationBaseIdAndExposureId_FromJwstPattern()
    {
        // Arrange — standard JWST filename pattern
        var fileName = "jw02733001001_02101_00001_nrca1_cal.fits";

        // Act
        var result = DataScanService.ParseFileInfo(fileName, null);

        // Assert
        result.ObservationBaseId.Should().Be("jw02733001001");
        result.ExposureId.Should().Be("jw02733001001_02101");
    }

    [Fact]
    public void ParseFileInfo_ReturnsNullIds_WhenFilenameDoesNotMatchPattern()
    {
        // Arrange — filename that does not match JWST regex
        var fileName = "random_data_file_cal.fits";

        // Act
        var result = DataScanService.ParseFileInfo(fileName, null);

        // Assert
        result.ObservationBaseId.Should().BeNull();
        result.ExposureId.Should().BeNull();
    }

    // =========================================================================
    // BuildMastMetadata
    // =========================================================================
    [Fact]
    public void BuildMastMetadata_WithNullObsMeta_ReturnsDictWithBaseKeys()
    {
        // Act
        var result = DataScanService.BuildMastMetadata(null, "obs-123", ProcessingLevels.Level2b);

        // Assert
        result.Should().ContainKey("mast_obs_id").WhoseValue.Should().Be("obs-123");
        result.Should().ContainKey("source").WhoseValue.Should().Be("MAST");
        result.Should().ContainKey("import_date");
        result.Should().ContainKey("processing_level").WhoseValue.Should().Be(ProcessingLevels.Level2b);
        result.Should().HaveCount(4);
    }

    [Fact]
    public void BuildMastMetadata_WithNonNullObsMeta_IncludesMastPrefixedKeys()
    {
        // Arrange
        var obsMeta = new Dictionary<string, object?>
        {
            { "target_name", "NGC-3132" },
            { "instrument_name", "NIRCAM" },
        };

        // Act
        var result = DataScanService.BuildMastMetadata(obsMeta, "obs-456", ProcessingLevels.Level3);

        // Assert
        result.Should().ContainKey("mast_target_name").WhoseValue.Should().Be("NGC-3132");
        result.Should().ContainKey("mast_instrument_name").WhoseValue.Should().Be("NIRCAM");
    }

    [Fact]
    public void BuildMastMetadata_DoesNotDoublePrefixMastKeys()
    {
        // Arrange
        var obsMeta = new Dictionary<string, object?>
        {
            { "mast_obs_id", "already-prefixed" },
        };

        // Act
        var result = DataScanService.BuildMastMetadata(obsMeta, "obs-789", ProcessingLevels.Level1);

        // Assert — "mast_obs_id" should be the obsMeta value (it overwrites the base key), not "mast_mast_obs_id"
        result.Should().ContainKey("mast_obs_id");
        result.Should().NotContainKey("mast_mast_obs_id");
    }

    [Fact]
    public void BuildMastMetadata_ConvertsJsonElementValues()
    {
        // Arrange
        var jsonElement = JsonSerializer.SerializeToElement("test-value");
        var obsMeta = new Dictionary<string, object?>
        {
            { "json_field", jsonElement },
        };

        // Act
        var result = DataScanService.BuildMastMetadata(obsMeta, "obs-1", ProcessingLevels.Unknown);

        // Assert
        result.Should().ContainKey("mast_json_field").WhoseValue.Should().Be("test-value");
    }

    [Fact]
    public void BuildMastMetadata_SkipsNullValuesInObsMeta()
    {
        // Arrange
        var obsMeta = new Dictionary<string, object?>
        {
            { "present_field", "value" },
            { "null_field", null },
        };

        // Act
        var result = DataScanService.BuildMastMetadata(obsMeta, "obs-2", ProcessingLevels.Level2a);

        // Assert
        result.Should().ContainKey("mast_present_field");
        result.Should().NotContainKey("mast_null_field");
    }

    // =========================================================================
    // ConvertJsonElement
    // =========================================================================
    [Fact]
    public void ConvertJsonElement_String_ReturnsString()
    {
        var element = JsonSerializer.SerializeToElement("hello");
        var result = DataScanService.ConvertJsonElement(element);
        result.Should().Be("hello");
    }

    [Fact]
    public void ConvertJsonElement_IntLikeNumber_ReturnsLongOrDouble()
    {
        // JsonSerializer.SerializeToElement(42) may produce a number that
        // TryGetInt64 can parse (returning long) or that resolves as double,
        // depending on runtime. Verify the value is numerically correct.
        var element = JsonSerializer.SerializeToElement(42);
        var result = DataScanService.ConvertJsonElement(element);
        result.Should().BeAssignableTo<IConvertible>();
        Convert.ToInt64(result, CultureInfo.InvariantCulture).Should().Be(42L);
    }

    [Fact]
    public void ConvertJsonElement_DoubleNumber_ReturnsDouble()
    {
        var element = JsonSerializer.SerializeToElement(3.14);
        var result = DataScanService.ConvertJsonElement(element);
        result.Should().BeOfType<double>();
        result.Should().Be(3.14);
    }

    [Fact]
    public void ConvertJsonElement_True_ReturnsTrue()
    {
        var element = JsonSerializer.SerializeToElement(true);
        var result = DataScanService.ConvertJsonElement(element);
        result.Should().Be(true);
    }

    [Fact]
    public void ConvertJsonElement_False_ReturnsFalse()
    {
        var element = JsonSerializer.SerializeToElement(false);
        var result = DataScanService.ConvertJsonElement(element);
        result.Should().Be(false);
    }

    [Fact]
    public void ConvertJsonElement_Null_ReturnsEmptyString()
    {
        var element = JsonSerializer.SerializeToElement<string?>(null);
        var result = DataScanService.ConvertJsonElement(element);
        result.Should().Be(string.Empty);
    }

    [Fact]
    public void ConvertJsonElement_Array_ReturnsToString()
    {
        var element = JsonSerializer.SerializeToElement(TestArray);
        var result = DataScanService.ConvertJsonElement(element);
        result.Should().BeOfType<string>();
        ((string)result).Should().Contain("1");
    }

    [Fact]
    public void ConvertJsonElement_Object_ReturnsToString()
    {
        var element = JsonSerializer.SerializeToElement(new { key = "value" });
        var result = DataScanService.ConvertJsonElement(element);
        result.Should().BeOfType<string>();
        ((string)result).Should().Contain("key");
    }

    // =========================================================================
    // CreateImageMetadata
    // =========================================================================
    [Fact]
    public void CreateImageMetadata_NullObsMeta_ReturnsNull()
    {
        var result = DataScanService.CreateImageMetadata(null);
        result.Should().BeNull();
    }

    [Fact]
    public void CreateImageMetadata_EmptyObsMeta_ReturnsMetadataWithDefaults()
    {
        // Arrange
        var obsMeta = new Dictionary<string, object?>();

        // Act
        var result = DataScanService.CreateImageMetadata(obsMeta);

        // Assert
        result.Should().NotBeNull();
        result!.CoordinateSystem.Should().Be("ICRS");
        result.TargetName.Should().BeNull();
        result.Instrument.Should().BeNull();
        result.Filter.Should().BeNull();
        result.ExposureTime.Should().BeNull();
        result.WCS.Should().BeNull();
    }

    [Fact]
    public void CreateImageMetadata_FullObsMeta_PopulatesAllFields()
    {
        // Arrange
        var obsMeta = new Dictionary<string, object?>
        {
            { "target_name", "NGC-3132" },
            { "instrument_name", "NIRCAM" },
            { "filters", "F200W" },
            { "t_exptime", "1347.5" },
            { "wavelength_region", "INFRARED" },
            { "calib_level", "3" },
            { "proposal_id", "02733" },
            { "proposal_pi", "Dr. Smith" },
            { "obs_title", "Deep Field Survey" },
            { "t_min", "59800.0" },
            { "s_ra", "187.7" },
            { "s_dec", "12.4" },
        };

        // Act
        var result = DataScanService.CreateImageMetadata(obsMeta);

        // Assert
        result.Should().NotBeNull();
        result!.TargetName.Should().Be("NGC-3132");
        result.Instrument.Should().Be("NIRCAM");
        result.Filter.Should().Be("F200W");
        result.ExposureTime.Should().Be(1347.5);
        result.WavelengthRange.Should().Be("INFRARED");
        result.CalibrationLevel.Should().Be(3);
        result.ProposalId.Should().Be("02733");
        result.ProposalPi.Should().Be("Dr. Smith");
        result.ObservationTitle.Should().Be("Deep Field Survey");
        result.ObservationDate.Should().NotBeNull();
        result.CoordinateSystem.Should().Be("ICRS");
        result.WCS.Should().NotBeNull();
        result.WCS!["CRVAL1"].Should().Be(187.7);
        result.WCS["CRVAL2"].Should().Be(12.4);
    }

    [Fact]
    public void CreateImageMetadata_PartialObsMeta_SetsOnlyProvidedFields()
    {
        // Arrange
        var obsMeta = new Dictionary<string, object?>
        {
            { "target_name", "M31" },
            { "instrument_name", "MIRI" },
        };

        // Act
        var result = DataScanService.CreateImageMetadata(obsMeta);

        // Assert
        result.Should().NotBeNull();
        result!.TargetName.Should().Be("M31");
        result.Instrument.Should().Be("MIRI");
        result.Filter.Should().BeNull();
        result.ExposureTime.Should().BeNull();
        result.WCS.Should().BeNull();
    }

    [Fact]
    public void CreateImageMetadata_InvalidExposureTime_DoesNotSetExposureTime()
    {
        // Arrange
        var obsMeta = new Dictionary<string, object?>
        {
            { "t_exptime", "not-a-number" },
        };

        // Act
        var result = DataScanService.CreateImageMetadata(obsMeta);

        // Assert
        result.Should().NotBeNull();
        result!.ExposureTime.Should().BeNull();
    }

    [Fact]
    public void CreateImageMetadata_MjdDateConversion_CalculatesCorrectDate()
    {
        // Arrange — MJD 59800.0 = 2022-08-13 (MJD epoch is 1858-11-17)
        var obsMeta = new Dictionary<string, object?>
        {
            { "t_min", "59800.0" },
        };

        // Act
        var result = DataScanService.CreateImageMetadata(obsMeta);

        // Assert
        result.Should().NotBeNull();
        result!.ObservationDate.Should().NotBeNull();

        var expectedDate = new DateTime(1858, 11, 17, 0, 0, 0, DateTimeKind.Utc).AddDays(59800.0);
        result.ObservationDate.Should().Be(expectedDate);
    }

    [Fact]
    public void CreateImageMetadata_MjdZero_DoesNotSetDate()
    {
        // Arrange — MJD=0 is rejected by the `mjd > 0` guard
        var obsMeta = new Dictionary<string, object?>
        {
            { "t_min", "0" },
        };

        // Act
        var result = DataScanService.CreateImageMetadata(obsMeta);

        // Assert — ObservationDate should remain null (not set)
        result.Should().NotBeNull();
        result!.ObservationDate.Should().BeNull();
    }

    [Fact]
    public void CreateImageMetadata_RaDecCoordinates_SetsWcsDict()
    {
        // Arrange
        var obsMeta = new Dictionary<string, object?>
        {
            { "s_ra", "53.1625" },
            { "s_dec", "-27.7914" },
        };

        // Act
        var result = DataScanService.CreateImageMetadata(obsMeta);

        // Assert
        result.Should().NotBeNull();
        result!.WCS.Should().NotBeNull();
        result.WCS!.Should().ContainKey("CRVAL1").WhoseValue.Should().Be(53.1625);
        result.WCS.Should().ContainKey("CRVAL2").WhoseValue.Should().Be(-27.7914);
    }

    [Fact]
    public void CreateImageMetadata_DateFallsBackToTmax_WhenTminIsZero()
    {
        // Arrange — t_min is zero (rejected), t_max has a valid MJD
        var obsMeta = new Dictionary<string, object?>
        {
            { "t_min", "0" },
            { "t_max", "59800.0" },
        };

        // Act
        var result = DataScanService.CreateImageMetadata(obsMeta);

        // Assert — should fall back to t_max
        result.Should().NotBeNull();
        result!.ObservationDate.Should().NotBeNull();
        var expectedDate = new DateTime(1858, 11, 17, 0, 0, 0, DateTimeKind.Utc).AddDays(59800.0);
        result.ObservationDate.Should().Be(expectedDate);
    }

    [Fact]
    public void CreateImageMetadata_InvalidCalibrationLevel_DoesNotSetCalibrationLevel()
    {
        // Arrange
        var obsMeta = new Dictionary<string, object?>
        {
            { "calib_level", "not-an-int" },
        };

        // Act
        var result = DataScanService.CreateImageMetadata(obsMeta);

        // Assert
        result.Should().NotBeNull();
        result!.CalibrationLevel.Should().BeNull();
    }

    // Helper — simple async enumerable from a sync sequence
    private static async IAsyncEnumerable<string> ToAsyncEnumerable(
        IEnumerable<string> source,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        foreach (var item in source)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Yield();
            yield return item;
        }
    }

    // Helper — build a MastSearchResponse with one result entry
    private static MastSearchResponse BuildMastResponse(string obsId, string targetName = "NGC-3132") =>
        new()
        {
            Results =
            [
                new Dictionary<string, object?>
                {
                    { "target_name", targetName },
                    { "instrument_name", "NIRCAM" },
                    { "filters", "F200W" },
                    { "t_exptime", "1200.0" },
                },
            ],
        };

    // Helper — create the SUT with all mocked dependencies
    private DataScanService CreateSut() =>
        new(
            mockMongo.Object,
            mockMast.Object,
            mockStorage.Object,
            mockThumbnailQueue.Object,
            embeddingQueue,
            mockLogger.Object);

    // Helper — configure the storage mock to behave like S3 (no local path support)
    private void SetupS3Storage(IEnumerable<string>? keys = null)
    {
        mockStorage.Setup(s => s.SupportsLocalPath).Returns(false);
        mockStorage
            .Setup(s => s.ListAsync("mast/", It.IsAny<CancellationToken>()))
            .Returns(ToAsyncEnumerable(keys ?? []));
    }
}
