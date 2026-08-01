# Derived product names + FilePath identity (#1803)

Implements options 4 and 3 from [#1803](https://github.com/Snoww3d/jwst-data-analysis/issues/1803).

## Problem

`Save to library` returned a 500 on the second run of any recipe.

`jwst_data` had a unique index on `(UserId, FileName)`, while
`save_output_to_library` checked for a re-save by **FilePath**. The storage key
embeds the job id, so a second run had a different FilePath but an identical
FileName: the guard passed, the insert hit the index, and `DuplicateKeyError`
escaped as a 500.

Identical because the filename came from the recipe, not the data:

```json
"association": { "rule": "DMS_Level3_Base", "product_name": "miri-imaging" }
```

Every run of MIRI Imaging — any target, any settings — wrote
`miri-imaging_i2d.fits`.

## Two problems, kept separate

- **Provenance** ("did this app make it, or did it come from MAST?") belongs in
  the name.
- **Repeat runs** do not. Two runs of the same data produce products with the
  same identity; only the *settings* differ, and settings are run metadata.
  Encoding them in the filename means inventing a slug.

## Option 4 — name products after the data

New `app/calibration/product_naming.py` derives, from the run's own exposures:

```
jw{program}-{acid}_{instrument}_{optical elements}
jw01040-a3001_miri_f770w
```

`acid` is the association candidate ID, and it carries provenance.
`jwst.associations.lib.acid` defines `oXXX` for PPS-planned OBSERVATION, `c1XXX`
for MOSAIC, and `a3XXX` for **DISCOVERED** — associations built
programmatically, which is what `asn_from_list` does here.

| Origin | Product name |
| --- | --- |
| MAST download | `jw01040-o001_t001_miri_f770w_i2d.fits` |
| This app | `jw01040-a3001_miri_f770w_i2d.fits` |

Decisions:

- **Optical elements are sorted alphabetically**, matching the archive —
  existing library records read `nircam_clear-f200w` (FILTER=F200W, PUPIL=CLEAR)
  and `nircam_f444w-f470n` (FILTER=F444W, PUPIL=F470N). Both sorted, not
  filter-then-pupil.
- **No `t###` target field.** It is assigned by PPS and cannot be known from the
  exposures; emitting a plausible-looking `t001` would invent an identifier.
- **Multi-observation → `a3000`.** A mosaic across visits has no single
  observation to be named after.
- **Mixed filters → no optics segment.** Naming a colour association after one
  of its filters would mislead.
- **Never raises.** An unreadable header falls back to the recipe's own name —
  the previous behaviour. A naming failure must not cost a multi-hour run.

Derived **once**, in `_execute`, because the same string must reach both the
association (which names the files) and the `_persist_outputs` prefix (which
finds them again). Deriving twice risks them disagreeing.

## Option 3 — identity is the storage key

- `idx_userId_fileName_unique` → **`idx_userId_filePath_unique`**, with an
  explicit drop of the old index alongside the existing `idx_fileName_unique`
  migration.
- **`DeduplicateRecordsAsync` now groups by `(UserId, FilePath)`.** This is the
  trap: it runs on every startup, so leaving it on FileName while the index
  permits repeated names would delete the extra records on the next boot —
  silently, after the user was told the save succeeded.
- `DuplicateKeyError` → **409** with a real message, instead of a 500 the UI
  could only render as "InternalServerError".

No data migration needed. Checked against the live dev database: 1,524 records,
0 missing FilePath, 0 duplicate `(UserId, FilePath)`.

## Out of scope

- Showing `_variant_description` in the library list so repeat runs are told
  apart by their settings. Worth a follow-up; the description is already written.
- Renaming existing records. Old records keep their names; nothing is
  retroactive.
- `MastController.GetByFileNameAsync` does a global `FirstOrDefault` on FileName
  and is now looser than it looks. Not touched here — filed separately.

## Test plan

- `tests/test_product_naming.py` — derivation, alphabetical optics, multi-obs,
  mixed filters, the `a3` provenance marker, no fabricated target, and every
  fallback path including an unreadable file.
- Output is fed through the real `Association` validator, since it becomes a
  filename.
- `test_duplicate_key_is_409_not_500` — regression for the 500.
- .NET dedup tests updated to the FilePath grouping key.
