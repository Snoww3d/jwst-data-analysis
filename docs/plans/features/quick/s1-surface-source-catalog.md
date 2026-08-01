# S1 — Surface the `_cat.ecsv` source catalog

## Problem

`Image3Pipeline`'s `source_catalog` step is on the executor allowlist
(`calibration/executor.py:78`) and runs in all three seed recipes — `image3` is
enabled with empty `step_overrides`, so the step fires at jwst defaults. It
writes `<product>_cat.ecsv`: STScI-calibrated RA/Dec positions, aperture fluxes,
AB magnitudes, and uncertainties.

That file is then thrown away. `_persist_outputs` keeps only what matches
`recipe.output_suffixes` (`["_i2d"]`), and `executor.py:744` does `rmtree` on the
workdir. The app computes the only citable numbers it has and deletes them on
every run.

## Change

Emit the catalog, then let it be saved to the library and read in the existing
`TableViewer` — rather than building a second table UI.

### 1. Emit

Add `"_cat"` to `output_suffixes` in the three seed recipes.
`_persist_outputs` matches on `path.stem.endswith(suffix)`, so `"_cat"` captures
`<product>_cat.ecsv` with no code change. `RecipeStore.seed()` runs at startup
(`processing-engine/main.py:57`) and `upsert()` replaces seed documents whole, so
the change reaches existing recipe docs on next boot — no migration.

### 2. Read ECSV in the table endpoints

`app/analysis/routes.py` — `get_table_data` already converts to an
`astropy.table.Table` internally; only HDU enumeration and column metadata are
FITS-specific. Add a small adapter returning a uniform `(columns, table)` from
either a FITS table HDU or an ECSV file, and branch both endpoints on the file
extension. ECSV reports one synthetic HDU at index 0.

`resolve_fits_path` needs no change — it validates traversal and existence, not
extension.

### 3. Let non-image outputs reach the library

`app/jobs/routes.py` — `_PREVIEWABLE_SUFFIXES` stays FITS-only; it means *image
preview* and that is still correct. Add `_TABULAR_SUFFIXES` and let
`save_output_to_library` accept it.

`level_for_suffix("_cat")` already returns `L3` — `library/levels.py` added
`_cat` deliberately so a saved catalog is not levelless.

### 4. Split "previewable" from "saveable" in the UI

`src/pages/RunDetail.tsx` — one `previewable` flag currently gates both the image
preview and the Save-to-library button, so a catalog cannot be saved at all.
Split into `isPreviewable` (image) and `isTabular` (ECSV); tabular outputs get
Save to library plus View catalog, which mounts the existing `TableViewer` on the
resulting `dataId`. ASDF outputs keep the "not an image" hint.

## Out of scope

- Cross-matching or plotting the catalog (that is S7).
- Any change to what the pipeline computes — the catalog already exists.
- Pagination tuning: `_cat.ecsv` files are kB-scale, so the existing paging is
  cosmetic here and is reused rather than special-cased.

## Test plan

- Python: table-info and table-data against an ECSV fixture; save-to-library
  accepts a `_cat` output; the three seeds still validate against
  `CalibrationRecipe`.
- Frontend: an ECSV output offers Save and View but not image preview; FITS
  outputs behave exactly as before.
- Manual: run a seed recipe, confirm `_cat.ecsv` appears in Outputs, save it,
  open it in the table viewer.
