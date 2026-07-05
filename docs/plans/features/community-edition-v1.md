# Community Edition (v1) — Definition & Build Plan

**Status:** Draft — pending `/plan-ceo-review` + `/plan-eng-review`
**Date:** 2026-07-05
**Supersedes:** the "Community Edition — 'JWST Wallpapers'" section of `docs/development-plan.md` (lines ~227–280), which describes an abandoned architecture (`community/` monorepo dir + Next.js/Vercel). That section should be replaced with a pointer here (Phase 0 task).
**Related:** epic #1403, #1617 (PR #1619), ADR 0001, `docs/deploy-workflow-review.md`

---

## 1. What Community Edition IS

A **public, anonymous, read-only instance** of the existing app on a ~4 GB VPS
(Hetzner/DigitalOcean), deployed with Docker Compose, with **pre-seeded FITS
data** for a curated set of featured targets.

The product is the output image: a stranger lands on Discover, picks a target,
and produces a gorgeous JWST composite in a few clicks — no account, no signup,
no MAST token, no waiting on downloads.

**The CE golden path** (`/` → `/target/:name` → `/create`) **already works
anonymously today:**

- 49 backend endpoints are `[AllowAnonymous]`, including all MAST/discovery
  searches and the synchronous composite generate/estimate/analyze endpoints
  (`CompositeController.cs:39,149,341`, `MosaicController.cs:43`).
- `GuidedCreate.tsx:369–374`: when all recipe data exists locally
  (`needsDownload.length === 0`), the wizard skips the download step — the only
  auth-gated step — and goes straight to the anonymous sync composite path.
- `MongoDBService.GetAccessibleDataAsync` (`MongoDBService.cs:880–916`) already
  serves `IsPublic=true` data to anonymous users, covered by the
  `SetupAnonymousUser` test suite.

CE is therefore mostly a **packaging and curation exercise**, not a build.

## 2. What CE is NOT

- **No accounts.** No login, register, email, password reset, admin. Nobody is
  ever issued a token.
- **No visitor writes.** No MAST imports, uploads, deletes, renames, library
  mutations, or async job queue. `[Authorize]` endpoints stay authorized and
  simply return 401 forever.
- **No .NET auth changes.** Auth middleware stays exactly as-is.
- **Not the v2 auth/email work.** #456, #457, #461, #640–#643, #647 move out of
  the CE epic to the v2 milestone (they were in #1403's original body, written
  before the 2026-04-15 "no auth" decision).

## 3. Architecture decision

Three approaches were adversarially reviewed (2026-07-05 ultraplan workflow):

| Option | Verdict | Why rejected |
|---|---|---|
| **A — auto-login seed user** | 3/10 REJECT | "Everyone on the internet is silently logged in as the same shared mutable account." Opens imports/writes/deletes/job-queue to the world; any visitor can delete the curated seed data; requires relaxing the `SeedDataService.cs:40–44` prod block; untested N-clients-1-user regime (refresh-token races); 100% of the work lands in the .NET tier ADR 0001 Phase 6 deletes. |
| **B — strip auth via CE flag** | 3/10 REJECT | Solves a solved problem (golden path is already anonymous) while world-exposing exactly the surfaces auth protects, with open HIGH findings #1572 (IDOR) and #1574 (auth bypass) in that territory. All flag plumbing is .NET throwaway. |
| **C — ship on Python backend first (ADR 0001)** | 4/10 REJECT as stated | Strategically correct end-state, but migration progress is exactly Phase 0 (empty routers). Gating CE on new persistence + jobs + an early frontend cutover (the ADR's own riskiest step) blows the ship window. Salvageable later as a read-only Phase-2 slice = v1.1 footprint reduction. |

**Chosen: Option D — "auth on, nobody logs in."** Ship on the current stack's
existing anonymous mode. Pre-seed `jwst_data` as `IsPublic=true / UserId=null`.
Frontend gets a cosmetic `VITE_CE_MODE` flag. Security is enforced server-side
(401s) and at the nginx ingress, not by hiding UI. Backend diff ≈ zero, which
also makes CE **migration-proof**: nothing CE ships is invalidated when the
.NET gateway is eventually deleted.

## 4. Build plan

### Phase 0 — Scope & triage (no code)

- [ ] Replace the stale CE section in `docs/development-plan.md` with a pointer here.
- [ ] Rewrite epic #1403's body to this scope. Move the auth/email cluster
      (#456, #457, #461, #640, #641, #642, #643, #647) to a v2 milestone.
- [ ] Re-triage remaining .NET-specific config children: #1042, #1043, #1361,
      #746 — mark post-CE / migration-superseded (CE needs none of them; the
      JWT startup check `Program.cs:72–80` is satisfied by a generated
      throwaway `Jwt__SecretKey` in the CE `.env`, which `server-setup.sh`
      already knows how to generate).
- [ ] Keep in scope: #651 (Docker network isolation), #745 (resource limits) —
      both fold into Phase 3's compose work.

### Phase 1 — Land #1617 (PR #1619), CE-amended

PR #1619 (MAST search → public `/archive` route, 48 files, 3 clean review
rounds) is already written. Amend before merge: in CE mode the import pill is
**hidden/disabled**, not login-gated (imports are the one capability CE must
not advertise). Merging first also avoids landing the CE flag in files the
split is about to move. #1618 (Search→Library fold) stays follow-up, not a CE
blocker.

### Phase 2 — `VITE_CE_MODE` frontend flag + stranger-proofing

One flag, build-time, no forked branch:

- [ ] Hide `/login`, `/register` routes and `UserMenu` (`App.tsx:74–75`,
      `SharedLayout.tsx:52`); hide `ProtectedRoute` pages `/library`,
      `/composite`, `/mosaic` (`App.tsx:85–95`) — or make `/library` the
      local-only public view per #1617.
