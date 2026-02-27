"""Tests for chunked_downloader skip-redownload behaviour."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.mast.chunked_downloader import ChunkedDownloader, FileDownloadProgress


@pytest.fixture
def downloader():
    return ChunkedDownloader()


@pytest.fixture
def file_progress(tmp_path):
    local_path = str(tmp_path / "test_file.fits")
    return FileDownloadProgress(
        filename="test_file.fits",
        url="https://mast.example.com/test_file.fits",
        local_path=local_path,
        total_bytes=1000,
    )


@pytest.mark.asyncio
async def test_skip_redownload_when_file_exists_correct_size(downloader, file_progress, tmp_path):
    """Should skip download when final file exists with matching size."""
    # Create a file with the expected size
    local_path = file_progress.local_path
    with open(local_path, "wb") as f:
        f.write(b"\x00" * 1000)

    result = await downloader.download_file_chunked(
        url=file_progress.url,
        local_path=local_path,
        file_progress=file_progress,
    )

    assert result is True
    assert file_progress.status == "complete"
    assert file_progress.downloaded_bytes == 1000
    assert file_progress.completed_at is not None


@pytest.mark.asyncio
async def test_skip_redownload_when_file_exists_unknown_size(downloader, tmp_path):
    """Should skip download when final file exists and total_bytes is unknown (0)."""
    local_path = str(tmp_path / "unknown_size.fits")
    with open(local_path, "wb") as f:
        f.write(b"\x00" * 500)

    fp = FileDownloadProgress(
        filename="unknown_size.fits",
        url="https://mast.example.com/unknown_size.fits",
        local_path=local_path,
        total_bytes=0,  # Size unknown
    )

    result = await downloader.download_file_chunked(
        url=fp.url,
        local_path=local_path,
        file_progress=fp,
    )

    assert result is True
    assert fp.status == "complete"
    assert fp.downloaded_bytes == 500


@pytest.mark.asyncio
async def test_no_skip_when_file_does_not_exist(downloader, file_progress, tmp_path):
    """Should proceed with download when file does not exist."""
    # Don't create the file — download_file_chunked will try to actually download
    # We mock the session to avoid real HTTP calls
    mock_session = AsyncMock()
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.headers = {"Content-Length": "1000"}
    mock_response.content = AsyncMock()
    mock_response.content.iter_chunked = MagicMock(return_value=AsyncIterator([b"\x00" * 1000]))
    mock_response.__aenter__ = AsyncMock(return_value=mock_response)
    mock_response.__aexit__ = AsyncMock(return_value=False)

    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.head = MagicMock(return_value=mock_response)
    mock_session.closed = False
    downloader._session = mock_session

    result = await downloader.download_file_chunked(
        url=file_progress.url,
        local_path=file_progress.local_path,
        file_progress=file_progress,
    )

    assert result is True
    assert file_progress.status == "complete"


@pytest.mark.asyncio
async def test_no_skip_when_file_size_mismatch(downloader, file_progress, tmp_path):
    """Should proceed with download when file exists but size doesn't match."""
    local_path = file_progress.local_path
    # Create a file with wrong size (500 instead of expected 1000)
    with open(local_path, "wb") as f:
        f.write(b"\x00" * 500)

    # Mock the session for the actual download
    mock_session = AsyncMock()
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.headers = {"Content-Length": "1000"}
    mock_response.content = AsyncMock()
    mock_response.content.iter_chunked = MagicMock(return_value=AsyncIterator([b"\x00" * 1000]))
    mock_response.__aenter__ = AsyncMock(return_value=mock_response)
    mock_response.__aexit__ = AsyncMock(return_value=False)

    mock_head = AsyncMock()
    mock_head.status = 200
    mock_head.headers = {"Content-Length": "1000"}
    mock_head.__aenter__ = AsyncMock(return_value=mock_head)
    mock_head.__aexit__ = AsyncMock(return_value=False)

    mock_session.get = MagicMock(return_value=mock_response)
    mock_session.head = MagicMock(return_value=mock_head)
    mock_session.closed = False
    downloader._session = mock_session

    result = await downloader.download_file_chunked(
        url=file_progress.url,
        local_path=local_path,
        file_progress=file_progress,
    )

    # The download should proceed (not skip)
    assert result is True
    assert file_progress.status == "complete"


class AsyncIterator:
    """Helper to create an async iterator from a list of chunks."""

    def __init__(self, items):
        self.items = iter(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.items)
        except StopIteration:
            raise StopAsyncIteration from None
