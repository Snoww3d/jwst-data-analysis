# Plan: Fix Data Enumeration in MosaicController.GenerateAndSaveMosaic

**Issue**: #1173
**Branch**: `fix/1173-mosaic-generate-and-save-enumeration`
**Complexity**: Quick (trivial fix — one catch block, one test update)

---

## CEO Review (Mode C)

### Right problem?

Partially. The issue description misidentifies the endpoint. It says "line 192 is `SaveMosaic`" — but in the actual file, line 192 is inside `GenerateAndSaveMosaic` (`POST /generate-and-save`). The real `SaveMosaic` (`POST /save`) is a queue-dispatch endpoint with no `UnauthorizedAccessException` catch and no enumeration risk. The vulnerability *is* real, just in a different endpoint than the description states.

### Does it already exist?

PR #1174 (which closed #1092) touched `MosaicController.cs` but only standardized message bodies for `GenerateMosaic` and `GetFootprint`. It left the `return Forbid()` at line 192 (`GenerateAndSaveMosaic`) untouched.

### Reversal cost?

None. One-line response code change in a single catch block. No data model, no storage, no API contract change. Rip-out time: minutes.

### Risks with severity

| Risk | Severity | Disposition |
|------|----------|-------------|
| The endpoint is Auth-only (`[Authorize]`, no `[AllowAnonymous]`) — anonymous callers never reach line 192; ASP.NET returns 401 at middleware. The "anonymous enumeration" framing in the issue is technically incorrect. The actual risk is **authenticated-user enumeration** (auth user probes IDs, gets 403 vs 404 to distinguish "exists but private" from "missing"). | Medium | Fix it anyway — the principle of least information is correct here, and the security-model doc's "Data Read Access" section says "Most endpoints return 404 to prevent enumeration." `GenerateAndSaveMosaic` should be consistent. |
| The security-model.md "Computed/Generated Data" table shows `POST /generate-and-save` with no enumeration-prevention note. After this fix, that row needs a note like the Analysis endpoints ("Auth: 403 if accessible; 404 if inaccessible"). | Low | Fix in-scope; update docs in same PR. |
| `GenerateAndSaveMosaic_ReturnsForbid_OnUnauthorizedAccessException` test must be updated to assert `NotFoundObjectResult`. This is the only behavioral test change. | Low | Expected; test must change to match new behavior. |

### Risk → issue triage

No new issues warranted. All risks are handled inline.

### NOT in scope

