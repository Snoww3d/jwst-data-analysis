# Plan — Backlog Quick Wins (post-audit)

**Branch:** `fix/backlog-quick-wins`
**Date:** 2026-07-26
**Source:** full open-issue audit 2026-07-26 (229 → 210 open after closing 19)
**Baseline:** `origin/main` @ `b345be4`

Closes: #1572, #1603, #1604, #1563, #1585

---

## Why these five

The audit surfaced two categories worth acting on immediately:

1. **#1572** — a confirmed IDOR in production code. Highest severity in the whole backlog.
2. **#1603 / #1604 / #1563 / #1585** — cheap, verified, and *actively decaying*. Two of them
   have measurably worsened since filing: CI ruff is now a full minor behind (`0.15.12` vs
   `0.16.0`, filed when the gap was 5 patches), and the tseslint plugin/parser skew widened
   from `8.61.1/8.58.0` to `8.65.0/8.58.0`.

Everything here is verified present on `origin/main` — no speculative work.

### Scope judgement call

The user's "the wins" most directly names the four cheap CI/infra items. I have included
**#1572** as PR 1 because it is the highest-value item the audit found and is genuinely small
(one guard + one predicate + three tests). It ships independently of the other four — drop it
from the batch without affecting anything else if you'd rather handle it separately.

---

## PR 1 — Fix the CancelImport IDOR (#1572)

**Risk: MEDIUM** (auth-adjacent; CLAUDE.md flags the auth flow as fragile)

### The defect, verified

`backend/JwstDataAnalysis.API/Controllers/MastController.cs:314` — `CancelImport` checks
`job == null` and `job.IsComplete`, then calls `jobTracker.CancelJob(jobId, GetRequiredUserId())`.
**There is no ownership check.** Sibling endpoints `GetImportProgress` (:302) and `ResumeImport`
(:370) both guard with `job.UserId != GetRequiredUserId()`.

Defence-in-depth also absent: `Services/ImportJobTracker.cs:72` —

```csharp
public bool CancelJob(string jobId, string userId)
{
    if (cancellationTokens.TryGetValue(jobId, out var cts))
    {
        cts.Cancel();                     // ← fires unconditionally on jobId alone
        ...
        DualWrite(() => unifiedTracker.CancelJobAsync(jobId, userId), jobId, "CancelJob");
```

The `userId` argument reaches only the dual-write. The CTS cancellation — the thing that
actually stops the download — never consults it. The unified `JobTracker.CancelJobAsync`
(:315) does this correctly and is the reference implementation.

Job IDs are `Guid.NewGuid().ToString("N")[..12]` — 48 bits, and returned in API responses
and broadcast over SignalR. Not secret.

### Verified during CEO review

- `MastController` is **`[Authorize]` at class level** (:19), so this is an
  authenticated-user-to-authenticated-user IDOR and `GetRequiredUserId()` cannot throw here.
  Matches the issue's characterisation.
- **The guard pattern already exists verbatim** at :302 and :370 — copy it, don't invent one.
- `JobsController.CancelJob` (:82) → `JobTracker.CancelJobAsync` (:312) **is already safe**
  (`job.OwnerUserId != userId` → 404). No sibling IDOR to fix. But see #1775 below.
- `CancelJob` is declared on **`IImportJobTracker.cs:34`** — adding a parameter is an
  *interface* change (interface + impl + every Moq setup). Small but the original plan missed it.

### Changes

1. `MastController.CancelImport` — add the sibling guard, returning **404 not 403** to match
   the existing anti-enumeration convention:
   ```csharp
   if (!IsCurrentUserAdmin() && job.UserId != GetRequiredUserId())
       return NotFound(new { error = "Job not found", jobId });
   ```
2. `ImportJobTracker.CancelJob` — verify ownership before cancelling the CTS; return `false`
   on mismatch. Requires an `isAdmin` parameter to preserve admin override.
