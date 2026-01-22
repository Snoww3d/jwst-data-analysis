"""
Download job tracking for MAST file downloads.
Tracks progress of background download operations with byte-level granularity.
"""

import uuid
import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class DownloadStage(str, Enum):
    QUEUED = "queued"
    FETCHING_PRODUCTS = "fetching_products"
    DOWNLOADING = "downloading"
    COMPLETE = "complete"
    FAILED = "failed"
    PAUSED = "paused"


@dataclass
class FileProgress:
    """Progress tracking for a single file."""
    filename: str
    total_bytes: int = 0
    downloaded_bytes: int = 0
    status: str = "pending"  # pending, downloading, complete, failed, paused

    @property
    def progress_percent(self) -> float:
        if self.total_bytes == 0:
            return 0.0
        return (self.downloaded_bytes / self.total_bytes) * 100

    def to_dict(self) -> Dict:
        return {
            "filename": self.filename,
            "total_bytes": self.total_bytes,
            "downloaded_bytes": self.downloaded_bytes,
            "progress_percent": round(self.progress_percent, 1),
            "status": self.status
        }


@dataclass
class DownloadProgress:
    job_id: str
    obs_id: str
    stage: DownloadStage = DownloadStage.QUEUED
    message: str = "Queued for download"
    progress: int = 0  # 0-100
    total_files: int = 0
    downloaded_files: int = 0
    current_file: Optional[str] = None
    files: List[str] = field(default_factory=list)
    error: Optional[str] = None
    started_at: datetime = field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    download_dir: Optional[str] = None
    # Byte-level progress fields
    total_bytes: int = 0
    downloaded_bytes: int = 0
    speed_bytes_per_sec: float = 0.0
    eta_seconds: Optional[float] = None
    file_progress: List[FileProgress] = field(default_factory=list)
    is_resumable: bool = False

    @property
    def download_progress_percent(self) -> float:
        """Calculate actual byte-level progress percentage."""
        if self.total_bytes == 0:
            return 0.0
        return (self.downloaded_bytes / self.total_bytes) * 100

    def to_dict(self) -> Dict:
        return {
            "job_id": self.job_id,
            "obs_id": self.obs_id,
            "stage": self.stage.value,
            "message": self.message,
            "progress": self.progress,
            "total_files": self.total_files,
            "downloaded_files": self.downloaded_files,
            "current_file": self.current_file,
            "files": self.files,
            "error": self.error,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "download_dir": self.download_dir,
            "is_complete": self.stage in (DownloadStage.COMPLETE, DownloadStage.FAILED),
            # Byte-level progress
            "total_bytes": self.total_bytes,
            "downloaded_bytes": self.downloaded_bytes,
            "download_progress_percent": round(self.download_progress_percent, 1),
            "speed_bytes_per_sec": round(self.speed_bytes_per_sec, 0),
            "eta_seconds": round(self.eta_seconds, 0) if self.eta_seconds is not None else None,
            "file_progress": [fp.to_dict() for fp in self.file_progress],
            "is_resumable": self.is_resumable
        }


