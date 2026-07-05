# Community Edition (v1) — Definition & Build Plan

**Status:** Draft v2 — pending `/plan-ceo-review` + `/plan-eng-review`
**Date:** 2026-07-05 (v2, same day — re-cut after whole-picture discussion)
**Supersedes:** the "Community Edition — 'JWST Wallpapers'" section of `docs/development-plan.md` (lines ~227–280), which describes an abandoned architecture (`community/` monorepo dir + Next.js/Vercel). That section should be replaced with a pointer here (Phase 0 task).
**Related:** epic #1403, #1617 (PR #1619), ADR 0001, `docs/deploy-workflow-review.md`

---

## 1. What Community Edition IS

A **public, anonymous, read-only instance** of the app on a cheap VPS
(Hetzner Ashburn, ~€7–11/mo), deployed with Docker Compose, with **pre-seeded
FITS data** for a curated set of featured targets — **served by the Python
backend only**. The .NET gateway is not part of the CE deployment.

The product is the output image: a stranger lands on Discover, picks a target,
and produces a gorgeous JWST composite in a few clicks — no account, no signup,
no MAST token, no waiting on downloads.

CE doubles as the **first consumer of the ADR 0001 single-backend migration**:
the thin FastAPI read layer CE needs *is* ADR Phase 2 plus a sliver of Phase 4,
and the CE deployment is the lowest-risk canary for the Phase 5 frontend
cutover (anonymous, read-only, no auth, no jobs, no SignalR).

**The CE golden path** (`/` → `/target/:name` → `/create`) **already works
anonymously in the frontend today:**

- `GuidedCreate.tsx:369–374`: when all recipe data exists locally
  (`needsDownload.length === 0`), the wizard skips the download step — the only
  auth-gated step — and takes the anonymous **synchronous** composite path
  (`GuidedCreate.tsx:680`, `CompositePreviewStep.tsx:671`). No job queue, no
  SignalR — which is exactly the subset the Python backend can serve without
  Phase 3.
- The compute already lives entirely in Python: composite, mosaic, MAST search,
  discovery, analysis (the .NET services for these are pure HTTP proxies, per
  ADR 0001).

What CE adds is the thin missing layer: catalog/recipe/availability **reads**
in FastAPI, currently served by .NET's `DiscoveryController` + Mongo.

## 2. What CE is NOT

- **No accounts.** No login, register, email, password reset, admin. The
  Python auth router (ADR Phase 1) stays unwritten/unmounted in CE.
- **No visitor writes.** No MAST imports, uploads, deletes, library mutations,
  no async job queue. Enforced by **deny-by-default route mounting** (see §4
  Phase 2), not by hiding UI.
- **No .NET tier in the CE deployment.** The gateway keeps serving the main
  app (local/dev) until the migration retires it; CE never depends on it.
- **Not the v2 auth/email work.** #456, #457, #461, #640–#643, #647 move out
  of the CE epic to a v2 milestone (they were in #1403's original body,
  written before the 2026-04-15 "no auth" decision).

## 3. Architecture decision record

Reviewed 2026-07-05 (ultraplan workflow: 5 mapping agents + 3 adversarial
reviews), then revised after a whole-picture discussion (hosting cost, fork
vs. flag, new-repo option):

