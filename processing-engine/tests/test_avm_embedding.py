"""Tests for AVM XMP metadata embedding."""

import io
import json
import xml.etree.ElementTree as ET

import pytest
from PIL import Image

from app.processing.avm import (
    _build_xmp_packet,
    embed_avm_xmp,
    extract_wcs_for_avm,
    parse_avm_metadata_json,
)


def _create_test_png(width: int = 100, height: int = 100) -> bytes:
    """Create a minimal test PNG image."""
    img = Image.new("RGB", (width, height), color=(128, 64, 32))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _create_test_jpeg(width: int = 100, height: int = 100) -> bytes:
    """Create a minimal test JPEG image."""
    img = Image.new("RGB", (width, height), color=(128, 64, 32))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


class TestBuildXmpPacket:
    """Tests for _build_xmp_packet."""

    def test_basic_packet_structure(self):
        xmp = _build_xmp_packet({"target_name": "NGC-6804"})
        assert "<?xpacket begin=" in xmp
        assert "<?xpacket end='w'?>" in xmp
        assert "NGC-6804" in xmp

    def test_spatial_fields(self):
        metadata = {
            "ra": 295.123,
            "dec": -10.456,
            "scale_x": -0.001,
            "scale_y": 0.001,
            "rotation": 45.0,
            "coordinate_frame": "ICRS",
        }
        xmp = _build_xmp_packet(metadata)
        assert "295.123" in xmp
        assert "-10.456" in xmp
        assert "ICRS" in xmp
        assert "45.0" in xmp
        assert "TAN" in xmp  # projection

    def test_observation_fields(self):
        metadata = {
            "target_name": "Carina Nebula",
            "instrument": "NIRCam",
            "filter": "F200W",
            "facility": "JWST",
            "spectral_band": "Infrared",
        }
        xmp = _build_xmp_packet(metadata)
        assert "Carina Nebula" in xmp
        assert "NIRCam" in xmp
        assert "F200W" in xmp
        assert "JWST" in xmp
        assert "Infrared" in xmp

    def test_publisher_and_description(self):
        metadata = {
            "publisher": "JWST Data Analysis App",
            "description": "Preview of NGC-6804 taken with NIRCam",
        }
        xmp = _build_xmp_packet(metadata)
        assert "JWST Data Analysis App" in xmp
        assert "Preview of NGC-6804" in xmp

    def test_empty_metadata(self):
        xmp = _build_xmp_packet({})
        assert "<?xpacket begin=" in xmp
        # Should still have the default spatial fields
        assert "ICRS" in xmp
        assert "J2000" in xmp

    def test_xmp_is_valid_xml(self):
        metadata = {"target_name": "Test", "ra": 180.0, "dec": 45.0}
        xmp = _build_xmp_packet(metadata)
        # Extract just the XML part (between xpacket markers)
        xml_start = xmp.index("<")
        # Find the end of the actual XML element (before the xpacket end)
        xpacket_end = xmp.index("<?xpacket end")
        xml_content = xmp[xml_start:xpacket_end].strip()
        # Should parse as valid XML
        ET.fromstring(xml_content)


class TestEmbedAvmXmp:
    """Tests for embed_avm_xmp."""

    def test_embed_png(self):
        png_bytes = _create_test_png()
        metadata = {
            "target_name": "NGC-1234",
            "ra": 50.0,
            "dec": -30.0,
        }
        result = embed_avm_xmp(png_bytes, "png", metadata)
        assert len(result) > len(png_bytes)

        # Verify the PNG can be opened and has XMP metadata
        img = Image.open(io.BytesIO(result))
        assert img.format == "PNG"
        assert "XML:com.adobe.xmp" in img.info
        xmp_text = img.info["XML:com.adobe.xmp"]
        assert "NGC-1234" in xmp_text

    def test_embed_jpeg(self):
        jpeg_bytes = _create_test_jpeg()
        metadata = {
            "target_name": "M31",
            "instrument": "MIRI",
        }
        result = embed_avm_xmp(jpeg_bytes, "jpeg", metadata)
        assert len(result) > 0

        # Verify the JPEG can be opened
        img = Image.open(io.BytesIO(result))
        assert img.format == "JPEG"

    def test_embed_unsupported_format_returns_original(self):
        png_bytes = _create_test_png()
        result = embed_avm_xmp(png_bytes, "tiff", {"target_name": "Test"})
        assert result == png_bytes

    def test_embed_empty_metadata(self):
        png_bytes = _create_test_png()
        result = embed_avm_xmp(png_bytes, "png", {})
        assert len(result) > 0
        # Should still be a valid PNG
        img = Image.open(io.BytesIO(result))
        assert img.format == "PNG"

    def test_embed_preserves_image_dimensions(self):
        png_bytes = _create_test_png(200, 150)
        result = embed_avm_xmp(png_bytes, "png", {"target_name": "Test"})
        img = Image.open(io.BytesIO(result))
        assert img.size == (200, 150)

    def test_embed_rgba_jpeg_conversion(self):
        """JPEG doesn't support alpha; ensure RGBA images convert correctly."""
        img = Image.new("RGBA", (50, 50), color=(100, 150, 200, 128))
        buf = io.BytesIO()
        img.save(buf, format="PNG")  # Save as PNG first (supports RGBA)
        png_bytes = buf.getvalue()

        result = embed_avm_xmp(png_bytes, "jpeg", {"target_name": "Test"})
        img_out = Image.open(io.BytesIO(result))
        assert img_out.mode == "RGB"