class DownloadTracker:
    """Tracks download job progress in memory with byte-level granularity."""

    def __init__(self):
        self._jobs: Dict[str, DownloadProgress] = {}
        self._lock = asyncio.Lock()

    def create_job(self, obs_id: str, job_id: Optional[str] = None) -> str:
        """Create a new download job and return its ID."""
        if job_id is None:
            job_id = uuid.uuid4().hex[:12]
        self._jobs[job_id] = DownloadProgress(
            job_id=job_id,
            obs_id=obs_id
        )
        logger.info(f"Created download job {job_id} for observation {obs_id}")
        self._cleanup_old_jobs()
        return job_id

    def get_job(self, job_id: str) -> Optional[DownloadProgress]:
        """Get job progress by ID."""
        return self._jobs.get(job_id)

    def update_stage(self, job_id: str, stage: DownloadStage, message: str):
        """Update job stage."""
        if job := self._jobs.get(job_id):
            job.stage = stage
            job.message = message
            logger.debug(f"Job {job_id}: {stage.value} - {message}")

    def set_total_files(self, job_id: str, total: int):
        """Set total number of files to download."""
        if job := self._jobs.get(job_id):
            job.total_files = total

    def set_total_bytes(self, job_id: str, total_bytes: int):
        """Set total bytes to download."""
        if job := self._jobs.get(job_id):
            job.total_bytes = total_bytes

    def update_file_progress(self, job_id: str, filename: str, downloaded: int):
        """Update progress for current file being downloaded."""
        if job := self._jobs.get(job_id):
            job.current_file = filename
            job.downloaded_files = downloaded
            if job.total_files > 0:
                job.progress = int((downloaded / job.total_files) * 100)
            job.message = f"Downloading file {downloaded}/{job.total_files}: {filename}"

    def update_byte_progress(
        self,
        job_id: str,
        downloaded_bytes: int,
        speed_bytes_per_sec: float = 0.0,
        eta_seconds: Optional[float] = None,
        current_file: Optional[str] = None
    ):
        """Update byte-level progress."""
        if job := self._jobs.get(job_id):
            job.downloaded_bytes = downloaded_bytes
            job.speed_bytes_per_sec = speed_bytes_per_sec
            job.eta_seconds = eta_seconds
            if current_file:
                job.current_file = current_file
            # Update percentage-based progress from bytes
            if job.total_bytes > 0:
                job.progress = int((downloaded_bytes / job.total_bytes) * 100)

    def set_file_progress_list(self, job_id: str, file_progress_list: List[FileProgress]):
        """Set the detailed file progress list."""
        if job := self._jobs.get(job_id):
            job.file_progress = file_progress_list
            # Update summary counts
            job.downloaded_files = sum(1 for fp in file_progress_list if fp.status == "complete")

    def update_single_file_progress(
        self,
        job_id: str,
        filename: str,
        downloaded_bytes: int,
        total_bytes: int,
        status: str = "downloading"
    ):
        """Update progress for a specific file in the list."""
        if job := self._jobs.get(job_id):
            for fp in job.file_progress:
                if fp.filename == filename:
                    fp.downloaded_bytes = downloaded_bytes
                    fp.total_bytes = total_bytes
                    fp.status = status
                    break
            else:
                # File not found, add it
                job.file_progress.append(FileProgress(
                    filename=filename,
                    total_bytes=total_bytes,
                    downloaded_bytes=downloaded_bytes,
                    status=status
                ))

    def set_resumable(self, job_id: str, is_resumable: bool):
        """Mark job as resumable."""
        if job := self._jobs.get(job_id):
            job.is_resumable = is_resumable

    def add_completed_file(self, job_id: str, filepath: str):
        """Add a completed file to the job."""
        if job := self._jobs.get(job_id):
            job.files.append(filepath)

    def complete_job(self, job_id: str, download_dir: str):
        """Mark job as complete."""
        if job := self._jobs.get(job_id):
            job.stage = DownloadStage.COMPLETE
            job.progress = 100
            job.message = f"Downloaded {len(job.files)} files"
            job.completed_at = datetime.utcnow()
            job.download_dir = download_dir
            job.current_file = None
            job.speed_bytes_per_sec = 0.0
            job.eta_seconds = None
            job.is_resumable = False
            logger.info(f"Job {job_id} completed: {len(job.files)} files")

    def fail_job(self, job_id: str, error: str, is_resumable: bool = False):
        """Mark job as failed."""
        if job := self._jobs.get(job_id):
            job.stage = DownloadStage.FAILED
            job.error = error
            job.message = f"Failed: {error}"
            job.completed_at = datetime.utcnow()
            job.is_resumable = is_resumable
            logger.error(f"Job {job_id} failed: {error}")

    def pause_job(self, job_id: str):
        """Mark job as paused."""
        if job := self._jobs.get(job_id):
            job.stage = DownloadStage.PAUSED
            job.message = "Download paused"
            job.is_resumable = True
            job.speed_bytes_per_sec = 0.0
            job.eta_seconds = None
            logger.info(f"Job {job_id} paused")

    def _cleanup_old_jobs(self):
        """Remove completed jobs older than 30 minutes."""
        from datetime import timedelta
        cutoff = datetime.utcnow() - timedelta(minutes=30)
        old_jobs = [
            job_id for job_id, job in self._jobs.items()
            if job.completed_at and job.completed_at < cutoff
        ]
        for job_id in old_jobs:
            del self._jobs[job_id]
            logger.debug(f"Cleaned up old job {job_id}")


# Global instance
download_tracker = DownloadTracker()
