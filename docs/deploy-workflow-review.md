# Deploy Workflow Review

**Status**: Decided — 2026-04-24. Closes #652.
**Scope**: Choose a production deploy workflow for the v1 Community Edition
release (epic #1403 — CE deploy readiness). Revisit the choices here when
the triggers noted in each section fire.

This doc is a decision log, not a runbook. For the runbook, see
[`deployment.md`](deployment.md).

## Context

JWST is a solo-dev passion project. The target production footprint is
**one VPS** (t3.medium-equivalent, 2 vCPU / 4 GB RAM) running the full Docker
Compose stack. Expected users at v1 launch: tens, not thousands. MongoDB is
schema-less; the only "migrations" to date have been additive field changes
that old readers ignore.

Given that profile, the default bias here is **minimum viable, easy to reverse,
boring**. Fancy deploy machinery (blue-green, canaries, auto-rollback) costs
more to maintain than it saves at this scale — and every hour spent on deploy
theater is an hour not spent on compositing, UX, or actually shipping.

## Summary of decisions

| Area | Decision | Revisit when |
|---|---|---|
| Promote main → staging | **Manual** (`staging.sh promote`) | Shipping daily from multiple contributors |
| Environment branches | **Keep `main` + `staging`. No `production` branch.** Prod deploys from a signed tag on `main`. | Two+ active prod environments (e.g. EU region) |
| Rollback | **Documented manual procedure**: revert to previous tag + `docker compose up --build` + optional `restore-mongo.sh` | A deploy breaks prod in a way the docs didn't anticipate |
| Blue-green / rolling | **No.** Single-node stop-the-world deploy. Target <90s downtime. | Any SLO tighter than "best effort" |
| DB migrations | **None needed** (MongoDB + additive-only changes). Pattern documented for future breaking changes. | First non-additive schema change |

## 1. Auto-promote vs manual promote (main → staging)

**Current**: Manual. `./scripts/staging.sh promote` fast-forwards `staging` to
`origin/main`, then `./scripts/staging.sh deploy` SSHes in and rebuilds.

**Options considered**:

- **A. Keep manual.** Author decides when a merge is staging-ready. Staging
  serves as a human-curated integration point.
- **B. Auto-promote on merge to main** via GitHub Actions — any `main` push
  fast-forwards `staging` and triggers a deploy.
- **C. Auto-promote only passing tags.** Deploy when a release tag is cut.

**Decision: A (manual).**

**Why**:
- Solo dev — there is no coordination problem to solve.
- Staging's job today is to smoke-test real-world behaviour (large FITS, S3
  creds, TLS) against real infra. Auto-promote is cheap only if staging is
  cheap to break; ours is sometimes in the middle of a manual test run.
- The `promote` + `deploy` split already gives the same ergonomics as an auto
  workflow without the CI complexity or the "who broke staging" ambiguity.

**Revisit when**: more than one person merges to main regularly, OR staging
stops being a place where the author actively drives through flows.

## 2. Environment branches

**Current**: `main` (truth) and `staging` (deploy pointer, fast-forwarded from
main). No `production` branch — prod is deployed from whatever commit
`server-setup-prod.sh` last pulled.

**Options considered**:

- **A. Keep main + staging, deploy prod from tags.** Cut `v1.x.y` on main,
  prod deploys that tag.
- **B. Add a `production` branch** that prod pulls from. Promote staging →
  production the same way we promote main → staging.
- **C. Single-branch (main only).** Prod and staging both track main.

