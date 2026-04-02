# JWST Data Analysis — Code Review Summary
**Date:** 2026-04-02  
**Reviewer:** Claude Code (automated)  
**Scope:** Full codebase (~100,000 LOC — C#, TypeScript/React, Python)

---

## RECENT PULL REQUESTS (Last 24 Hours)

5 PRs merged on 2026-04-01:

| PR | Title | Author |
|----|-------|--------|
| #937 | docs: add April 2026 monthly git history audit | Shanon Clemmons |
| #931 | chore(deps): Bump react-router-dom in /frontend/jwst-frontend | dependabot[bot] |
| #930 | chore(deps): Bump @rolldown/binding-linux-arm64-musl | dependabot[bot] |
| #929 | chore(deps-dev): Bump jsdom in /frontend/jwst-frontend | dependabot[bot] |
| #928 | chore(deps-dev): Bump @vitest/coverage-v8 in /frontend/jwst-frontend | dependabot[bot] |

All 5 merges are dependency bumps or documentation; no logic changes in any of them.

---

## OVERALL ASSESSMENT

**Risk Level:** LOW  
**Code Quality Score:** 7.5 / 10

The codebase is well-structured and production-ready. No critical defects were found. Issues are primarily around code organization (DRY), function decomposition, and minor logging inconsistencies.

---

## DEAD CODE

| Severity | Location | Issue |
|----------|----------|-------|
| MEDIUM | `processing-engine/app/processing/analysis.py:33-35` | Mock data fallback silently replaces missing FITS file. Code `np.random.normal(100, 10, (100, 100))` runs in production when `file_path` is absent, masking configuration errors. Should raise explicitly. |
| LOW | `frontend/jwst-frontend/src/index.tsx:12` | `window.jwst` debug helpers left in place. Tracked as issue #840 with a TODO comment. Must be removed before community release. |

No unused imports, unused exports, or orphaned commented-out blocks were found in Python, TypeScript, or C# files.

---

## CODE QUALITY ISSUES

### Medium Priority

**1. `auto_stretch_params()` is a 144-line monolith**  
`processing-engine/app/composite/auto_stretch.py:30-174`  
Cyclomatic complexity ~12. Single function handles noise calculation, dynamic range detection, black/white point derivation, gamma computation, curve selection, and instrument-specific adjustments.  
*Recommendation:* Extract into sub-functions: `_compute_noise_and_range()`, `_detect_hdr()`, `_compute_black_white_points()`, `_compute_gamma()`, `_apply_instrument_adjustments()`.

**2. Duplicated search endpoint logic**  
`processing-engine/app/mast/routes.py:115-156`  
Four search endpoints (`search_by_target`, `search_by_coordinates`, `search_by_observation_id`, `search_by_program_id`) each re-implement identical cache/timeout/logging logic.  
*Recommendation:* Extract a `_cached_search(search_key, search_func, cache_dict, cache_ttl, timeout)` wrapper.

**3. No validation of `file_path` before use**  
`processing-engine/app/processing/analysis.py:29-40`  
`file_path` from request parameters is passed directly to `load_fits_data()` without checking for path traversal or symlink attacks.  
*Recommendation:* Validate against a known base directory (same pattern already used in `mast_service._safe_obs_dir()`).

### Low Priority

**4. Generic `except Exception` blocks**  
`processing-engine/app/semantic/embedding_service.py:79, 138`  
Broad catches mask the specific error type. Should narrow to `OSError`, `IOError`, `json.JSONDecodeError`, etc.

**5. Inconsistent `exc_info` usage**  
`processing-engine/app/processing/pipeline.py:193` logs without `exc_info=True`, losing traceback. Other files (e.g. `embedding_service.py:79`) include it.  
*Recommendation:* Always pass `exc_info=True` when logging exceptions.

**6. `recipe_engine.py` returns `None` instead of `[]`**  
`processing-engine/app/discovery/recipe_engine.py:20`  
`return ids or None` forces every caller to handle `None` separately. An empty list is a cleaner contract.

---

## SECURITY REVIEW

### No Critical Issues Found

| Item | Status | Location |
|------|--------|----------|
| SSRF prevention | EXCELLENT — multi-layer validation with whitelist regex, path traversal check, URL encoding, and blocked-attempt logging | `app/mast/mast_service.py:87-134` |
| JWT default key guard | EXCELLENT — throws at startup in non-development environments if placeholder key detected | `backend/.../Program.cs:70-76` |
| Rate limiting | Configured | `backend/.../Program.cs:34-38` |
| Input validation (obs_id) | Present and consistent | `app/mast/models.py:59-76` |
| MAST URI regex | Simple, no ReDoS risk | `app/mast/mast_service.py:60` |

**One gap:** `_safe_obs_dir()` blocks path traversal but does not defend against symlink attacks.  
**One gap:** `target_name` in search requests is passed to astroquery without explicit validation; relies entirely on astroquery's internal handling.  
**One gap:** `wavelengthUm` is not clamped to the valid JWST range (0.6–28 µm) before use in `get_pixel_scale()`.

---

## TODOS / UNFINISHED WORK

| File | Comment | Linked Issue |
|------|---------|--------------|
| `frontend/jwst-frontend/src/index.tsx:12` | `// TODO(v1): Remove window.jwst debug helpers before community release` | #840 |

No other FIXME or TODO markers found across the codebase.

---

## RECOMMENDED ACTIONS

### Immediate (P0)
1. Remove `window.jwst` debug helpers from `index.tsx` — tracked as #840, do this before any public release.
2. Fix `analysis.py` to raise explicitly when no `file_path` is provided instead of falling back to mock data.
3. Add `file_path` validation against base directory in the analysis endpoint.

### Short-term (P1)
4. Decompose `auto_stretch_params()` into focused sub-functions.
5. Extract shared MAST search wrapper to eliminate duplicated cache/timeout logic.
6. Standardize exception logging to always include `exc_info=True`.
7. Replace generic `except Exception` with specific exception types in `embedding_service.py`.

### Medium-term (P2)
8. Add symlink attack prevention in `_safe_obs_dir()`.
9. Add explicit input validation for `target_name` and `wavelengthUm` ranges.
10. Split `mast/routes.py` (650+ lines) into `search_routes.py` and `download_routes.py`.

### Long-term (P3)
11. Add pylint/flake8 to CI for Python complexity enforcement.
12. Add pre-commit hooks for linting (`.pre-commit-config.yaml` exists but verify coverage).
13. Add Architecture Decision Records (ADRs) for key design choices.

---

## CODEBASE STRENGTHS

- Strong type safety across all three languages (TypeScript, C# Data Annotations, Python Pydantic)
- Clean separation of concerns: Controllers → Services → Data access in backend; Routes → Business logic → Utilities in engine
- Security-first design: SSRF prevention, JWT key guard, rate limiting, validated MAST URIs
- Storage abstraction with pluggable backends (local/S3) via clean factory pattern
- 40+ Python test files + React component tests covering critical paths
- No significant commented-out code or unused import clutter