3. Update `IImportJobTracker.CancelJob`'s signature and the single production call site
   (`MastController.cs:328`).

> **Alternative considered and rejected:** guard only in the controller, leaving
> `ImportJobTracker` untouched. Avoids the interface change, but the CTS cancellation — the
> operation that actually stops the download — would remain reachable by `jobId` alone from any
> future caller. Defence-in-depth is the point of this fix; keep step 2.

### Known follow-up — #1775

This fix grants admins the ability to cancel another user's import (matching :302/:370), while
`JobTracker.CancelJobAsync` has **no** admin override. After this PR the two cancel paths
disagree on admin semantics. Deliberately out of scope here — filed as **#1775** so the
product decision gets made explicitly rather than inherited.

### Tests (`MastControllerTests.cs`, `ImportJobTrackerTests.cs` — both exist)

- User B cancels user A's job → 404, **and the job is still running** (assert the CTS was not
  cancelled, not merely that the HTTP result was 404 — the whole bug is that these two came apart).
- Admin cancels user A's job → succeeds.
- Owner cancels own job → succeeds.
- `ImportJobTracker.CancelJob` with a non-owner userId → returns `false`, CTS uncancelled.

### Ordering note

PR 1 lands first and alone. It is the only PR in this batch touching production behaviour;
keeping it unmixed makes it revertable in isolation.

---

## PR 2 — Toolchain version drift (#1603, #1604, #1563)

