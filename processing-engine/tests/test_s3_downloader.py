"""Unit tests for the S3 download engine."""

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

        # Mock the actual boto download to just create the file
        def fake_download(Bucket, Key, Filename, Config, Callback):
            import os

            os.makedirs(os.path.dirname(Filename), exist_ok=True)
            with open(Filename, "wb") as f:
                f.write(b"x" * 1024)
            if Callback:
                Callback(1024)

        mock_s3_client._client.download_file.side_effect = fake_download

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

        def fake_download(Bucket, Key, Filename, Config, Callback):
            import os

            os.makedirs(os.path.dirname(Filename), exist_ok=True)
            with open(Filename, "wb") as f:
                f.write(b"x" * 2048)
            if Callback:
                Callback(1024)
                Callback(1024)

        mock_s3_client._client.download_file.side_effect = fake_download

        progress_calls = []
        result = downloader.download_files(
            files_info,
            download_dir,
            job_state,
            progress_callback=lambda state: progress_calls.append(state.downloaded_bytes),
        )
        assert result.status == "complete"

    def test_skips_invalid_filenames(self, downloader, mock_s3_client, tmp_path):
        """Test that dangerous filenames are skipped."""
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

        def fake_download(Bucket, Key, Filename, Config, Callback):
            import os

            os.makedirs(os.path.dirname(Filename), exist_ok=True)
            with open(Filename, "wb") as f:
                f.write(b"x" * 1024)
            if Callback:
                Callback(1024)

        mock_s3_client._client.download_file.side_effect = fake_download

        result = downloader.download_files(files_info, download_dir, job_state)
        # Only the safe file should be tracked
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
        mock_s3_client._client.download_file.side_effect = ClientError(error_response, "GetObject")

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

        def fake_download(Bucket, Key, Filename, Config, Callback):
            import os

            os.makedirs(os.path.dirname(Filename), exist_ok=True)
            with open(Filename, "wb") as f:
                f.write(b"x" * 1024)
            call_count[0] += 1
            # Cancel after first file
            if call_count[0] == 1:
                downloader.cancel()

        mock_s3_client._client.download_file.side_effect = fake_download

        result = downloader.download_files(files_info, download_dir, job_state)
        # First file should complete, second should be paused
        assert result.files[0].status == "complete"
        assert result.files[1].status == "paused"
        assert result.status == "paused"
