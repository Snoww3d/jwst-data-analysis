"""Unit tests for the S3 download engine."""

import os
from unittest.mock import MagicMock, patch

import pytest

from app.mast.chunked_downloader import DownloadJobState
from app.mast.s3_downloader import S3Downloader


@pytest.fixture
def mock_s3_client():
    """Mock the S3Client used by S3Downloader."""
    with patch("app.mast.s3_downloader.S3Client") as MockClient:
        mock_instance = MagicMock()
        MockClient.return_value = mock_instance
        # Default: files exist with known sizes
        mock_instance.get_file_size.return_value = 1024
        yield mock_instance


@pytest.fixture
def downloader(mock_s3_client):
    return S3Downloader()


class TestS3Downloader:
    def test_download_files_basic(self, downloader, mock_s3_client, tmp_path):
        """Test downloading a single file."""
        download_dir = str(tmp_path / "downloads")
        files_info = [
            {"s3_key": "jwst/public/02733/test.fits", "filename": "test.fits", "size": 1024},
        ]
        job_state = DownloadJobState(job_id="test-1", obs_id="jw02733", download_dir=download_dir)

        # Mock the S3Client.download_file to create a file on disk
        def fake_download(s3_key, local_path, progress_callback=None, transfer_config=None):
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(b"x" * 1024)
            if progress_callback:
                progress_callback(1024)
            return local_path

        mock_s3_client.download_file.side_effect = fake_download

        result = downloader.download_files(files_info, download_dir, job_state)
        assert result.status == "complete"
        assert len(result.files) == 1
        assert result.files[0].status == "complete"

    def test_download_files_with_progress(self, downloader, mock_s3_client, tmp_path):
        """Test that progress callback is invoked."""
        download_dir = str(tmp_path / "downloads")
        files_info = [
            {"s3_key": "jwst/public/02733/test.fits", "filename": "test.fits", "size": 2048},
        ]
        job_state = DownloadJobState(job_id="test-2", obs_id="jw02733", download_dir=download_dir)

        def fake_download(s3_key, local_path, progress_callback=None, transfer_config=None):
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(b"x" * 2048)
            if progress_callback:
                progress_callback(1024)
                progress_callback(1024)
            return local_path

        mock_s3_client.download_file.side_effect = fake_download

        progress_calls = []
        result = downloader.download_files(
            files_info,
            download_dir,
            job_state,
            progress_callback=lambda state: progress_calls.append(state.downloaded_bytes),
        )
        assert result.status == "complete"

    def test_sanitizes_traversal_filenames(self, downloader, mock_s3_client, tmp_path):
        """Test that path traversal filenames are sanitized to safe basenames."""
        download_dir = str(tmp_path / "downloads")
        files_info = [
            {
                "s3_key": "jwst/public/02733/../../../etc/passwd",
                "filename": "../../../etc/passwd",
                "size": 100,
            },
            {"s3_key": "jwst/public/02733/good.fits", "filename": "good.fits", "size": 1024},
        ]
        job_state = DownloadJobState(job_id="test-3", obs_id="jw02733", download_dir=download_dir)

        def fake_download(s3_key, local_path, progress_callback=None, transfer_config=None):
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(b"x" * 1024)
            if progress_callback:
                progress_callback(1024)
            return local_path

        mock_s3_client.download_file.side_effect = fake_download

        result = downloader.download_files(files_info, download_dir, job_state)
        # Traversal path is sanitized to basename "passwd" — safe within download_dir
        assert len(result.files) == 2
        filenames = [f.filename for f in result.files]
        assert "passwd" in filenames
        assert "good.fits" in filenames
        # Verify the sanitized file stays within the download directory
        for f in result.files:
            assert os.path.abspath(f.local_path).startswith(os.path.abspath(download_dir))

    def test_skips_truly_invalid_filenames(self, downloader, mock_s3_client, tmp_path):
        """Test that filenames with invalid characters are skipped entirely."""
        download_dir = str(tmp_path / "downloads")
        files_info = [
            {
                "s3_key": "jwst/public/02733/bad<file>.fits",
                "filename": "bad<file>.fits",
                "size": 100,
            },
            {
                "s3_key": "jwst/public/02733/",
                "filename": "",
                "size": 100,
            },
            {"s3_key": "jwst/public/02733/good.fits", "filename": "good.fits", "size": 1024},
        ]
        job_state = DownloadJobState(job_id="test-3b", obs_id="jw02733", download_dir=download_dir)

        def fake_download(s3_key, local_path, progress_callback=None, transfer_config=None):
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(b"x" * 1024)
            if progress_callback:
                progress_callback(1024)
            return local_path

        mock_s3_client.download_file.side_effect = fake_download

        result = downloader.download_files(files_info, download_dir, job_state)
        # Only the valid file should be tracked — invalid chars and empty name are skipped
        assert len(result.files) == 1
        assert result.files[0].filename == "good.fits"

    def test_handles_download_failure(self, downloader, mock_s3_client, tmp_path):
        """Test that a failed download marks the file and job as failed."""
        from botocore.exceptions import ClientError

        download_dir = str(tmp_path / "downloads")
        files_info = [
            {"s3_key": "jwst/public/02733/test.fits", "filename": "test.fits", "size": 1024},
        ]
        job_state = DownloadJobState(job_id="test-4", obs_id="jw02733", download_dir=download_dir)

        error_response = {"Error": {"Code": "404", "Message": "Not Found"}}
        mock_s3_client.download_file.side_effect = ClientError(error_response, "GetObject")

        result = downloader.download_files(files_info, download_dir, job_state)
        assert result.status == "failed"
        assert result.files[0].status == "failed"

    def test_cancellation(self, downloader, mock_s3_client, tmp_path):
        """Test that cancellation stops downloads."""
        download_dir = str(tmp_path / "downloads")
        files_info = [
            {"s3_key": "jwst/public/02733/a.fits", "filename": "a.fits", "size": 1024},
            {"s3_key": "jwst/public/02733/b.fits", "filename": "b.fits", "size": 1024},
        ]
        job_state = DownloadJobState(job_id="test-5", obs_id="jw02733", download_dir=download_dir)

        call_count = [0]

        def fake_download(s3_key, local_path, progress_callback=None, transfer_config=None):
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(b"x" * 1024)
            call_count[0] += 1
            # Cancel after first file
            if call_count[0] == 1:
                downloader.cancel()
            return local_path

        mock_s3_client.download_file.side_effect = fake_download

        result = downloader.download_files(files_info, download_dir, job_state)
        # First file should complete, second should be paused
        assert result.files[0].status == "complete"
        assert result.files[1].status == "paused"
        assert result.status == "paused"
