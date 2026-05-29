# Fix #1540 — Unescaped double-quotes in S3 presigned-URL Content-Disposition

**Branch**: `fix/1540-s3-content-disposition-escaping`
**Type**: Bug fix (correctness + header-injection hardening), backend (.NET), priority: medium
**Complexity**: Low (single helper + tests)

## Problem

`S3StorageProvider.GetPresignedUrlAsync` built the `Content-Disposition`
response-header override by interpolating the filename between double-quotes:
`$"attachment; filename=\"{downloadFilename}\""`. A filename containing a `"`
produces an RFC 6266-invalid header → S3 returns HTTP 400 → the presigned
download silently breaks. CR/LF in the filename is a header-injection vector.
The `LocalStorageProvider` path is unaffected (ASP.NET builds the header safely).

## Fix

Extract an `internal static BuildContentDisposition(string filename)` helper
(exposed to tests via the existing `InternalsVisibleTo`):

1. Strip the full control-char range (`char.IsControl` — CR/LF + TAB/NUL/DEL/C1),
   then escape `\` and `"` per RFC 6266 §4.1 (strip → escape ordering).
2. For non-ASCII names, append an RFC 5987 `filename*=UTF-8''<percent-encoded>`
   parameter. `Uri.EscapeDataString` leaves `' ( ) *` raw on .NET, so those are
   percent-encoded explicitly (`%27 %28 %29 %2A`) to stay attr-char-conformant.

Wired into `GetPresignedUrlAsync` in place of the raw interpolation.

## Tests (new `S3StorageProviderTests.cs`)

- Plain ASCII name → quoted as-is, no `filename*`.
- `"` → `\"`, `\` → `\\` (exact-string).
- CR/LF + TAB/NUL/DEL stripped.
- Non-ASCII → `filename*=UTF-8''` with percent-encoding.
- Combined non-ASCII + `"` + `'` → `n%C3%A1%22me%27s.fits`.

## Scope check

Verified the other backend Content-Disposition call sites
(`MosaicController`, `CompositeController`, `JwstDataController`, `JobsController`,
`DataManagementController`) all use ASP.NET `File(...)`/`FileResult`, which builds
the header via `ContentDispositionHeaderValue` and is not vulnerable. The S3
presigned-URL path was the only hand-built header.

## Verification

`dotnet test --filter S3StorageProviderTests` — 12 passed. No new StyleCop warnings.
Two rounds of code-reviewer.
