# Copyright (c) JWST Data Analysis. All rights reserved.
# Licensed under the MIT License.

"""
Tests for DownloadStateManager, focusing on race-condition handling
in cleanup_orphaned_partial_files.
"""

from unittest.mock import patch

import pytest

from app.mast.download_state_manager import DownloadStateManager


@pytest.fixture
def state_manager(tmp_path):
    """Create a DownloadStateManager with a temporary base directory."""
    return DownloadStateManager(str(tmp_path))


@pytest.fixture
def obs_dir_with_part_file(tmp_path):
    """Create an observation directory containing a .part file."""
    obs_path = tmp_path / "obs_test"
    obs_path.mkdir()
    part_file = obs_path / "data.fits.part"
    part_file.write_bytes(b"\x00" * 100)
    return part_file


class TestCleanupOrphanedPartialFilesRaceCondition:
    """Tests for the race condition where a .part file disappears between
    listdir() and getmtime()/remove()."""

    @pytest.mark.usefixtures("obs_dir_with_part_file")
    def test_file_deleted_before_getmtime(self, state_manager):
        """If the .part file is removed between listdir and getmtime,
        the cleanup should not crash (bug #1020)."""
        with patch("app.mast.download_state_manager.os.path.getmtime") as mock_getmtime:
            mock_getmtime.side_effect = FileNotFoundError("[Errno 2] No such file or directory")
            # Should not raise
            removed = state_manager.cleanup_orphaned_partial_files()

        assert removed == 0

    @pytest.mark.usefixtures("obs_dir_with_part_file")
    def test_file_deleted_before_remove(self, state_manager):
        """If the .part file is removed between getmtime and os.remove,
        the cleanup should not crash."""
        # Return an old mtime so the code tries to remove the file
        old_timestamp = 0.0  # epoch — definitely older than retention period

        with patch("app.mast.download_state_manager.os.remove") as mock_remove:
            mock_remove.side_effect = FileNotFoundError("[Errno 2] No such file or directory")
            with patch(
                "app.mast.download_state_manager.os.path.getmtime",
                return_value=old_timestamp,
            ):
                removed = state_manager.cleanup_orphaned_partial_files()

        # The removal failed, so count should be 0
        assert removed == 0

    @pytest.mark.usefixtures("obs_dir_with_part_file")
    def test_permission_error_handled(self, state_manager):
        """OSError subclasses like PermissionError should also be caught."""
        with patch("app.mast.download_state_manager.os.path.getmtime") as mock_getmtime:
            mock_getmtime.side_effect = PermissionError("[Errno 13] Permission denied")
            removed = state_manager.cleanup_orphaned_partial_files()

        assert removed == 0

    def test_normal_old_file_still_removed(self, state_manager, obs_dir_with_part_file):
        """Verify that old .part files are still correctly removed
        when no race condition occurs."""
        old_timestamp = 0.0  # epoch

        with patch(
            "app.mast.download_state_manager.os.path.getmtime",
            return_value=old_timestamp,
        ):
            removed = state_manager.cleanup_orphaned_partial_files()

        assert removed == 1
        assert not obs_dir_with_part_file.exists()

    def test_recent_file_not_removed(self, state_manager, obs_dir_with_part_file):
        """Verify that recent .part files are left alone."""
        # Don't mock getmtime — the file was just created, so it's recent
        removed = state_manager.cleanup_orphaned_partial_files()

        assert removed == 0
        assert obs_dir_with_part_file.exists()

    @pytest.mark.usefixtures("obs_dir_with_part_file")
    def test_debug_log_on_race_condition(self, state_manager):
        """Verify that a debug log message is emitted on race condition."""
        with patch("app.mast.download_state_manager.os.path.getmtime") as mock_getmtime:
            mock_getmtime.side_effect = FileNotFoundError("[Errno 2] No such file or directory")
            with patch("app.mast.download_state_manager.logger") as mock_logger:
                state_manager.cleanup_orphaned_partial_files()
                mock_logger.debug.assert_called_once()
                assert "already removed" in mock_logger.debug.call_args[0][0]
