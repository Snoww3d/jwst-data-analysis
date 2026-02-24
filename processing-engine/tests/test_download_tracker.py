# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for the download tracker module.

Covers DownloadStage enum, FileProgress dataclass, DownloadProgress dataclass,
and DownloadTracker class with all methods including cleanup logic.
"""

from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from app.mast.download_tracker import (
    DownloadProgress,
    DownloadStage,
    DownloadTracker,
    FileProgress,
)


JOB_ID = "test-job-001"
OBS_ID = "jw02733-o001"


@pytest.fixture()
def tracker() -> DownloadTracker:
    """Return a fresh DownloadTracker instance for each test."""
    return DownloadTracker()


@pytest.fixture()
def tracker_with_job(tracker: DownloadTracker) -> tuple[DownloadTracker, str]:
    """Return a tracker that already has one job created."""
    job_id = tracker.create_job(OBS_ID, job_id=JOB_ID)
    return tracker, job_id


# ──────────────────────────────────────────────
# DownloadStage enum
# ──────────────────────────────────────────────


class TestDownloadStage:
    """Tests for the DownloadStage string enum."""

    def test_all_stages_have_string_values(self):
        expected = {
            "queued",
            "fetching_products",
            "downloading",
            "complete",
            "failed",
            "paused",
        }
        assert {s.value for s in DownloadStage} == expected

    def test_stage_is_str_subclass(self):
        assert isinstance(DownloadStage.QUEUED, str)
        assert DownloadStage.DOWNLOADING == "downloading"


# ──────────────────────────────────────────────
# FileProgress dataclass
# ──────────────────────────────────────────────


class TestFileProgress:
    """Tests for FileProgress dataclass and its properties."""

    def test_defaults(self):
        fp = FileProgress(filename="image.fits")
        assert fp.filename == "image.fits"
        assert fp.total_bytes == 0
        assert fp.downloaded_bytes == 0
        assert fp.status == "pending"

    def test_progress_percent_zero_total_bytes(self):
        """progress_percent returns 0.0 when total_bytes is zero (no division error)."""
        fp = FileProgress(filename="a.fits", total_bytes=0, downloaded_bytes=0)
        assert fp.progress_percent == 0.0

    def test_progress_percent_normal(self):
        fp = FileProgress(filename="a.fits", total_bytes=200, downloaded_bytes=100)
        assert fp.progress_percent == 50.0

    def test_progress_percent_complete(self):
        fp = FileProgress(filename="a.fits", total_bytes=500, downloaded_bytes=500)
        assert fp.progress_percent == 100.0

    def test_progress_percent_partial_fraction(self):
        fp = FileProgress(filename="a.fits", total_bytes=300, downloaded_bytes=100)
        assert abs(fp.progress_percent - 33.333333) < 0.001

    def test_to_dict_serialization(self):
        fp = FileProgress(
            filename="spec.fits",
            total_bytes=1000,
            downloaded_bytes=750,
            status="downloading",
        )
        d = fp.to_dict()
        assert d["filename"] == "spec.fits"
        assert d["total_bytes"] == 1000
        assert d["downloaded_bytes"] == 750
        assert d["status"] == "downloading"
        assert d["progress_percent"] == 75.0

    def test_to_dict_rounds_progress(self):
        fp = FileProgress(filename="a.fits", total_bytes=3, downloaded_bytes=1)
        d = fp.to_dict()
        # 33.333... rounded to 1 decimal place
        assert d["progress_percent"] == 33.3


# ──────────────────────────────────────────────
# DownloadProgress dataclass
# ──────────────────────────────────────────────


class TestDownloadProgress:
    """Tests for DownloadProgress dataclass and its properties."""

    def test_defaults(self):
        dp = DownloadProgress(job_id="j1", obs_id="o1")
        assert dp.stage == DownloadStage.QUEUED
        assert dp.message == "Queued for download"
        assert dp.progress == 0
        assert dp.total_files == 0
        assert dp.downloaded_files == 0
        assert dp.current_file is None
        assert dp.files == []
        assert dp.error is None
        assert dp.completed_at is None
        assert dp.download_dir is None
        assert dp.total_bytes == 0
        assert dp.downloaded_bytes == 0
        assert dp.speed_bytes_per_sec == 0.0
        assert dp.eta_seconds is None
        assert dp.file_progress == []
        assert dp.is_resumable is False

    def test_download_progress_percent_zero_total(self):
        dp = DownloadProgress(job_id="j1", obs_id="o1", total_bytes=0)
        assert dp.download_progress_percent == 0.0

    def test_download_progress_percent_normal(self):
        dp = DownloadProgress(
            job_id="j1",
            obs_id="o1",
            total_bytes=2000,
            downloaded_bytes=500,
        )
        assert dp.download_progress_percent == 25.0

    def test_download_progress_percent_complete(self):
        dp = DownloadProgress(
            job_id="j1",
            obs_id="o1",
            total_bytes=1000,
            downloaded_bytes=1000,
        )
        assert dp.download_progress_percent == 100.0

    def test_to_dict_all_fields(self):
        now = datetime(2026, 2, 24, 12, 0, 0)
        completed = datetime(2026, 2, 24, 12, 5, 0)
        fp = FileProgress(
            filename="a.fits", total_bytes=100, downloaded_bytes=50, status="downloading"
        )
        dp = DownloadProgress(
            job_id="j1",
            obs_id="o1",
            stage=DownloadStage.DOWNLOADING,
            message="Downloading...",
            progress=50,
            total_files=2,
            downloaded_files=1,
            current_file="a.fits",
            files=["b.fits"],
            error=None,
            started_at=now,
            completed_at=completed,
            download_dir="/data/downloads",
            total_bytes=2000,
            downloaded_bytes=1000,
            speed_bytes_per_sec=500.7,
            eta_seconds=2.3,
            file_progress=[fp],
            is_resumable=True,
        )
        d = dp.to_dict()

        assert d["job_id"] == "j1"
        assert d["obs_id"] == "o1"
        assert d["stage"] == "downloading"
        assert d["message"] == "Downloading..."
        assert d["progress"] == 50
        assert d["total_files"] == 2
        assert d["downloaded_files"] == 1
        assert d["current_file"] == "a.fits"
        assert d["files"] == ["b.fits"]
        assert d["error"] is None
        assert d["started_at"] == now.isoformat()
        assert d["completed_at"] == completed.isoformat()
        assert d["download_dir"] == "/data/downloads"
        assert d["total_bytes"] == 2000
        assert d["downloaded_bytes"] == 1000
        assert d["download_progress_percent"] == 50.0
        assert d["speed_bytes_per_sec"] == 501.0  # rounded
        assert d["eta_seconds"] == 2.0  # rounded
        assert len(d["file_progress"]) == 1
        assert d["file_progress"][0]["filename"] == "a.fits"
        assert d["is_resumable"] is True

    def test_to_dict_completed_at_none(self):
        dp = DownloadProgress(job_id="j1", obs_id="o1")
        d = dp.to_dict()
        assert d["completed_at"] is None

    def test_to_dict_eta_seconds_none(self):
        dp = DownloadProgress(job_id="j1", obs_id="o1", eta_seconds=None)
        d = dp.to_dict()
        assert d["eta_seconds"] is None

    def test_is_complete_for_complete_stage(self):
        dp = DownloadProgress(job_id="j1", obs_id="o1", stage=DownloadStage.COMPLETE)
        d = dp.to_dict()
        assert d["is_complete"] is True

    def test_is_complete_for_failed_stage(self):
        dp = DownloadProgress(job_id="j1", obs_id="o1", stage=DownloadStage.FAILED)
        d = dp.to_dict()
        assert d["is_complete"] is True

    def test_is_complete_false_for_in_progress_stages(self):
        for stage in (
            DownloadStage.QUEUED,
            DownloadStage.DOWNLOADING,
            DownloadStage.FETCHING_PRODUCTS,
            DownloadStage.PAUSED,
        ):
            dp = DownloadProgress(job_id="j1", obs_id="o1", stage=stage)
            d = dp.to_dict()
            assert d["is_complete"] is False, f"Expected is_complete=False for {stage}"

    def test_to_dict_download_progress_percent_rounded(self):
        dp = DownloadProgress(
            job_id="j1",
            obs_id="o1",
            total_bytes=3,
            downloaded_bytes=1,
        )
        d = dp.to_dict()
        assert d["download_progress_percent"] == 33.3


# ──────────────────────────────────────────────
# DownloadTracker class
# ──────────────────────────────────────────────


class TestDownloadTrackerCreateJob:
    """Tests for DownloadTracker.create_job."""

    def test_create_job_with_custom_id(self, tracker: DownloadTracker):
        job_id = tracker.create_job(OBS_ID, job_id="custom-id-123")
        assert job_id == "custom-id-123"
        job = tracker.get_job("custom-id-123")
        assert job is not None
        assert job.obs_id == OBS_ID
        assert job.stage == DownloadStage.QUEUED

    def test_create_job_generates_id(self, tracker: DownloadTracker):
        job_id = tracker.create_job(OBS_ID)
        assert isinstance(job_id, str)
        assert len(job_id) == 12  # uuid4().hex[:12]
        assert tracker.get_job(job_id) is not None

    def test_create_job_multiple(self, tracker: DownloadTracker):
        id1 = tracker.create_job("obs-a")
        id2 = tracker.create_job("obs-b")
        assert id1 != id2
        assert tracker.get_job(id1).obs_id == "obs-a"
        assert tracker.get_job(id2).obs_id == "obs-b"


class TestDownloadTrackerGetJob:
    """Tests for DownloadTracker.get_job."""

    def test_get_existing_job(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        job = tracker.get_job(job_id)
        assert job is not None
        assert job.job_id == JOB_ID

    def test_get_missing_job_returns_none(self, tracker: DownloadTracker):
        assert tracker.get_job("nonexistent") is None


class TestDownloadTrackerUpdateStage:
    """Tests for DownloadTracker.update_stage."""

    def test_update_stage_existing_job(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.update_stage(job_id, DownloadStage.DOWNLOADING, "Starting download")
        job = tracker.get_job(job_id)
        assert job.stage == DownloadStage.DOWNLOADING
        assert job.message == "Starting download"

    def test_update_stage_missing_job_no_error(self, tracker: DownloadTracker):
        """Updating stage for a nonexistent job should silently do nothing."""
        tracker.update_stage("nonexistent", DownloadStage.FAILED, "err")
        # No exception raised


class TestDownloadTrackerSetTotalFiles:
    """Tests for DownloadTracker.set_total_files."""

    def test_set_total_files(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.set_total_files(job_id, 5)
        assert tracker.get_job(job_id).total_files == 5

    def test_set_total_files_missing_job(self, tracker: DownloadTracker):
        tracker.set_total_files("nonexistent", 10)
        # No exception


class TestDownloadTrackerSetTotalBytes:
    """Tests for DownloadTracker.set_total_bytes."""

    def test_set_total_bytes(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.set_total_bytes(job_id, 50000)
        assert tracker.get_job(job_id).total_bytes == 50000

    def test_set_total_bytes_missing_job(self, tracker: DownloadTracker):
        tracker.set_total_bytes("nonexistent", 1000)


class TestDownloadTrackerUpdateFileProgress:
    """Tests for DownloadTracker.update_file_progress."""

    def test_update_file_progress_sets_fields(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.set_total_files(job_id, 4)
        tracker.update_file_progress(job_id, "img_001.fits", 2)

        job = tracker.get_job(job_id)
        assert job.current_file == "img_001.fits"
        assert job.downloaded_files == 2
        assert job.progress == 50  # 2/4 * 100
        assert "2/4" in job.message
        assert "img_001.fits" in job.message

    def test_update_file_progress_zero_total(self, tracker_with_job):
        """When total_files is 0, progress should stay at 0 (no division)."""
        tracker, job_id = tracker_with_job
        tracker.update_file_progress(job_id, "file.fits", 0)
        job = tracker.get_job(job_id)
        assert job.progress == 0

    def test_update_file_progress_missing_job(self, tracker: DownloadTracker):
        tracker.update_file_progress("nonexistent", "f.fits", 1)


class TestDownloadTrackerUpdateByteProgress:
    """Tests for DownloadTracker.update_byte_progress."""

    def test_update_byte_progress_all_fields(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.set_total_bytes(job_id, 10000)
        tracker.update_byte_progress(
            job_id,
            downloaded_bytes=5000,
            speed_bytes_per_sec=1000.0,
            eta_seconds=5.0,
            current_file="data.fits",
        )

        job = tracker.get_job(job_id)
        assert job.downloaded_bytes == 5000
        assert job.speed_bytes_per_sec == 1000.0
        assert job.eta_seconds == 5.0
        assert job.current_file == "data.fits"
        assert job.progress == 50  # 5000/10000 * 100

    def test_update_byte_progress_without_current_file(self, tracker_with_job):
        """current_file should not be overwritten when not provided."""
        tracker, job_id = tracker_with_job
        tracker.update_stage(job_id, DownloadStage.DOWNLOADING, "go")
        tracker.update_file_progress(job_id, "existing.fits", 0)
        tracker.set_total_bytes(job_id, 1000)

        tracker.update_byte_progress(job_id, downloaded_bytes=500)
        job = tracker.get_job(job_id)
        assert job.current_file == "existing.fits"  # unchanged

    def test_update_byte_progress_zero_total(self, tracker_with_job):
        """Progress stays 0 when total_bytes is 0."""
        tracker, job_id = tracker_with_job
        tracker.update_byte_progress(job_id, downloaded_bytes=100)
        assert tracker.get_job(job_id).progress == 0

    def test_update_byte_progress_missing_job(self, tracker: DownloadTracker):
        tracker.update_byte_progress("nonexistent", 100)


class TestDownloadTrackerSetFileProgressList:
    """Tests for DownloadTracker.set_file_progress_list."""

    def test_set_file_progress_list(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        files = [
            FileProgress(filename="a.fits", status="complete"),
            FileProgress(filename="b.fits", status="downloading"),
            FileProgress(filename="c.fits", status="complete"),
        ]
        tracker.set_file_progress_list(job_id, files)

        job = tracker.get_job(job_id)
        assert len(job.file_progress) == 3
        assert job.downloaded_files == 2  # 2 complete

    def test_set_file_progress_list_empty(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.set_file_progress_list(job_id, [])
        job = tracker.get_job(job_id)
        assert job.file_progress == []
        assert job.downloaded_files == 0

    def test_set_file_progress_list_missing_job(self, tracker: DownloadTracker):
        tracker.set_file_progress_list("nonexistent", [])


class TestDownloadTrackerUpdateSingleFileProgress:
    """Tests for DownloadTracker.update_single_file_progress."""

    def test_updates_existing_file(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        initial = [
            FileProgress(filename="a.fits", total_bytes=100, downloaded_bytes=0, status="pending")
        ]
        tracker.set_file_progress_list(job_id, initial)

        tracker.update_single_file_progress(
            job_id, "a.fits", downloaded_bytes=50, total_bytes=100, status="downloading"
        )

        job = tracker.get_job(job_id)
        assert len(job.file_progress) == 1
        fp = job.file_progress[0]
        assert fp.downloaded_bytes == 50
        assert fp.total_bytes == 100
        assert fp.status == "downloading"

    def test_appends_new_file(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.set_file_progress_list(job_id, [])

        tracker.update_single_file_progress(
            job_id, "new.fits", downloaded_bytes=0, total_bytes=500, status="pending"
        )

        job = tracker.get_job(job_id)
        assert len(job.file_progress) == 1
        assert job.file_progress[0].filename == "new.fits"
        assert job.file_progress[0].total_bytes == 500

    def test_appends_when_different_filename(self, tracker_with_job):
        """When the filename doesn't match any existing entry, it should be appended."""
        tracker, job_id = tracker_with_job
        existing = [FileProgress(filename="existing.fits")]
        tracker.set_file_progress_list(job_id, existing)

        tracker.update_single_file_progress(job_id, "other.fits", 100, 200, "downloading")

        job = tracker.get_job(job_id)
        assert len(job.file_progress) == 2
        assert job.file_progress[1].filename == "other.fits"

    def test_missing_job(self, tracker: DownloadTracker):
        tracker.update_single_file_progress("nonexistent", "f.fits", 0, 0)