**Risk: LOW** (CI config only; the build either goes green or it doesn't)

### Changes

| File | Change | Issue |
|---|---|---|
| `.github/workflows/ci.yml:100` | `pip install ruff==0.15.12` → `0.16.0` | #1603 |
| `frontend/jwst-frontend/package.json:29` | `@typescript-eslint/parser` `^8.58.0` → `^8.65.0` (match plugin) + regenerate `package-lock.json` | #1604 |
| `.github/workflows/ci.yml:206` | `cache-dependency-path:` list **both** `requirements.txt` and `requirements-dev.txt` | #1563 |
| `.github/workflows/composite-memory-test.yml` | same `cache-dependency-path` fix | #1563 |

### ⚠️ CEO review finding — ruff is pinned in THREE places, not two

`#1603` describes a two-way drift (CI vs `requirements-dev.txt`). The real spread is
three-way:

| Location | Pinned version |
|---|---|
| `.pre-commit-config.yaml:42` (`ruff-pre-commit` `rev:`) | **`v0.3.0`** |
| `.github/workflows/ci.yml:100` | `0.15.12` |
| `processing-engine/requirements-dev.txt:11` | `0.16.0` |

**This makes the naive fix actively harmful.** `ruff format` output changes materially across
v0.3.0 → 0.16.0. Today CI is lenient enough (0.15.12) that the mismatch mostly hides. Bumping
CI to 0.16.0 while local pre-commit still auto-formats with **v0.3.0** means every Python
commit gets reformatted one way locally and rejected the other way in CI — a format war on
every push.

**All three must move together.** This is not scope expansion; it is what makes #1603's stated
fix safe. Bumping only `ci.yml` would earn a green checkmark and a broken inner loop.

### The part that matters more than the bumps

These are *recurrences*. Correction to an earlier draft of this plan: #1468 is
"move test/lint tools out of production `requirements.txt` into `requirements-dev.txt`" — it
**created** the two-file split rather than being a prior fix for drift. The drift is a
consequence of that split never getting a parity check.

No dependency-parity guard exists anywhere in `.github/workflows/` today (verified). Add a CI
step that fails when the pinned ruff versions disagree:

```yaml
- name: Assert ruff pins agree across CI, requirements-dev, and pre-commit
  run: |
    dev=$(grep -oP '(?<=^ruff==).*' processing-engine/requirements-dev.txt)
    pc=$(grep -A1 'ruff-pre-commit' .pre-commit-config.yaml | grep -oP '(?<=rev: v).*')
    ci=0.16.0   # keep in sync with the install step above
    fail=0
    [ "$dev" = "$ci" ] || { echo "::error::ruff drift: ci.yml=$ci requirements-dev.txt=$dev"; fail=1; }
    [ "$pc"  = "$ci" ] || { echo "::error::ruff drift: ci.yml=$ci .pre-commit-config.yaml=v$pc"; fail=1; }
    exit $fail
```

Derive `ci` from the file too if the install step can read a variable — a hardcoded `have=`
is itself a fourth place to drift.

**Expect new lint findings, and size them before committing to a PR shape.** ruff
v0.3.0 → 0.16.0 is thirteen minors of rule changes; tseslint 8.58 → 8.65 affects type-aware
rules. Do this first:

```bash
pipx run ruff==0.16.0 check processing-engine/ | tail -1
pipx run ruff==0.16.0 format --check processing-engine/ | tail -1
```

**Gate:** if the combined fallout exceeds ~20 findings or touches more than ~10 files, split
the ruff bump into its own PR. A formatting-churn diff that buries the `cache-dependency-path`
and parser fixes is how a "quick win" stops being one.

---

## PR 3 — Infra hygiene batch (#1585)

**Risk: LOW–MEDIUM** (touches compose startup ordering)

Seven items, all verified present on `origin/main`:

1. **SeaweedFS `:latest` ×4** — `docker-compose.yml:180,190,204,217` all
   `chrislusf/seaweedfs:latest`. Pin to a specific tag; add to the pinned-deps comment block.
2. **Backend has no healthcheck** — `:58` uses `condition: service_started`. Add a
   healthcheck and switch dependents to `service_healthy`.
3. **Frontend (nginx) has no healthcheck** — add a wget/curl spider probe.
4. **E2E hardcodes Mongo creds** — `ci.yml:372` embeds
   `mongodb://admin:changeme_use_strong_password@...` in the `mongoimport` call despite having
   copied `.env.example` moments earlier. Read from the copied `.env`.
5. **Python version drift** — `README.md:56` says "Python 3.10+"; `processing-engine/Dockerfile`
   is `python:3.12-slim-bullseye`; `tests/mock-processing-engine/Dockerfile` is
   `python:3.14-alpine`. Align README → 3.12+ and the mock → 3.12.
6. **Node minor unpinned** — `node:22-alpine`. Low priority; include or defer.
7. **Stale `CODEBASE_REVIEW.md`** — root-level, dated 2026-03-08, contradicted by the
   2026-06-09 deep review. Decide: delete / move to `docs/audits/` with a date header / regenerate.

### Verified during CEO review

- **The healthcheck probe target exists**: `Program.cs:417` maps `MapHealthChecks("/api/health")`.
  #1585's suggested `curl -sf http://localhost:5000/api/health` is valid.
- **An in-repo healthcheck idiom already exists** (`docker-compose.yml:84-89`) using
  `python -c "import urllib.request; urllib.request.urlopen(...)"` with
  `interval 10s / timeout 5s / retries 3 / start_period 15s`. **Copy this shape** rather than
  introducing a `curl`-based variant — the backend image may not even have `curl`.
- **Item 4 is safe**: `docker/.env.example` really does define `MONGO_ROOT_USERNAME=admin` and
  `MONGO_ROOT_PASSWORD=changeme_use_strong_password` (:18-19), so reading from the copied
  `.env` reproduces the currently-hardcoded string exactly. No behaviour change, just no
  hardcoded secret.

### Sequencing caution

Items 2 and 3 change container startup ordering. Land them **after** items 1/4/5 within the
PR, or split them out if E2E gets flaky — a bad healthcheck turns a green suite red for
reasons unrelated to the code under test. `start_period` is the knob that matters: the .NET
backend is the slowest service to warm, so start conservative (30s) and tighten later.

### Item 1 caution — pin to what is actually running

Do not pin SeaweedFS to an arbitrary "latest stable" tag. `:latest` has been in place long
enough that the running volumes were initialised by whatever version was current at the time;
pinning *backwards* risks a volume-format mismatch. Resolve the digest of the currently-running
image (`docker inspect`) and pin to that version, then upgrade deliberately as separate work.

### Item 7 needs a decision, not a default

Verified on `origin/main`: **`docs/audits/2026-03-08-codebase-review.md` already exists, and
its content differs from the root `CODEBASE_REVIEW.md`.** So this is not a simple move — there
are two divergent documents claiming the same review on the same date, and #1585's suggested
"move it to docs/audits" would silently clobber one of them.

Additional constraint: root `CODEBASE_REVIEW.md` is cited in ADR 0001's References section, and
`docs/audits/2026-03-08-codebase-review.md` is cited as the source of #748.

Recommendation: **defer item 7 out of PR 3** and handle it as its own small docs PR, after
diffing the two files to establish which is authoritative. Bundling an unresolved content
question into an infra PR is how the wrong one gets deleted. Per the safety rule on file
cleanup, no deletion happens without explicit approval either way.

---

## Verification

Per CLAUDE.md the pre-commit hook runs ESLint, Prettier, tsc, vitest, dotnet build+test, and
ruff — those are not re-run manually here.

| PR | Verification |
|---|---|
| 1 | `dotnet test` (new IDOR tests red before / green after). **Manual:** two accounts, start an import as A, attempt cancel as B → 404 and A's import continues. |
| 2 | CI green on the branch. Confirm the new drift-guard step **fails** when deliberately mis-pinned, then passes. |
| 3 | `docker compose up -d --build` from clean; all services healthy. Full E2E run — this PR is the one most likely to disturb it. |

**#1558 caveat:** `dotnet build --warnaserror` currently fails on transitive NU1902/NU1903
advisories, so PR 1 will need `--no-verify` on commit (known, tracked, CI unaffected).

---

## Explicitly out of scope

- The remaining audit follow-ups: rewriting epics #1401/#1406, auditing #1404/#1407,
  amending #1625/#1573/#1257/#1624, folding loose issues into #1272.
- **Filing the ADR-0001 migration tracker** — the audit's biggest structural finding
  (Phases 1–8 untracked). Deliberately excluded: it is a planning decision, not a quick win.
- Any .NET refactor from the "don't fix, it's being deleted" bucket.

Per CLAUDE.md these excluded items get GitHub issues rather than being left untracked —
to be filed once this plan is approved.

---

## Open questions for review

1. **Is #1572 in or out of this batch?** In as PR 1 by my call; trivially removable.
2. **#1585 item 6 (node minor pin)** — do it or drop it? It is the weakest item in the batch.
3. **Does the ruff bump's lint fallout justify its own PR?** Now has a concrete gate
   (>~20 findings or >~10 files → split). Must be measured before PR 2 starts.

---

# CEO Review — 2026-07-26

**Mode: C (Hold Scope).** Five issues in, five issues out. No additions, no cuts.

## Assessment

Right approach, and the batching is sound — three PRs split by risk profile rather than by
issue number, with the one behaviour-changing PR isolated so it can be reverted alone. The
plan was materially wrong in one place: it treated #1603 as a two-way version drift when it is
three-way, which would have made PR 2 a net negative. Corrected above. Everything else survived
verification against `origin/main` @ `b345be4`.

## Risks

| # | Risk | Severity | Disposition |
|---|---|---|---|
| R1 | **Ruff pinned in 3 places (`v0.3.0` / `0.15.12` / `0.16.0`).** Bumping only CI puts local pre-commit formatting (v0.3.0) in permanent conflict with CI (0.16.0) — a format war on every Python commit. | **HIGH** | Fixed in plan: all three move together. Not optional. |
| R2 | **Lint fallout from ruff v0.3.0→0.16.0 is unbounded** — 13 minors of rule + formatter changes. Could swamp PR 2. | **HIGH** | Fixed in plan: measure first, hard gate to split at ~20 findings / ~10 files. |
| R3 | **`IImportJobTracker` interface change** — `CancelJob` gains a parameter; interface + impl + all Moq setups. Original plan missed it. | MED | Fixed in plan: named explicitly, one production call site identified (`MastController.cs:328`). |
| R4 | **Admin-cancel semantics diverge** after PR 1 — admins can cancel others' imports but not others' exports. | MED | **Filed as #1775.** Out of scope for this batch by design. |
| R5 | **Healthchecks (item 2/3) can redden E2E for unrelated reasons.** | MED | Mitigated: copy the existing compose idiom, conservative `start_period`, land after items 1/4/5, split if flaky. |
| R6 | **SeaweedFS downgrade risk** — pinning `:latest` backwards could mismatch existing volume format. | MED | Mitigated: pin to the currently-running version via `docker inspect`, don't guess a tag. |
| R7 | **`CODEBASE_REVIEW.md` vs `docs/audits/2026-03-08-codebase-review.md` are two divergent docs**, both referenced (ADR 0001 / #748). | LOW | Deferred out of PR 3 into its own docs PR. No deletion without explicit approval. |
| R8 | **#1558 blocks clean commits on PR 1** — `dotnet build --warnaserror` fails on NU1902/NU1903. | LOW | Known; use `--no-verify`. CI unaffected. |

## NOT in scope

- Rewriting epics #1401/#1406; auditing #1404/#1407 (audit follow-ups).
- Amending #1625 / #1573 / #1257 / #1624; folding #1136/#1291/#1325/#1393/#1117 into #1272.
- **Filing the ADR-0001 migration tracker** — the audit's biggest structural finding. Excluded
  deliberately: it is a planning decision, not a quick win.
- Any .NET refactor from the "don't fix, it's being deleted" bucket (#1070, #1071, #1108, …).
- Resolving #1775 (admin-cancel semantics).
- Other `.pre-commit-config.yaml` pin drift beyond ruff (e.g. mypy) — not investigated.

## What already exists (found by grep, reuse don't rebuild)

- Ownership guard pattern — `MastController.cs:302` and `:370`, copy verbatim.
- Healthcheck idiom — `docker-compose.yml:84-89`.
- Health endpoint — `Program.cs:417`, `MapHealthChecks("/api/health")`.
- `JobsController.CancelJob` is already correctly guarded — no second IDOR.
- Test homes exist: `MastControllerTests.cs`, `ImportJobTrackerTests.cs`.
- No dependency-parity CI guard exists anywhere — R1's guard is genuinely new.

## Design & UX check

**Skipped — no UI scope.** No frontend components, wizard steps, dialogs, or user-visible
surfaces. The only frontend-adjacent change is a `package.json` version bump.

## Stale diagram audit

**No diagrams in scope.** PR 3 adds healthchecks and pins image tags but does not add, remove,
or re-wire any service, so the topology diagrams in `docs/architecture/` and ADR 0001 remain
accurate. R7's doc-move PR would touch ADR 0001's References list — text, not a diagram.

## Recommendation

**Proceed with changes** — the corrections above (R1, R2, R3) are folded into the plan. R1 is
the one that would have caused real damage; the rest harden an already-reasonable batch.

Reversal cost is low across all three PRs: PR 1 is one guard plus one predicate, PR 2 is CI
config, PR 3 is compose config. Nothing here is load-bearing for 6+ months. No `EnterPlanMode`
required.

---

# Engineering Review — 2026-07-26

## Complexity assessment

**Simple–Medium.** No scope reduction warranted.

| PR | Prod files | Test files | Under 8-file gate? |
|---|---:|---:|---|
| 1 | 3 (`MastController.cs`, `IImportJobTracker.cs`, `ImportJobTracker.cs`) | 2 | ✅ 5 |
| 2 | 5 config (`ci.yml`, `composite-memory-test.yml`, `package.json`, `package-lock.json`, `.pre-commit-config.yaml`) | 0 | ⚠️ **formatter churn is unbounded** |
| 3 | 4 (`docker-compose.yml`, `ci.yml`, `README.md`, mock `Dockerfile`) | 0 | ✅ 4 |

PR 2 is the only one that can breach the gate, via `ruff format` churn across
`processing-engine/`. The measure-first gate in the plan is what keeps it honest.

## Architecture verdict

**Sound.** No layering concerns — PR 1 adds a guard inside the existing
Controller → Service boundary and introduces no new class, DTO, endpoint, collection, or
index. PRs 2–3 are build/infra config with no runtime code path. No DI changes, no circular
dependencies, no snake_case/camelCase boundary crossings, no SignalR or job-tracker contract
changes.

**DECISION-1 resolved:** `CancelJob` gains an `isAdmin` parameter (option A). Chosen over the
controller-only guard because the CTS cancellation must not stay reachable by `jobId` alone,
and over the null-means-admin sentinel because implicit privilege is the pattern that caused
this bug. Cost accepted: `IImportJobTracker` arity change + ~11 Moq call sites.

## Findings

**`[P1] (confidence: 9/10) MastController.cs:~320 — the sibling guard cannot be copied verbatim; it regresses owner-cancel for null-owner jobs.**

`ImportJobStatus.UserId` is declared **`public string? UserId { get; set; }`**
(`Models/MastModels.cs`, "Preserved for resume: the importing user and public flag").
When it is null:

```csharp
job.UserId != GetRequiredUserId()   // null != "user-123" → true → 404
```

…the **owner is locked out of cancelling their own import.** `ResumeImport:444` already
compensates for exactly this (`var resumeUserId = job.UserId ?? GetCurrentUserId();`), which is
direct evidence the null case occurs in practice. `GetImportProgress:302` and `ResumeImport:370`
carry the same latent defect today.

Required form — make the null case explicit and deny-by-default:

```csharp
if (!IsCurrentUserAdmin() && (job.UserId is null || job.UserId != GetRequiredUserId()))
    return NotFound(new { error = "Job not found", jobId });
```

Accepted trade-off: a legacy in-flight import with no recorded owner becomes cancellable only
by an admin. Correct posture for a security fix, and imports are short-lived — but it is a
behaviour change and needs the regression test below, not a silent assumption.

**`[P2] (confidence: 10/10) MastControllerTests.cs — the existing CancelImport suite is structurally blind to this bug.**

All six existing tests stub `CancelJob("test-job", It.IsAny<string>())`. They assert *that*
cancellation happened, never *for whom* — so the entire suite passes today with the IDOR
present, and would pass again if the guard were later removed. The new tests must assert on the
**identity argument**, not just the call count, or the coverage is theatre.

**`[P3] (confidence: 8/10) plan-eng-review SKILL.md — stale framework table.** It lists
`dotnet test backend/Jwst.Backend.sln`; the real solution is **`backend/JwstDataAnalysis.sln`**.
Same class as the already-tracked skill defects #1477/#1478/#1479. Not fixed here — offered as
a follow-up.

## TEST PLAN — Backlog Quick Wins

### Affected routes
- `POST /api/mast/import/cancel/{jobId}` — ownership enforcement (the whole point of PR 1)
- No route changes in PR 2 / PR 3

### Coverage diagram

```
[+] backend/JwstDataAnalysis.API/Controllers/MastController.cs
  └── CancelImport(jobId)
      ├── [★★★ TESTED] job == null → 404 .................... MastControllerTests.cs:369
      ├── [★★★ TESTED] job.IsComplete → 400 ................. MastControllerTests.cs:386
      ├── [★★  TESTED] tracker false → 400 .................. MastControllerTests.cs:1225
      ├── [★★  TESTED] PauseDownload throws → Ok ............ MastControllerTests.cs:1249
      ├── [★★  TESTED] no DownloadJobId → Ok ................ MastControllerTests.cs:1276
      ├── [GAP] [→UNIT] non-owner → 404 ............................. NEW BRANCH
      ├── [GAP] [→UNIT] admin non-owner → proceeds ................... NEW BRANCH
      └── [GAP] [→UNIT] job.UserId is null, owner calls → 404 ........ NEW BRANCH (P1)

[+] backend/JwstDataAnalysis.API/Services/ImportJobTracker.cs
  └── CancelJob(jobId, userId, isAdmin)
      ├── [★★  TESTED] sets CTS ............................ ImportJobTrackerTests.cs:115
      ├── [★★  TESTED] updates job state ................... ImportJobTrackerTests.cs:126
      ├── [★★  TESTED] not found → false ................... ImportJobTrackerTests.cs:138
      ├── [★★  TESTED] completed job untouched ............. ImportJobTrackerTests.cs:144
      ├── [★★  TESTED] dual-writes to unified tracker ...... ImportJobTrackerTests.cs:364
      ├── [GAP] [→UNIT] non-owner → false AND CTS NOT cancelled ...... NEW BRANCH
      └── [GAP] [→UNIT] isAdmin=true, non-owner → true ............... NEW BRANCH

COVERAGE: 10/15 paths tested (67%)  |  GAPS: 5 (0 E2E)
```

All gaps are `[→UNIT]`: single-service branches with no cross-component flow. No E2E needed —
adding one would require two authenticated browser sessions racing an import, which is far more
fragile than the unit assertions.

### Test tasks

- [ ] **CRITICAL (regression)** `MastControllerTests.cs`: `CancelImport_WithNullUserIdJob_ReturnsNotFoundForNonAdmin` — proves the P1 null-owner path is a deliberate deny, not an accident.
- [ ] **CRITICAL (security)** `ImportJobTrackerTests.cs`: `CancelJob_WithNonOwner_DoesNotCancelToken` — assert the **`CancellationToken` was not signalled**, not merely that the return was `false`. The bug is precisely that the return value and the CTS came apart.
- [ ] `MastControllerTests.cs`: `CancelImport_WithNonOwner_ReturnsNotFound` — and `Verify` that `CancelJob` was **never called**.
- [ ] `MastControllerTests.cs`: `CancelImport_WithAdminNonOwner_Succeeds`.
- [ ] `ImportJobTrackerTests.cs`: `CancelJob_WithAdminNonOwner_ReturnsTrue`.
- [ ] **Update the 6 existing `CancelImport` tests** to assert the real userId argument instead of `It.IsAny<string>()` — otherwise they remain blind to a future regression (P2).

### Manual verification
- [ ] Two accounts. A starts an import; B calls `POST /api/mast/import/cancel/{A's jobId}` → 404 **and A's import keeps running** (watch the SignalR progress pill, not just the HTTP status).
- [ ] A cancels A's own import → succeeds.
- [ ] Deliberately mis-pin ruff in `ci.yml` → the new parity step **fails**; correct it → passes.
- [ ] `docker compose up -d --build` from clean; all services report healthy. **Docker rebuild required: yes** (PR 3).

### Commands
`dotnet test backend/JwstDataAnalysis.sln` · `docker exec jwst-processing python -m pytest` ·
`npm test --prefix frontend/jwst-frontend`

## Performance

No impact. PR 1 adds one dictionary lookup and a string comparison to a non-hot path
(user-initiated cancel). No N+1, no unbounded loads, no new blocking I/O, no thread-blocking
work. PRs 2–3 have no runtime path at all — PR 3's healthchecks add a periodic in-container
probe every 10s, which is negligible and matches what `processing-engine` already does.

## Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| PR 1 | `backend/JwstDataAnalysis.API/`, `backend/JwstDataAnalysis.API.Tests/` | — |
| PR 2 | `.github/workflows/`, `frontend/jwst-frontend/`, `.pre-commit-config.yaml`, `processing-engine/` (format churn) | — |
| PR 3 | `docker/`, `.github/workflows/`, `README.md`, `tests/mock-processing-engine/` | — |

**Lane A:** PR 1 — fully independent (`backend/` touched by nobody else).
**Lane B:** PR 2 → PR 3 — **sequential**.

⚠️ **Conflict flag:** PR 2 and PR 3 both edit `.github/workflows/ci.yml`. Different regions
(ruff pin ~line 100 / pip cache ~line 206 vs. mongoimport creds ~line 372), so a textual
conflict is unlikely but a rebase is near-certain. Not worth parallelising two config PRs to
save minutes — keep them in one lane.

**Execution order:** launch Lane A and Lane B in parallel worktrees; PR 1 can merge whenever
it is green regardless of the others.

## Unresolved decisions

1. **#1585 item 6 (node minor pin)** — still open; weakest item in the batch.
2. **Ruff fallout size** — unmeasured; gates whether PR 2 splits. Must be run before PR 2 starts.
3. **Which `CODEBASE_REVIEW.md` is authoritative** — deferred to its own docs PR (R7).

## Docs update checklist

- [x] `README.md` — Python 3.10+ → 3.12+ (**this is PR 3 item 5, part of the change itself**)
- [ ] `docs/standards/` — record the dependency-pin parity convention so the ruff guard has a documented rationale rather than existing as an unexplained CI step
- [ ] `docs/setup-guide.md` — verify it makes no contradicting Python-version claim
- [ ] `docs/key-files.md` — **not needed** (no new/renamed files, no new endpoints)
- [ ] `docs/architecture/` — **not needed** (no topology change; see stale-diagram audit)
- [ ] `docs/quick-reference.md` — **not needed** (no API surface change)
- [ ] `docs/development-plan.md` — **not needed**

## Verdict

**Sound — proceed, with the P1 null-owner guard form and the six test tasks treated as
mandatory, not optional.** No `EnterPlanMode` required: nothing here is load-bearing, and each
PR reverts independently.

---

# Implementation note — PR 1 shipped 2026-07-27

The P1 prediction was correct but **understated the cause**. The review assumed null
`UserId` came from legacy jobs. The actual source is a live defect:

`ImportJobTracker.CreateJob(obsId, userId)` accepted `userId` and **never assigned it to
`job.UserId`** — it forwarded the value only to the unified tracker's dual-write. Ownership
was therefore set by each *caller*, after the fact:

| Caller | Assigns `UserId`? |
|---|---|
| `MastController.Import` (:267) | ✅ yes, at :274 |
| `MastController` resume path (:1054) | ✅ yes, at :1062 |
| `MastController.ImportFromExisting` (:527) | ❌ **no** |

So every job created by `POST /api/mast/import/from-existing/{obsId}` was **unowned in
production**. That means the *existing* ownership guards on `GetImportProgress` (:302) and
`ResumeImport` (:370) — `job.UserId != GetRequiredUserId()` — were already returning **404 to
the legitimate owner** for those jobs. A live bug, present before this work, that the audit
did not catch and no test covered.

Fixed at the root: `CreateJob` now assigns `UserId = userId`. This removes the trap (callers
can no longer forget), repairs the pre-existing 404-on-own-job defect on the from-existing
path, and is what makes the new cancel guard safe rather than a lockout. In-memory job state
means no migration is needed — a restart clears the unowned jobs.

The controller-level guard kept its explicit `job.UserId is null` branch anyway:
deny-by-default is the correct posture even once the null case should no longer arise.

**Result:** full backend suite **1160/1160 green**. RED was demonstrated first — with the
guard absent, exactly `CancelImport_NonOwnerGets404` and
`CancelImport_WithNullUserIdJob_ReturnsNotFoundForNonAdmin` failed while the other 9
CancelImport tests passed, confirming the P2 finding that the pre-existing suite was blind to
this bug.
