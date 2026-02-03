// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Tests.Fixtures;

/// <summary>
/// Provides sample test data for unit tests.
/// </summary>
public static class TestDataFixtures
{
    /// <summary>
    /// Creates a sample JwstDataModel with default values.
    /// </summary>
    /// <param name="id">Optional ID for the data model.</param>
    /// <param name="fileName">File name for the data model.</param>
    /// <param name="dataType">Data type (image, spectral, etc.).</param>
    /// <param name="status">Processing status.</param>
    /// <returns>A sample JwstDataModel.</returns>
    public static JwstDataModel CreateSampleData(
        string? id = null,
        string fileName = "test_file.fits",
        string dataType = "image",
        string status = "pending")
    {
        return new JwstDataModel
        {
            Id = id ?? "507f1f77bcf86cd799439011",
            FileName = fileName,
            DataType = dataType,
            Description = "Test data description",
            UploadDate = DateTime.UtcNow,
            ProcessingStatus = status,
            FileSize = 1024 * 1024,
            FilePath = "/data/test/test_file.fits",
            Tags = ["test", "sample"],
            UserId = "test-user-123",
            IsPublic = false,
            IsValidated = false,
            IsArchived = false,
            Version = 1,
            FileFormat = "fits",
            ProcessingLevel = "L2b",
            ObservationBaseId = "jw02733-o001_t001_nircam",
            ExposureId = "jw02733001001_02101_00001",
            ImageInfo = new ImageMetadata
            {
                Width = 2048,
                Height = 2048,
                TargetName = "NGC-6804",
                Instrument = "NIRCAM",
                Filter = "F200W",
            },
        };
    }

    /// <summary>
    /// Creates a list of sample JwstDataModels for testing list operations.
    /// </summary>
    /// <param name="count">Number of items to create.</param>
    /// <returns>A list of sample JwstDataModels.</returns>
    public static List<JwstDataModel> CreateSampleDataList(int count = 5)
    {
        var list = new List<JwstDataModel>();
        var dataTypes = new[] { "image", "spectral", "sensor", "calibration", "raw" };
        var statuses = new[] { "pending", "processing", "completed", "failed" };

        for (var i = 0; i < count; i++)
        {
            list.Add(new JwstDataModel
            {
                Id = $"507f1f77bcf86cd79943901{i}",
                FileName = $"test_file_{i}.fits",
                DataType = dataTypes[i % dataTypes.Length],
                Description = $"Test data {i}",
                UploadDate = DateTime.UtcNow.AddDays(-i),
                ProcessingStatus = statuses[i % statuses.Length],
                FileSize = (i + 1) * 1024 * 1024,
                Tags = ["test", $"tag{i}"],
                UserId = $"user-{i % 3}",
                IsPublic = i % 2 == 0,
                IsValidated = i % 3 == 0,
                IsArchived = false,
                Version = 1,
                FileFormat = "fits",
            });
        }

        return list;
    }

    /// <summary>
    /// Creates a sample SearchRequest for testing search functionality.
    /// </summary>
    /// <param name="searchTerm">Optional search term.</param>
    /// <param name="dataTypes">Optional data types filter.</param>
    /// <param name="statuses">Optional statuses filter.</param>
    /// <param name="page">Page number.</param>
    /// <param name="pageSize">Page size.</param>
    /// <returns>A sample SearchRequest.</returns>
    public static SearchRequest CreateSearchRequest(
        string? searchTerm = null,
        List<string>? dataTypes = null,
        List<string>? statuses = null,
        int page = 1,
        int pageSize = 20)
    {
        return new SearchRequest
        {
            SearchTerm = searchTerm,
            DataTypes = dataTypes,
            Statuses = statuses,
            Page = page,
            PageSize = pageSize,
            SortBy = "uploadDate",
            SortOrder = "desc",
        };
    }

    /// <summary>
    /// Creates sample data with processing results for testing.
    /// </summary>
    /// <param name="resultCount">Number of processing results to add.</param>
    /// <returns>A JwstDataModel with processing results.</returns>
    public static JwstDataModel CreateDataWithProcessingResults(int resultCount = 2)
    {
        var data = CreateSampleData();
        data.ProcessingResults = [];

        for (var i = 0; i < resultCount; i++)
        {
            data.ProcessingResults.Add(new ProcessingResult
            {
                Id = $"result-{i}",
                Algorithm = $"algorithm_{i}",
                Status = "success",
                ProcessedDate = DateTime.UtcNow.AddHours(-i),
                ProcessingTime = 10.5 + i,
                Parameters = new Dictionary<string, object>
                {
                    { "param1", "value1" },
                    { "param2", i },
                },
                Results = new Dictionary<string, object>
                {
                    { "output", $"result_{i}" },
                },
            });
        }

        return data;
    }

    /// <summary>
    /// Creates sample data for lineage testing.
    /// </summary>
    /// <param name="observationBaseId">The observation base ID.</param>
    /// <returns>A list of JwstDataModels representing a lineage tree.</returns>
    public static List<JwstDataModel> CreateLineageData(string observationBaseId = "jw02733-o001_t001_nircam")
    {
        var levels = new[] { "L1", "L2a", "L2b", "L3" };
        var suffixes = new[] { "_uncal", "_rate", "_cal", "_i2d" };
        var list = new List<JwstDataModel>();

        for (var i = 0; i < levels.Length; i++)
        {
            list.Add(new JwstDataModel
            {
                Id = $"507f1f77bcf86cd79943902{i}",
                FileName = $"{observationBaseId}{suffixes[i]}.fits",
                DataType = "image",
                ProcessingLevel = levels[i],
                ObservationBaseId = observationBaseId,
                UploadDate = DateTime.UtcNow.AddHours(-i),
                ProcessingStatus = "completed",
                FileSize = (i + 1) * 1024 * 1024,
            });
        }

        return list;
    }

    /// <summary>
    /// Creates a sample CreateDataRequest for testing POST endpoints.
    /// </summary>
    /// <param name="fileName">File name for the request.</param>
    /// <param name="dataType">Data type for the request.</param>
    /// <returns>A sample CreateDataRequest.</returns>
    public static CreateDataRequest CreateDataRequest(
        string fileName = "new_file.fits",
        string dataType = "image")
    {
        return new CreateDataRequest
        {
            FileName = fileName,
            DataType = dataType,
            Description = "Test create request",
            Tags = ["new", "test"],
            UserId = "test-user-123",
        };
    }

    /// <summary>
    /// Creates a sample UpdateDataRequest for testing PUT endpoints.
    /// </summary>
    /// <param name="fileName">Optional file name update.</param>
    /// <param name="description">Optional description update.</param>
    /// <param name="tags">Optional tags update.</param>
    /// <returns>A sample UpdateDataRequest.</returns>
    public static UpdateDataRequest CreateUpdateRequest(
        string? fileName = null,
        string? description = null,
        List<string>? tags = null)
    {
        return new UpdateDataRequest
        {
            FileName = fileName,
            Description = description ?? "Updated description",
            Tags = tags,
        };
    }
}
