# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for race condition prevention in download resume endpoints.

Verifies that concurrent resume requests for the same job return 409 Conflict
instead of corrupting download state.
"""

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.mast.chunked_downloader import DownloadJobState
from app.mast.routes import _resuming_jobs
from main import app


client = TestClient(app)

JOB_ID = "test-job-123"
OBS_ID = "jw02733-o001"


def _make_resumable_state() -> DownloadJobState:
    """Create a mock DownloadJobState that looks resumable."""
    return DownloadJobState(
        job_id=JOB_ID,
        obs_id=OBS_ID,
        download_dir="/tmp/test",
        status="paused",
        files=[],
        total_bytes=1000,
        downloaded_bytes=500,
    )


class TestResumeRaceCondition:
    """Tests for concurrent resume detection on POST /mast/download/resume/{job_id}."""

    def setup_method(self):
        """Clean up _resuming_jobs before each test."""
        _resuming_jobs.discard(JOB_ID)

    def teardown_method(self):
        """Clean up _resuming_jobs after each test."""
        _resuming_jobs.discard(JOB_ID)

    @patch("app.mast.routes._run_chunked_download_job")
    @patch("app.mast.routes.state_manager")
    def test_first_resume_succeeds(self, mock_state_manager, mock_run_job):
        """First resume request for a job should succeed."""
        mock_state_manager.load_job_state.return_value = _make_resumable_state()
        mock_run_job.return_value = MagicMock()

        resp = client.post(f"/mast/download/resume/{JOB_ID}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "resuming"

    @patch("app.mast.routes._run_chunked_download_job")
    @patch("app.mast.routes.state_manager")
    def test_concurrent_resume_returns_409(self, mock_state_manager, mock_run_job):
        """Second resume request for an in-progress job should return 409."""
        mock_state_manager.load_job_state.return_value = _make_resumable_state()
        mock_run_job.return_value = MagicMock()

        # Simulate that the job is already being resumed
        _resuming_jobs.add(JOB_ID)

        resp = client.post(f"/mast/download/resume/{JOB_ID}")
        assert resp.status_code == 409
        assert "already being resumed" in resp.json()["detail"]

    @patch("app.mast.routes.state_manager")
    def test_resume_nonexistent_job_returns_404(self, mock_state_manager):
        """Resume request for a job with no saved state should return 404."""
        mock_state_manager.load_job_state.return_value = None

        resp = client.post(f"/mast/download/resume/{JOB_ID}")
        assert resp.status_code == 404

    @patch("app.mast.routes.state_manager")
    def test_resume_completed_job_returns_400(self, mock_state_manager):
        """Resume request for a completed job should return 400."""
        state = _make_resumable_state()
        state.status = "complete"
        mock_state_manager.load_job_state.return_value = state

        resp = client.post(f"/mast/download/resume/{JOB_ID}")
        assert resp.status_code == 400
        assert "not resumable" in resp.json()["detail"]


class TestStartChunkedResumeRaceCondition:
    """Tests for concurrent resume detection on POST /mast/download/start-chunked."""

    def setup_method(self):
        _resuming_jobs.discard(JOB_ID)

    def teardown_method(self):
        _resuming_jobs.discard(JOB_ID)

    @patch("app.mast.routes._run_chunked_download_job")
    @patch("app.mast.routes.state_manager")
    def test_start_chunked_resume_succeeds(self, mock_state_manager, mock_run_job):
        """Resume via start-chunked should succeed on first attempt."""
        mock_state_manager.load_job_state.return_value = _make_resumable_state()
        mock_run_job.return_value = MagicMock()

        resp = client.post(
            "/mast/download/start-chunked",
            json={"obs_id": OBS_ID, "resume_job_id": JOB_ID},
        )
        assert resp.status_code == 200
        assert resp.json()["is_resume"] is True

    @patch("app.mast.routes._run_chunked_download_job")
    @patch("app.mast.routes.state_manager")
    def test_start_chunked_concurrent_resume_returns_409(self, mock_state_manager, mock_run_job):
        """Resume via start-chunked should return 409 if already resuming."""
        mock_state_manager.load_job_state.return_value = _make_resumable_state()
        mock_run_job.return_value = MagicMock()

        # Simulate that the job is already being resumed
        _resuming_jobs.add(JOB_ID)

        resp = client.post(
            "/mast/download/start-chunked",
            json={"obs_id": OBS_ID, "resume_job_id": JOB_ID},
        )
        assert resp.status_code == 409
        assert "already being resumed" in resp.json()["detail"]