class TestDownloadTrackerSetResumable:
    """Tests for DownloadTracker.set_resumable."""

    def test_set_resumable_true(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.set_resumable(job_id, True)
        assert tracker.get_job(job_id).is_resumable is True

    def test_set_resumable_false(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.set_resumable(job_id, True)
        tracker.set_resumable(job_id, False)
        assert tracker.get_job(job_id).is_resumable is False

    def test_set_resumable_missing_job(self, tracker: DownloadTracker):
        tracker.set_resumable("nonexistent", True)


class TestDownloadTrackerAddCompletedFile:
    """Tests for DownloadTracker.add_completed_file."""

    def test_add_completed_file(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.add_completed_file(job_id, "/data/a.fits")
        tracker.add_completed_file(job_id, "/data/b.fits")
        job = tracker.get_job(job_id)
        assert job.files == ["/data/a.fits", "/data/b.fits"]

    def test_add_completed_file_missing_job(self, tracker: DownloadTracker):
        tracker.add_completed_file("nonexistent", "/data/f.fits")


class TestDownloadTrackerCompleteJob:
    """Tests for DownloadTracker.complete_job."""

    def test_complete_job_sets_all_fields(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.set_resumable(job_id, True)
        tracker.update_byte_progress(job_id, 500, speed_bytes_per_sec=100.0, eta_seconds=10.0)
        tracker.update_file_progress(job_id, "active.fits", 1)
        tracker.add_completed_file(job_id, "/data/a.fits")
        tracker.add_completed_file(job_id, "/data/b.fits")

        tracker.complete_job(job_id, "/data/downloads")

        job = tracker.get_job(job_id)
        assert job.stage == DownloadStage.COMPLETE
        assert job.progress == 100
        assert job.message == "Downloaded 2 files"
        assert job.completed_at is not None
        assert job.download_dir == "/data/downloads"
        assert job.current_file is None
        assert job.speed_bytes_per_sec == 0.0
        assert job.eta_seconds is None
        assert job.is_resumable is False

    def test_complete_job_missing_job(self, tracker: DownloadTracker):
        tracker.complete_job("nonexistent", "/data")


class TestDownloadTrackerFailJob:
    """Tests for DownloadTracker.fail_job."""

    def test_fail_job_default_not_resumable(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.fail_job(job_id, "Network timeout")

        job = tracker.get_job(job_id)
        assert job.stage == DownloadStage.FAILED
        assert job.error == "Network timeout"
        assert job.message == "Failed: Network timeout"
        assert job.completed_at is not None
        assert job.is_resumable is False

    def test_fail_job_resumable(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.fail_job(job_id, "Connection lost", is_resumable=True)

        job = tracker.get_job(job_id)
        assert job.stage == DownloadStage.FAILED
        assert job.is_resumable is True

    def test_fail_job_missing_job(self, tracker: DownloadTracker):
        tracker.fail_job("nonexistent", "error")


class TestDownloadTrackerPauseJob:
    """Tests for DownloadTracker.pause_job."""

    def test_pause_job(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.update_byte_progress(job_id, 500, speed_bytes_per_sec=200.0, eta_seconds=5.0)

        tracker.pause_job(job_id)

        job = tracker.get_job(job_id)
        assert job.stage == DownloadStage.PAUSED
        assert job.message == "Download paused"
        assert job.is_resumable is True
        assert job.speed_bytes_per_sec == 0.0
        assert job.eta_seconds is None

    def test_pause_job_missing_job(self, tracker: DownloadTracker):
        tracker.pause_job("nonexistent")


class TestDownloadTrackerRemoveJob:
    """Tests for DownloadTracker.remove_job."""

    def test_remove_existing_job(self, tracker_with_job):
        tracker, job_id = tracker_with_job
        tracker.remove_job(job_id)
        assert tracker.get_job(job_id) is None

    def test_remove_missing_job_no_error(self, tracker: DownloadTracker):
        tracker.remove_job("nonexistent")


class TestDownloadTrackerCleanupOldJobs:
    """Tests for DownloadTracker._cleanup_old_jobs (called automatically on create_job)."""

    def test_removes_completed_jobs_older_than_30_minutes(self, tracker: DownloadTracker):
        """Completed jobs with completed_at > 30 minutes ago should be removed."""
        old_time = datetime.utcnow() - timedelta(minutes=45)

        # Create a job and mark it completed with an old timestamp
        old_id = tracker.create_job("obs-old", job_id="old-job")
        tracker.complete_job(old_id, "/data")
        tracker.get_job(old_id).completed_at = old_time

        # Create a new job — triggers _cleanup_old_jobs
        tracker.create_job("obs-new", job_id="new-job")

        assert tracker.get_job("old-job") is None
        assert tracker.get_job("new-job") is not None

    def test_keeps_recently_completed_jobs(self, tracker: DownloadTracker):
        """Completed jobs within the last 30 minutes should NOT be removed."""
        recent_time = datetime.utcnow() - timedelta(minutes=10)

        recent_id = tracker.create_job("obs-recent", job_id="recent-job")
        tracker.complete_job(recent_id, "/data")
        tracker.get_job(recent_id).completed_at = recent_time

        # Trigger cleanup
        tracker.create_job("obs-trigger", job_id="trigger-job")

        assert tracker.get_job("recent-job") is not None

    def test_keeps_incomplete_jobs(self, tracker: DownloadTracker):
        """Jobs without completed_at (still in progress) should never be cleaned up."""
        tracker.create_job("obs-active", job_id="active-job")

        # Trigger cleanup
        tracker.create_job("obs-trigger", job_id="trigger-job")

        assert tracker.get_job("active-job") is not None

    def test_removes_failed_jobs_older_than_30_minutes(self, tracker: DownloadTracker):
        """Failed jobs also have completed_at set, so they should be cleaned up too."""
        old_time = datetime.utcnow() - timedelta(minutes=45)

        fail_id = tracker.create_job("obs-fail", job_id="fail-job")
        tracker.fail_job(fail_id, "some error")
        tracker.get_job(fail_id).completed_at = old_time

        # Trigger cleanup
        tracker.create_job("obs-trigger", job_id="trigger-job")

        assert tracker.get_job("fail-job") is None

    @patch("app.mast.download_tracker.datetime")
    def test_cleanup_cutoff_boundary(self, mock_datetime):
        """Jobs completed exactly at the 30-minute boundary should NOT be removed."""
        now = datetime(2026, 2, 24, 12, 30, 0)
        mock_datetime.utcnow.return_value = now
        # Ensure timedelta still works by using the real one
        mock_datetime.side_effect = lambda *a, **kw: datetime(*a, **kw)

        tracker = DownloadTracker()

        # Manually insert a job that completed exactly 30 minutes ago (at cutoff)
        boundary_job = DownloadProgress(
            job_id="boundary",
            obs_id="obs-boundary",
            stage=DownloadStage.COMPLETE,
            completed_at=datetime(2026, 2, 24, 12, 0, 0),  # exactly 30 min ago
        )
        tracker._jobs["boundary"] = boundary_job

        # Trigger cleanup — cutoff is utcnow() - 30 min = 12:00:00
        # completed_at (12:00:00) is NOT < cutoff (12:00:00), so it should stay
        tracker.create_job("obs-new", job_id="new")

        assert tracker.get_job("boundary") is not None
