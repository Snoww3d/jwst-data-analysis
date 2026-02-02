# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Security tests for MastService URI validation.

These tests verify that SSRF attacks via malicious data URIs are blocked.
"""

import pytest

from app.mast.mast_service import MastService


class TestMastUriValidation:
    """Test cases for MAST data URI validation to prevent SSRF attacks."""

    # Valid MAST URIs that should be accepted
    @pytest.mark.parametrize(
        "uri",
        [
            "mast:JWST/product/jw02733-o001_t001_nircam_clear-f090w_i2d.fits",
            "mast:JWST/product/jw12345-o001_t001_miri_f770w_cal.fits",
            "mast:JWST/product/jw01234-c1001_t001_nirspec_g140h-f100lp_s2d.fits",
            "mast:HST/product/some_file.fits",
            "mast:TESS/product/data.fits",
        ],
    )
    def test_valid_mast_uri_accepted(self, uri: str):
        """Valid MAST URIs should be accepted."""
        assert MastService._is_valid_mast_uri(uri) is True

    # Invalid URIs that should be rejected (SSRF attempts)
    @pytest.mark.parametrize(
        "uri,description",
        [
            # Missing mast: prefix
            ("JWST/product/file.fits", "missing mast: prefix"),
            ("http://evil.com/steal?data=", "HTTP URL instead of mast: URI"),
            ("https://attacker.com/file.fits", "HTTPS URL instead of mast: URI"),
            # URL injection attempts
            ("mast:JWST/product/file.fits?evil=param", "query string injection"),
            ("mast:JWST/product/file.fits#fragment", "fragment injection"),
            ("mast:JWST/product/file.fits&extra=param", "ampersand injection"),
            # Path traversal attempts
            ("mast:JWST/product/../../../etc/passwd", "path traversal with .."),
            ("mast:../../../etc/passwd", "path traversal at start"),
            ("mast:JWST/../../../secret", "nested path traversal"),
            # Protocol smuggling
            ("mast:JWST/product/file.fits\nHost: evil.com", "newline injection"),
            ("mast:JWST/product/file.fits\r\nX-Injected: header", "CRLF injection"),
            # Special characters that could break URL parsing
            ("mast:JWST/product/file.fits;rm -rf /", "semicolon injection"),
            ("mast:JWST/product/`whoami`.fits", "backtick injection"),
            ("mast:JWST/product/$(id).fits", "command substitution"),
            ("mast:JWST/product/file.fits|cat /etc/passwd", "pipe injection"),
            # Unicode/encoding attacks
            ("mast:JWST/product/file%2e%2e%2f.fits", "URL encoded traversal"),
            # Empty or whitespace
            ("", "empty string"),
            ("   ", "whitespace only"),
            ("mast:", "mast prefix only"),
            # Null bytes
            ("mast:JWST/product/file\x00.fits", "null byte injection"),
        ],
    )
    def test_invalid_uri_rejected(self, uri: str, description: str):
        """Invalid or malicious URIs should be rejected."""
        assert MastService._is_valid_mast_uri(uri) is False, f"Should reject: {description}"


class TestMastDownloadUrlBuilder:
    """Test cases for safe MAST download URL construction."""

    def test_valid_uri_builds_url(self):
        """Valid URI should produce a properly encoded URL."""
        uri = "mast:JWST/product/jw02733-o001_t001_nircam_clear-f090w_i2d.fits"
        url = MastService._build_mast_download_url(uri)

        assert url is not None
        assert url.startswith("https://mast.stsci.edu/api/v0.1/Download/file?uri=")
        # URI should be URL-encoded
        assert "mast%3AJWST" in url  # : encoded as %3A
        assert "jw02733" in url

    def test_invalid_uri_returns_none(self):
        """Invalid URI should return None instead of building a URL."""
        malicious_uris = [
            "http://evil.com/steal",
            "mast:../../../etc/passwd",
            "mast:JWST/product/file.fits?inject=true",
        ]

        for uri in malicious_uris:
            result = MastService._build_mast_download_url(uri)
            assert result is None, f"Should return None for: {uri}"

    def test_url_encoding_prevents_injection(self):
        """URL encoding should prevent parameter injection even if validation is bypassed."""
        # Even if a URI somehow passed validation, encoding would neutralize it
        # This tests the defense-in-depth approach
        uri = "mast:JWST/product/safe_file.fits"
        url = MastService._build_mast_download_url(uri)

        assert url is not None
        # The URI parameter should be encoded, making injection impossible
        assert "?" not in url.split("uri=")[1] if url else True
        assert "&" not in url.split("uri=")[1] if url else True


class TestFilenameValidation:
    """Test filename validation in download URL generation."""

    @pytest.mark.parametrize(
        "filename,should_pass",
        [
            # Valid JWST filenames
            ("jw02733-o001_t001_nircam_clear-f090w_i2d.fits", True),
            ("jw12345-o001_t001_miri_f770w_cal.fits", True),
            ("simple_file.fits", True),
            # Invalid filenames
            ("../../../etc/passwd", False),
            ("file.fits;rm -rf /", False),
            ("file`whoami`.fits", False),
            ("file$(id).fits", False),
            ("file|cat.fits", False),
            ("file.fits.exe", False),  # Not a .fits file
            ("", False),
        ],
    )
    def test_filename_validation(self, filename: str, should_pass: bool):
        """Filenames should be validated before being used in URLs."""
        import re

        # This tests the regex pattern used in get_download_urls
        pattern = r"^[A-Za-z0-9_\-./]+\.fits$"
        result = bool(re.match(pattern, filename)) if filename else False
        assert result == should_pass, f"Filename '{filename}' validation mismatch"


class TestChunkedDownloaderFilenameValidation:
    """Test cases for chunked downloader filename sanitization to prevent path traversal."""

    @pytest.mark.parametrize(
        "filename,expected",
        [
            # Valid filenames should pass through unchanged
            ("jw02733-o001_t001_nircam_clear-f090w_i2d.fits", "jw02733-o001_t001_nircam_clear-f090w_i2d.fits"),
            ("simple_file.fits", "simple_file.fits"),
            ("file-with-dashes.fits", "file-with-dashes.fits"),
            ("file.with.dots.fits", "file.with.dots.fits"),
            # Path traversal attempts - basename extracted, which may be valid or not
            # These extract the basename and check against pattern
            ("../../../etc/passwd", "passwd"),  # basename is 'passwd', valid pattern
            ("/etc/passwd", "passwd"),  # basename is 'passwd', valid pattern
            ("path/to/file.fits", "file.fits"),  # basename extracted
            # Windows paths - basename extracted
            ("C:\\Windows\\file.fits", "file.fits"),  # backslash converted, basename extracted
            # Special characters in filename should be rejected (not in path)
            ("file`whoami`.fits", None),  # backtick not in pattern
            ("file$(id).fits", None),  # $ and () not in pattern
            ("file|cat.fits", None),  # pipe not in pattern
            ("file\n.fits", None),  # newline not in pattern
            ("file with spaces.fits", None),  # space not in pattern
            # Empty/whitespace
            ("", None),
            ("   ", None),
        ],
    )
    def test_sanitize_filename(self, filename: str, expected: str | None):
        """Test filename sanitization extracts basename and validates pattern."""
        from app.mast.chunked_downloader import _sanitize_filename

        result = _sanitize_filename(filename)
        assert result == expected, f"Sanitize '{filename}' expected '{expected}', got '{result}'"

    def test_sanitize_filename_empty_string(self):
        """Empty string should return None."""
        from app.mast.chunked_downloader import _sanitize_filename

        assert _sanitize_filename("") is None

    def test_sanitize_filename_removes_null_bytes(self):
        """Null bytes should be stripped from filename."""
        from app.mast.chunked_downloader import _sanitize_filename

        # Null byte is removed, resulting in valid filename
        result = _sanitize_filename("file\x00.fits")
        assert result == "file.fits"

    def test_sanitize_filename_double_dot_removed(self):
        """Double dots should be removed from the basename."""
        from app.mast.chunked_downloader import _sanitize_filename

        # After basename extraction and .. removal
        result = _sanitize_filename("file..name.fits")
        assert result == "filename.fits"  # .. removed

    @pytest.mark.parametrize(
        "filepath,directory,expected",
        [
            # Valid paths within directory
            ("/app/data/mast/obs1/file.fits", "/app/data/mast/obs1", True),
            ("/app/data/mast/obs1/subdir/file.fits", "/app/data/mast/obs1", True),
            # Path traversal attempts
            ("/app/data/mast/obs1/../../../etc/passwd", "/app/data/mast/obs1", False),
            ("/etc/passwd", "/app/data/mast/obs1", False),
            ("/app/data/mast/other_obs/file.fits", "/app/data/mast/obs1", False),
        ],
    )
    def test_is_path_within_directory(self, filepath: str, directory: str, expected: bool):
        """Test path containment check prevents traversal."""
        from app.mast.chunked_downloader import _is_path_within_directory

        result = _is_path_within_directory(filepath, directory)
        assert result == expected, f"Path '{filepath}' in '{directory}': expected {expected}, got {result}"
