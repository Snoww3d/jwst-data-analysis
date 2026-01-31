//

using System.ComponentModel.DataAnnotations;
using FluentAssertions;
using JwstDataAnalysis.API.Models;

namespace JwstDataAnalysis.API.Tests.Models;

/// <summary>
/// Tests for model validation attributes.
/// </summary>
public class ValidationTests
{
    // ==========================================
    // CreateDataRequest Validation Tests
    // ==========================================

    [Fact]
    public void CreateDataRequest_ValidRequest_PassesValidation()
    {
        // Arrange
        var request = new CreateDataRequest
        {
            FileName = "test.fits",
            DataType = "image",
            Description = "Test description",
        };

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void CreateDataRequest_MissingFileName_FailsValidation()
    {
        // Arrange
        var request = new CreateDataRequest
        {
            FileName = string.Empty,
            DataType = "image",
        };

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().Contain(v => v.MemberNames.Contains("FileName"));
    }

    [Fact]
    public void CreateDataRequest_MissingDataType_FailsValidation()
    {
        // Arrange
        var request = new CreateDataRequest
        {
            FileName = "test.fits",
            DataType = string.Empty,
        };

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().Contain(v => v.MemberNames.Contains("DataType"));
    }

    [Fact]
    public void CreateDataRequest_FileNameTooLong_FailsValidation()
    {
        // Arrange
        var request = new CreateDataRequest
        {
            FileName = new string('a', 256), // Exceeds 255 char limit
            DataType = "image",
        };

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().Contain(v => v.MemberNames.Contains("FileName"));
    }

    [Fact]
    public void CreateDataRequest_DescriptionTooLong_FailsValidation()
    {
        // Arrange
        var request = new CreateDataRequest
        {
            FileName = "test.fits",
            DataType = "image",
            Description = new string('a', 1001), // Exceeds 1000 char limit
        };

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().Contain(v => v.MemberNames.Contains("Description"));
    }

    // ==========================================
    // UpdateDataRequest Validation Tests
    // ==========================================

    [Fact]
    public void UpdateDataRequest_AllNullFields_PassesValidation()
    {
        // Arrange - All fields are optional
        var request = new UpdateDataRequest();

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void UpdateDataRequest_ValidFields_PassesValidation()
    {
        // Arrange
        var request = new UpdateDataRequest
        {
            FileName = "updated.fits",
            Description = "Updated description",
            Tags = new List<string> { "tag1", "tag2" },
            IsPublic = true,
        };

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void UpdateDataRequest_FileNameTooLong_FailsValidation()
    {
        // Arrange
        var request = new UpdateDataRequest
        {
            FileName = new string('a', 256),
        };

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().Contain(v => v.MemberNames.Contains("FileName"));
    }

    // ==========================================
    // ProcessingRequest Validation Tests
    // ==========================================

    [Fact]
    public void ProcessingRequest_ValidRequest_PassesValidation()
    {
        // Arrange
        var request = new ProcessingRequest
        {
            Algorithm = "basic_analysis",
            Parameters = new Dictionary<string, object> { { "param1", "value1" } },
        };

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void ProcessingRequest_MissingAlgorithm_FailsValidation()
    {
        // Arrange
        var request = new ProcessingRequest
        {
            Algorithm = string.Empty,
        };

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().Contain(v => v.MemberNames.Contains("Algorithm"));
    }

    [Fact]
    public void ProcessingRequest_AlgorithmTooLong_FailsValidation()
    {
        // Arrange
        var request = new ProcessingRequest
        {
            Algorithm = new string('a', 101), // Exceeds 100 char limit
        };

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().Contain(v => v.MemberNames.Contains("Algorithm"));
    }

    // ==========================================
    // SearchRequest Default Values Tests
    // ==========================================

    [Fact]
    public void SearchRequest_DefaultValues_AreCorrect()
    {
        // Arrange & Act
        var request = new SearchRequest();

        // Assert
        request.Page.Should().Be(1);
        request.PageSize.Should().Be(20);
        request.SortBy.Should().Be("uploadDate");
        request.SortOrder.Should().Be("desc");
    }

    [Fact]
    public void SearchRequest_EmptyRequest_PassesValidation()
    {
        // Arrange
        var request = new SearchRequest();

        // Act
        var validationResults = ValidateModel(request);

        // Assert
        validationResults.Should().BeEmpty();
    }

    // ==========================================
    // JwstDataModel Validation Tests
    // ==========================================

    [Fact]
    public void JwstDataModel_DefaultValues_AreCorrect()
    {
        // Arrange & Act
        var model = new JwstDataModel();

        // Assert
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
        // Arrange
        var model = new JwstDataModel
        {
            FileName = "test.fits",
            DataType = "image",
            UploadDate = DateTime.UtcNow,
        };

        // Act
        var validationResults = ValidateModel(model);

        // Assert
        validationResults.Should().BeEmpty();
    }

    [Fact]
    public void JwstDataModel_MissingFileName_FailsValidation()
    {
        // Arrange
        var model = new JwstDataModel
        {
            FileName = string.Empty,
            DataType = "image",
        };

        // Act
        var validationResults = ValidateModel(model);

        // Assert
        validationResults.Should().Contain(v => v.MemberNames.Contains("FileName"));
    }

    // ==========================================
    // Custom Validation Attribute Tests
    // ==========================================

    [Theory]
    [InlineData("image", true)]
    [InlineData("sensor", true)]
    [InlineData("spectral", true)]
    [InlineData("metadata", true)]
    [InlineData("calibration", true)]
    [InlineData("raw", true)]
    [InlineData("processed", true)]
    [InlineData("invalid_type", false)]
    [InlineData("IMAGE", true)] // Case insensitive
    [InlineData("", true)] // Empty is valid (optional)
    [InlineData(null, true)] // Null is valid (optional)
    public void AstronomicalDataValidationAttribute_ValidatesCorrectly(string? dataType, bool isValid)
    {
        // Arrange
        var attribute = new AstronomicalDataValidationAttribute();
        var context = new ValidationContext(new object());

        // Act
        var result = attribute.GetValidationResult(dataType, context);

        // Assert
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
    [InlineData("FITS", true)] // Case insensitive
    [InlineData("", true)] // Empty is valid
    [InlineData(null, true)] // Null is valid
    public void FileFormatValidationAttribute_ValidatesCorrectly(string? fileFormat, bool isValid)
    {
        // Arrange
        var attribute = new FileFormatValidationAttribute();
        var context = new ValidationContext(new object());

        // Act
        var result = attribute.GetValidationResult(fileFormat, context);

        // Assert
        if (isValid)
        {
            result.Should().Be(ValidationResult.Success);
        }
        else
        {
            result.Should().NotBe(ValidationResult.Success);
        }
    }

    // ==========================================
    // ProcessingLevels Tests
    // ==========================================

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
        // Act & Assert
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

    // ==========================================
    // DataTypes Constants Tests
    // ==========================================

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

    // ==========================================
    // ProcessingStatuses Constants Tests
    // ==========================================

    [Fact]
    public void ProcessingStatuses_Constants_AreCorrect()
    {
        ProcessingStatuses.Pending.Should().Be("pending");
        ProcessingStatuses.Processing.Should().Be("processing");
        ProcessingStatuses.Completed.Should().Be("completed");
        ProcessingStatuses.Failed.Should().Be("failed");
        ProcessingStatuses.Cancelled.Should().Be("cancelled");
    }

    // ==========================================
    // FileFormats Constants Tests
    // ==========================================

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

    // ==========================================
    // Helper Methods
    // ==========================================

    private static List<ValidationResult> ValidateModel(object model)
    {
        var validationResults = new List<ValidationResult>();
        var context = new ValidationContext(model, null, null);
        Validator.TryValidateObject(model, context, validationResults, true);
        return validationResults;
    }
}