| Option | Verdict | Why |
|---|---|---|
| **A — auto-login seed user** | REJECT (3/10) | World-shared mutable account; any visitor can delete the curated seed data; opens imports/writes/job-queue; requires relaxing `SeedDataService.cs:40–44` prod block; untested N-clients-1-user regime; all work lands in the .NET tier scheduled for deletion. |
| **B — strip auth via CE flag** | REJECT (3/10) | Golden path is already anonymous; stripping guards only exposes the surfaces auth protects, with HIGH findings #1572 (IDOR) / #1574 (auth bypass) open in that territory. |
| **D — full stack, "auth on, nobody logs in"** | REJECTED after discussion (was v1 of this plan) | Ships fastest (~2–3 wks) and the anonymous mode is tested — but it relieves the cost/architecture pressure without delivering the slimming, entrenches the .NET tier in a public deployment, and every capability later "enabled over time" deepens that dependency. Kept as the **timeboxed fallback** (§6). |
| **New repo / fork ("start over slim")** | REJECT | Owner keeps and likes large parts of this codebase; a fork reabsorbs changes forever, and a new-repo product abandons the migration and freezes the main app. |
| **C → chosen: CE on the Python read-slice** | **ACCEPTED** (as the reviewers' salvaged variant) | The original "finish enough of ADR 0001 first" was rejected (4/10) for gating CE on Phases 2+3+4+5 wholesale. The accepted cut: **read-only Phase 2 slice + Phase 4 sliver, sync compute only, deny-by-default routes** — no jobs, no WebSocket, no auth port. CE is born slim (frontend + FastAPI + Mongo, ~3 containers), the work advances the migration instead of being throwaway, and the parts the owner likes (frontend, engine, repo) are reused as-is. |

**Cost note:** hosting economics are provider-driven, not architecture-driven —
AWS t3.medium ≈ $43/mo vs Hetzner CX32 (4 vCPU/8GB) ≈ €7/mo (+ ~€4 for a
100GB volume). The slim architecture is chosen for **maintainability and
migration progress**, with the cost win coming from the VPS move either way.
Hetzner's Ashburn, VA location sits next to MAST's `stpubdata` bucket
(us-east-1); CE only needs bucket proximity at seed time anyway, since visitor
imports are disabled.

## 4. Build plan

### Phase 0 — Scope & triage (no code)

- [ ] Replace the stale CE section in `docs/development-plan.md` with a pointer here.
- [ ] Rewrite epic #1403's body to this scope; move the auth/email cluster
      (#456, #457, #461, #640, #641, #642, #643, #647) to a v2 milestone.
- [ ] Park .NET-specific config children (#1042, #1043, #1361, #746) as
      migration-superseded — CE has no .NET tier to configure. Apply #1383's
      validation-framework idea to the Python side instead (Mongo URI, storage
      root, memory budgets, `CE_MODE`).
- [ ] Keep in scope: #651 (network isolation), #745 (resource limits) — fold
      into Phase 4 compose work.

### Phase 1 — Day-1 spikes (de-risk before building)

- [ ] **BSON casing spike:** `jwst_data` documents are PascalCase (`FileName`,
      `IsPublic` — no `BsonElement` attrs, no camelCase convention pack in the
      .NET API). Write one motor read of a real doc produced by
      `prefetch-discovery` and confirm pydantic field aliasing; decide whether
      seed export normalizes casing instead.
- [ ] **Route inventory:** enumerate exactly which endpoints the CE frontend
      calls on the golden path (+ `/archive` search) — this list becomes the
      CE route allowlist.

### Phase 2 — Python read-slice (ADR 0001 Phase 2 + Phase 4 sliver)

In `processing-engine/app/` per the ADR layout:

- [ ] `db/`: motor client + repository for `jwst_data` **reads** (catalog
      lookups, `IsPublic` filtering). Read-only Mongo credentials for CE.
- [ ] `library/`: read endpoints the frontend needs (data listing/detail for
      the seeded catalog).
- [ ] `discovery/`: featured targets, recipes, availability resolution
      (ports `DiscoveryController` logic; `featured-targets.json` moves or is
      shared).
- [ ] MAST **search** passthrough (stateless astroquery metadata queries) so
      `/archive` works — import/download triggers NOT ported.
- [ ] **`CE_MODE` deny-by-default mounting:** CE mounts only
      read/search/compute routers. No upload, no delete, no scan, no MAST
      import, no jobs, and the auth router never mounts. This — not UI hiding —
      is the security posture, since the engine has no auth primitive.
- [ ] Red-green: pytest coverage for the read layer, including the
      anonymous/`IsPublic` filter semantics mirrored from the .NET
      `SetupAnonymousUser` suite.

### Phase 3 — Frontend: `VITE_CE_MODE` + API cutover (CE build only)

One flag, build-time, no fork. Framed as a **progressive capability gate**
("enable over time" = flip capabilities on as they exist in the Python tier):

- [ ] CE build points `VITE_API_URL` at FastAPI; anonymous sync composite
      paths already exist (`GuidedCreate.tsx:680,795`); SignalR client never
      initializes in CE.
- [ ] Hide `/login`, `/register`, `UserMenu` (`App.tsx:74–75`,
      `SharedLayout.tsx:52`); hide `ProtectedRoute` pages `/library`,
      `/composite`, `/mosaic` (`App.tsx:85–95`) — or ship `/library` as the
      local-only public view per #1617.
- [ ] Remove reachable auth affordances: GuidedCreate sign-in wall
      (`GuidedCreate.tsx:1050–1081`), RecipeCard "Login required" pill
      (`RecipeCard.tsx:91,144`), admin Re-index button
      (`SearchPage.tsx:111–120`), Result-step handoff to gated `/composite`
      (`GuidedCreate.tsx:1182–1202`).
- [ ] Fix empty states linking to auth-gated `/library`
      (`DiscoveryHome.tsx:110–118`, `TargetDetail.tsx:155–162`).
- [ ] De-jargon pass: `MastStatusPill` "MAST · online/offline", raw
      `NO_PRODUCTS:`/`S3_UNAVAILABLE:` prefixes (`GuidedCreate.tsx:526–543`),
      SearchPage FAISS/384-dim explainer.
- [ ] **#1617 handling:** merge PR #1619 against .NET for the main app (it's
      done — 48 files, 3 clean review rounds); CE serves `/archive` via the
      Phase 2 Python MAST-search passthrough with the import pill hidden.

### Phase 4 — Hardening + CE compose

New `docker/docker-compose.ce.yml`: **frontend (nginx, sole published port,
same-origin `/api` proxy) + processing-engine + mongodb.** No .NET, no
mast-proxy, no SeaweedFS, no docs. `STORAGE_PROVIDER=local`.

- [ ] **Global render semaphore** in the engine (1–2 concurrent composites,
      queue-or-429). The #882 memory budget is per-request; nothing bounds
      concurrency today — this is mandatory for any public no-auth deploy.
- [ ] nginx `limit_req`/`limit_conn` + request timeout on `/api`.
- [ ] Memory math (8GB box): engine `mem_limit` ~4g /
      `MAX_COMPOSITE_MEMORY_BYTES` ~3e9 (the `.env.example` 4GB row now has
      real headroom), Mongo `mem_limit` + `--wiredTigerCacheSizeGB 0.5`,
      swap enabled. Covers #745/#651.

### Phase 5 — Seed bundle (the one genuinely new tool)

- [ ] `seed-ce.sh`: run `scripts/prefetch-discovery.sh` against
      `featured-targets.json` (FITS into `/app/data`) + export matching Mongo
      metadata (`IsPublic=true`, `UserId=null`; paths are container-relative
      `/app/data` so they transfer). Casing per the Phase 1 spike.
- [ ] **Completeness gate:** fail the seed build if any featured recipe has
      `needsDownload > 0` — guarantees no stranger ever hits a dead end.
- [ ] Run the semantic-search embed batch during seeding so `/search` isn't
      cold ("0 indexed") — or drop `/search` from CE capability set v1.
- [ ] Curate to VPS disk (dev `data/` is 170GB; volume ~100GB — pick targets).

### Phase 6 — Deploy, smoke, decommission

- [ ] Provision Hetzner **Ashburn** CX32 (8GB) + 100GB volume; adapt
      `server-setup.sh` (clone/env-generate/compose-up transfers nearly
      verbatim; drop IMDS IP detection, drop JWT/seed vars). TLS via the
      `server-setup-prod.sh` certbot pattern.
- [ ] **Stranger smoke test:** cold browser → Discover → pick target → create
      composite → download image → `/archive` search works → no sign-in wall
      anywhere → `curl` to import/upload/delete/jobs/auth endpoints returns
      404/blocked (deny-by-default verified) → parallel composite requests get
      429/queue, not OOM.
- [ ] CE runbook section in `docs/deployment.md` (CE is re-seedable —
      "restore" = re-run the seed; no backup cron required).
- [ ] **Decommission the AWS EC2 boxes** once CE is stable — the main app
      runs locally until v2 needs public hosting. (Pending owner confirmation.)

## 5. Sequencing vs ADR 0001 — and the fallback

CE **is** migration progress: Phase 2 here delivers ADR Phase 2 reads + a
Phase 4 sliver, and the CE deployment becomes the Phase 5 cutover canary — the
smallest possible surface (anonymous, read-only, sync-only) proving the Python
tier in production before the main app ever cuts over. The .NET tier keeps
serving the main app locally, untouched, until later phases retire it.

**Timeboxed fallback (Option D):** if the read-slice + CE compose is not
demo-able on a VPS within ~3 weeks of Phase 2 starting, ship CE v1.0 on the
current stack's anonymous mode instead (pre-seeded `IsPublic` data, generated
throwaway `Jwt__SecretKey`, `VITE_CE_MODE` cosmetics, full-stack compose) and
land the Python slice as v1.1. The reversal-cost gate favors having a
ship-anyway exit.

## 6. Effort estimate

| Phase | Size |
|---|---|
| 0 Scope/triage | hours |
| 1 Spikes | 1–2 days |
| 2 Python read-slice | 2–3 weeks |
| 3 CE flag + cutover + stranger-proofing | 3–5 days |
| 4 Hardening + compose | 2–3 days |
| 5 Seed bundle | 3–5 days |
| 6 Deploy + smoke | 2–3 days |

**≈ 6–9 weeks** solo, sequential. No external deadline; the slim architecture
and migration progress are the point.

## 7. Risks

- **Phase 2 scope creep** is the top schedule risk — the ADR's full Phase 2
  includes CRUD/upload/scan; CE ports **reads only**. Hold that line; the
  timeboxed fallback is the backstop.
- **Sync-render DoS**: mitigated by the semaphore + nginx rate limits + #882's
  413 budget; verify under parallel load in the smoke test.
- **BSON PascalCase** coupling between .NET-era seed tooling and motor models —
  spiked day 1 by design.
- **Dual read-implementations** (.NET keeps `DiscoveryController` for the main
  app while Python serves CE): accepted temporarily; recipe/availability
  bugfixes must land in Python first, .NET only if the main app needs them —
  Python is the future, .NET is legacy.
- **Open HIGH findings #1572 (IDOR) / #1574 (auth bypass)**: CE's
  deny-by-default Python surface sidesteps the .NET territory these live in,
  but re-check both against the CE deployment before announcement.
- **PR #1619 drift**: merge against .NET soon (it's finished) so the CE
  frontend work builds on the post-split file layout.
