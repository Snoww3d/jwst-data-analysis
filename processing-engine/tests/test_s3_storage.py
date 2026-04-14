"""Unit tests for S3 storage provider and temp file cache."""

import logging
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from app.storage.s3_storage import S3Storage
from app.storage.temp_cache import TempFileCache


class TestTempFileCache:
    def test_get_miss(self, tmp_path):
        cache = TempFileCache(cache_dir=tmp_path / "cache", max_bytes=1024)
        assert cache.get("missing/key.fits") is None

    def test_put_and_get(self, tmp_path):
        cache = TempFileCache(cache_dir=tmp_path / "cache", max_bytes=1024)
        local_path = cache.put("mast/obs/file.fits")
        local_path.write_bytes(b"fits data")
        result = cache.get("mast/obs/file.fits")
        assert result is not None
        assert result.read_bytes() == b"fits data"

    def test_eviction(self, tmp_path):
        cache = TempFileCache(cache_dir=tmp_path / "cache", max_bytes=100)

        # Fill cache with 3 files of 50 bytes each (150 > 100 budget)
        for i in range(3):
            path = cache.put(f"file{i}.fits")
            path.write_bytes(b"x" * 50)

        within_budget = cache.evict_if_needed()
        assert within_budget is True

        # Total size should be within budget
        total = sum(f.stat().st_size for f in cache.cache_dir.rglob("*") if f.is_file())
        assert total <= 100

    def test_eviction_returns_true_when_within_budget(self, tmp_path):
        cache = TempFileCache(cache_dir=tmp_path / "cache", max_bytes=1024)
        path = cache.put("small.fits")
        path.write_bytes(b"x" * 50)
        assert cache.evict_if_needed() is True

    def test_eviction_logs_warning_on_delete_failure(self, tmp_path, caplog):
        cache = TempFileCache(cache_dir=tmp_path / "cache", max_bytes=50)

        # Create 3 files of 50 bytes each (150 total, budget 50)
        # All 3 must be attempted — the first will fail, so the loop
        # continues to try the remaining files.
        for i in range(3):
            path = cache.put(f"file{i}.fits")
            path.write_bytes(b"x" * 50)

        original_unlink = Path.unlink
        attempted = []

        def failing_unlink(self_path, *args, **kwargs):
            """Fail to delete the first attempted file, succeed on the rest."""
            attempted.append(str(self_path))
            if len(attempted) == 1:
                raise OSError("Permission denied")
            original_unlink(self_path, *args, **kwargs)

        with (
            patch.object(Path, "unlink", failing_unlink),
            caplog.at_level(logging.WARNING, logger="app.storage.temp_cache"),
        ):
            cache.evict_if_needed()

        assert any("Failed to delete cached file" in msg for msg in caplog.messages)

    def test_eviction_incomplete_when_all_deletes_fail(self, tmp_path, caplog):
        cache = TempFileCache(cache_dir=tmp_path / "cache", max_bytes=100)

        # Create files totaling 150 bytes (over 100 budget)
        for i in range(3):
            path = cache.put(f"file{i}.fits")
            path.write_bytes(b"x" * 50)

        def always_fail(self_path, *args, **kwargs):
            raise OSError("Permission denied")

        with (
            patch.object(Path, "unlink", always_fail),
            caplog.at_level(logging.WARNING, logger="app.storage.temp_cache"),
        ):
            result = cache.evict_if_needed()

        assert result is False
        assert any("eviction incomplete" in msg.lower() for msg in caplog.messages)

    def test_eviction_partial_delete_still_succeeds(self, tmp_path):
        """If enough files are deleted to get within budget, return True even if some fail."""
        cache = TempFileCache(cache_dir=tmp_path / "cache", max_bytes=100)

        # Create 3 files of 40 bytes = 120 total, budget 100, need to free 20+
        for i in range(3):
            path = cache.put(f"file{i}.fits")
            path.write_bytes(b"x" * 40)

        original_unlink = Path.unlink
        call_count = 0

        def fail_first_unlink(self_path, *args, **kwargs):
            """Fail on the first attempt, succeed on subsequent ones."""
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise OSError("Permission denied")
            original_unlink(self_path, *args, **kwargs)

        with patch.object(Path, "unlink", fail_first_unlink):
            result = cache.evict_if_needed()

        # One file failed, but deleting one of the remaining two frees 40 bytes
        # which brings 120 - 40 = 80, within 100 budget
        assert result is True

    def test_preserves_key_structure(self, tmp_path):
        cache = TempFileCache(cache_dir=tmp_path / "cache", max_bytes=1024)
        local_path = cache.put("mast/obs123/file.fits")
        assert "mast" in str(local_path)
        assert "obs123" in str(local_path)


