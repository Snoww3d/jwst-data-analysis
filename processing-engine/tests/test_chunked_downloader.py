# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for ChunkedDownloader skip-if-exists behavior.

Verifies that already-downloaded files are skipped on re-download,
avoiding wasted bandwidth.
"""

import os
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.mast.chunked_downloader import ChunkedDownloader, FileDownloadProgress


@pytest.fixture
def downloader():
    return ChunkedDownloader(max_retries=0, retry_base_delay=0)


@pytest.fixture
def file_progress(tmp_path):
    local_path = str(tmp_path / "test_file.fits")
    return FileDownloadProgress(
        filename="test_file.fits",
        url="https://mast.stsci.edu/test_file.fits",
        local_path=local_path,
        total_bytes=1000,
    )


def _mock_failing_session():
    """Create a mock session whose head/get return a 500 async context manager."""
    mock_session = MagicMock()
    mock_resp = MagicMock()
    mock_resp.status = 500
    mock_resp.reason = "Test"

    @asynccontextmanager
    async def _fake_request(*args, **kwargs):
        yield mock_resp

    mock_session.head = _fake_request
    mock_session.get = _fake_request
    return mock_session


def _patch_get_session(downloader, session):
    """Patch _get_session with a plain async function (avoids AsyncMock coroutine warnings)."""

    async def fake_get_session():
        return session

    return patch.object(downloader, "_get_session", new=fake_get_session)


class TestSkipAlreadyDownloaded:
    """Tests for skipping files that already exist on disk."""

    @pytest.mark.asyncio
    async def test_skips_file_when_exists_with_matching_size(self, downloader, file_progress):
        """File that exists and matches expected size should be skipped."""
        with open(file_progress.local_path, "wb") as f:
            f.write(b"x" * 1000)

        with _patch_get_session(downloader, MagicMock()):
            result = await downloader.download_file_chunked(
                url=file_progress.url,
                local_path=file_progress.local_path,
                file_progress=file_progress,
            )

        assert result is True
        assert file_progress.status == "complete"
        assert file_progress.downloaded_bytes == 1000

    @pytest.mark.asyncio
    async def test_skips_file_when_exists_larger_than_expected(self, downloader, file_progress):
        """File that exists and is larger than expected should be skipped."""
        with open(file_progress.local_path, "wb") as f:
            f.write(b"x" * 1500)

        with _patch_get_session(downloader, MagicMock()):
            result = await downloader.download_file_chunked(
                url=file_progress.url,
                local_path=file_progress.local_path,
                file_progress=file_progress,
            )

        assert result is True
        assert file_progress.status == "complete"

    @pytest.mark.asyncio
    async def test_does_not_skip_empty_file(self, downloader, file_progress):
        """An empty existing file should NOT be skipped."""
        with open(file_progress.local_path, "wb"):
            pass

        assert os.path.getsize(file_progress.local_path) == 0

        with _patch_get_session(downloader, _mock_failing_session()):
            await downloader.download_file_chunked(
                url=file_progress.url,
                local_path=file_progress.local_path,
                file_progress=file_progress,
            )

        # Should have attempted download (and failed), not skipped
        assert file_progress.status == "failed"

    @pytest.mark.asyncio
    async def test_does_not_skip_undersized_file(self, downloader, tmp_path):
        """A file smaller than expected should NOT be skipped."""
        local_path = str(tmp_path / "partial.fits")
        with open(local_path, "wb") as f:
            f.write(b"x" * 500)

        fp = FileDownloadProgress(
            filename="partial.fits",
            url="https://mast.stsci.edu/partial.fits",
            local_path=local_path,
            total_bytes=1000,
        )

        with _patch_get_session(downloader, _mock_failing_session()):
            await downloader.download_file_chunked(
                url=fp.url,
                local_path=fp.local_path,
                file_progress=fp,
            )

        # Should NOT have skipped — file is too small
        assert fp.status == "failed"

    @pytest.mark.asyncio
    async def test_skips_when_size_unknown_but_file_exists(self, downloader, tmp_path):
        """When expected size is 0 (unknown), check remote size. If file matches, skip."""
        local_path = str(tmp_path / "unknown_size.fits")
        with open(local_path, "wb") as f:
            f.write(b"x" * 1000)

        fp = FileDownloadProgress(
            filename="unknown_size.fits",
            url="https://mast.stsci.edu/unknown_size.fits",
            local_path=local_path,
            total_bytes=0,  # Unknown
        )

        # Mock get_file_size to return matching size
        with patch.object(downloader, "get_file_size", new_callable=AsyncMock) as mock_size:
            mock_size.return_value = 1000

            with _patch_get_session(downloader, MagicMock()):
                result = await downloader.download_file_chunked(
                    url=fp.url,
                    local_path=fp.local_path,
                    file_progress=fp,
                )

        assert result is True
        assert fp.status == "complete"
        assert fp.downloaded_bytes == 1000

    @pytest.mark.asyncio
    async def test_skips_when_remote_size_also_unknown(self, downloader, tmp_path):
        """When both local exists and remote size is unknown (0), skip the file."""
        local_path = str(tmp_path / "both_unknown.fits")
        with open(local_path, "wb") as f:
            f.write(b"x" * 500)

        fp = FileDownloadProgress(
            filename="both_unknown.fits",
            url="https://mast.stsci.edu/both_unknown.fits",
            local_path=local_path,
            total_bytes=0,
        )

        with patch.object(downloader, "get_file_size", new_callable=AsyncMock) as mock_size:
            mock_size.return_value = 0  # Remote size also unknown

            with _patch_get_session(downloader, MagicMock()):
                result = await downloader.download_file_chunked(
                    url=fp.url,
                    local_path=fp.local_path,
                    file_progress=fp,
                )

        # Should skip — file exists, remote size unknown, assume complete
        assert result is True
        assert fp.status == "complete"

    @pytest.mark.asyncio
    async def test_no_file_does_not_trigger_skip(self, downloader, file_progress):
        """When file doesn't exist, should proceed to download (not skip)."""
        assert not os.path.exists(file_progress.local_path)

        with _patch_get_session(downloader, _mock_failing_session()):
            await downloader.download_file_chunked(
                url=file_progress.url,
                local_path=file_progress.local_path,
                file_progress=file_progress,
            )

        # Should have tried to download (failed due to mock), not skipped
        assert file_progress.status == "failed"
