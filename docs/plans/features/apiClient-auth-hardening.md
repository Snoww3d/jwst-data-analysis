# apiClient.ts Auth Hardening (Epic)

**Child issues**: #1218, #1263, #1264, #1224
**Labels**: frontend, bug, priority: high
**Risk**: High — auth code path; CLAUDE.md explicitly flags it as fragile.
**Complexity**: Medium — one file (~540 lines) + test additions.

---

## Why one epic

All four child issues describe *the same underlying design flaw*:
`apiClient.ts` uses three mutable module-level globals (`getAccessToken`,
`refreshTokenCallback`, `refreshPromise`, plus `wasAuthenticated`) to coordinate
authentication. These globals are:

- **Race-prone across tabs** (#1218) — two tabs can start a refresh, one
  succeeds, the other's stale token write clobbers the fresh one.
- **Race-prone within one tab** (#1264) — the `refreshPromise` guard works
  only within a single module instance and relies on the event loop ordering.
- **Silently swallow errors** (#1263) — `authLog()` and `getAuthLogs()` catch
  exceptions with bare `{}` blocks. If `sessionStorage` throws (Safari private
  mode, quota exceeded), the failure is invisible.
- **Not covered by tests** (#1224) — no test asserts behaviour under concurrent
  401s or concurrent tab refreshes.

Fixing them one at a time would require re-touching the same ~100-line
auth-coordination block 3 times and shipping an incomplete fix on the way.

## Scope

| # | Issue | Symptom |
|---|-------|---------|
| 1 | #1218 | Two tabs hit a 401 simultaneously; both call `attemptTokenRefresh`; the second tab's call reads the first tab's *old* refresh token from localStorage, fails, and clears auth |
| 2 | #1264 | `getAccessToken`, `refreshTokenCallback`, `refreshPromise`, `wasAuthenticated` are mutable module-level `let` bindings with no synchronisation |
| 3 | #1263 | `authLog`, `getAuthLogs` swallow sessionStorage errors with bare catch blocks |
| 4 | #1224 | No test coverage for concurrent-401 or cross-tab refresh |

## Out of scope

- The backend refresh-token rotation scheme (out of scope until #1186 admin-unlock work)
- `AuthContext.tsx` — callers register via `setTokenGetter`/`setTokenRefresher`; that API stays the same
- SignalR reconnect (`ensureTokenFresh`) — still exported with the same signature

---

## Root cause analysis

### The cross-tab race (#1218)

Today:

1. Tab A's access token expires at `T`.
2. At `T`, tab A makes a request → 401 → `attemptTokenRefresh()` → sets
   `refreshPromise` (only in tab A's module).
3. Tab B also makes a request at `T+50ms` → 401 → tab B has its *own*
   `refreshPromise = null`, so it starts its *own* refresh.
4. Tab A's refresh succeeds first, writes new tokens to localStorage. Tab B's
   refresh then runs with the *old* refresh token (which was just rotated) →
   401 from the refresh endpoint → tab B clears localStorage → tab A loses its
   session too on its next request.

The `refreshPromise` module-global is per-tab, not cross-tab.

### The fix

Use `BroadcastChannel` (or a `storage` event listener as fallback for Safari
iOS <15.4) to coordinate refreshes across tabs:

- Before calling `refreshFn()`, broadcast `{ type: 'refresh-start', leaderId }`
- A tab that receives a `refresh-start` from another tab while its own
  `refreshPromise` is null should **wait** for a matching `refresh-done` rather
  than starting its own refresh
- `refresh-done` broadcasts the new `{ accessToken, expiresAt }` (not the
  refresh token — that stays in localStorage) so all tabs skip a redundant
  localStorage read

## Target architecture

One module-local class encapsulating the auth coordination state:

```ts
// apiClient.ts, near top of file

class AuthCoordinator {
  private tokenGetter: (() => string | null) | null = null;
  private refresher: (() => Promise<boolean>) | null = null;
  private pendingRefresh: Promise<boolean> | null = null;
  private wasAuthenticated = false;
  private channel: BroadcastChannel | null = null;

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('jwst_auth');
      this.channel.onmessage = (e) => this.handleBroadcast(e.data);
    }
  }

  setGetter(g: () => string | null) { ... }
  setRefresher(r: () => Promise<boolean>) { ... }
  getToken(): string | null { ... }

  async refresh(): Promise<boolean> {
    if (this.pendingRefresh) return this.pendingRefresh;
    this.channel?.postMessage({ type: 'refresh-start', at: Date.now() });
    this.pendingRefresh = this.doRefresh();
    try { return await this.pendingRefresh; }
    finally { this.pendingRefresh = null; }
  }

  private handleBroadcast(msg: AuthBroadcast) { ... }
}

const auth = new AuthCoordinator();
```

The exported shims (`setTokenGetter`, `setTokenRefresher`, `attemptTokenRefresh`,
`ensureTokenFresh`, `clearTokenGetter`, `clearTokenRefresher`) keep their
current signatures and delegate to `auth`.

Fixes:
- #1264 — globals collapse into one private class instance
- #1218 — `BroadcastChannel` prevents two tabs racing
- #1263 — `authLog` adds a second-chance warning to `console.error` when
  sessionStorage write fails (not silent)
- #1224 — the coordinator is testable in isolation (no module reload hacks)

---

## PR split (2 PRs)

### PR 1 — Extract `AuthCoordinator`, no behavioural change (#1264, #1263)

- Encapsulate the four globals in `AuthCoordinator`
- Fix #1263 silent suppression: on sessionStorage failure, log to `console.error` once per page lifecycle (not per call — don't spam)
- **No `BroadcastChannel` yet** — this PR is refactor-only so it's reviewable
- All existing tests must still pass unchanged
- Add direct unit tests for `AuthCoordinator` (preparing the surface for #1224)

**Risk**: Medium — refactor of auth-critical code. Keep commits surgical:
commit 1 = add class, commit 2 = migrate exports, commit 3 = remove dead
globals. Run full E2E before push (memory rule: E2E before push on frontend
behavioural changes — even though this is refactor-only, auth is touchy).

### PR 2 — Cross-tab refresh coordination + tests (#1218, #1224)

- Add `BroadcastChannel` + `storage`-event fallback in `AuthCoordinator`
- Tests (#1224):
  - Concurrent 401 retries within one tab — assert only one `refreshFn` call
  - Two instances (simulating two tabs) — assert the second waits rather than
    calling `refreshFn`
  - Refresh failure propagates to all tabs
  - sessionStorage-unavailable branch (Safari private mode simulation)
- Manual cross-tab verification: open the app in two tabs, let token expire,
  hit a protected endpoint in both simultaneously, assert both succeed without
  an auth clear

**Risk**: High — `BroadcastChannel` behaviour varies between browsers. Feature-detect; fall back to `storage` events on older Safari. Keep the no-channel path functionally equivalent to today's behaviour so we can rollback by short-circuiting the class to `channel = null`.

---

## Testing

- Vitest: add `frontend/jwst-frontend/src/services/__tests__/AuthCoordinator.test.ts`
- Use `vi.useFakeTimers()` to simulate the 1s fallback retry
- Use two `AuthCoordinator` instances in one test to simulate two tabs (the channel uses a shared in-memory channel in jsdom)
- Playwright E2E: add a 2-tab refresh test under `tests/e2e/auth-refresh.spec.ts`
- Manual: the `getAuthLogs()` dev helper already exists — use it to verify the
  broadcast log entries fire in the right order

## Rollout

- PR 1 behind no flag — refactor-only
- PR 2 behind a runtime feature flag `window.__JWST_AUTH_BROADCAST = true` on
  first deploy so we can disable the new path without a rollback if we see
  auth clears spike in production

## Acceptance (epic-level)

- [ ] Zero mutable module-level `let` bindings remain in `apiClient.ts` for auth state
- [ ] Running two tabs simultaneously through token expiry does not clear auth
- [ ] `authLog` failures surface once via `console.error` (#1263)
- [ ] Vitest coverage for concurrent 401 + cross-tab refresh lands green
- [ ] All 4 child issues closed