class TestExtractWcsForAvm:
    """Tests for extract_wcs_for_avm."""

    def test_basic_wcs_extraction(self):
        header = {
            "CRPIX1": 512.0,
            "CRPIX2": 512.0,
            "CRVAL1": 180.5,
            "CRVAL2": -45.2,
            "CD1_1": -1e-5,
            "CD1_2": 0.0,
            "CD2_1": 0.0,
            "CD2_2": 1e-5,
            "CTYPE1": "RA---TAN",
            "CTYPE2": "DEC--TAN",
        }
        result = extract_wcs_for_avm(header, 1024, 1024, 512, 512)
        assert result["ra"] == 180.5
        assert result["dec"] == -45.2
        assert result["coordinate_frame"] == "ICRS"
        # CRPIX should be scaled down by 2
        assert abs(result["scale_x"] - (-1e-5 * 2)) < 1e-10
        assert abs(result["scale_y"] - (1e-5 * 2)) < 1e-10

    def test_no_wcs_returns_empty(self):
        header = {"CRPIX1": 0, "CRVAL1": 0}
        result = extract_wcs_for_avm(header, 1024, 1024, 512, 512)
        assert result == {}

    def test_missing_cd_matrix_returns_empty(self):
        header = {
            "CRPIX1": 512.0,
            "CRPIX2": 512.0,
            "CRVAL1": 180.0,
            "CRVAL2": -45.0,
        }
        result = extract_wcs_for_avm(header, 1024, 1024, 512, 512)
        assert result == {}

    def test_cdelt_fallback(self):
        header = {
            "CRPIX1": 100.0,
            "CRPIX2": 100.0,
            "CRVAL1": 90.0,
            "CRVAL2": 20.0,
            "CDELT1": -0.001,
            "CDELT2": 0.001,
            "CTYPE1": "RA---TAN",
        }
        result = extract_wcs_for_avm(header, 200, 200, 100, 100)
        assert result["ra"] == 90.0
        assert result["scale_x"] == pytest.approx(-0.002, abs=1e-8)
        assert result["scale_y"] == pytest.approx(0.002, abs=1e-8)

    def test_fk5_coordinate_frame(self):
        header = {
            "CRPIX1": 256.0,
            "CRPIX2": 256.0,
            "CRVAL1": 45.0,
            "CRVAL2": 60.0,
            "CD1_1": -1e-4,
            "CD2_2": 1e-4,
            "CTYPE1": "RA---TAN-FK5",
        }
        result = extract_wcs_for_avm(header, 512, 512, 512, 512)
        assert result["coordinate_frame"] == "FK5"

    def test_same_size_no_scaling(self):
        header = {
            "CRPIX1": 256.0,
            "CRPIX2": 256.0,
            "CRVAL1": 100.0,
            "CRVAL2": -20.0,
            "CD1_1": -3e-5,
            "CD1_2": 0.0,
            "CD2_1": 0.0,
            "CD2_2": 3e-5,
            "CTYPE1": "RA---TAN",
        }
        result = extract_wcs_for_avm(header, 512, 512, 512, 512)
        assert result["scale_x"] == pytest.approx(-3e-5, abs=1e-12)
        assert result["scale_y"] == pytest.approx(3e-5, abs=1e-12)


class TestParseAvmMetadataJson:
    """Tests for parse_avm_metadata_json."""

    def test_valid_json(self):
        data = {
            "target_name": "NGC-6804",
            "instrument": "NIRCam",
            "filter": "F200W",
        }
        result = parse_avm_metadata_json(json.dumps(data))
        assert result["target_name"] == "NGC-6804"
        assert result["instrument"] == "NIRCam"
        assert result["filter"] == "F200W"
        assert result["facility"] == "JWST"  # Default

    def test_empty_string(self):
        result = parse_avm_metadata_json("")
        assert result == {}

    def test_invalid_json(self):
        result = parse_avm_metadata_json("not-json{")
        assert result == {}

    def test_none_input(self):
        result = parse_avm_metadata_json(None)
        assert result == {}

    def test_custom_facility(self):
        data = {"facility": "HST", "target_name": "Test"}
        result = parse_avm_metadata_json(json.dumps(data))
        assert result["facility"] == "HST"

    def test_all_fields(self):
        data = {
            "target_name": "Carina",
            "instrument": "MIRI",
            "filter": "F770W",
            "description": "Mid-infrared view",
            "facility": "JWST",
            "spectral_band": "Infrared",
            "publisher": "Test User",
        }
        result = parse_avm_metadata_json(json.dumps(data))
        assert len(result) == 7
        assert result["spectral_band"] == "Infrared"
        assert result["publisher"] == "Test User"
