"""Tests for the bounded LRU cache over the MAST download directory.

Every test operates on a pytest tmp_path. The real `data/mast` is never
touched — the whole point of the feature is deleting FITS, so the blast radius
of a buggy test is exactly the thing to keep contained.
"""

import logging
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from app.mast.cache import DEFAULT_MAX_BYTES, MastCache, PinManifestUnavailableError


def write_file(path: Path, size: int, atime: float | None = None) -> Path:
    """Create `path` with `size` bytes, optionally backdating its access time."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\0" * size)
    if atime is not None:
        os.utime(path, (atime, atime))
    return path


@pytest.fixture
def download_dir(tmp_path: Path) -> Path:
    d = tmp_path / "data" / "mast"
    d.mkdir(parents=True)
    return d


def test_disabled_by_default_is_a_no_op(download_dir: Path, monkeypatch):
    monkeypatch.delenv("MAST_CACHE_ENABLED", raising=False)
    monkeypatch.delenv("MAST_CACHE_MAX_BYTES", raising=False)
    big = write_file(download_dir / "obs" / "a_i2d.fits", 5_000)

    cache = MastCache(download_dir)

    assert cache.enabled is False
    assert cache.max_bytes == DEFAULT_MAX_BYTES
    assert cache.evict_if_needed() is None
    assert big.exists()


def test_disabled_cache_does_not_walk_the_directory(download_dir: Path):
    cache = MastCache(download_dir, enabled=False, max_bytes=0)

    def explode():
        raise AssertionError("disabled cache must not enumerate candidates")

    cache._evictable_candidates = explode  # type: ignore[method-assign]

    assert cache.evict_if_needed() is None


def test_default_construction_can_never_unlink_anything(download_dir: Path, monkeypatch):
    """The safety property the whole feature rests on.

    With no MAST_CACHE_* env set — the shipped configuration — the cache must
    not be able to delete a file even when the directory is enormously over any
    plausible budget. Asserted by making any unlink attempt an outright test
    failure, not by checking survivors afterwards.
    """
    for name in ("MAST_CACHE_ENABLED", "MAST_CACHE_MAX_BYTES", "MAST_CACHE_PIN_MANIFEST"):
        monkeypatch.delenv(name, raising=False)

    files = [write_file(download_dir / f"obs{i}" / f"f{i}_i2d.fits", 10_000) for i in range(5)]

    cache = MastCache(download_dir)

    def forbidden_unlink(*args, **kwargs):
        raise AssertionError("disabled MAST cache attempted to unlink a file")

    with patch.object(Path, "unlink", forbidden_unlink):
        assert cache.evict_if_needed() is None

    assert all(f.exists() for f in files)


@pytest.mark.parametrize("value", ["false", "False", "0", "no", "off", ""])
def test_falsy_env_values_keep_the_cache_off(download_dir: Path, monkeypatch, value):
    monkeypatch.setenv("MAST_CACHE_ENABLED", value)

    assert MastCache(download_dir).enabled is False


def test_typo_in_the_enable_flag_fails_loudly(download_dir: Path, monkeypatch):
    """A typo must not read as False and silently disable a cache the operator
    believed was on — nor as True and silently enable deletion."""
    from app.config import EnvVarError

    monkeypatch.setenv("MAST_CACHE_ENABLED", "ture")

    with pytest.raises(EnvVarError):
        MastCache(download_dir)


def test_env_switches_the_cache_on(download_dir: Path, monkeypatch):
    monkeypatch.setenv("MAST_CACHE_ENABLED", "true")
    monkeypatch.setenv("MAST_CACHE_MAX_BYTES", "1234")

    cache = MastCache(download_dir)

    assert cache.enabled is True
    assert cache.max_bytes == 1234


def test_evicts_until_within_budget(download_dir: Path):
    old = write_file(download_dir / "o1" / "old_i2d.fits", 1_000, atime=1_000)
    mid = write_file(download_dir / "o2" / "mid_i2d.fits", 1_000, atime=2_000)
    new = write_file(download_dir / "o3" / "new_i2d.fits", 1_000, atime=3_000)

    cache = MastCache(download_dir, enabled=True, max_bytes=2_000)
    result = cache.evict_if_needed()

    assert result is not None
    assert result.within_budget
    assert result.evicted_count == 1
    assert result.bytes_freed == 1_000
    assert result.remaining_bytes == 2_000
    assert not old.exists()
    assert mid.exists()
    assert new.exists()


def test_lru_order_is_by_access_time_not_name_or_mtime(download_dir: Path):
    # Alphabetically first but most recently accessed — must survive.
    a = write_file(download_dir / "a_i2d.fits", 1_000, atime=9_000)
    b = write_file(download_dir / "b_i2d.fits", 1_000, atime=1_000)
    c = write_file(download_dir / "c_i2d.fits", 1_000, atime=2_000)

    cache = MastCache(download_dir, enabled=True, max_bytes=1_000)
    result = cache.evict_if_needed()

    assert result is not None
    assert result.evicted_count == 2
    assert a.exists()
    assert not b.exists()
    assert not c.exists()


def test_under_budget_evicts_nothing(download_dir: Path):
    keep = write_file(download_dir / "keep_i2d.fits", 100, atime=1)

    cache = MastCache(download_dir, enabled=True, max_bytes=10_000)
    result = cache.evict_if_needed()

    assert result is not None
    assert result.evicted_count == 0
    assert result.bytes_freed == 0
    assert result.remaining_bytes == 100
    assert keep.exists()


def test_pinned_files_survive_even_when_oldest(download_dir: Path, tmp_path: Path):
    pinned = write_file(download_dir / "seed" / "pinned_i2d.fits", 5_000, atime=1)
    evictable = write_file(download_dir / "other" / "spare_i2d.fits", 5_000, atime=9_000)

    manifest = tmp_path / "files.txt"
    manifest.write_text(
        "# CE seed bundle\n\nmast/seed/pinned_i2d.fits\n",
        encoding="utf-8",
    )

    cache = MastCache(
        download_dir,
        enabled=True,
        max_bytes=1_000,
        pin_manifest_path=manifest,
    )
    result = cache.evict_if_needed()

    assert result is not None
    assert cache.is_pinned(pinned)
    assert pinned.exists()
    assert not evictable.exists()
    # Pinned bytes still count against the budget, so the pass legitimately
    # ends over budget rather than deleting protected science data.
    assert result.remaining_bytes == 5_000
    assert not result.within_budget


def test_manifest_entries_are_resolved_against_the_data_root_only(
    download_dir: Path, tmp_path: Path, caplog
):
    """The base is the data root, matching how the bundle is generated.

    `seed_ce.py` writes entries as `relpath(file, dirname(download_dir))` and
    `seed-ce.sh` consumes them via `rsync --files-from=files.txt "$DATA_ROOT/"`.
    A download-dir-relative entry is therefore malformed: it must NOT silently
    pin, and it must be logged so the dead pin is visible.
    """
    target = write_file(download_dir / "seed" / "pinned_i2d.fits", 5_000, atime=1)
    manifest = tmp_path / "files.txt"
    # Missing the leading `mast/` — resolves to <data root>/seed/..., not under
    # the download dir at all.
    manifest.write_text("seed/pinned_i2d.fits\n", encoding="utf-8")

    cache = MastCache(download_dir, enabled=True, max_bytes=0, pin_manifest_path=manifest)

    with caplog.at_level(logging.WARNING, logger="app.mast.cache"):
        assert cache.is_pinned(target) is False

    assert any("protect nothing" in message for message in caplog.messages)


def test_correctly_based_manifest_entry_pins(download_dir: Path, tmp_path: Path):
    """The shape seed_ce.py actually emits: `mast/<obs>/<file>`."""
    target = write_file(download_dir / "seed" / "pinned_i2d.fits", 5_000, atime=1)
    manifest = tmp_path / "files.txt"
    manifest.write_text("mast/seed/pinned_i2d.fits\n", encoding="utf-8")

    cache = MastCache(download_dir, enabled=True, max_bytes=0, pin_manifest_path=manifest)
    cache.evict_if_needed()

    assert cache.is_pinned(target) is True
    assert target.exists()


def test_unreadable_manifest_skips_the_pass_rather_than_evicting_unpinned(
    download_dir: Path, tmp_path: Path
):
    """A configured-but-unreadable manifest must fail closed.

    Evicting with zero pins because the pin list could not be read would delete
    exactly the files the manifest exists to protect. Skipping the pass leaves
    the directory over budget, which is the recoverable failure.
    """
    survivor = write_file(download_dir / "x_i2d.fits", 1_000, atime=1)

    cache = MastCache(
        download_dir,
        enabled=True,
        max_bytes=0,
        pin_manifest_path=tmp_path / "does-not-exist.txt",
    )

    assert cache.evict_if_needed() is None
    assert survivor.exists()

    with pytest.raises(PinManifestUnavailableError):
        cache.is_pinned(survivor)


def test_no_manifest_configured_evicts_normally(download_dir: Path):
    """No manifest at all is different from a manifest that cannot be read."""
    doomed = write_file(download_dir / "x_i2d.fits", 1_000, atime=1)

    cache = MastCache(download_dir, enabled=True, max_bytes=0, pin_manifest_path=None)
    monkeyless = cache.evict_if_needed()

    assert monkeyless is not None
    assert monkeyless.evicted_count == 1
    assert not doomed.exists()


def test_manifest_edits_take_effect_without_a_restart(download_dir: Path, tmp_path: Path):
    """The window between editing the manifest and restarting the engine is
    exactly when newly-pinned files would otherwise be deleted."""
    target = write_file(download_dir / "obs" / "a_i2d.fits", 1_000, atime=1)
    manifest = tmp_path / "files.txt"
    manifest.write_text("# nothing pinned yet\n", encoding="utf-8")

    cache = MastCache(download_dir, enabled=True, max_bytes=0, pin_manifest_path=manifest)
    assert cache.is_pinned(target) is False

    # Edit the manifest on disk; no reload_pins() call, no restart.
    os.utime(manifest, None)
    manifest.write_text("mast/obs/a_i2d.fits\n", encoding="utf-8")

    assert cache.is_pinned(target) is True

    cache.evict_if_needed()
    assert target.exists()


def test_in_flight_and_partial_files_are_never_evicted(download_dir: Path):
    in_flight = write_file(download_dir / "live" / "live_i2d.fits", 4_000, atime=1)
    partial = write_file(download_dir / "live" / "other_i2d.fits.part", 4_000, atime=1)
    spare = write_file(download_dir / "done" / "spare_i2d.fits", 4_000, atime=5_000)

    cache = MastCache(
        download_dir,
        enabled=True,
        max_bytes=0,
        in_flight_paths=lambda: [str(in_flight)],
    )
    result = cache.evict_if_needed()

    assert result is not None
    assert in_flight.exists()
    assert partial.exists()
    assert not spare.exists()


def test_part_sibling_of_an_in_flight_file_is_protected(download_dir: Path):
    target = download_dir / "live" / "resuming_i2d.fits"
    part = write_file(Path(f"{target}.part"), 1_000, atime=1)

    cache = MastCache(
        download_dir,
        enabled=True,
        max_bytes=0,
        in_flight_paths=lambda: [str(target)],
    )
    cache.evict_if_needed()

    assert part.exists()


def test_download_state_and_non_fits_files_are_ignored(download_dir: Path):
    state = write_file(download_dir / ".download_state" / "job-1.json", 2_000, atime=1)
    state_fits = write_file(download_dir / ".download_state" / "stashed_i2d.fits", 2_000, atime=1)
    readme = write_file(download_dir / "obs" / "README.txt", 2_000, atime=1)
    fits = write_file(download_dir / "obs" / "data_i2d.fits", 2_000, atime=1)

    cache = MastCache(download_dir, enabled=True, max_bytes=0)
    result = cache.evict_if_needed()

    assert result is not None
    assert result.evicted_count == 1
    assert not fits.exists()
    assert state.exists()
    assert state_fits.exists()
    assert readme.exists()


def test_compressed_fits_variants_are_evictable(download_dir: Path):
    gz = write_file(download_dir / "obs" / "a_i2d.fits.gz", 1_000, atime=1)
    fit = write_file(download_dir / "obs" / "b.fit", 1_000, atime=2)

    cache = MastCache(download_dir, enabled=True, max_bytes=0)
    result = cache.evict_if_needed()

    assert result is not None
    assert result.evicted_count == 2
    assert not gz.exists()
    assert not fit.exists()


def test_files_outside_the_download_dir_are_never_touched(download_dir: Path, tmp_path: Path):
    outsider = write_file(tmp_path / "elsewhere" / "precious_i2d.fits", 9_000, atime=1)
    inside = write_file(download_dir / "obs" / "a_i2d.fits", 1_000, atime=1)

    cache = MastCache(download_dir, enabled=True, max_bytes=0)
    cache.evict_if_needed()

    assert outsider.exists()
    assert not inside.exists()


def test_missing_download_dir_is_harmless(tmp_path: Path):
    cache = MastCache(tmp_path / "no-such-dir", enabled=True, max_bytes=0)
    result = cache.evict_if_needed()

    assert result is not None
    assert result.evicted_count == 0
    assert result.remaining_bytes == 0


def test_unreadable_in_flight_registry_skips_eviction(download_dir: Path):
    survivor = write_file(download_dir / "obs" / "a_i2d.fits", 1_000, atime=1)

    def boom():
        raise RuntimeError("dictionary changed size during iteration")

    cache = MastCache(download_dir, enabled=True, max_bytes=0, in_flight_paths=boom)

    assert cache.evict_if_needed() is None
    assert survivor.exists()


def test_reload_pins_picks_up_manifest_changes(download_dir: Path, tmp_path: Path):
    target = write_file(download_dir / "obs" / "a_i2d.fits", 1_000, atime=1)
    manifest = tmp_path / "files.txt"
    manifest.write_text("", encoding="utf-8")

    cache = MastCache(download_dir, enabled=True, max_bytes=0, pin_manifest_path=manifest)
    assert cache.is_pinned(target) is False

    manifest.write_text("mast/obs/a_i2d.fits\n", encoding="utf-8")
    cache.reload_pins()

    assert cache.is_pinned(target) is True


class TestRoutesWiring:
    """The eviction trigger as `app.mast.routes` actually wires it up."""

    def test_in_flight_paths_reads_both_downloader_registries(self, monkeypatch):
        from app.mast import routes
        from app.mast.chunked_downloader import DownloadJobState, FileDownloadProgress

        def make_downloader(local_path: str):
            state = DownloadJobState(job_id="j", obs_id="o", download_dir="/tmp")
            state.files.append(
                FileDownloadProgress(filename="f.fits", url="http://x", local_path=local_path)
            )

            class Fake:
                job_state = state

            return Fake()

        monkeypatch.setattr(routes, "_active_downloaders", {"a": make_downloader("/d/a_i2d.fits")})
        monkeypatch.setattr(
            routes, "_active_s3_downloaders", {"b": make_downloader("/d/b_i2d.fits")}
        )

        assert sorted(routes._in_flight_download_paths()) == ["/d/a_i2d.fits", "/d/b_i2d.fits"]

    def test_idle_downloader_contributes_no_paths(self, monkeypatch):
        from app.mast import routes

        class Idle:
            job_state = None

        monkeypatch.setattr(routes, "_active_downloaders", {"a": Idle()})
        monkeypatch.setattr(routes, "_active_s3_downloaders", {})

        assert routes._in_flight_download_paths() == []

    def test_module_cache_is_disabled_unless_opted_in(self):
        from app.mast import routes

        assert routes.mast_cache.enabled is False


class TestDryRun:
    """`MAST_CACHE_DRY_RUN` — the gate before pointing this at real data."""

    def test_dry_run_deletes_nothing_but_reports_the_full_plan(self, download_dir: Path, caplog):
        old = write_file(download_dir / "o1" / "old_i2d.fits", 1_000, atime=1_000)
        mid = write_file(download_dir / "o2" / "mid_i2d.fits", 1_000, atime=2_000)
        new = write_file(download_dir / "o3" / "new_i2d.fits", 1_000, atime=3_000)

        cache = MastCache(download_dir, enabled=True, max_bytes=1_000, dry_run=True)

        def forbidden_unlink(*args, **kwargs):
            raise AssertionError("dry run attempted to unlink a file")

        with (
            patch.object(Path, "unlink", forbidden_unlink),
            caplog.at_level(logging.INFO, logger="app.storage.lru_evictor"),
        ):
            result = cache.evict_if_needed()

        assert result is not None
        assert result.dry_run is True
        # Reports exactly what a real pass would have done.
        assert result.evicted_count == 2
        assert result.bytes_freed == 2_000
        assert result.remaining_bytes == 1_000
        # ...and deleted nothing.
        assert old.exists() and mid.exists() and new.exists()

        plan = "\n".join(caplog.messages)
        assert "WOULD EVICT" in plan
        assert str(old) in plan
        assert str(mid) in plan
        assert str(new) not in plan  # newest survives, so it is not in the plan
        assert "DRY RUN" in plan

    def test_dry_run_respects_pins_and_in_flight(self, download_dir: Path, tmp_path: Path):
        pinned = write_file(download_dir / "seed" / "p_i2d.fits", 1_000, atime=1)
        live = write_file(download_dir / "live" / "l_i2d.fits", 1_000, atime=2)
        spare = write_file(download_dir / "done" / "s_i2d.fits", 1_000, atime=3)
        manifest = tmp_path / "files.txt"
        manifest.write_text("mast/seed/p_i2d.fits\n", encoding="utf-8")

        cache = MastCache(
            download_dir,
            enabled=True,
            max_bytes=0,
            dry_run=True,
            pin_manifest_path=manifest,
            in_flight_paths=lambda: [str(live)],
        )
        result = cache.evict_if_needed()

        assert result is not None
        # Only the one unprotected file appears in the plan.
        assert result.evicted_count == 1
        assert result.bytes_freed == 1_000
        assert pinned.exists() and live.exists() and spare.exists()

    def test_dry_run_under_budget_reports_no_plan(self, download_dir: Path, caplog):
        keep = write_file(download_dir / "a_i2d.fits", 100, atime=1)

        cache = MastCache(download_dir, enabled=True, max_bytes=10_000, dry_run=True)
        with caplog.at_level(logging.INFO, logger="app.storage.lru_evictor"):
            result = cache.evict_if_needed()

        assert result is not None
        assert result.evicted_count == 0
        assert result.dry_run is True
        assert keep.exists()
        assert any("nothing would be evicted" in message for message in caplog.messages)

    def test_dry_run_defaults_to_false(self, download_dir: Path, monkeypatch):
        monkeypatch.delenv("MAST_CACHE_DRY_RUN", raising=False)

        assert MastCache(download_dir).dry_run is False

    def test_dry_run_reads_its_env_var(self, download_dir: Path, monkeypatch):
        monkeypatch.setenv("MAST_CACHE_DRY_RUN", "true")

        assert MastCache(download_dir).dry_run is True

    def test_dry_run_does_not_enable_a_disabled_cache(self, download_dir: Path, monkeypatch):
        """Dry run is a mode of an ENABLED cache, never a way to switch it on."""
        monkeypatch.setenv("MAST_CACHE_DRY_RUN", "true")
        monkeypatch.delenv("MAST_CACHE_ENABLED", raising=False)
        doomed = write_file(download_dir / "a_i2d.fits", 10_000, atime=1)

        cache = MastCache(download_dir, max_bytes=0)

        assert cache.enabled is False
        assert cache.evict_if_needed() is None
        assert doomed.exists()