class TestS3Storage:
    @pytest.fixture
    def mock_boto3(self):
        with patch("app.storage.s3_storage.boto3") as mock:
            mock_client = MagicMock()
            mock.client.return_value = mock_client
            yield mock_client

    @pytest.fixture
    def s3_storage(self, mock_boto3, tmp_path):  # noqa: ARG002 — mock_boto3 patches boto3 globally
        storage = S3Storage(
            bucket_name="test-bucket",
            endpoint="http://localhost:8333",
            access_key="test",
            secret_key="test",
        )
        # Replace cache with a test-scoped one
        storage._cache = TempFileCache(cache_dir=tmp_path / "cache", max_bytes=1024)
        return storage

    def test_exists_true(self, s3_storage, mock_boto3):
        mock_boto3.head_object.return_value = {}
        assert s3_storage.exists("mast/obs/file.fits") is True
        mock_boto3.head_object.assert_called_once_with(
            Bucket="test-bucket", Key="mast/obs/file.fits"
        )

    def test_exists_false(self, s3_storage, mock_boto3):
        error = ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
        mock_boto3.head_object.side_effect = error
        assert s3_storage.exists("missing.fits") is False

    def test_write_from_bytes(self, s3_storage, mock_boto3):
        s3_storage.write_from_bytes("test/key.fits", b"data")
        mock_boto3.put_object.assert_called_once_with(
            Bucket="test-bucket", Key="test/key.fits", Body=b"data"
        )

    def test_write_from_path(self, s3_storage, mock_boto3, tmp_path):
        source = tmp_path / "local.fits"
        source.write_bytes(b"local data")
        s3_storage.write_from_path("s3/key.fits", source)
        mock_boto3.upload_file.assert_called_once_with(str(source), "test-bucket", "s3/key.fits")

    def test_delete(self, s3_storage, mock_boto3):
        s3_storage.delete("mast/obs/file.fits")
        mock_boto3.delete_object.assert_called_once_with(
            Bucket="test-bucket", Key="mast/obs/file.fits"
        )

    def test_presigned_url(self, s3_storage, mock_boto3):
        mock_boto3.generate_presigned_url.return_value = (
            "http://localhost:8333/test-bucket/key?sig=abc"
        )
        url = s3_storage.presigned_url("key", expiry=300)
        assert url is not None
        assert "key" in url
        mock_boto3.generate_presigned_url.assert_called_once()

    def test_resolve_local_path_raises(self, s3_storage):
        with pytest.raises(NotImplementedError):
            s3_storage.resolve_local_path("any/key.fits")

    def test_read_to_temp_downloads(self, s3_storage, mock_boto3):
        # Simulate download by writing to the path
        def fake_download(bucket, key, path):
            Path(path).write_bytes(b"downloaded")

        mock_boto3.download_file.side_effect = fake_download
        result = s3_storage.read_to_temp("mast/obs/file.fits")
        assert result.exists()
        assert result.read_bytes() == b"downloaded"

    def test_read_to_temp_cache_hit(self, s3_storage, mock_boto3):
        # Pre-populate cache
        cache_path = s3_storage._cache.put("cached/file.fits")
        cache_path.write_bytes(b"cached data")

        result = s3_storage.read_to_temp("cached/file.fits")
        assert result.read_bytes() == b"cached data"
        # Should not have called download
        mock_boto3.download_file.assert_not_called()

    def test_read_to_temp_not_found(self, s3_storage, mock_boto3):
        error = ClientError(
            {"Error": {"Code": "NoSuchKey", "Message": "Not Found"}},
            "GetObject",
        )
        mock_boto3.download_file.side_effect = error
        with pytest.raises(FileNotFoundError):
            s3_storage.read_to_temp("missing.fits")


class TestS3StorageFactory:
    def test_factory_creates_s3(self):
        import app.storage.factory as factory_module

        factory_module._instance = None
        with (
            patch.dict(
                os.environ,
                {
                    "STORAGE_PROVIDER": "s3",
                    "S3_BUCKET_NAME": "test",
                    "S3_ENDPOINT": "http://localhost:8333",
                    "S3_ACCESS_KEY": "test",
                    "S3_SECRET_KEY": "test",
                },
            ),
            patch("app.storage.s3_storage.boto3"),
        ):
            provider = factory_module.get_storage_provider()
            assert isinstance(provider, S3Storage)
        # Reset singleton
        factory_module._instance = None
