// Copyright (c) JWST Data Analysis. All rights reserved.
// Licensed under the MIT License.

using System.Globalization;
using System.Text.Json;

using FluentAssertions;

using JwstDataAnalysis.API.Models;
using JwstDataAnalysis.API.Services;

namespace JwstDataAnalysis.API.Tests.Services;

/// <summary>
/// Unit tests for the internal static helper methods of DataScanService.
/// Accessible via InternalsVisibleTo in the main project.
/// </summary>
public class DataScanServiceTests
{
    private static readonly int[] TestArray = [1, 2, 3];

    // ========== ParseFileInfo Tests ==========
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

    // ========== BuildMastMetadata Tests ==========
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

    // ========== ConvertJsonElement Tests ==========
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

    // ========== CreateImageMetadata Tests ==========
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
}
