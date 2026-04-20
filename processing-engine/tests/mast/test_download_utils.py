"""Tests for the shared filename sanitizer in app.mast.download_utils."""

from __future__ import annotations

import pytest

from app.mast.download_utils import sanitize_filename


class TestSanitizeFilenameRejects:
    """Cases that must return None."""

    @pytest.mark.parametrize(
        "raw",
        [
            # Classic path traversal
            "../../../etc/passwd",
            "..",
            "../",
            # URL-encoded traversal — the bug #1095 closes
            "%2e%2e/%2e%2e/etc/passwd",
            "%2E%2E%2F%2E%2E%2Fetc%2Fpasswd",
            "%2e%2e",
            # Windows-style traversal
            "file\\..\\other",
            "..\\..\\windows\\system32",
            # Mid-name double-dot — the other bug #1095 closes
            "file..name",
            "jw02733..001.fits",
            "foo...bar",
            # Null byte
            "\x00evil",
            "evil\x00.fits",
            # Empty / whitespace-only
            "",
            "   ",
            "\t\n",
            # Disallowed characters
            "file`whoami`.fits",
            "file$(id).fits",
            "file|cat.fits",
            "file with spaces.fits",
            "file<evil>.fits",
        ],
    )
    def test_rejects(self, raw: str):
        assert sanitize_filename(raw) is None


class TestSanitizeFilenameAccepts:
    """Cases that must return a sanitized basename."""

    @pytest.mark.parametrize(
        "raw,expected",
        [
            # Valid FITS names pass through untouched
            (
                "jw02733001001_02101_00001_nircam_cal.fits",
                "jw02733001001_02101_00001_nircam_cal.fits",
            ),
            ("test-image_1.2.fits", "test-image_1.2.fits"),
            ("simple_file.fits", "simple_file.fits"),
            ("file-with-dashes.fits", "file-with-dashes.fits"),
            ("file.with.dots.fits", "file.with.dots.fits"),
            # Basename extraction from a clean posix path (no traversal in raw)
            ("path/to/file.fits", "file.fits"),
            ("/tmp/file.fits", "file.fits"),
            # Basename extraction from a windows path
            ("C:\\Windows\\file.fits", "file.fits"),
            ("dir\\sub\\file.fits", "file.fits"),
            # URL-encoded path separators that decode to a clean basename
            ("path%2Fto%2Ffile.fits", "file.fits"),
            # URL-encoded single dots are fine (%2E == '.')
            ("foo%2Ebar.fits", "foo.bar.fits"),
        ],
    )
    def test_accepts(self, raw: str, expected: str):
        assert sanitize_filename(raw) == expected


class TestSanitizeFilenameLogging:
    """Confirm we log a warning on rejection (helps ops diagnose bad inputs)."""

    def test_logs_on_traversal(self, caplog: pytest.LogCaptureFixture):
        with caplog.at_level("WARNING", logger="app.mast.download_utils"):
            sanitize_filename("../../etc/passwd")
        assert any("parent-directory" in r.message for r in caplog.records)

    def test_logs_on_invalid_chars(self, caplog: pytest.LogCaptureFixture):
        with caplog.at_level("WARNING", logger="app.mast.download_utils"):
            sanitize_filename("file|pipe.fits")
        assert any("invalid characters" in r.message for r in caplog.records)
