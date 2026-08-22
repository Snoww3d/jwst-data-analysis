"""Tests for the shared atime-LRU eviction pass."""

import os
from pathlib import Path

from app.storage.lru_evictor import evict_to_budget


def write_file(path: Path, size: int, atime: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\0" * size)
    os.utime(path, (atime, atime))
    return path


def test_under_budget_is_a_no_op(tmp_path: Path):
    a = write_file(tmp_path / "a", 100, atime=1)

    result = evict_to_budget([a], max_bytes=1_000)

    assert result.evicted_count == 0
    assert result.remaining_bytes == 100
    assert result.within_budget
    assert a.exists()


def test_evicts_oldest_first_and_stops_at_budget(tmp_path: Path):
    a = write_file(tmp_path / "a", 100, atime=1)
    b = write_file(tmp_path / "b", 100, atime=2)
    c = write_file(tmp_path / "c", 100, atime=3)

    result = evict_to_budget([c, a, b], max_bytes=200)

    assert result.evicted_count == 1
    assert result.bytes_freed == 100
    assert result.remaining_bytes == 200
    assert not a.exists()
    assert b.exists() and c.exists()


def test_protected_files_count_toward_budget_but_are_kept(tmp_path: Path):
    protected = write_file(tmp_path / "keep", 500, atime=1)
    spare = write_file(tmp_path / "spare", 500, atime=2)

    result = evict_to_budget(
        [protected, spare],
        max_bytes=100,
        is_protected=lambda p: p.name == "keep",
    )

    assert protected.exists()
    assert not spare.exists()
    assert result.remaining_bytes == 500
    assert not result.within_budget


def test_vanished_candidates_are_skipped(tmp_path: Path):
    present = write_file(tmp_path / "present", 100, atime=1)
    missing = tmp_path / "gone"

    result = evict_to_budget([missing, present], max_bytes=0)

    assert result.evicted_count == 1
    assert not present.exists()


def test_dry_run_reports_the_plan_without_deleting(tmp_path: Path):
    a = write_file(tmp_path / "a", 100, atime=1)
    b = write_file(tmp_path / "b", 100, atime=2)

    result = evict_to_budget([a, b], max_bytes=100, dry_run=True)

    assert result.dry_run is True
    assert result.evicted_count == 1
    assert result.bytes_freed == 100
    assert result.remaining_bytes == 100
    assert a.exists()
    assert b.exists()


def test_dry_run_never_counts_failures(tmp_path: Path):
    """A dry run does not call unlink, so it cannot record a delete failure."""
    a = write_file(tmp_path / "a", 100, atime=1)

    result = evict_to_budget([a], max_bytes=0, dry_run=True)

    assert result.failed_count == 0
    assert result.evicted_count == 1
    assert a.exists()


def test_default_is_not_a_dry_run(tmp_path: Path):
    a = write_file(tmp_path / "a", 100, atime=1)

    result = evict_to_budget([a], max_bytes=0)

    assert result.dry_run is False
    assert not a.exists()
