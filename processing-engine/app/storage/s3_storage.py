"""
S3-compatible object storage provider.

Works with AWS S3, SeaweedFS, and other S3-compatible services.
Downloads files to a local LRU temp cache for astropy to open.
"""

import logging
import os
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from .provider import StorageProvider
from .temp_cache import TempFileCache


logger = logging.getLogger(__name__)

# AWS S3 key limit is 1024 bytes; we use char-count as a conservative proxy.
_MAX_KEY_LENGTH = 1024


def _validate_s3_key(key: str) -> None:
    """Reject S3 keys that could escape the local cache path or break clients.

    The validation is a security boundary (rejects path-traversal artefacts
    that would otherwise reach `TempFileCache` and write outside its dir)
    plus a basic well-formedness check. (#1258)
    """
    if not isinstance(key, str) or not key:
        raise ValueError("S3 key must be a non-empty string")
    if "\x00" in key:
        raise ValueError("S3 key contains null byte")
    if len(key) > _MAX_KEY_LENGTH:
        raise ValueError(f"S3 key exceeds {_MAX_KEY_LENGTH}-byte limit")
    # The cache derives a filesystem path from the key; `..` segments could
    # escape the cache directory once the key is path-joined.
    if ".." in key.split("/"):
        raise ValueError("S3 key contains parent-directory traversal segment")


class S3Storage(StorageProvider):
    """S3-compatible storage implementation of StorageProvider."""

    def __init__(
        self,
        bucket_name: str | None = None,
        endpoint: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
        force_path_style: bool = True,
        region: str = "us-east-1",
        public_endpoint: str | None = None,
    ):
        self._bucket = bucket_name or os.environ.get("S3_BUCKET_NAME", "jwst-data")
        self._endpoint = endpoint or os.environ.get("S3_ENDPOINT")
        self._public_endpoint = public_endpoint or os.environ.get("S3_PUBLIC_ENDPOINT")
        access = access_key or os.environ.get("S3_ACCESS_KEY")
        secret = secret_key or os.environ.get("S3_SECRET_KEY")
        force_ps = (
            force_path_style or os.environ.get("S3_FORCE_PATH_STYLE", "true").lower() == "true"
        )

        config = Config(s3={"addressing_style": "path"} if force_ps else {})

        client_kwargs: dict = {
            "service_name": "s3",
            "config": config,
            "region_name": region,
        }
        if self._endpoint:
            client_kwargs["endpoint_url"] = self._endpoint
        if access and secret:
            client_kwargs["aws_access_key_id"] = access
            client_kwargs["aws_secret_access_key"] = secret

        self._client = boto3.client(**client_kwargs)
        self._cache = TempFileCache()

        logger.info(
            "Initialized S3 storage provider (bucket=%s, endpoint=%s)",
            self._bucket,
            self._endpoint or "default AWS",
        )

    def read_to_temp(self, key: str) -> Path:
        """Download from S3 to local temp cache if not already cached."""
        _validate_s3_key(key)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        local_path = self._cache.put(key)
        try:
            self._client.download_file(self._bucket, key, str(local_path))
            logger.debug("Downloaded s3://%s/%s -> %s", self._bucket, key, local_path)
        except ClientError as e:
            # Clean up partial download
            if local_path.exists():
                local_path.unlink()
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code in ("404", "NoSuchKey"):
                raise FileNotFoundError(f"File not found in S3: {key}") from e
            raise

        self._cache.evict_if_needed()
        return local_path

    def write_from_path(self, key: str, local_path: Path) -> None:
        """Upload a local file to S3."""
        _validate_s3_key(key)
        self._client.upload_file(str(local_path), self._bucket, key)
        logger.debug("Uploaded %s -> s3://%s/%s", local_path, self._bucket, key)

    def write_from_bytes(self, key: str, data: bytes) -> None:
        """Write raw bytes to S3."""
        _validate_s3_key(key)
        self._client.put_object(Bucket=self._bucket, Key=key, Body=data)

    def exists(self, key: str) -> bool:
        """Check whether a key exists in S3."""
        _validate_s3_key(key)
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey"):
                return False
            raise

    def delete(self, key: str) -> None:
        """Delete an object from S3."""
        _validate_s3_key(key)
        self._client.delete_object(Bucket=self._bucket, Key=key)

    def presigned_url(self, key: str, expiry: int = 900) -> str | None:
        """Generate a presigned download URL."""
        _validate_s3_key(key)
        url = self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expiry,
        )
        # Rewrite internal Docker hostname to public endpoint if configured
        if self._public_endpoint and self._endpoint and url:
            url = url.replace(self._endpoint, self._public_endpoint)
        return url

    def resolve_local_path(self, key: str) -> Path:
        """Not supported for S3 storage."""
        raise NotImplementedError(
            "S3 storage does not support local filesystem paths. "
            "Use read_to_temp() to get a local copy."
        )
