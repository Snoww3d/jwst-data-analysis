"""Unit tests for the storage abstraction layer."""

import os
from pathlib import Path
from unittest.mock import patch

import pytest

import app.storage.factory as factory_module
from app.storage.factory import get_storage_provider
from app.storage.local_storage import LocalStorage


@pytest.fixture
def tmp_storage(tmp_path):
    """Create a LocalStorage instance backed by a temp directory."""
    return LocalStorage(base_path=str(tmp_path))


class TestLocalStorage:
    def test_write_from_bytes_and_read(self, tmp_storage, tmp_path):
        tmp_storage.write_from_bytes("test/hello.txt", b"hello world")
        assert (tmp_path / "test" / "hello.txt").read_bytes() == b"hello world"

    def test_write_from_path(self, tmp_storage, tmp_path):
        source = tmp_path / "source.dat"
        source.write_bytes(b"source data")
        tmp_storage.write_from_path("dest/file.dat", source)
        assert (tmp_path / "dest" / "file.dat").read_bytes() == b"source data"

    def test_write_from_path_same_location(self, tmp_storage, tmp_path):
        """Writing from the same path as the target should be a no-op."""
        target = tmp_path / "same.dat"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"original")
        tmp_storage.write_from_path("same.dat", target)
        assert target.read_bytes() == b"original"

    def test_exists(self, tmp_storage, tmp_path):
        assert not tmp_storage.exists("missing.txt")
        (tmp_path / "present.txt").write_bytes(b"data")
        assert tmp_storage.exists("present.txt")

    def test_delete(self, tmp_storage, tmp_path):
        (tmp_path / "delete_me.txt").write_bytes(b"bye")
        assert tmp_storage.exists("delete_me.txt")
        tmp_storage.delete("delete_me.txt")
        assert not tmp_storage.exists("delete_me.txt")

    def test_delete_nonexistent(self, tmp_storage):
        """Deleting a non-existent file should not raise."""
        tmp_storage.delete("nope.txt")

    def test_read_to_temp(self, tmp_storage, tmp_path):
        (tmp_path / "data.fits").write_bytes(b"fits-data")
        result = tmp_storage.read_to_temp("data.fits")
        assert isinstance(result, Path)
        assert result == tmp_path / "data.fits"

    def test_resolve_local_path(self, tmp_storage, tmp_path):
        path = tmp_storage.resolve_local_path("mast/obs/file.fits")
        assert path == tmp_path / "mast" / "obs" / "file.fits"

    def test_presigned_url_returns_none(self, tmp_storage):
        assert tmp_storage.presigned_url("any/key.fits") is None

    def test_creates_parent_directories(self, tmp_storage, tmp_path):
        tmp_storage.write_from_bytes("a/b/c/d/deep.txt", b"deep")
        assert (tmp_path / "a" / "b" / "c" / "d" / "deep.txt").exists()

    def test_path_traversal_blocked(self, tmp_storage):
        with pytest.raises(ValueError, match="Invalid storage key"):
            tmp_storage.resolve_local_path("../../etc/passwd")

    def test_path_traversal_write_blocked(self, tmp_storage):
        with pytest.raises(ValueError, match="Invalid storage key"):
            tmp_storage.write_from_bytes("../escape.txt", b"bad")

    def test_path_traversal_read_blocked(self, tmp_storage):
        with pytest.raises(ValueError, match="Invalid storage key"):
            tmp_storage.read_to_temp("../../etc/shadow")


class TestStorageFactory:
    def setup_method(self):
        """Reset the singleton between tests."""
        factory_module._instance = None
        factory_module._lock = __import__("threading").Lock()

    def test_default_returns_local(self):
        provider = get_storage_provider()
        assert isinstance(provider, LocalStorage)

    def test_singleton(self):
        p1 = get_storage_provider()
        p2 = get_storage_provider()
        assert p1 is p2

    def test_unknown_provider_raises(self):
        factory_module._instance = None
        with (
            patch.dict(os.environ, {"STORAGE_PROVIDER": "azure"}),
            pytest.raises(ValueError, match="Unknown storage provider"),
        ):
            get_storage_provider()

    def test_custom_base_path(self, tmp_path):
        factory_module._instance = None
        with patch.dict(
            os.environ,
            {
                "STORAGE_PROVIDER": "local",
                "STORAGE_BASE_PATH": str(tmp_path),
            },
        ):
            provider = get_storage_provider()
            assert isinstance(provider, LocalStorage)
            path = provider.resolve_local_path("test.fits")
            assert str(path).startswith(str(tmp_path))