**Decision: A.** Keep `main` + `staging`. Introduce signed release tags on
`main` for prod (`v1.0.0`, `v1.0.1`, …) when the tag/release workflow
(#277) lands. `server-setup-prod.sh` currently does `git pull`; update it
to `git checkout <tag>` once tags exist.

**Why**:
- The `production` branch in (B) adds ceremony with no new guarantee — it's
  another pointer that has to be kept honest. Tags are the same pointer with
  git-native semantics (immutable, signable, releasable).
- (C) lets any main merge hit prod without a curated staging pass. No.

**Revisit when**: a second prod environment appears (EU region, dedicated
customer instance), at which point per-env branches or Terraform workspaces
start paying for themselves.

**Follow-up tracked**: tag-cutting workflow is not yet scripted — see
Follow-ups below.

## 3. Rollback

**Current**: Implicit. `server-setup-prod.sh` is idempotent — re-running it
pulls the latest `main` and rebuilds. There is no written rollback procedure.

**Decision**: Document a manual rollback procedure; no automation.

**Procedure** (also in [`deployment.md`](deployment.md#rollback-procedure)):

```bash
# On prod host
cd ~/jwst-app
git fetch origin --tags

# Pick ONE of the next two commands.
#
# Preferred: roll back to a previous release tag (requires #277 to have shipped).
git checkout <previous-tag>            # e.g. v1.0.3 if v1.0.4 broke
#
# Until #277 ships there are no release tags — use a commit SHA instead.
# Find it with: git log --oneline -20
git checkout <previous-commit-sha>

cd docker
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# If the bad deploy corrupted data, also restore the last known-good MongoDB backup:
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop backend
~/jwst-app/scripts/restore-mongo.sh ~/jwst-backups/<last-known-good>.archive.gz
docker compose -f docker-compose.yml -f docker-compose.prod.yml start backend
```

> ⚠ **Do not re-run `server-setup-prod.sh` after a rollback.** It does
> `git reset --hard origin/main` and will re-deploy the broken version.
> `restore-mongo.sh` also refuses to proceed while `backend` is connected
> unless you type the explicit override — see the restore procedure for
> its safety prompts.

**Why no automation**:
- Auto-rollback needs a success signal that is more reliable than the thing
  being deployed. We don't have one — only `processing-engine` and
  `mast-proxy` have Docker healthchecks today; `backend`, `frontend`, and
  `mongodb` have none. The services most likely to break a deploy are
  exactly the ones without a signal.
- Building that signal + a rollback harness is a week of work that buys
  nothing until we've actually had a production rollback needed. Solo-dev
  passion-project risk budget says: do it once, by hand, then script what hurt.

**Revisit when**: a real prod rollback is needed and the manual procedure
takes longer than 10 minutes end-to-end.

## 4. Blue-green / rolling deployment

**Current**: `docker compose up --build` replaces containers in place.
`restart: unless-stopped` means a failed container is retried until it
starts or is manually fixed. Estimated user-visible downtime during a
deploy: 30–90s (image build + container swap). *Not yet measured — record
the first prod deploy timing and update this number.*

**Options considered**:

- **A. Keep stop-the-world deploy.**
- **B. Blue-green on a single host** (two compose stacks on different ports,
  nginx flips upstream).
- **C. Second EC2 instance + ALB** for true blue-green.

**Decision: A.**

**Why**:
- Target users (v1) are a small community. 90s of downtime during an
  off-peak deploy is acceptable. Document the expected window; pick an
  off-peak time.
- (B) doubles the RAM footprint on a 4 GB box and adds nginx config flipping
  logic. Not worth it until we're on a 16 GB host.
- (C) doubles infra cost and brings ALB ($16/mo minimum) into the picture.
  Revisit only with a real uptime SLO.

**Revisit when**: we publish an SLO, OR downtime during a deploy causes a
user-reported incident.

## 5. Database migration strategy

**Current**: None. All schema changes to date have been additive (new fields,
ignored by older readers). MongoDB is schema-less and no explicit migration
tool is in the repo.

**Decision**: Continue additive-only by convention. Document the pattern for
the first breaking change, don't build it until needed.

**Pattern for future breaking changes** (to be added to
`docs/standards/` when first used):

1. **Dual-write**: write both the old and the new field/shape from the new
   code. Old readers still work.
2. **Backfill**: one-shot script (under `scripts/migrations/`, directory to
   be created when first used) that reads all documents and fills in the
   new shape from the old.
3. **Cut over reads**: switch readers to the new shape.
4. **Drop old writes**: remove the dual-write.
5. **Drop old field**: second one-shot script, run after at least one full
   backup cycle.

Each step is a separate PR. `backup-mongo.sh` runs before each migration
script.

**Why not adopt a migration tool now**: MongoDB migration tooling (mongock,
migrate-mongo) buys ordering and history tracking. We have neither problem
yet — no ordering conflicts (one dev) and the history is `git log`.

**Revisit when**: the first non-additive change is needed, OR multiple devs
are making schema changes concurrently.

## Follow-ups

These came out of the review and are filed (or should be filed) separately:

- **Tagged-release workflow** — GitHub Action that cuts a tag from main,
  builds a CHANGELOG, and (later) triggers a prod deploy. Already tracked
  as #277. Until this ships, the §3 rollback uses commit SHAs instead of
  tags.
- **Deploy via GitHub Actions** (SSH + compose rebuild) — listed in
  `deployment.md`'s "Future Improvements" section. Still deferred.
- **CloudWatch dashboards / alarms** — #646 already tracks this for post-CE.
- **Backup-failure notification channel** — #1409 already tracks this.
- **Quarterly restore drill** — #1408 already tracks this.
- **Terraform/IaC** — listed in `deployment.md`'s "Future Improvements".
  Still deferred.

## Why this doc is short

A deploy-workflow review for a project with one host, one dev, and zero
users today does not need a 30-page runbook. The job is to make the choices
explicitly so future-us (and anyone else who picks this up) knows *why* we
didn't build the fancy thing, and what signal would change the answer.
