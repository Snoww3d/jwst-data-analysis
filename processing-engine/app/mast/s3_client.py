"""
S3 client for accessing the public STScI JWST archive on AWS S3.

The bucket `stpubdata` (region us-east-1) mirrors the full JWST public archive.
No authentication is required -- we use unsigned requests.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable

import boto3
from botocore import UNSIGNED
from botocore.config import Config
from botocore.exceptions import ClientError


logger = logging.getLogger(__name__)

BUCKET_NAME = "stpubdata"
REGION = "us-east-1"

# Type alias for progress callback: (bytes_transferred, total_bytes)
S3ProgressCallback = Callable[[int], None]


def _build_client():
    """Create an anonymous S3 client for the public STScI bucket."""
    return boto3.client(
        "s3",
        region_name=REGION,
        config=Config(signature_version=UNSIGNED),
    )


class S3Client:
    """Wrapper around boto3 for anonymous access to the STScI public S3 bucket."""

    def __init__(self):
        self._client = _build_client()

    def file_exists(self, s3_key: str) -> bool:
        """Check whether a key exists in the bucket.

        Args:
            s3_key: Full S3 object key (e.g. ``jwst/public/2733/jw02733-o001_t001_.../file.fits``).

        Returns:
            True if the object exists, False otherwise.
        """
        try:
            self._client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            return True
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code in ("404", "NoSuchKey"):
                return False
            logger.error("S3 head_object failed for %s: %s", s3_key, exc)
            raise

    def get_file_size(self, s3_key: str) -> int:
        """Return the size in bytes of an S3 object, or 0 if not found.

        Args:
            s3_key: Full S3 object key.

        Returns:
            Size in bytes, or 0 on error / not found.
        """
        try:
            response = self._client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            return int(response.get("ContentLength", 0))
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code in ("404", "NoSuchKey"):
                return 0
            logger.error("S3 get_file_size failed for %s: %s", s3_key, exc)
            return 0

    def download_file(
        self,
        s3_key: str,
        local_path: str,
        progress_callback: S3ProgressCallback | None = None,
        transfer_config: object | None = None,
    ) -> str:
        """Download a file from S3 to a local path.

        Args:
            s3_key: Full S3 object key.
            local_path: Destination path on disk.
            progress_callback: Optional callback invoked with bytes transferred so far.
            transfer_config: Optional boto3 ``TransferConfig`` for multipart settings.

        Returns:
            The local_path on success.

        Raises:
            ClientError: If the download fails.
        """
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        logger.info("S3 download: s3://%s/%s -> %s", BUCKET_NAME, s3_key, local_path)
        kwargs: dict = {
            "Bucket": BUCKET_NAME,
            "Key": s3_key,
            "Filename": local_path,
            "Callback": progress_callback,
        }
        if transfer_config is not None:
            kwargs["Config"] = transfer_config
        self._client.download_file(**kwargs)
        logger.info("S3 download complete: %s", local_path)
        return local_path