- `[Authorize]` vs `[AllowAnonymous]` audit of the whole controller (tracked by #1071)
- Centralizing `IsDataAccessible()` (tracked by #1071)
- The `ExportMosaic` endpoint (`POST /export`) — it already handles auth via `GetCurrentUserId()` null-check returning 401, and has no `UnauthorizedAccessException` catch; no risk.
- The `SaveMosaic` endpoint (`POST /save`) — same pattern as `ExportMosaic`; no risk.

---

## Eng Review

### Architecture

`GenerateAndSaveMosaic` sits under the class-level `[Authorize]` attribute and calls `mosaicService.GenerateAndSaveMosaicAsync(...)`, which performs `CanAccessData()` checks at the service layer (service-level auth for background job compatibility — see security-model.md §4). When the service throws `UnauthorizedAccessException`, the controller currently returns a bare `Forbid()`. Since the endpoint requires authentication, an authenticated user whose request is denied gets 403; a missing record gets 404. These two status codes allow enumeration of valid data IDs.

The fix follows the exact pattern established by `GenerateMosaic` (line 103) and `GetFootprint` (line 262) — both of which were already correct or fixed in PR #1174:

```csharp
// Before (line 192)
catch (UnauthorizedAccessException ex)
{
    LogInvalidOperation(ex.Message);
    return Forbid();
}

// After
catch (UnauthorizedAccessException ex)
{
    LogInvalidOperation(ex.Message);
    var isAuthenticated = User.Identity?.IsAuthenticated ?? false;
    return isAuthenticated ? Forbid() : NotFound(new { error = "The requested data was not found." });
}
```

Note: `isAuthenticated` is captured at the top of `GenerateMosaic` and `GetFootprint` before the try block; `GenerateAndSaveMosaic` computes it inside the try block (line 168). Moving it before the try block is the cleanest approach, matching sibling endpoints. However, since `GenerateAndSaveMosaic` is `[Authorize]`-only, `isAuthenticated` will always be true in production — the `NotFound` branch is only reachable in unit tests with a mocked unauthenticated context. The fix is still correct and defensive.

### Files Changed Table

| File | Change |
|------|--------|
| `backend/JwstDataAnalysis.API/Controllers/MosaicController.cs` | Move `isAuthenticated` capture before the try block in `GenerateAndSaveMosaic`; change `return Forbid()` to `return isAuthenticated ? Forbid() : NotFound(...)` in the `UnauthorizedAccessException` catch |
| `backend/JwstDataAnalysis.API.Tests/Controllers/MosaicControllerTests.cs` | Update `GenerateAndSaveMosaic_ReturnsForbid_OnUnauthorizedAccessException` → split into two tests: auth user → `ForbidResult`, anon user → `NotFoundObjectResult`. Add indistinguishability test: same body for KeyNotFoundException and UnauthorizedAccessException (auth user path). |
| `docs/architecture/security-model.md` | Update MosaicController table row for `POST /generate-and-save` to add "Auth: 403 if accessible; 404 if inaccessible" note. Update "Last updated" timestamp. Fix `#571` Known Gap to reference `#1071` (the current tracking issue for deduplication). |

### Failure Modes

| Scenario | Before | After |
|----------|--------|-------|
| Authenticated user probes private data ID via `generate-and-save` | 403 (leaks existence) | 403 (unchanged — user is authenticated) |
| Authenticated user probes non-existent data ID via `generate-and-save` | 404 | 404 (unchanged) |
| Anonymous user hits `generate-and-save` | 401 (ASP.NET middleware, never reaches controller) | 401 (unchanged) |
| Unit test simulates unauthenticated user context with `UnauthorizedAccessException` | ForbidResult (wrong) | NotFoundObjectResult (correct) |

Wait — re-reading: since the endpoint is `[Authorize]`, authenticated users who are denied still get `Forbid()` after the fix (the `isAuthenticated ? Forbid() : NotFound(...)` path). The only behavioral change is in the unit-test-only unauthenticated context. In production this is a defensive fix.

The more meaningful impact: this closes the pattern-inconsistency gap that #1071 will fully eliminate. If someone later adds `[AllowAnonymous]` to this endpoint (e.g., to support anonymous composite previews like `generate-nchannel`), the enumeration protection is already in place.

### Test Plan Artifact

**Pre-conditions**: Docker stack running, `docker exec jwst-processing python -m pytest` baseline passing.

**Automated tests** (run `dotnet test` in `backend/`):
- [ ] `GenerateAndSaveMosaic_ReturnsForbid_OnUnauthorizedAccessException` (renamed/split) — authenticated path returns `ForbidResult`
- [ ] `GenerateAndSaveMosaic_ReturnsNotFound_WhenAnonymousUserLacksAccess` (new) — unauthenticated context returns `NotFoundObjectResult`
- [ ] All existing `GenerateAndSaveMosaic_*` tests still pass (no regression)
- [ ] Total test count increases by 1 (one test split into two)

**Manual verification** (low priority — production path unchanged):
- [ ] As authenticated user, `POST /api/mosaic/generate-and-save` with valid accessible data → 201 Created
- [ ] As authenticated user, `POST /api/mosaic/generate-and-save` with private data belonging to another user → 403 Forbidden (unchanged behavior, correct)
- [ ] As unauthenticated caller, `POST /api/mosaic/generate-and-save` → 401 Unauthorized (middleware blocks, unchanged)

### Docs Update Checklist

- [ ] `docs/architecture/security-model.md` — MosaicController table: add note to `POST /generate-and-save` row
- [ ] `docs/architecture/security-model.md` — "Last updated" header: update to 2026-04-15
- [ ] `docs/architecture/security-model.md` — Known Gaps: `#571` reference is stale, update to `#1071`

---

## Implementation Steps

1. Create branch: `fix/1173-mosaic-generate-and-save-enumeration`
2. In `MosaicController.cs`, `GenerateAndSaveMosaic`: move `isAuthenticated` capture to before the try block (line ~168 → before line 159). Update `UnauthorizedAccessException` catch to return `isAuthenticated ? Forbid() : NotFound(new { error = "The requested data was not found." })`.
3. In `MosaicControllerTests.cs`: update the existing `GenerateAndSaveMosaic_ReturnsForbid_OnUnauthorizedAccessException` test to assert `ForbidResult` (authenticated path); add `GenerateAndSaveMosaic_ReturnsNotFound_WhenAnonymousUserLacksAccess` that calls `SetupUnauthenticatedUser()` and asserts `NotFoundObjectResult`.
4. Update `security-model.md` per the docs checklist above.
5. Run `dotnet test` — confirm all pass, count +1.
6. Run pre-commit hook (build + test + secrets scan).
7. Create PR, close #1173.
