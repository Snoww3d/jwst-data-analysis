"""
Chunked file downloader with HTTP Range support for large MAST FITS files.
Supports parallel downloads, progress reporting, and resume capability.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import aiofiles
import aiohttp


logger = logging.getLogger(__name__)

# Security: Valid filename pattern for FITS files
# Allows alphanumeric, underscores, hyphens, dots - no path separators or special chars
SAFE_FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9_\-.]+$")

# Configuration
CHUNK_SIZE = 5 * 1024 * 1024  # 5MB chunks
MAX_CONCURRENT_FILES = 3  # Parallel file downloads
MAX_RETRIES = 3  # Retry failed chunks
RETRY_BASE_DELAY = 1.0  # Exponential backoff base (seconds)
CONNECTION_TIMEOUT = 30  # Connection timeout in seconds
READ_TIMEOUT = 300  # Read timeout in seconds (5 minutes for large chunks)


@dataclass
class FileDownloadProgress:
    """Progress info for a single file download."""

    filename: str
    url: str
    local_path: str
    total_bytes: int = 0
    downloaded_bytes: int = 0
    status: str = "pending"  # pending, downloading, complete, failed, paused
    error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None

    @property
    def progress_percent(self) -> float:
        if self.total_bytes == 0:
            return 0.0
        return (self.downloaded_bytes / self.total_bytes) * 100


@dataclass
class DownloadJobState:
    """State of an entire download job for persistence."""

    job_id: str
    obs_id: str
    download_dir: str
    files: list[FileDownloadProgress] = field(default_factory=list)
    total_bytes: int = 0
    downloaded_bytes: int = 0
    status: str = "pending"  # pending, downloading, complete, failed, paused
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None

    @property
    def progress_percent(self) -> float:
        if self.total_bytes == 0:
            return 0.0
        return (self.downloaded_bytes / self.total_bytes) * 100


# Progress callback type
ProgressCallback = Callable[[DownloadJobState], None]


def _sanitize_filename(filename: str) -> str | None:
    """
    Sanitize a filename to prevent path traversal attacks.

    Security: Removes path separators and validates against safe pattern.

    Args:
        filename: The filename to sanitize

    Returns:
        Sanitized filename, or None if the filename is invalid/dangerous
    """
    if not filename:
        return None

    # Remove any path components - take only the basename
    # This handles both Unix (/) and Windows (\) separators
    sanitized = os.path.basename(filename.replace("\\", "/"))

    # Remove any remaining dangerous sequences
    sanitized = sanitized.replace("..", "").replace("\x00", "")

    # Strip whitespace
    sanitized = sanitized.strip()

    if not sanitized:
        return None

    # Validate against safe pattern
    if not SAFE_FILENAME_PATTERN.match(sanitized):
        logger.warning(f"Filename contains invalid characters after sanitization: {sanitized[:50]}")
        return None

    return sanitized


def _is_path_within_directory(filepath: str, directory: str) -> bool:
    """
    Check if a filepath is within the specified directory.

    Security: Defense-in-depth check to prevent path traversal.

    Args:
        filepath: The path to check
        directory: The directory that should contain the filepath

    Returns:
        True if filepath is within directory, False otherwise
    """
    # Resolve to absolute paths to handle any relative path tricks
    abs_filepath = os.path.abspath(filepath)
    abs_directory = os.path.abspath(directory)

    # Ensure directory path ends with separator for proper prefix matching
    if not abs_directory.endswith(os.sep):
        abs_directory += os.sep

    # Check if the filepath starts with the directory path
    return abs_filepath.startswith(abs_directory) or abs_filepath == abs_directory.rstrip(os.sep)


class ChunkedDownloader:
    """
    Downloads files in chunks with parallel file downloads,
    progress reporting, and resume capability.
    """

    def __init__(
        self,
        chunk_size: int = CHUNK_SIZE,
        max_concurrent_files: int = MAX_CONCURRENT_FILES,
        max_retries: int = MAX_RETRIES,
        retry_base_delay: float = RETRY_BASE_DELAY,
    ):
        self.chunk_size = chunk_size
        self.max_concurrent_files = max_concurrent_files
        self.max_retries = max_retries
        self.retry_base_delay = retry_base_delay
        self._session: aiohttp.ClientSession | None = None
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # Not paused by default
        self._cancelled = False

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create an aiohttp session with connection pooling."""
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(connect=CONNECTION_TIMEOUT, sock_read=READ_TIMEOUT)
            connector = aiohttp.TCPConnector(
                limit=self.max_concurrent_files * 2,
                limit_per_host=self.max_concurrent_files,
                enable_cleanup_closed=True,
            )
            self._session = aiohttp.ClientSession(timeout=timeout, connector=connector)
        return self._session

    async def close(self):
        """Close the HTTP session."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    def pause(self):
        """Pause all downloads."""
        self._pause_event.clear()
        logger.info("Downloads paused")

    def resume(self):
        """Resume paused downloads."""
        self._pause_event.set()
        logger.info("Downloads resumed")

    def cancel(self):
        """Cancel all downloads."""
        self._cancelled = True
        self.resume()  # Unblock any paused operations
        logger.info("Downloads cancelled")

    async def _wait_if_paused(self):
        """Wait if downloads are paused."""
        await self._pause_event.wait()
        if self._cancelled:
            raise asyncio.CancelledError("Download cancelled")

    async def get_file_size(self, url: str) -> int:
        """Get file size from HTTP HEAD request."""
        session = await self._get_session()
        try:
            async with session.head(url, allow_redirects=True) as response:
                if response.status == 200:
                    return int(response.headers.get("Content-Length", 0))
                elif response.status == 405:  # Method not allowed, try GET with Range
                    async with session.get(
                        url, headers={"Range": "bytes=0-0"}, allow_redirects=True
                    ) as range_resp:
                        content_range = range_resp.headers.get("Content-Range", "")
                        if "/" in content_range:
                            return int(content_range.split("/")[-1])
                return 0
        except Exception as e:
            logger.warning(f"Failed to get file size for {url}: {e}")
            return 0

    async def download_file_chunked(
        self,
        url: str,
        local_path: str,
        file_progress: FileDownloadProgress,
        on_progress: Callable[[int, int], None] | None = None,
    ) -> bool:
        """
        Download a single file in chunks with resume capability.

        Args:
            url: URL to download from
            local_path: Local file path to save to
            file_progress: FileDownloadProgress object to update
            on_progress: Optional callback(downloaded_bytes, total_bytes)

        Returns:
            True if download completed successfully
        """
        session = await self._get_session()
        part_path = f"{local_path}.part"

        # Ensure directory exists
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        # Check for existing partial download
        start_byte = 0
        if os.path.exists(part_path):
            start_byte = os.path.getsize(part_path)
            file_progress.downloaded_bytes = start_byte
            logger.info(f"Resuming download from byte {start_byte}: {file_progress.filename}")

        file_progress.status = "downloading"
        file_progress.started_at = datetime.utcnow()

        try:
            # Get total size if not known
            if file_progress.total_bytes == 0:
                file_progress.total_bytes = await self.get_file_size(url)

            total_bytes = file_progress.total_bytes

            # If file already complete, just rename
            if start_byte >= total_bytes > 0:
                if os.path.exists(part_path):
                    os.rename(part_path, local_path)
                file_progress.status = "complete"
                file_progress.completed_at = datetime.utcnow()
                return True

            # Download in chunks
            retry_count = 0
            while file_progress.downloaded_bytes < total_bytes or total_bytes == 0:
                await self._wait_if_paused()

                headers = {}
                if start_byte > 0 or file_progress.downloaded_bytes > 0:
                    current_byte = max(start_byte, file_progress.downloaded_bytes)
                    headers["Range"] = f"bytes={current_byte}-"

                try:
                    async with session.get(url, headers=headers, allow_redirects=True) as response:
                        if response.status == 416:  # Range not satisfiable - file complete
                            break

                        if response.status not in (200, 206):
                            raise aiohttp.ClientError(f"HTTP {response.status}: {response.reason}")

                        # Update total bytes from response if available
                        if total_bytes == 0:
                            content_length = response.headers.get("Content-Length")
                            if content_length:
                                total_bytes = int(content_length)
                                file_progress.total_bytes = total_bytes

                        # Open file for appending
                        mode = "ab" if os.path.exists(part_path) else "wb"
                        async with aiofiles.open(part_path, mode) as f:
                            async for chunk in response.content.iter_chunked(self.chunk_size):
                                await self._wait_if_paused()

                                await f.write(chunk)
                                file_progress.downloaded_bytes += len(chunk)

                                if on_progress:
                                    on_progress(file_progress.downloaded_bytes, total_bytes)

                        # If we got here without chunked transfer and no content-length,
                        # the download is complete
                        if total_bytes == 0:
                            total_bytes = file_progress.downloaded_bytes
                            file_progress.total_bytes = total_bytes

                        retry_count = 0  # Reset retry count on success

                except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                    retry_count += 1
                    if retry_count > self.max_retries:
                        raise

                    delay = self.retry_base_delay * (2 ** (retry_count - 1))
                    logger.warning(
                        f"Download error (retry {retry_count}/{self.max_retries}): {e}. "
                        f"Waiting {delay}s before retry..."
                    )
                    await asyncio.sleep(delay)
                    continue

                # Check if complete
                if file_progress.downloaded_bytes >= total_bytes > 0:
                    break

            # Download complete - rename part file to final
            if os.path.exists(part_path):
                os.rename(part_path, local_path)

            file_progress.status = "complete"
            file_progress.completed_at = datetime.utcnow()
            logger.info(
                f"Downloaded: {file_progress.filename} ({file_progress.downloaded_bytes} bytes)"
            )
            return True

        except asyncio.CancelledError:
            file_progress.status = "paused"
            logger.info(f"Download paused/cancelled: {file_progress.filename}")
            return False

        except Exception as e:
            file_progress.status = "failed"
            file_progress.error = str(e)
            logger.error(f"Download failed for {file_progress.filename}: {e}")
            return False

    async def download_files(
        self,
        files_info: list[dict[str, Any]],
        download_dir: str,
        job_state: DownloadJobState,
        progress_callback: ProgressCallback | None = None,
    ) -> DownloadJobState:
        """
        Download multiple files in parallel with progress tracking.

        Args:
            files_info: List of dicts with 'url' and 'filename' keys
            download_dir: Directory to save files
            job_state: DownloadJobState to track progress
            progress_callback: Optional callback for progress updates

        Returns:
            Updated DownloadJobState
        """
        self._cancelled = False
        self._pause_event.set()

        job_state.status = "downloading"
        job_state.started_at = datetime.utcnow()
        job_state.download_dir = download_dir

        # Initialize file progress for each file
        skipped_files = 0
        for file_info in files_info:
            url = file_info.get("url", "")
            raw_filename = file_info.get("filename", os.path.basename(url))

            # Security: Sanitize filename to prevent path traversal
            filename = _sanitize_filename(raw_filename)
            if filename is None:
                logger.warning(
                    f"Path traversal attempt blocked - invalid filename: {raw_filename[:100]}"
                )
                skipped_files += 1
                continue

            local_path = os.path.join(download_dir, filename)

            # Security: Defense-in-depth - verify path is within download directory
            if not _is_path_within_directory(local_path, download_dir):
                logger.warning(
                    f"Path traversal attempt blocked - path outside download dir: {local_path[:100]}"
                )
                skipped_files += 1
                continue

            # Check if already tracked
            existing = next((f for f in job_state.files if f.filename == filename), None)
            if not existing:
                file_progress = FileDownloadProgress(
                    filename=filename,
                    url=url,
                    local_path=local_path,
                    total_bytes=file_info.get("size", 0),
                )
                job_state.files.append(file_progress)

        if skipped_files > 0:
            logger.warning(f"Skipped {skipped_files} files with invalid filenames")

        # Calculate total bytes (if sizes are known)
        job_state.total_bytes = sum(f.total_bytes for f in job_state.files)

        # Get file sizes for files where we don't know the size
        size_tasks = []
        for file_progress in job_state.files:
            if file_progress.total_bytes == 0 and file_progress.status == "pending":
                size_tasks.append(self._update_file_size(file_progress))

        if size_tasks:
            await asyncio.gather(*size_tasks)
            job_state.total_bytes = sum(f.total_bytes for f in job_state.files)

        if progress_callback:
            progress_callback(job_state)

        # Create semaphore for limiting concurrent downloads
        semaphore = asyncio.Semaphore(self.max_concurrent_files)

        # Track speed calculations
        speed_tracker = SpeedTracker()

        async def download_with_semaphore(file_progress: FileDownloadProgress):
            async with semaphore:
                if file_progress.status in ("complete", "failed"):
                    return

                def on_file_progress(downloaded: int, total: int):
                    # Update job state
                    job_state.downloaded_bytes = sum(f.downloaded_bytes for f in job_state.files)
                    speed_tracker.add_sample(downloaded)
                    if progress_callback:
                        progress_callback(job_state)

                await self.download_file_chunked(
                    url=file_progress.url,
                    local_path=file_progress.local_path,
                    file_progress=file_progress,
                    on_progress=on_file_progress,
                )

        # Download all files
        try:
            tasks = [
                download_with_semaphore(fp) for fp in job_state.files if fp.status == "pending"
            ]
            await asyncio.gather(*tasks, return_exceptions=True)
        except asyncio.CancelledError:
            job_state.status = "paused"
            logger.info(f"Download job {job_state.job_id} paused")

        # Update final state
        job_state.downloaded_bytes = sum(f.downloaded_bytes for f in job_state.files)

        failed_files = [f for f in job_state.files if f.status == "failed"]
        paused_files = [f for f in job_state.files if f.status == "paused"]
        complete_files = [f for f in job_state.files if f.status == "complete"]

        if failed_files:
            job_state.status = "failed"
            job_state.error = f"{len(failed_files)} file(s) failed to download"
        elif paused_files:
            job_state.status = "paused"
        elif len(complete_files) == len(job_state.files):
            job_state.status = "complete"
            job_state.completed_at = datetime.utcnow()

        if progress_callback:
            progress_callback(job_state)

        await self.close()
        return job_state

    async def _update_file_size(self, file_progress: FileDownloadProgress):
        """Update file size from URL."""
        size = await self.get_file_size(file_progress.url)
        file_progress.total_bytes = size


class SpeedTracker:
    """Tracks download speed using a sliding window."""

    def __init__(self, window_size: float = 5.0):
        self.window_size = window_size
        self.samples: list[tuple] = []  # (timestamp, bytes)
        self._last_bytes = 0

    def add_sample(self, total_bytes: int):
        """Add a new sample."""
        now = time.time()
        bytes_delta = total_bytes - self._last_bytes
        self._last_bytes = total_bytes

        self.samples.append((now, bytes_delta))

        # Remove old samples
        cutoff = now - self.window_size
        self.samples = [(t, b) for t, b in self.samples if t > cutoff]

    def get_speed(self) -> float:
        """Get current speed in bytes per second."""
        if len(self.samples) < 2:
            return 0.0

        total_bytes = sum(b for _, b in self.samples)
        time_span = self.samples[-1][0] - self.samples[0][0]

        if time_span <= 0:
            return 0.0

        return total_bytes / time_span

    def get_eta(self, remaining_bytes: int) -> float | None:
        """Get estimated time remaining in seconds."""
        speed = self.get_speed()
        if speed <= 0:
            return None
        return remaining_bytes / speed


def calculate_speed_and_eta(
    job_state: DownloadJobState, speed_tracker: SpeedTracker
) -> tuple[float, float | None]:
    """Calculate current speed and ETA for a download job."""
    speed = speed_tracker.get_speed()
    remaining = job_state.total_bytes - job_state.downloaded_bytes
    eta = speed_tracker.get_eta(remaining) if remaining > 0 else 0.0
    return speed, eta
