# Plan: Migrate to photutils 3.0.0

**Complexity**: Quick (normalization + test updates + version bump)

## Problem

`processing-engine/requirements.txt` pins `photutils>=1.10.0` with no upper bound. photutils 3.0.0 (released 2026-04) renamed centroid columns from `xcentroid`/`ycentroid` to `x_centroid`/`y_centroid`, which breaks:

- `tests/test_detection.py::TestDetectPointSources::test_table_has_expected_columns` (asserts `xcentroid` in raw Table colnames)
- `tests/test_detection.py::TestSourcesToDict::test_converts_table` (asserts `xcentroid` in normalized dict)

The `Python Tests` CI job fresh-installs `photutils>=1.10.0` and now gets 3.0.0, so main's Python CI lane is broken for every new PR. Affects dependabot PRs #1303, #1305, #1307 and any new Python work.

## Fix

External API contract stays stable: `DetectedSource` Pydantic model and the frontend `SourceDetectionOverlay` both continue to receive `xcentroid`/`ycentroid`.

1. `sources_to_dict()` in `app/processing/detection.py` normalizes photutils' new column names back to the legacy `xcentroid`/`ycentroid` via a module-level rename map. Everything downstream (`analysis/routes.py`, `SourceInfo`, frontend) is unaffected.
2. `tests/test_detection.py::test_table_has_expected_columns` asserts on the raw photutils Table, so it now checks for either spelling (covers photutils 2.x if anyone still runs it, plus the new 3.x naming).
3. `requirements.txt` bumps `photutils>=1.10.0` → `photutils>=3.0.0` — explicit commitment to 3.x and unblocks the deferred bumps below.

Deferred (tracked by photutils deprecation warnings, not breakage): `npixels` → `n_pixels` keyword rename. Still works with a `DeprecationWarning` in 3.x and will break in photutils 4.x. Handle in a follow-up when 4.x lands.

## Files Changed

| File | Change |
|------|--------|
| `processing-engine/app/processing/detection.py` | Add `_PHOTUTILS_COLUMN_RENAMES` map; `sources_to_dict` applies it so `xcentroid`/`ycentroid` are always present in the output dicts |
| `processing-engine/tests/test_detection.py` | `test_table_has_expected_columns` accepts either `xcentroid`/`ycentroid` or `x_centroid`/`y_centroid` on the raw photutils Table |
| `processing-engine/requirements.txt` | `photutils>=1.10.0` → `photutils>=3.0.0` |

## Verification

- `docker exec -u root jwst-processing pip install --upgrade "photutils>=3.0.0"`
- `docker cp` modified files into container (since compose doesn't bind-mount processing-engine)
- `docker exec jwst-processing python -m pytest` → 1214 passed, 0 failed (vs. 2 failed before the fix)

Downstream (unchanged):
- `app/analysis/routes.py` still reads `s.get("xcentroid", 0.0)` and gets the normalized value
- `SourceInfo` model exposes `xcentroid: float` / `ycentroid: float`
- Frontend `AnalysisTypes.ts` types and `SourceDetectionOverlay` continue to consume `xcentroid`/`ycentroid`

## Risk

- Risk: Low. The normalization only translates known renamed columns; unknown columns pass through unchanged. Behavior under photutils 2.x is preserved (map is a no-op because the legacy names are already present). Frontend contract unchanged.
- Rollback: `git revert` the commit; also pin `photutils>=1.10.0,<3.0.0` if the revert re-introduces the column break in CI. No data migration or coordinated rollback required.
