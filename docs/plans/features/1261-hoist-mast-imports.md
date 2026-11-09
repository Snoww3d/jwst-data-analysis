# Issue #1261 - Hoist MAST Table Conversion Imports

Issue: https://github.com/Snoww3d/jwst-data-analysis/issues/1261

## Analysis

processing-engine/app/mast/mast_service.py contains function-local
imports of math, time, and numpy in _table_to_dict_list().
math already exists at module scope.

This is a code-quality cleanup, not a confirmed runtime failure.
The reported line numbers have shifted to approximately 1191-1194.

## Proposed Solution

- Keep the existing module-level math import.
- Move time and numpy imports to module scope.
- Remove the three local import statements.
- Do not change data conversion, exceptions, return values, or APIs.
- Verify that eager numpy import does not introduce an import-time problem.

## Implementation Plan

1. Record existing import locations as baseline evidence.
2. Add a focused regression test in
   processing-engine/tests/test_mast_import_placement.py.
3. Verify the regression test fails against the original code.
4. Move time and numpy to module scope and delete local imports.
5. Run the regression test and relevant existing MAST tests.
6. Run Ruff, syntax validation, and available repository checks.
7. Document test results and any environmental limitations.

## Plan Review Outcome

On November 8, 2026, /plan-ceo-review ran in Hold Scope mode and recommended proceeding with the import cleanup. The review was read-only; issue filing and automatic additional work were skipped. No maintainer approval is claimed.

The repository plan file is:
docs/plans/features/1261-hoist-mast-imports.md

## Testing Strategy

### Import-placement regression

New file:
processing-engine/tests/test_mast_import_placement.py

Use Python AST to verify:
- math, time, and numpy are imported at module level.
- None of these imports remain inside _table_to_dict_list.

Expected:
- Baseline: the regression test fails because local imports exist.
- Fixed branch: the regression test passes.

### Conversion behavior

Exercise _table_to_dict_list with a simple Astropy Table containing
string and numeric fields.

Compare the list-of-dictionaries output before and after the fix.
Expected: identical field names, values, and result structure.

### Existing regression tests

Run, where dependencies are available:

python -m pytest processing-engine/tests/test_mast_facet_search.py processing-engine/tests/test_mast_pagination.py processing-engine/tests/test_mast_search_geometry.py -q

Expected: relevant tests pass before and after the import cleanup.
Some tests mock the conversion function, so these provide surrounding
regression coverage rather than direct conversion verification.

### Code quality and import behavior

python -m ruff check processing-engine
python -m py_compile processing-engine/app/mast/mast_service.py

Expected: both return exit code 0.

Attempt module import in the supported Python environment to check
that moving numpy to module scope is safe. Record failures honestly
if required dependencies are unavailable.

## Risk and Rollback

Risk: importing numpy eagerly could change module import behavior.

Rollback: revert the import-only change and its regression test.

No database, API, authentication, frontend, or infrastructure
changes are planned.
