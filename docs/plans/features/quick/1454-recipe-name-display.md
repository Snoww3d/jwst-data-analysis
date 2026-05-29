# Fix #1454 — Clean up auto-generated recipe names

**Branch**: `fix/1454-recipe-name-display`
**Type**: UX bug fix (display strings), processing-engine, priority: nice-to-have
**Complexity**: Low–medium (helpers + ~14 name sites + test migration)

## Problem

Recipe titles showed raw MAST `instrument` strings:
`Best 6-filter MIRI/IMAGE+NIRCAM/IMAGE…` — the `/IMAGE` suffix is redundant
noise, the all-caps reads poorly, and the long name truncates in the UI.

## Fix (`processing-engine/app/discovery/recipe_engine.py`)

Three module-level helpers:

- `normalize_instrument_for_display(raw)` — `"NIRCAM/IMAGE"` → `"NIRCam"`
  (drop the dataproduct-kind suffix, canonical casing; unknown → title-case).
- `format_instruments_for_display(instruments)` — normalize + de-dupe + join
  with `" + "`, ordered short → long wavelength (NIRCam … MIRI).
- `_filter_count_phrase(n)` — `"1 filter"` / `"3 filters"` (correct plural;
  the naive `-filter` → ` filters` swap would have produced `"1 filters"`).

Applied at every `name=` site (cross-instrument → `format_instruments_for_display`,
single → `instrument_display`) and at the instrument-bearing `description=`
strings. New format: `Best 6 filters · NIRCam + MIRI`.

**The `instruments=[…]` data field stays raw** (MAST form) — only display
strings changed. Curated recipes (hardcoded names) are untouched.

## Tests (`tests/test_recipe_engine.py`)

- New `TestInstrumentDisplayNames`: helper unit tests (normalize, dedupe,
  ordering, singular/plural, empty, unknown-append) + integration tests for the
  single- and cross-instrument name formats.
- Migrated all existing old-format assertions/selectors (e.g.
  `"3-filter NIRCAM"` → `"3 filters · NIRCam"`, `"Narrowband NIRCAM"` →
  `"Narrowband NIRCam"`, `"NIRCAM+MIRI"` → `"NIRCam + MIRI"`).

## Out of scope (tracked)

Frontend recipe/target cards render `recipe.instruments.join(' + ')` (raw) in
their meta line — a separate display surface from the title #1454 targets.
Filed as follow-up **#1561** (TS display helper + e2e assertion update).

## Verification

Full processing-engine suite: **1424 passed**. Ruff clean. Two code-review rounds.
