// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.ComponentModel.DataAnnotations;

using FluentAssertions;

using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Tests.Models;

/// <summary>
/// Tests for model validation attributes and constants.
/// Covers CreateDataRequest, UpdateDataRequest, ProcessingRequest, SearchRequest,
/// JwstDataModel, custom validation attributes, and constant classes.
/// </summary>
public class ValidationTests
{
    [Fact]
    public void CreateDataRequest_ValidRequest_PassesValidation()
    {
        var request = new CreateDataRequest
        {
            FileName = "test.fits",
            DataType = "image",
            Description = "Test description",
        };

        var validationResults = ValidateModel(request);

        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void CreateDataRequest_MissingFileName_FailsValidation()
    {
        var request = new CreateDataRequest
        {
            FileName = string.Empty,
            DataType = "image",
        };

        var validationResults = ValidateModel(request);

        validationResults.Should().Contain(v => v.MemberNames.Contains("FileName"));
    }

    [Fact]
    public void CreateDataRequest_MissingDataType_FailsValidation()
    {
        var request = new CreateDataRequest
        {
            FileName = "test.fits",
            DataType = string.Empty,
        };

        var validationResults = ValidateModel(request);

        validationResults.Should().Contain(v => v.MemberNames.Contains("DataType"));
    }

    [Fact]
    public void CreateDataRequest_FileNameTooLong_FailsValidation()
    {
        var request = new CreateDataRequest
        {
            FileName = new string('a', 256),
            DataType = "image",
        };

        var validationResults = ValidateModel(request);

        validationResults.Should().Contain(v => v.MemberNames.Contains("FileName"));
    }

    [Fact]
    public void CreateDataRequest_DescriptionTooLong_FailsValidation()
    {
        var request = new CreateDataRequest
        {
            FileName = "test.fits",
            DataType = "image",
            Description = new string('a', 1001),
        };

        var validationResults = ValidateModel(request);

        validationResults.Should().Contain(v => v.MemberNames.Contains("Description"));
    }

    [Fact]
    public void UpdateDataRequest_AllNullFields_PassesValidation()
    {
        var request = new UpdateDataRequest();

        var validationResults = ValidateModel(request);

        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void UpdateDataRequest_ValidFields_PassesValidation()
    {
        var request = new UpdateDataRequest
        {
            FileName = "updated.fits",
            Description = "Updated description",
            Tags = new List<string> { "tag1", "tag2" },
            IsPublic = true,
        };

        var validationResults = ValidateModel(request);

        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void UpdateDataRequest_FileNameTooLong_FailsValidation()
    {
        var request = new UpdateDataRequest
        {
            FileName = new string('a', 256),
        };

        var validationResults = ValidateModel(request);

        validationResults.Should().Contain(v => v.MemberNames.Contains("FileName"));
    }

    [Fact]
    public void ProcessingRequest_ValidRequest_PassesValidation()
    {
        var request = new ProcessingRequest
        {
            Algorithm = "basic_analysis",
            Parameters = new Dictionary<string, object> { { "param1", "value1" } },
        };

        var validationResults = ValidateModel(request);

        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void ProcessingRequest_MissingAlgorithm_FailsValidation()
    {
        var request = new ProcessingRequest
        {
            Algorithm = string.Empty,
        };

        var validationResults = ValidateModel(request);

        validationResults.Should().Contain(v => v.MemberNames.Contains("Algorithm"));
    }

    [Fact]
    public void ProcessingRequest_AlgorithmTooLong_FailsValidation()
    {
        var request = new ProcessingRequest
        {
            Algorithm = new string('a', 101),
        };

        var validationResults = ValidateModel(request);

        validationResults.Should().Contain(v => v.MemberNames.Contains("Algorithm"));
    }

    [Fact]
    public void SearchRequest_DefaultValues_AreCorrect()
    {
        var request = new SearchRequest();

        request.Page.Should().Be(1);
        request.PageSize.Should().Be(20);
        request.SortBy.Should().Be("uploadDate");
        request.SortOrder.Should().Be("desc");
    }

    [Fact]
    public void SearchRequest_EmptyRequest_PassesValidation()
    {
        var request = new SearchRequest();

        var validationResults = ValidateModel(request);

        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void JwstDataModel_DefaultValues_AreCorrect()
    {
        var model = new JwstDataModel();

        model.Version.Should().Be(1);
        model.IsPublic.Should().BeFalse();
        model.IsValidated.Should().BeFalse();
        model.IsArchived.Should().BeFalse();
        model.IsViewable.Should().BeTrue();
        model.ProcessingStatus.Should().Be("pending");
        model.Tags.Should().BeEmpty();
        model.ProcessingResults.Should().BeEmpty();
        model.Metadata.Should().BeEmpty();
    }

    [Fact]
    public void JwstDataModel_ValidModel_PassesValidation()
    {
        var model = new JwstDataModel
        {
            FileName = "test.fits",
            DataType = "image",
            UploadDate = DateTime.UtcNow,
        };

        var validationResults = ValidateModel(model);

        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void JwstDataModel_MissingFileName_FailsValidation()
    {
        var model = new JwstDataModel
        {
            FileName = string.Empty,
            DataType = "image",
        };

        var validationResults = ValidateModel(model);

        validationResults.Should().Contain(v => v.MemberNames.Contains("FileName"));
    }

    [Theory]
    [InlineData("image", true)]
    [InlineData("sensor", true)]
    [InlineData("spectral", true)]
    [InlineData("metadata", true)]
    [InlineData("calibration", true)]
    [InlineData("raw", true)]
    [InlineData("processed", true)]
    [InlineData("invalid_type", false)]
    [InlineData("IMAGE", true)]
    [InlineData("", true)]
    [InlineData(null, true)]
    public void AstronomicalDataValidationAttribute_ValidatesCorrectly(string? dataType, bool isValid)
    {
        var attribute = new AstronomicalDataValidationAttribute();
        var context = new ValidationContext(new object());

        var result = attribute.GetValidationResult(dataType, context);

        if (isValid)
        {
            result.Should().Be(ValidationResult.Success);
        }
        else
        {
            result.Should().NotBe(ValidationResult.Success);
        }
    }

    [Theory]
    [InlineData("fits", true)]
    [InlineData("csv", true)]
    [InlineData("json", true)]
    [InlineData("hdf5", true)]
    [InlineData("ascii", true)]
    [InlineData("binary", true)]
    [InlineData("xlsx", false)]
    [InlineData("pdf", false)]
    [InlineData("FITS", true)]
    [InlineData("", true)]
    [InlineData(null, true)]
    public void FileFormatValidationAttribute_ValidatesCorrectly(string? fileFormat, bool isValid)
    {
        var attribute = new FileFormatValidationAttribute();
        var context = new ValidationContext(new object());

        var result = attribute.GetValidationResult(fileFormat, context);

        if (isValid)
        {
            result.Should().Be(ValidationResult.Success);
        }
        else
        {
            result.Should().NotBe(ValidationResult.Success);
        }
    }

    [Theory]
    [InlineData("_uncal", "L1")]
    [InlineData("_rate", "L2a")]
    [InlineData("_rateints", "L2a")]
    [InlineData("_cal", "L2b")]
    [InlineData("_crf", "L2b")]
    [InlineData("_i2d", "L3")]
    [InlineData("_s2d", "L3")]
    [InlineData("_x1d", "L3")]
    public void ProcessingLevels_SuffixToLevel_MapsCorrectly(string suffix, string expectedLevel)
    {
        ProcessingLevels.SuffixToLevel.Should().ContainKey(suffix);
        ProcessingLevels.SuffixToLevel[suffix].Should().Be(expectedLevel);
    }

    [Fact]
    public void ProcessingLevels_Constants_AreCorrect()
    {
        ProcessingLevels.Level1.Should().Be("L1");
        ProcessingLevels.Level2a.Should().Be("L2a");
        ProcessingLevels.Level2b.Should().Be("L2b");
        ProcessingLevels.Level3.Should().Be("L3");
        ProcessingLevels.Unknown.Should().Be("unknown");
    }

    [Fact]
    public void DataTypes_Constants_AreCorrect()
    {
        DataTypes.Image.Should().Be("image");
        DataTypes.Sensor.Should().Be("sensor");
        DataTypes.Spectral.Should().Be("spectral");
        DataTypes.Metadata.Should().Be("metadata");
        DataTypes.Calibration.Should().Be("calibration");
        DataTypes.Raw.Should().Be("raw");
        DataTypes.Processed.Should().Be("processed");
    }

    [Fact]
    public void ProcessingStatuses_Constants_AreCorrect()
    {
        ProcessingStatuses.Pending.Should().Be("pending");
        ProcessingStatuses.Processing.Should().Be("processing");
        ProcessingStatuses.Completed.Should().Be("completed");
        ProcessingStatuses.Failed.Should().Be("failed");
        ProcessingStatuses.Cancelled.Should().Be("cancelled");
    }

    [Fact]
    public void FileFormats_Constants_AreCorrect()
    {
        FileFormats.FITS.Should().Be("fits");
        FileFormats.CSV.Should().Be("csv");
        FileFormats.JSON.Should().Be("json");
        FileFormats.HDF5.Should().Be("hdf5");
        FileFormats.ASCII.Should().Be("ascii");
        FileFormats.Binary.Should().Be("binary");
    }

    private static List<ValidationResult> ValidateModel(object model)
    {
        var validationResults = new List<ValidationResult>();
        var context = new ValidationContext(model, null, null);
        Validator.TryValidateObject(model, context, validationResults, true);
        return validationResults;
    }
}