- [ ] Remove reachable "Sign In to Continue" states: seed-set completeness
      makes `GuidedCreate.tsx:1050–1081` unreachable, but hide it in CE anyway;
      RecipeCard "Login required" pill (`RecipeCard.tsx:91,144`); admin
      Re-index button (`SearchPage.tsx:111–120`); GuidedCreate Result-step
      "open in advanced editor" handoff to gated `/composite`
      (`GuidedCreate.tsx:1182–1202`).
- [ ] Fix empty states linking to auth-gated `/library`
      (`DiscoveryHome.tsx:110–118`, `TargetDetail.tsx:155–162`).
- [ ] De-jargon pass: `MastStatusPill` "MAST · online/offline", raw
      `NO_PRODUCTS:`/`S3_UNAVAILABLE:` error prefixes
      (`GuidedCreate.tsx:526–543`), SearchPage's FAISS/384-dim explainer.

### Phase 3 — CE compose overlay + 4 GB memory math + DoS guards

New `docker/docker-compose.ce.yml` on the staging pattern (nginx frontend as
the **only** published port, same-origin `/api` proxy):

- [ ] Processing engine: `mem_limit 2–2.5g`, `MAX_COMPOSITE_MEMORY_BYTES`
      ≈ 1.5e9 (the `.env.example` 2 GB row — the current `4g` on a 4 GB host
      is a footgun: zero headroom, host OOM-killer takes down Mongo).
- [ ] MongoDB: add `mem_limit` + `--wiredTigerCacheSizeGB 0.25–0.5` (currently
      unbounded everywhere).
- [ ] **Global concurrency cap on sync composite** — an `asyncio.Semaphore`
      (1–2 concurrent renders, queue-or-429) in the engine. The #882 memory
      budget is per-request; nothing bounds N parallel requests today. This is
      the one small backend code item and it's mandatory for any public deploy.
- [ ] nginx `limit_req`/`limit_conn` + request timeout on `/api`; block
      `/api/auth/*` at ingress (belt-and-suspenders).
- [ ] Exclude docs + SeaweedFS services; `STORAGE_PROVIDER=local`; swap enabled
      on host. Covers #745/#651.

### Phase 4 — Seed bundle (the one genuinely new build item)

- [ ] Script `seed-ce.sh`: run `scripts/prefetch-discovery.sh` against
      `featured-targets.json` (FITS into `/app/data`), then export a matching
      Mongo metadata archive (`IsPublic=true`, `UserId=null`; paths are
      container-relative `/app/data` so they transfer). Deliverable = tarball +
      `mongorestore` archive, or scripted post-deploy prefetch.
- [ ] **Completeness gate:** fail the seed build if any featured recipe still
      has `needsDownload > 0` — this is what guarantees no stranger ever sees
      a sign-in wall.
- [ ] Run the semantic-search embed batch during seeding so `/search` isn't
      cold ("0 indexed").
- [ ] Curate to VPS disk (dev `data/` is 170 GB; VPS ~100 GB — pick targets).

### Phase 5 — VPS deploy + smoke test

- [ ] Provision Hetzner/DO manually (`deploy-aws.sh` is EC2-specific;
      `server-setup.sh`'s clone/env-generate/compose-up bootstrap transfers
      almost verbatim — swap IMDS IP detection).
- [ ] TLS via the `server-setup-prod.sh` certbot pattern.
- [ ] Update ops docs: CE runbook section in `docs/deployment.md` (note: CE is
      re-seedable — "restore" = re-run the seed, no backup cron required;
      `Seeding__Enabled=false`, generated throwaway JWT secret).
- [ ] **Stranger smoke test** (replaces the epic's stale register→verify→login
      script): cold browser → Discover → pick target → create composite →
      download image → `/archive` search works → no sign-in wall anywhere →
      `curl` to import/jobs/admin endpoints returns 401/blocked → parallel
      composite requests get 429/queue, not OOM.

### Sequencing vs ADR 0001

CE ships on the current 3-service stack **without adding to it** — no new .NET
code paths beyond the engine semaphore. The migration continues independently;
a read-only Python Phase-2 slice later becomes the v1.1 footprint reduction
(drops .NET + a few hundred MB from the box). One gotcha recorded for that
future work: `jwst_data` BSON is **PascalCase** (no `BsonElement` attributes,
no camelCase convention pack) — Python motor/pydantic models must alias fields
or the seed tooling must normalize casing.

## 5. Effort estimate

| Phase | Size |
|---|---|
| 0 Scope/triage | hours |
| 1 Land #1619 amended | days (PR exists) |
| 2 CE flag + stranger-proofing | 2–4 days |
| 3 Compose + memory + DoS guards | 2–3 days |
| 4 Seed bundle | 3–5 days (new tooling + curation) |
| 5 Deploy + smoke | 2–3 days |

**≈ 2–3 weeks** solo, sequential — well inside a 4–6 week window, vs. 3–6
weeks of new backend code before CE work even starts under the Python-first
option.

## 6. Risks

- **Sync-render DoS** is the top risk of any no-auth deploy — mitigated by the
  Phase 3 semaphore + nginx rate limits + #882's 413 budget; verify under
  parallel load in the smoke test.
- **Open HIGH findings #1572 (IDOR) / #1574 (auth bypass)**: CE's
  anonymous-only, public-data-only posture shrinks the exposed surface, but
  both should be re-checked against the CE deployment before announcement.
- **Seed/metadata path coupling**: `FilePath` values must match the seeded
  volume layout exactly — the completeness gate catches this.
- **PR #1619 drift**: built on "import requires login"; the CE amendment must
  land before merge or the public `/archive` import pill regresses.
