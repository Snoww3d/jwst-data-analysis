# Fix #1523 — Missing 'Local Path' manifest guard in progressive download

**Branch**: `fix/1523-progressive-download-manifest-guard`
**Type**: Bug fix (defensive guard consistency), processing-engine, priority: medium
**Complexity**: Low (single per-file loop guard + tests)

## Problem

#1516 added a defensive manifest check to `download_product` and
`download_observation`:

```python
if manifest is None or "Local Path" not in manifest.colnames:
    raise MASTServiceError(...)
```

The sibling `download_observation_with_progress` (the SSE progress path) was not
updated. Its per-file loop only checked `if manifest and len(manifest) > 0`, then
indexed `manifest["Local Path"][0]`. When astroquery returns a non-`None` table
missing the `"Local Path"` column (the exact failure mode #1516 defends against),
the index raises `KeyError`, which the surrounding `except Exception as file_error`
swallows as a generic warning — silently dropping the file. The caller gets
`status: "completed"` with fewer files and no clear root cause.

## Fix

Add the same guard inside the per-file loop, using `continue` (per-file semantics)
+ a clear warning instead of raising:

```python
if manifest is None or "Local Path" not in manifest.colnames:
    logger.warning("Download manifest for %s is missing 'Local Path' — skipping file", filename)
    continue
if len(manifest) > 0:
    filepath = str(manifest["Local Path"][0])
    ...
```

Guard sits *before* the length check so a column-less non-empty table can't reach
the index.

## Tests (new `tests/mast/test_download_progress_guard.py`)

- Missing-column manifest → file skipped, `status: completed`, 0 files, and the
  warning is the guard's "missing 'Local Path'" message (not the swallowed
  `except`-path "Failed to download" message — the fixed-vs-buggy discriminator).
- Valid manifest → file still downloaded and returned.

## Verification

`docker exec jwst-processing python -m pytest tests/mast/ tests/test_mast_service_security.py`
— 133 passed. Ruff clean. Two rounds of code-reviewer.
