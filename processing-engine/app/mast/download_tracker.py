"""
Download job tracking for MAST file downloads.
Tracks progress of background download operations.
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
            "is_complete": self.stage in (DownloadStage.COMPLETE, DownloadStage.FAILED)
        }


class DownloadTracker:
    """Tracks download job progress in memory."""

    def __init__(self):
        self._jobs: Dict[str, DownloadProgress] = {}
        self._lock = asyncio.Lock()

    def create_job(self, obs_id: str) -> str:
        """Create a new download job and return its ID."""
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

    def update_file_progress(self, job_id: str, filename: str, downloaded: int):
        """Update progress for current file being downloaded."""
        if job := self._jobs.get(job_id):
            job.current_file = filename
            job.downloaded_files = downloaded
            if job.total_files > 0:
                job.progress = int((downloaded / job.total_files) * 100)
            job.message = f"Downloading file {downloaded}/{job.total_files}: {filename}"

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
            logger.info(f"Job {job_id} completed: {len(job.files)} files")

    def fail_job(self, job_id: str, error: str):
        """Mark job as failed."""
        if job := self._jobs.get(job_id):
            job.stage = DownloadStage.FAILED
            job.error = error
            job.message = f"Failed: {error}"
            job.completed_at = datetime.utcnow()
            logger.error(f"Job {job_id} failed: {error}")

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
