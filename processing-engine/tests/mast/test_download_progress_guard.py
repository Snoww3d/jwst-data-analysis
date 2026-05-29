"""Regression tests for the manifest 'Local Path' guard in the progressive
download path (#1523).

`download_observation_with_progress` previously did `manifest["Local Path"][0]`
guarded only by `if manifest and len(manifest) > 0`. When astroquery returned a
non-None table missing the `"Local Path"` column (the failure mode #1516 already
defends against in the sibling `download_product` / `download_observation`), the
indexing raised KeyError, which the broad `except Exception` swallowed as a
generic warning — silently dropping the file with no clear root cause.
"""

import logging
from unittest.mock import MagicMock, patch

import pytest
from astropy.table import Table

from app.mast.mast_service import MastService


@pytest.fixture()
def service(tmp_path):
    return MastService(download_dir=str(tmp_path))


def _patch_observations(monkeypatch_target, *, manifest):
    """Patch the module-level Observations so the progressive loop reaches one
    file whose download returns the given manifest."""
    obs = MagicMock()
    obs.query_criteria.return_value = Table({"obs_id": ["jw001"]})
    obs.get_product_list.return_value = Table({"productFilename": ["file1.fits"]})
    obs.filter_products.return_value = Table(
        {"productFilename": ["file1.fits"], "productType": ["SCIENCE"]}
    )
    obs.download_products.return_value = manifest
    return patch.object(monkeypatch_target, "Observations", obs)


def test_manifest_missing_local_path_column_is_skipped_with_clear_warning(service, caplog):
    import app.mast.mast_service as mod

    # Non-None manifest, but no "Local Path" column — the #1516 failure mode.
    bad_manifest = Table({"Status": ["COMPLETE"]})

    with (
        _patch_observations(mod, manifest=bad_manifest),
        patch.object(MastService, "_safe_obs_dir", return_value=str(service.download_dir)),
        caplog.at_level(logging.WARNING),
    ):
        result = service.download_observation_with_progress("jw001")

    # File is skipped (not indexed) and the call still completes cleanly.
    assert result["status"] == "completed"
    assert result["files"] == []
    assert result["file_count"] == 0

    # The real fixed-vs-buggy discriminator: the fix drops the file via the
    # explicit guard ("missing 'Local Path'"), whereas the buggy code dropped it
    # via the broad `except Exception` handler ("Failed to download ...: 'Local Path'",
    # the str() of the swallowed KeyError).
    # getMessage() renders %-style args so the assertion is independent of style.
    warnings = " ".join(r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)
    assert "missing 'Local Path'" in warnings
    assert "Failed to download" not in warnings


def test_manifest_with_local_path_still_downloads(service, caplog):
    import app.mast.mast_service as mod

    good_manifest = Table({"Local Path": [str(service.download_dir) + "/file1.fits"]})

    with (
        _patch_observations(mod, manifest=good_manifest),
        patch.object(MastService, "_safe_obs_dir", return_value=str(service.download_dir)),
    ):
        result = service.download_observation_with_progress("jw001")

    assert result["status"] == "completed"
    assert result["file_count"] == 1
    assert result["files"] == [str(service.download_dir) + "/file1.fits"]
