# Plan: Render zoom memory guard

- **Status:** approved
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
