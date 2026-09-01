# Full-stack audit — handoff (2026-08-25)

Audit of **performance, security, reliability, accessibility, and code quality**
across every user workflow, run against `main @ 7842228`.

**Full findings report (browsable, ~65 findings):**
<https://claude.ai/code/artifact/aa8b6f13-30b4-4335-b2d9-d0d5e9c596fc>

Tally: **10 high · 24 medium · 29 low · 10 areas verified clean.**

This file is the handoff: what triggered it, what got fixed, and what is still
open. Start at "Pick up here".

---

## What triggered it

Reported symptom: "the new search seems to crash." It does — but the crash is
already filed, and the audit found the wider pattern behind it.

**Root cause: [#1897](https://github.com/Snoww3d/jwst-data-analysis/issues/1897).**
`jwst-mast-proxy` is OOM-killed (confirmed live: `OOMKilled=true`, 512 MiB cap)
building the sky-coverage snapshot. `fetch_coverage_rows`
(`processing-engine/app/mast/coverage.py:247`) pages MAST 5000 rows at a time but
still accumulates all ~21,700 `CoverageRow` objects while astropy holds a
5000×36 table per page. It dies at page 2–3 of 5, so the cache is never written
and every request restarts the build — a permanent crash loop on cold cache.

Search *appears* to crash because the uvicorn worker dies mid-response and 503s
**unrelated in-flight requests**. [#1899](https://github.com/Snoww3d/jwst-data-analysis/issues/1899)
is the UI half.

Not in #1897: `build_snapshot` (`coverage.py:268`) also retains the full row list
*inside* the snapshot and then JSON-serializes it — peak is rows + cells +
serialized buffer at once. Binning incrementally per page and discarding raw rows
cuts peak far more than raising the cap.

---

## Done this session

Dependency and repo hygiene only — **no application code was changed.**

- **Dependabot alerts + security updates enabled.** They were `disabled`, which is
  why none of these advisories had ever surfaced. This was the single highest-value
  discovery of the session.
- **Security alerts 13 → 1.** All high and medium cleared. 23 Dependabot PRs merged
  (react-router ×5 advisories, ws, flatted, postcss, vite, signalr, plus routine bumps).
- **Labels `dependencies` and `docker` created.** Both were declared in
  `.github/dependabot.yml` but did not exist in the repo, so Dependabot silently
  failed to apply them. Backfilled onto all 18 open PRs at the time.
- **Open-PR cap lifted** across all five ecosystems
  ([#1904](https://github.com/Snoww3d/jwst-data-analysis/pull/1904), merged `88dd2b2`).
  The default of 5 had npm fully saturated, suppressing 21 frontend updates.

---

## Pick up here

Ordered by damage prevented per line changed. The first two are minutes.

### 1. Gitignore the credential backup — do this first

`docker/.env.bak-20260822-121110` is **not gitignored** (`git check-ignore`
confirms). `.gitignore:63-67` patterns are `.env`, `.env.local`, `.env.*.local`,
`.env.agent*`, `*.env` — the last requires the name to *end* in `.env`, and this
one ends in a timestamp. It holds `MONGO_ROOT_PASSWORD`, `JWT_SECRET_KEY`,
`S3_SECRET_KEY`. Explicit-`git add`-per-file habit is what has been preventing a leak.

**Fix:** add `.env.bak*` to `.gitignore`. Rotate if it ever reached a commit.

### 2. Make the JWT secret required

`docker-compose.yml:45,124` default it via `:-` to the repo-public placeholder;
Mongo correctly uses `:?` on line 17. The guard at `Program.cs:77-83` only fires
under `!IsDevelopment()`, and `docker-compose.yml:46` defaults the environment to
**Development** — so the documented Quick Start boots with a public signing key
and no warning. The Python engine validates the *same* key and has no placeholder
check at all (`auth/deps.py:56` only rejects *unset*).

Mitigations that keep this High rather than Critical: all ports are loopback-bound,
the engine publishes none, and `prod.yml` sets Production where the guard does fire.
**CE is unaffected** — no JWT secret is set, so the engine fails closed.

**Fix:** `:-` → `:?` in both compose entries; move the guard out of the Development
branch; add the same `CHANGE_THIS` rejection to `_decode`.

### 3. Fix the search endpoint — one change, three defects

`JwstDataController.cs:1278-1288` + `MongoDBService.cs:580-587`.

- **Facet counts leak other users' data.** The facet aggregation is a bare `$group`
  over the whole collection with **no `$match` stage** — no search filter, no
  authorization. The controller's post-filter rewrites `.Data` but never `.Facets`,
  so any authenticated non-admin gets exact per-`DataType` counts across every
  record in the system, including other users' private ones.
- **Pagination strands accessible data.** `Skip`/`Limit` run server-side *before*
  the in-memory auth filter, then `TotalCount` is overwritten with the surviving
  page count. 500 matches, 3 visible in page 1 → response says `TotalPages 1` and
  pages 2–25 become silently unreachable.
- Pages come back variably empty regardless of totals.

Admins are unaffected (`IsCurrentUserAdmin()` short-circuits), which is why this
looks fine in admin testing.

**Fix:** push the authorization predicate into `BuildSearchFilter` as an `$or` of
public / owned / shared-with-me, so Mongo filters, pages, and counts over one set.

### 4. Call `ensure_indexes()`

`processing-engine/app/jobs/store.py:63` is defined with **zero call sites**. The
`jobs` collection has no index on `job_id`, so `get()` — polled by the UI every
1.5s — plus `is_cancel_requested` and every progress/log update are collection
scans. The unique constraint on `job_id` does not exist either.

**Fix:** one `await store.ensure_indexes()` in the engine lifespan beside
`reconcile_interrupted()`.

### 5. Enable compression

Measured: `/api/jwstdata` returns 2.95 MB and `Accept-Encoding: gzip` returns a
byte-identical 2.95 MB, on both `:5001` and `:8000`. Neither nginx config enables
gzip and neither backend registers compression middleware. This JSON shape
typically compresses 8–10×.

### 6. Defer `/fits.js`

52.6 kB render-blocking classic `<script>` in `<head>` with no `defer`, blocking
first paint on **every** route including those that never touch FITS. Cheapest
win in the audit.

### 7. Memory: slice before `astype`

`render/routes.py:252,261` opens FITS without `memmap=True` and converts the
**entire** array to float32 before slicing — up to ~800 MB per concurrent request
to produce a 1000×1000 PNG. `/preview`, `/histogram`, `/pixeldata` are
deliberately *outside* the render gate (`render_gate.py:16-21`), and anyio's
default 40 threads is not overridden. On CE (4 GB limit, 4 concurrent per IP)
that is ~3.2 GB from one address. `.fits.gz` is not memmapped by astropy, so a
gzipped file decompresses fully into RAM while passing both size checks.

### 8. Then the rest

Everything else is in the artifact, grouped by dimension. Notable clusters:
float64 end-to-end through composite/mosaic for uint8 output (~1.5 GB at the
64 Mpx ceiling — likely the driver of the 413s); `ExportFramingPanel.tsx:238`
re-decoding at full resolution on every pointermove; unmemoized `AuthContext`
value; thumbnail blobs (26.7 MB of a 29.6 MB collection) travelling on every
library list; both backends writing to one `jobs` collection with incompatible
schemas.

---

## Dependency queue state

- **19 PRs open**, ~13 stale/conflicting from lockfile contention and self-rebasing.
  A second merge pass should clear most — give the rebase queue time to settle.
- **2 majors held deliberately, both green:**
  [#1942](https://github.com/Snoww3d/jwst-data-analysis/pull/1942) plotly 3→4 and
  [#1914](https://github.com/Snoww3d/jwst-data-analysis/pull/1914) jest-dom 6→7.
  Not auto-merged: a charting major can change rendering without failing tests, and
  `SpectralViewer` coverage is thin. Review plotly 4's breaking changes first.
- **2 genuinely failing:** [#1795](https://github.com/Snoww3d/jwst-data-analysis/pull/1795)
  (typescript 7 — blocked upstream on `@typescript-eslint`'s peer range
  `>=4.8.4 <6.1.0`, self-resolving; **do not** add an `ignore` rule, it would go
  silent exactly when the block clears) and
  [#1908](https://github.com/Snoww3d/jwst-data-analysis/pull/1908) (ruff).
- **1 alert left:** `@babel/core` (low, dev-tree) — no PR opened yet.

---

## Test suite state

| Suite | Result | Statements | Branch |
|---|---|---|---|
| Frontend (vitest) | 1809 pass | 60.8% | 54.5% |
| Python (pytest) | 2075 pass, **1 fail** | 78% | — |
| .NET (dotnet test) | 1185 pass, 0 warnings | — | — |

The Python failure is a **real defect**, not flaky: `app/mast/routes.py` builds
`mast_cache` as a module-level singleton at import time from env, so
`tests/test_mast_cache.py:428` fails locally (dev container sets
`MAST_CACHE_ENABLED=true`) and passes in CI. The import-time global also prevents
per-test and per-request override.

Highest-risk untested code:

- `generate_preview` (`render/routes.py:139`) — cyclomatic complexity **50**, the
  highest in any stack, at **27% coverage**, and it is the CE-facing render path.
- `pages/GuidedCreate.tsx` — 1233 lines at **0% coverage**, and it is the primary
  user flow.
- The import/download path is thinnest on both sides: `fileProgressUtils.ts` 0%
  branch, `ImportProgress.tsx` 1.2% of 163 branches, `chunked_downloader.py` 42%.
  This is where file corruption would originate.

Auth and the CE allowlist are **not** the gap — `auth/deps.py` is 91% covered and
CE deny-by-default is structural with dedicated tests.

---

## Corrections carried forward

Two claims made during the audit were wrong and are withdrawn — do not act on them
if they resurface in notes:

- **Plotly is not eagerly loaded with My Library.** The emitted bundle shows a real
  dynamic import (`F.lazy(()=>import("./dist-*.js"))`), so that half of #1449 is
  already done.
- **"No event-loop blocking in the backend" was too strong.** `library/routes.py:87`
  calls a blocking `os.stat` in a loop on the event loop, wrapped around an N+1 that
  awaits once per `obs_id`, up to 50 per request.

One lead resolved as **not exploitable**: `local_storage.py:22` guards traversal
with `str.startswith` rather than `is_relative_to`, so a sibling directory
extending the base name would pass. All four call paths were enumerated and none
carries a client-influenced key past the `helpers.py:45` gate;
`write_from_bytes` has no application caller. Worth fixing as defense-in-depth,
not as a live vulnerability.
