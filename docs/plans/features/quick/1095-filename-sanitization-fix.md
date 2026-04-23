# Plan: Fix Filename Sanitization Bypasses in S3 and Chunked Downloaders

**Issue:** #1095
**Labels:** backend, security, priority: high
**Complexity:** Quick (single module, pure Python, no schema/API changes)

---

## CEO Review

### Right problem?
Yes. Both `_sanitize_filename` implementations have the same two concrete gaps:

1. **URL-encoded traversal** (`%2e%2e/etc/passwd`): neither function calls
   `urllib.parse.unquote` before checking for `..`, so percent-encoded variants
   slip through the `..` check and past `os.path.basename`.

2. **Mid-name double-dot in chunked_downloader**: the `..` strip runs before the
   `SAFE_FILENAME_PATTERN` regex. The regex `[A-Za-z0-9_\-.]+` does **not** block
   `..` in the middle of a name (e.g. `"file..name"`). After `os.path.basename`
   that name contains no slash, so the strip doesn't fire, and it passes validation.

The existing `_is_path_within_directory` defense-in-depth catch is the last
safety net but shouldn't be relied on as the primary sanitizer.

### Already implemented?
No. Test coverage for both files is missing the URL-encoded and mid-name
double-dot cases. No shared utility module exists.

### Reversal cost
Low — internal Python helper, no public API or DB schema touched. Could be
reverted in under 30 minutes.

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Valid FITS filenames containing `..` mid-name (e.g. `jw02733..001.fits`) | Low | MAST filenames follow strict STScI naming; none use `..` legitimately |
| Switching to `raise ValueError` at utility level breaks call-site loop | Medium | Keep `None`-return API at the wrapper layer; raise only in the new shared helper if desired, or keep None-return throughout — see decision below |
| `PurePosixPath` on Windows paths | Negligible | Runs in Docker/Linux only |

**Decision on raise vs None:** Keep `None`-return API to avoid touching all call
sites. The shared helper returns `None` for invalid names; callers already handle
this with `continue`/`skipped` counters.

### NOT in scope
- `obs_id` validation (already covered in `mast_service.py`)
- C# backend, frontend, MongoDB schema
- Changes to `_is_path_within_directory` (it's correct as-is)

---

## Engineering Plan

### Approach
Extract a single hardened `sanitize_filename` into a new shared module
`processing-engine/app/mast/download_utils.py`. Both downloaders import from it.
Remove the duplicate `SAFE_FILENAME_PATTERN` and `_sanitize_filename` definitions.

### Corrected algorithm

```python
# processing-engine/app/mast/download_utils.py
from __future__ import annotations

import re
from pathlib import PurePosixPath
from urllib.parse import unquote

import logging

logger = logging.getLogger(__name__)

# Whitelist: alphanumeric, underscore, hyphen, single dots only
# Note: this blocks ".." at any position because the fullmatch catches it via
# the post-check below; the regex itself allows dots so FITS names like
# "jw02733001001_02101_00001_nircam_cal.fits" pass cleanly.
SAFE_FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9_\-.]+$")


def sanitize_filename(raw: str) -> str | None:
    """
    Sanitize a filename to prevent path traversal attacks.

    Steps:
    1. URL-decode to catch %2e%2e variants.
    2. Strip all directory components using PurePosixPath.name (handles both
       / and \\ separators after replace).
    3. Null-byte removal.
    4. Whitespace strip.
    5. Explicit ".." rejection (catches mid-name patterns like "file..name").
    6. Whitelist regex fullmatch.

    Returns the sanitized filename, or None if it is invalid/dangerous.
    """
    if not raw:
        return None

    # Step 1: URL-decode (%2e%2e, %2f, etc.)
    decoded = unquote(raw)

    # Step 2: Strip all directory components (handles / and \)
    name = PurePosixPath(decoded.replace("\\", "/")).name

    # Step 3: Remove null bytes
    name = name.replace("\x00", "")

    # Step 4: Strip whitespace
    name = name.strip()

    if not name:
        return None

    # Step 5: Reject any ".." anywhere in the name
    if ".." in name:
        logger.warning("Filename contains parent-directory reference: %.50s", raw)
        return None

    # Step 6: Whitelist check
    if not SAFE_FILENAME_PATTERN.fullmatch(name):
        logger.warning("Filename contains invalid characters: %.50s", name)
        return None

    return name
```

### Files changed

| File | Change |
|---|---|
| `processing-engine/app/mast/download_utils.py` | **New** — shared `sanitize_filename` + `SAFE_FILENAME_PATTERN` |
| `processing-engine/app/mast/s3_downloader.py` | Remove `_sanitize_filename` + local `SAFE_FILENAME_PATTERN`; import `sanitize_filename` from `download_utils`; update call sites |
| `processing-engine/app/mast/chunked_downloader.py` | Same removals; import from `download_utils`; update call sites |
| `processing-engine/tests/mast/test_download_utils.py` | **New** — exhaustive tests for `sanitize_filename` |
| `processing-engine/tests/test_s3_downloader.py` | Update traversal test expectations if needed (current `passwd` test may now return `None` for `%2e` forms) |

### Failure modes to test

- `"../../../etc/passwd"` → `None`
- `"%2e%2e/%2e%2e/etc/passwd"` → `None`
- `"file\\..\\other"` (Windows backslash) → `None`
- `"file..name"` → `None` (mid-name double-dot)
- `"\x00evil"` → `None`
- `"  "` → `None`
- `""` → `None`
- `"jw02733001001_02101_00001_nircam_cal.fits"` → passes (valid FITS name)
- `"test-image_1.2.fits"` → passes (single dots OK)
- `"bad<file>.fits"` → `None` (invalid char)

### Call-site wiring

Both downloaders call `_sanitize_filename(raw_filename)` today. After the change,
both call `sanitize_filename(raw_filename)` (no underscore prefix — it's now a
public utility). The existing `if filename is None: ... continue` guard remains
unchanged.

### Test plan

**TDD order:**
1. Write `tests/mast/test_download_utils.py` covering all failure modes above → RED
2. Implement `download_utils.py` → GREEN
3. Refactor `s3_downloader.py` and `chunked_downloader.py` to import and use it
4. Run full pytest suite inside Docker: `docker exec jwst-processing python -m pytest`
5. Verify existing `test_s3_downloader.py::test_sanitizes_traversal_filenames` still passes (the `"../../../etc/passwd"` traversal case was already handled — only the URL-encoded variant was new)

**Manual smoke test:**
Not applicable — no UI change. Docker unit test run is sufficient.

### Docs update checklist
- No public endpoints changed, no controller added → doc update not required.

---

## Implementation sequence

1. Branch: `feature/1095-filename-sanitization`
2. Write failing tests in `tests/mast/test_download_utils.py`
3. Create `app/mast/download_utils.py` with `sanitize_filename`
4. Refactor both downloader files to import from `download_utils`
5. Run pytest, confirm all green
6. PR → `Closes #1095`
