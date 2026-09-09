# Plan: Render zoom memory guard

- **Status:** done
- **Spec:** [1105-zoom-memory-guard](../../design/1105-zoom-memory-guard.md)
- **Branch:** `feature/card-1105`
- **Issue:** #1105, #1825

## Approach

Add container-aware memory diagnostics, guard both render zoom calls, and move
FITS size validation ahead of payload access. Preserve interpolation and output.

## Steps

1. Add available_memory_bytes and check_zoom_memory in app/diagnostics.py; prove
   fallback, cgroup headroom, exhausted budget and threshold/dtype behaviour.
2. Guard preview/pixeldata zoom and translate MemoryError to 413; prove rejected
   requests never call scipy and real allocation failures return 413.
3. Validate header shape in preview/histogram/pixeldata/thumbnail; prove oversized
   lazy HDUs are rejected without data access and tables are skipped.
4. Run Python lint/format and Docker pytest, review against REVIEW.md, then push
   and open a non-draft PR. Do not merge.

## Files changed

| File | Change |
|------|--------|
| processing-engine/app/diagnostics.py | Memory availability and zoom estimate |
| processing-engine/app/render/routes.py | Guard, 413 mapping, header-first validation |
| processing-engine/tests/test_render_memory.py | Unit and route regressions |

## Test plan

1. Docker pytest tests/test_render_memory.py: all guard, status, payload ordering
   and successful FITS route cases pass (unit/in-process HTTP coverage).
2. Commit hook: Python lint, formatting and documentation consistency pass.
3. Docker pytest full default suite passes; opt-in memory/calibration suites
   retain their existing exclusion. No browser UI or cross-service flow changes.

### Validation results (2026-09-06)

- Focused regression suite: 30 passed.
- Full Docker pytest with isolated MongoDB: 2,113 passed, 2 deselected;
  79.36% coverage (60% CI threshold passed).
- Frontend: 1,819 tests passed; lint has zero errors (122 warnings), format and
  TypeScript checks passed. .NET: 1,185 tests passed; build has zero warnings/errors.
- Commit hooks: Python lint/format, secrets and documentation consistency passed.
- REVIEW.md self-review: no unresolved findings; both zoom consumers and the CE
  facade error propagation inspected. Session retro: provision CI's MongoDB
  dependency before full-suite runs; the first run had only missing-URI errors.

## Rollback

Revert the implementation commit to restore prior render behaviour.

## Blast radius

Render routes and their CE facade callers can now receive 413 under memory
pressure. No auth, persistence, storage implementation or deployment changes.

## Reviews

CEO review (hold authorized scope): proceed. HIGH risk (10/10): payload access
before the cap defeats compressed FITS protection; R4 resolves it. MED risk
(10/10): memory.max alone ignores live usage; R1 resolves it. Existing diagnostics,
FITS cap and render concurrency gate are reused. No diagrams in scope.

Engineering review: simple, sound, no unresolved decisions. Tests cover budget
fallbacks, threshold boundaries, both route error paths and lazy HDU rejection.
Sequential implementation, no parallelization opportunity. Document the new
failure behaviour in this spec; no new endpoint or architecture map changes.

## Out of scope

- Render concurrency gate changes (#1664).
- Container-based slot sizing (#1773).
