"""
Download state persistence for resume capability.
Stores download job state to JSON files for recovery after interruption.
"""

import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any

from .chunked_downloader import DownloadJobState, FileDownloadProgress


logger = logging.getLogger(__name__)

# Configuration
STATE_RETENTION_DAYS = 7  # Auto-cleanup state files older than this
STATE_DIR_NAME = ".download_state"


class DownloadStateManager:
    """
    Manages persistent state for download jobs to enable resume capability.
    State is stored as JSON files in a hidden directory within the download directory.
    """

    def __init__(self, base_download_dir: str):
        """
        Initialize the state manager.

        Args:
            base_download_dir: Base directory for MAST downloads (e.g., /app/data/mast)
        """
        self.base_download_dir = base_download_dir
        self.state_dir = os.path.join(base_download_dir, STATE_DIR_NAME)
        os.makedirs(self.state_dir, exist_ok=True)

    def _get_state_path(self, job_id: str) -> str:
        """Get the file path for a job's state file."""
        return os.path.join(self.state_dir, f"{job_id}.json")

    def _serialize_datetime(self, dt: datetime | None) -> str | None:
        """Serialize datetime to ISO format string."""
        return dt.isoformat() if dt else None

    def _deserialize_datetime(self, dt_str: str | None) -> datetime | None:
        """Deserialize ISO format string to datetime."""
        if dt_str:
            return datetime.fromisoformat(dt_str)
        return None

    def _file_progress_to_dict(self, fp: FileDownloadProgress) -> dict[str, Any]:
        """Convert FileDownloadProgress to dictionary."""
        return {
            "filename": fp.filename,
            "url": fp.url,
            "local_path": fp.local_path,
            "total_bytes": fp.total_bytes,
            "downloaded_bytes": fp.downloaded_bytes,
            "status": fp.status,
            "error": fp.error,
            "started_at": self._serialize_datetime(fp.started_at),
            "completed_at": self._serialize_datetime(fp.completed_at),
        }

    def _dict_to_file_progress(self, data: dict[str, Any]) -> FileDownloadProgress:
        """Convert dictionary to FileDownloadProgress."""
        fp = FileDownloadProgress(
            filename=data["filename"],
            url=data["url"],
            local_path=data["local_path"],
            total_bytes=data.get("total_bytes", 0),
            downloaded_bytes=data.get("downloaded_bytes", 0),
            status=data.get("status", "pending"),
            error=data.get("error"),
        )
        fp.started_at = self._deserialize_datetime(data.get("started_at"))
        fp.completed_at = self._deserialize_datetime(data.get("completed_at"))
        return fp

    def _job_state_to_dict(self, job_state: DownloadJobState) -> dict[str, Any]:
        """Convert DownloadJobState to dictionary for JSON serialization."""
        return {
            "job_id": job_state.job_id,
            "obs_id": job_state.obs_id,
            "download_dir": job_state.download_dir,
            "files": [self._file_progress_to_dict(f) for f in job_state.files],
            "total_bytes": job_state.total_bytes,
            "downloaded_bytes": job_state.downloaded_bytes,
            "status": job_state.status,
            "started_at": self._serialize_datetime(job_state.started_at),
            "completed_at": self._serialize_datetime(job_state.completed_at),
            "error": job_state.error,
            "saved_at": datetime.utcnow().isoformat(),
        }

    def _dict_to_job_state(self, data: dict[str, Any]) -> DownloadJobState:
        """Convert dictionary to DownloadJobState."""
        job_state = DownloadJobState(
            job_id=data["job_id"],
            obs_id=data["obs_id"],
            download_dir=data.get("download_dir", ""),
            total_bytes=data.get("total_bytes", 0),
            downloaded_bytes=data.get("downloaded_bytes", 0),
            status=data.get("status", "pending"),
            error=data.get("error"),
        )
        job_state.started_at = self._deserialize_datetime(data.get("started_at"))
        job_state.completed_at = self._deserialize_datetime(data.get("completed_at"))
        job_state.files = [self._dict_to_file_progress(f) for f in data.get("files", [])]
        return job_state

    def save_job_state(self, job_state: DownloadJobState) -> bool:
        """
        Save job state to disk.

        Args:
            job_state: The job state to save

        Returns:
            True if saved successfully
        """
        try:
            state_path = self._get_state_path(job_state.job_id)
            state_data = self._job_state_to_dict(job_state)

            # Write atomically using temp file
            temp_path = f"{state_path}.tmp"
            with open(temp_path, "w") as f:
                json.dump(state_data, f, indent=2)

            os.replace(temp_path, state_path)
            logger.debug(f"Saved state for job {job_state.job_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to save state for job {job_state.job_id}: {e}")
            return False

    def load_job_state(self, job_id: str) -> DownloadJobState | None:
        """
        Load job state from disk.

        Args:
            job_id: The job ID to load

        Returns:
            DownloadJobState if found, None otherwise
        """
        try:
            state_path = self._get_state_path(job_id)
            if not os.path.exists(state_path):
                return None

            with open(state_path) as f:
                data = json.load(f)

            job_state = self._dict_to_job_state(data)

            # Verify that partial files exist and update downloaded bytes
            for file_progress in job_state.files:
                if file_progress.status not in ("complete", "failed"):
                    part_path = f"{file_progress.local_path}.part"
                    if os.path.exists(part_path):
                        actual_bytes = os.path.getsize(part_path)
                        file_progress.downloaded_bytes = actual_bytes
                        file_progress.status = "paused"
                    elif os.path.exists(file_progress.local_path):
                        # Full file exists - mark as complete
                        actual_bytes = os.path.getsize(file_progress.local_path)
                        file_progress.downloaded_bytes = actual_bytes
                        file_progress.total_bytes = actual_bytes
                        file_progress.status = "complete"
                    else:
                        # No file exists - reset progress
                        file_progress.downloaded_bytes = 0
                        file_progress.status = "pending"

            # Recalculate total downloaded bytes
            job_state.downloaded_bytes = sum(f.downloaded_bytes for f in job_state.files)

            logger.info(
                f"Loaded state for job {job_id}: {job_state.downloaded_bytes}/{job_state.total_bytes} bytes"
            )
            return job_state

        except Exception as e:
            logger.error(f"Failed to load state for job {job_id}: {e}")
            return None

    def delete_job_state(self, job_id: str) -> bool:
        """
        Delete job state from disk.

        Args:
            job_id: The job ID to delete

        Returns:
            True if deleted successfully
        """
        try:
            state_path = self._get_state_path(job_id)
            if os.path.exists(state_path):
                os.remove(state_path)
                logger.debug(f"Deleted state for job {job_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete state for job {job_id}: {e}")
            return False

    def get_resumable_jobs(self) -> list[dict[str, Any]]:
        """
        Get list of jobs that can be resumed.

        Returns:
            List of job summaries with id, obs_id, progress, etc.
        """
        resumable = []

        try:
            for filename in os.listdir(self.state_dir):
                if not filename.endswith(".json"):
                    continue

                job_id = filename[:-5]  # Remove .json
                job_state = self.load_job_state(job_id)

                if job_state and job_state.status in ("paused", "failed", "downloading"):
                    # Check if any files are resumable
                    has_resumable = any(
                        f.status in ("pending", "paused", "downloading") for f in job_state.files
                    )

                    if has_resumable:
                        resumable.append(
                            {
                                "job_id": job_state.job_id,
                                "obs_id": job_state.obs_id,
                                "total_bytes": job_state.total_bytes,
                                "downloaded_bytes": job_state.downloaded_bytes,
                                "progress_percent": job_state.progress_percent,
                                "status": job_state.status,
                                "total_files": len(job_state.files),
                                "completed_files": sum(
                                    1 for f in job_state.files if f.status == "complete"
                                ),
                                "started_at": self._serialize_datetime(job_state.started_at),
                            }
                        )

        except Exception as e:
            logger.error(f"Failed to list resumable jobs: {e}")

        # Deduplicate by obs_id: keep the job with most progress
        best_by_obs: dict[str, dict[str, Any]] = {}
        stale_job_ids: list[str] = []

        for job in resumable:
            obs_id = job["obs_id"]
            if obs_id in best_by_obs:
                existing = best_by_obs[obs_id]
                if job["downloaded_bytes"] > existing["downloaded_bytes"]:
                    stale_job_ids.append(existing["job_id"])
                    best_by_obs[obs_id] = job
                else:
                    stale_job_ids.append(job["job_id"])
            else:
                best_by_obs[obs_id] = job

        # Clean up stale duplicate state files
        for stale_id in stale_job_ids:
            self.delete_job_state(stale_id)
            logger.info(f"Removed duplicate state file for job {stale_id}")

        return list(best_by_obs.values())

    def cleanup_completed(self, max_age_days: int = STATE_RETENTION_DAYS) -> int:
        """
        Remove state files for completed or cancelled jobs older than max_age_days.

        Args:
            max_age_days: Maximum age in days for completed/cancelled job states

        Returns:
            Number of state files removed
        """
        removed = 0
        cutoff = datetime.utcnow() - timedelta(days=max_age_days)

        # Statuses that should be cleaned up after retention period
        cleanup_statuses = {"complete", "cancelled", "failed"}

        try:
            for filename in os.listdir(self.state_dir):
                if not filename.endswith(".json"):
                    continue

                state_path = os.path.join(self.state_dir, filename)

                try:
                    with open(state_path) as f:
                        data = json.load(f)

                    status = data.get("status", "")
                    saved_at = data.get("saved_at") or data.get("completed_at")

                    if status in cleanup_statuses and saved_at:
                        saved_dt = datetime.fromisoformat(saved_at)
                        if saved_dt < cutoff:
                            os.remove(state_path)
                            removed += 1
                            logger.debug(
                                f"Cleaned up old state file: {filename} (status: {status})"
                            )

                except Exception as e:
                    logger.warning(f"Failed to process state file {filename}: {e}")

        except Exception as e:
            logger.error(f"Failed to cleanup state files: {e}")

        if removed > 0:
            logger.info(f"Cleaned up {removed} old state file(s)")

        return removed

    def cleanup_orphaned_partial_files(self) -> int:
        """
        Remove orphaned .part files that don't have corresponding state files.

        Returns:
            Number of files removed
        """
        removed = 0

        try:
            # Get all job IDs from state files
            state_job_ids = set()
            for filename in os.listdir(self.state_dir):
                if filename.endswith(".json"):
                    state_job_ids.add(filename[:-5])

            # Walk through download directories
            for obs_dir in os.listdir(self.base_download_dir):
                if obs_dir == STATE_DIR_NAME:
                    continue

                obs_path = os.path.join(self.base_download_dir, obs_dir)
                if not os.path.isdir(obs_path):
                    continue

                for filename in os.listdir(obs_path):
                    if filename.endswith(".part"):
                        file_path = os.path.join(obs_path, filename)

                        # Check if file is very old (more than retention period)
                        mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
                        cutoff = datetime.utcnow() - timedelta(days=STATE_RETENTION_DAYS)

                        if mtime < cutoff:
                            os.remove(file_path)
                            removed += 1
                            logger.debug(f"Removed orphaned partial file: {file_path}")

        except Exception as e:
            logger.error(f"Failed to cleanup orphaned partial files: {e}")

        if removed > 0:
            logger.info(f"Removed {removed} orphaned partial file(s)")

        return removed
