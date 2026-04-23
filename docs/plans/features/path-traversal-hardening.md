# Path-Traversal & Filename Sanitization Hardening (Epic)

**Child issues**: #1094, #1095, #1160, #1212, #1249, #1255, #1257, #1258
**Labels**: security, backend, processing-engine, priority: high
**Risk**: Medium — touches file-resolution code on the download path; malicious MAST URIs have been demonstrated to bypass the current sanitizer in tests.
**Complexity**: Medium — 3 PRs, all in `processing-engine/app/mast/`.

---

## Why one epic

Every child ticket is a variant of the same defect class: *a string (filename,
URI, job_id, S3 key) is combined into a filesystem or object-store path without
a single authoritative validator.* Fixing them individually would churn the
same 4-5 files repeatedly, and inconsistent sanitizers are themselves a
vulnerability (e.g. #1212 hardens `DownloadStateManager` to `pathlib` while
#1160 is still the symlink-resolve gap in that same module).

## Scope

| # | Issue | Location | Defect |
|---|-------|----------|--------|
| 1 | #1095 | `s3_downloader.py`, `chunked_downloader.py` | URL-encoded `..` + mid-name `..` both bypass `SAFE_FILENAME_PATTERN` |
| 2 | #1257 | `s3_downloader.py` | Pattern allows double-extension filenames (`x.fits.sh`) |
| 3 | #1094 | `mast_service.py` (URI normaliser) + local-storage path check | URI decode order + storage-path containment |
| 4 | #1213 (already high) | `mast_service.py` | URL-decoding happens before validation — encoded-character bypass |
| 5 | #1249 | `mast_service.py` | Ad-hoc path-traversal checks duplicated; no shared helper |
| 6 | #1160 | `download_state_manager.py` | `normpath` + prefix check does not resolve symlinks |
| 7 | #1212 | `download_state_manager.py` | `os.path.normpath` should be `pathlib.Path.resolve().relative_to()` |
| 8 | #1255 | `chunked_downloader.py` | Same — `Path.resolve().relative_to()` for containment |
| 9 | #1258 | `storage/s3_storage.py` | No S3 key validation — traversal into sibling prefixes |

## Out of scope

- C# backend path handling (none of these findings apply there — `IsDataAccessible` is authorization, not path resolution)
- Frontend
- Changes to `obs_id` validation (already handled in `mast_service.py`)
- Any change to the fundamental download directory layout

---

## Target architecture

A single module `processing-engine/app/mast/path_security.py` exports:

```python
def sanitize_filename(raw: str) -> str | None:
    """Returns a safe basename, or None. Handles %-decode, \\ → /, null bytes,
    mid-name '..', whitelist regex. See #1095 quick plan for the reference
    implementation."""

def ensure_within(candidate: str | os.PathLike, root: str | os.PathLike) -> Path:
    """Resolves both paths (following symlinks) and asserts candidate is under
    root. Raises ValueError on violation. Replaces every ad-hoc
    `normpath + startswith` pattern in the codebase."""

def sanitize_s3_key(raw: str, allowed_prefix: str) -> str | None:
    """Validates an S3 object key: no leading `/`, no `..` segments, no URL
    encoding, must start with allowed_prefix. Returns the normalised key or
    None."""

def validate_mast_uri(raw: str) -> str | None:
    """Validates a MAST URI (mast:JWST/product/...) before any URL decoding.
    Rejects encoded `..`, encoded slashes, and unexpected schemes."""
```

Every call site currently using `_sanitize_filename`, `_is_path_within_directory`,
ad-hoc `normpath`, or direct `urllib.parse.unquote` in a path context imports
from this module. The three duplicate `SAFE_FILENAME_PATTERN` definitions
collapse to one.

---

## PR split (3 PRs)

### PR 1 — Shared utility + filename sanitizer (#1095, #1249, #1257)

- Create `app/mast/path_security.py` with `sanitize_filename` + `ensure_within`
- Migrate `s3_downloader.py` and `chunked_downloader.py` to use it
- Tighten `SAFE_FILENAME_PATTERN` per #1257 (reject double-extension patterns that end in a shell/script suffix when preceded by another extension)
- Exhaustive unit tests (see failure modes in #1095 quick plan)
- The existing `docs/plans/features/quick/1095-filename-sanitization-fix.md` is absorbed here; it can be deleted after the PR lands.

**Risk**: Low — internal helper, keeps `None`-return API so callers don't change signatures.

### PR 2 — Containment checks (#1160, #1212, #1255, #1258)

- Replace every `normpath + startswith` / `normpath + os.sep` pattern with `ensure_within()` from `path_security.py`
- Sites: `download_state_manager.py:47`, `s3_downloader.py:112`, `chunked_downloader.py:422`, any S3 key construction in `storage/s3_storage.py`
- `ensure_within` uses `Path.resolve(strict=False)` so **symlinks are resolved** (closes #1160)
- Add `sanitize_s3_key` and wire into the S3 storage provider (closes #1258)
- Tests: symlink-based escape attempt, `..` mid-segment, absolute-path injection, Windows-style `\` (defence-in-depth — we run on Linux, but cheap)

**Risk**: Medium — changes the exact error path/message for rejected paths. Must keep existing behaviour where callers expect a boolean or a `None` return rather than an exception. Wrap `ensure_within` in a boolean adapter at call sites that can't propagate exceptions yet.

### PR 3 — MAST URI validation order (#1094, #1213)

- Introduce `validate_mast_uri()` that runs **before** any `unquote()` call
- Update `_convert_mast_uris` in `mast_service.py:39` and any other MAST URI consumer
- Reject encoded `..`, encoded `/`, and non-`mast:` schemes before they reach the URL decoder
- Tests: `mast:JWST/product/%2e%2e/etc/passwd`, `mast:JWST/%2fetc%2fpasswd`, `file:///etc/passwd` masquerading as MAST

**Risk**: Low-to-medium — MAST responses we've seen are consistently well-formed, but any row that somehow contains a URL-encoded slash will start failing. Add a metric/log so we notice if this rejects production data.

---

## Testing

All three PRs must:

1. Add negative tests *before* the fix (TDD — red, then green)
2. Run inside Docker: `docker exec jwst-processing python -m pytest processing-engine/tests/mast/ -v`
3. Re-run the full engine suite to catch any call-site signature regressions
4. Include at least one integration test that downloads a real MAST file end-to-end with the new validators in the pipeline (to catch false positives)

## Rollout

Merge order: PR 1 → PR 2 → PR 3. Each closes its child issues with `Closes #N` in the body. After PR 3 lands, close this epic tracking issue.

## Acceptance (epic-level)

- [ ] Exactly one `SAFE_FILENAME_PATTERN` and one `sanitize_filename` across `processing-engine/`
- [ ] Zero direct calls to `os.path.normpath(...).startswith(...)` outside `path_security.py`
- [ ] Zero direct `urllib.parse.unquote` calls in filename or URI code paths outside `path_security.py` and `validate_mast_uri`
- [ ] All 8 child issues closed
- [ ] Full engine test suite passes in Docker
