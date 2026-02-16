"""
S3 download engine with progress tracking for JWST FITS files.

Uses boto3 TransferConfig for multipart downloads and integrates with the
existing DownloadJobState / progress tracking pattern from chunked_downloader.
"""

from __future__ import annotations

import logging
import os
import re
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

from boto3.s3.transfer import TransferConfig
from botocore.exceptions import ClientError

from .chunked_downloader import DownloadJobState, FileDownloadProgress
from .s3_client import BUCKET_NAME, S3Client


logger = logging.getLogger(__name__)

# Security: Valid filename pattern for FITS files (reuse from chunked_downloader)
SAFE_FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9_\-.]+$")

# Transfer configuration for multipart downloads
S3_TRANSFER_CONFIG = TransferConfig(
    multipart_chunksize=8 * 1024 * 1024,  # 8 MB chunks
    max_concurrency=4,
    use_threads=True,
)

# Progress callback type matching chunked_downloader
ProgressCallback = Callable[[DownloadJobState], None]


def _sanitize_filename(filename: str) -> str | None:
    """Sanitize a filename to prevent path traversal."""
    if not filename:
        return None
    sanitized = os.path.basename(filename.replace("\\", "/"))
    sanitized = sanitized.replace("..", "").replace("\x00", "")
    sanitized = sanitized.strip()
    if not sanitized:
        return None
    if not SAFE_FILENAME_PATTERN.match(sanitized):
        logger.warning("Filename contains invalid characters: %s", sanitized[:50])
        return None
    return sanitized


def _is_path_within_directory(filepath: str, directory: str) -> bool:
    """Check if a filepath is within the specified directory."""
    abs_filepath = os.path.abspath(filepath)
    abs_directory = os.path.abspath(directory)
    if not abs_directory.endswith(os.sep):
        abs_directory += os.sep
    return abs_filepath.startswith(abs_directory) or abs_filepath == abs_directory.rstrip(os.sep)


class S3Downloader:
    """Downloads FITS files from the STScI public S3 bucket with progress tracking."""

    def __init__(self):
        self._client = S3Client()
        self._cancelled = False

    def cancel(self):
        """Signal cancellation of ongoing downloads."""
        self._cancelled = True
        logger.info("S3 downloads cancelled")

    def download_files(
        self,
        files_info: list[dict[str, Any]],
        download_dir: str,
        job_state: DownloadJobState,
        progress_callback: ProgressCallback | None = None,
    ) -> DownloadJobState:
        """Download multiple files from S3 with progress tracking.

        Args:
            files_info: List of dicts with ``s3_key``, ``filename``, and optionally ``size``.
            download_dir: Local directory to save files.
            job_state: DownloadJobState to update.
            progress_callback: Optional callback for progress updates.

        Returns:
            Updated DownloadJobState.
        """
        self._cancelled = False
        job_state.status = "downloading"
        job_state.started_at = datetime.utcnow()
        job_state.download_dir = download_dir
        os.makedirs(download_dir, exist_ok=True)

        # Initialize file progress entries
        skipped = 0
        for info in files_info:
            raw_filename = info.get("filename", "")
            filename = _sanitize_filename(raw_filename)
            if filename is None:
                logger.warning("Skipping invalid filename: %s", raw_filename[:100])
                skipped += 1
                continue

            local_path = os.path.join(download_dir, filename)
            if not _is_path_within_directory(local_path, download_dir):
                logger.warning("Path traversal blocked: %s", local_path[:100])
                skipped += 1
                continue

            existing = next((f for f in job_state.files if f.filename == filename), None)
            if not existing:
                fp = FileDownloadProgress(
                    filename=filename,
                    url=info.get("s3_key", ""),  # store s3_key in url field
                    local_path=local_path,
                    total_bytes=info.get("size", 0),
                )
                job_state.files.append(fp)

        if skipped:
            logger.warning("Skipped %d files with invalid filenames", skipped)

        # Get sizes for files where we don't know yet
        for fp in job_state.files:
            if fp.total_bytes == 0 and fp.status == "pending":
                fp.total_bytes = self._client.get_file_size(fp.url)

        job_state.total_bytes = sum(f.total_bytes for f in job_state.files)

        if progress_callback:
            progress_callback(job_state)

        # Track last progress report time for throttling
        last_report = [time.time()]

        # Download each file sequentially (boto3 handles multipart internally)
        for fp in job_state.files:
            if self._cancelled:
                fp.status = "paused"
                continue

            if fp.status in ("complete", "failed"):
                continue

            fp.status = "downloading"
            fp.started_at = datetime.utcnow()

            # Check if file already fully downloaded
            if os.path.exists(fp.local_path):
                existing_size = os.path.getsize(fp.local_path)
                if existing_size >= fp.total_bytes > 0:
                    fp.downloaded_bytes = existing_size
                    fp.status = "complete"
                    fp.completed_at = datetime.utcnow()
                    job_state.downloaded_bytes = sum(f.downloaded_bytes for f in job_state.files)
                    if progress_callback:
                        progress_callback(job_state)
                    continue

            try:
                # Progress callback wrapper for boto3
                def make_boto_callback(file_progress: FileDownloadProgress):
                    def callback(bytes_amount: int):
                        file_progress.downloaded_bytes += bytes_amount
                        job_state.downloaded_bytes = sum(
                            f.downloaded_bytes for f in job_state.files
                        )
                        now = time.time()
                        if progress_callback and now - last_report[0] >= 0.1:
                            last_report[0] = now
                            progress_callback(job_state)

                    return callback

                self._client._client.download_file(
                    Bucket=BUCKET_NAME,
                    Key=fp.url,
                    Filename=fp.local_path,
                    Config=S3_TRANSFER_CONFIG,
                    Callback=make_boto_callback(fp),
                )

                fp.status = "complete"
                fp.completed_at = datetime.utcnow()
                logger.info("S3 downloaded: %s (%d bytes)", fp.filename, fp.downloaded_bytes)

            except ClientError as exc:
                fp.status = "failed"
                fp.error = str(exc)
                logger.error("S3 download failed for %s: %s", fp.filename, exc)

            except Exception as exc:
                fp.status = "failed"
                fp.error = str(exc)
                logger.error("Unexpected error downloading %s: %s", fp.filename, exc)

        # Final state update
        job_state.downloaded_bytes = sum(f.downloaded_bytes for f in job_state.files)

        failed = [f for f in job_state.files if f.status == "failed"]
        paused = [f for f in job_state.files if f.status == "paused"]
        complete = [f for f in job_state.files if f.status == "complete"]

        if failed:
            job_state.status = "failed"
            job_state.error = f"{len(failed)} file(s) failed to download"
        elif paused:
            job_state.status = "paused"
        elif len(complete) == len(job_state.files):
            job_state.status = "complete"
            job_state.completed_at = datetime.utcnow()

        if progress_callback:
            progress_callback(job_state)

        return job_state
