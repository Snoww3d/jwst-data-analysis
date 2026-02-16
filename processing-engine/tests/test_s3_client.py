"""Unit tests for the S3 client wrapper."""

from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from app.mast.s3_client import BUCKET_NAME, S3Client


@pytest.fixture
def mock_boto_client():
    """Create a mock boto3 S3 client."""
    with patch("app.mast.s3_client._build_client") as mock_build:
        mock_client = MagicMock()
        mock_build.return_value = mock_client
        yield mock_client


@pytest.fixture
def s3_client(mock_boto_client):
    """Create an S3Client instance with a mocked boto3 client."""
    return S3Client()


class TestFileExists:
    def test_returns_true_when_object_exists(self, s3_client, mock_boto_client):
        mock_boto_client.head_object.return_value = {"ContentLength": 1024}
        assert s3_client.file_exists("jwst/public/02733/test.fits") is True
        mock_boto_client.head_object.assert_called_once_with(
            Bucket=BUCKET_NAME, Key="jwst/public/02733/test.fits"
        )

    def test_returns_false_when_object_not_found(self, s3_client, mock_boto_client):
        error_response = {"Error": {"Code": "404", "Message": "Not Found"}}
        mock_boto_client.head_object.side_effect = ClientError(error_response, "HeadObject")
        assert s3_client.file_exists("jwst/public/02733/missing.fits") is False

    def test_returns_false_for_no_such_key(self, s3_client, mock_boto_client):
        error_response = {
            "Error": {"Code": "NoSuchKey", "Message": "The specified key does not exist."}
        }
        mock_boto_client.head_object.side_effect = ClientError(error_response, "HeadObject")
        assert s3_client.file_exists("jwst/public/02733/missing.fits") is False

    def test_raises_on_other_client_errors(self, s3_client, mock_boto_client):
        error_response = {"Error": {"Code": "403", "Message": "Forbidden"}}
        mock_boto_client.head_object.side_effect = ClientError(error_response, "HeadObject")
        with pytest.raises(ClientError):
            s3_client.file_exists("jwst/public/02733/test.fits")


class TestGetFileSize:
    def test_returns_content_length(self, s3_client, mock_boto_client):
        mock_boto_client.head_object.return_value = {"ContentLength": 52428800}
        size = s3_client.get_file_size("jwst/public/02733/test.fits")
        assert size == 52428800

    def test_returns_zero_when_not_found(self, s3_client, mock_boto_client):
        error_response = {"Error": {"Code": "404", "Message": "Not Found"}}
        mock_boto_client.head_object.side_effect = ClientError(error_response, "HeadObject")
        assert s3_client.get_file_size("jwst/public/02733/missing.fits") == 0

    def test_returns_zero_on_error(self, s3_client, mock_boto_client):
        error_response = {"Error": {"Code": "500", "Message": "Internal Error"}}
        mock_boto_client.head_object.side_effect = ClientError(error_response, "HeadObject")
        assert s3_client.get_file_size("jwst/public/02733/test.fits") == 0


class TestDownloadFile:
    def test_downloads_file_successfully(self, s3_client, mock_boto_client, tmp_path):
        local_path = str(tmp_path / "subdir" / "test.fits")
        result = s3_client.download_file("jwst/public/02733/test.fits", local_path)

        assert result == local_path
        mock_boto_client.download_file.assert_called_once_with(
            Bucket=BUCKET_NAME,
            Key="jwst/public/02733/test.fits",
            Filename=local_path,
            ExtraArgs={},
            Callback=None,
        )

    def test_downloads_with_progress_callback(self, s3_client, mock_boto_client, tmp_path):
        local_path = str(tmp_path / "test.fits")
        callback = MagicMock()
        s3_client.download_file(
            "jwst/public/02733/test.fits", local_path, progress_callback=callback
        )

        mock_boto_client.download_file.assert_called_once()
        call_kwargs = mock_boto_client.download_file.call_args
        assert call_kwargs.kwargs["Callback"] == callback

    def test_creates_parent_directories(self, s3_client, mock_boto_client, tmp_path):  # noqa: ARG002
        local_path = str(tmp_path / "deep" / "nested" / "dir" / "test.fits")
        s3_client.download_file("jwst/public/02733/test.fits", local_path)
        # Parent directory should have been created
        import os

        assert os.path.isdir(str(tmp_path / "deep" / "nested" / "dir"))

    def test_raises_on_download_error(self, s3_client, mock_boto_client, tmp_path):
        local_path = str(tmp_path / "test.fits")
        error_response = {"Error": {"Code": "404", "Message": "Not Found"}}
        mock_boto_client.download_file.side_effect = ClientError(error_response, "GetObject")
        with pytest.raises(ClientError):
            s3_client.download_file("jwst/public/02733/missing.fits", local_path)
