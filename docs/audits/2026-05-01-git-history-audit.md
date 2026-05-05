# Git History Security Audit

**Date**: 2026-05-01
**Status**: Complete — Medium/low findings only; no secrets or check bypasses
**Previous audit**: 2026-04-02 (PR #937)
**Next audit**: 2026-06-01

## Executive Summary

Monthly git history security scan for the window **2026-04-02 → 2026-05-01**. No secrets,
API keys, or plaintext credentials found. Two large PRs by line count exceed the 1,500-line
threshold and are flagged for future splitting guidance. The `public-preflight.sh` script
produced 3 FAIL / 4 WARN results; all are MEDIUM or lower in severity. No HIGH-priority
findings (no secrets leaked, no required-check bypasses).

## Window Statistics

| Metric | Value |
|--------|-------|
| Commits in window | 50 |
| PRs merged in window | 95 |
| Merge commits | 0 (squash-merge strategy — clean history) |
| Stale remote branches (>30 days, unmerged) | 0 (only `origin/main` exists) |
| Plaintext credentials in diffs | 0 |

## public-preflight.sh Results

Script: `scripts/public-preflight.sh` — **EXIT 1** (3 blocking, 4 warnings)

### FAIL 1 — `.claude/skills/` tracked files (INFO / false positive)

17 `.claude/skills/**` files flagged as "internal paths that should not be public."

**Status**: Accepted false positive — carried forward from April 2026 audit. `.gitignore`
explicitly un-ignores `.claude/skills/` because these are intentionally public skill docs.
Action item from April audit (add a preflight exception) remains open.

### FAIL 2 — Absolute user-specific filesystem paths (LOW)

Paths containing `/home/ec2-user/` detected in tracked content:

| File | Path | Introduced by |
|------|------|---------------|
| `scripts/deploy-aws.sh:245` | `touch /home/ec2-user/.docker-ready` | Pre-existing (accepted Apr audit) |
| `scripts/backup-mongo.sh:17` | cron comment with `/home/ec2-user/jwst-app/…` | PR #1412 (2026-04-23) |
| `docs/deployment.md:293` | cron example with `/home/ec2-user/jwst-app/…` | PR #1422 (2026-04-24) |
| `docs/plans/features/650-…:137` | same cron example | PR #1412 (2026-04-23) |
| `scripts/.sensitive-patterns.example:17-18` | `/Users/yourname/`, `/home/yourname/` | Example patterns — not real paths |

**Assessment**: `/home/ec2-user/` is the Amazon Linux 2 EC2 default username — it reveals
the target OS/platform but contains no personal information, credentials, or instance IDs.
The April 2026 audit accepted `deploy-aws.sh` under the same reasoning. The new occurrences
in `backup-mongo.sh` and `deployment.md` (from the production environment configuration PR)
are the same category. The `.sensitive-patterns.example` entries are intentional examples.

**Recommendation**: No immediate action required. If the project moves to a public mirror,
consider a sed pass to replace `/home/ec2-user/jwst-app/` with `<deploy-path>/` in doc
examples.

### FAIL 3 — `gitleaks` not installed (MEDIUM)

gitleaks is absent in this environment (was at `/opt/homebrew/bin/gitleaks` on macOS per
April audit; not present on this Linux host).

**Impact**: The automated secret-scanning step of preflight cannot complete. The manual
grep-based credential scan (see below) covered the audit window.

**Recommendation**: Install gitleaks on the CI runner or add `gitleaks/gitleaks-action` to
the GitHub Actions workflow so automated scanning runs on every PR.

### Warnings (carry-forward)

| Warning | Severity | Status |
|---------|----------|--------|
| Git history contains `.claude/skills/` paths | INFO | Same as FAIL 1 — intentional |
| Markdown docs reference internal/agentic files | INFO | Pre-existing, cosmetic |
| Tracked files >1 MB (47 blog/design images) | LOW | Pre-existing; Git LFS evaluation pending |
| 1 TODO in `eslint.config.js` (issue #891) | INFO | Properly issue-tagged; unchanged |

## Secrets and Credentials Scan

Manual diff scan covering all 50 commits in the window — grep for `password=`, `api_key=`,
`secret=`, `token=` patterns in added lines:

| Category | Result |
|----------|--------|
| Plaintext credential patterns in diffs | **CLEAN** — 0 matches |
| AWS AKIA key patterns | Clean |
| GitHub tokens (ghp_/gho_) | Clean |
| `.env` files committed | Clean — none |
| MongoDB credentials | Historical placeholder only (accepted prior audits) |

## Large PRs (>1,500 changed lines)

Measured by `git diff --shortstat` on the squash-merge commit; deps-only PRs excluded.

| PR | Title | Lines changed | Notes |
|----|-------|--------------|-------|
| #1415 | feat(design): import JWST Discovery Design System | +3,524 / −0 = **3,524** | Purely additive asset/token import; low review risk but large diff |
| #1206 | feat: smart auto-stretch with histogram analysis | +1,808 / −44 = **1,852** | Cross-cutting feature (backend + frontend); could have been split by layer |

Neither PR shows evidence of bypassed required checks. Flagging for future team guidance:
PRs >1,500 lines benefit from a pre-review split into logical layers (data, API, UI) to
reduce reviewer fatigue.

## Commit Churn — Top 10 Files

Files touched most often across the audit window (indicator of refactor pressure or
dependency noise):

| Touches | File |
|---------|------|
| 11 | `frontend/jwst-frontend/package.json` |
| 11 | `frontend/jwst-frontend/package-lock.json` |
| 10 | `processing-engine/requirements.txt` |
| 6 | `backend/JwstDataAnalysis.API/JwstDataAnalysis.API.csproj` |
| 4 | `processing-engine/app/composite/routes.py` |
| 4 | `processing-engine/app/composite/models.py` |
| 4 | `frontend/jwst-frontend/src/types/CompositeTypes.ts` |
| 4 | `frontend/jwst-frontend/src/services/compositeService.ts` |
| 4 | `frontend/jwst-frontend/src/services/compositeService.test.ts` |

The top 4 are dependency manifest files driven by the heavy Dependabot activity (62 of 95
PRs were dependency bumps). The composite-layer files reflect active feature work on the
NGC-3324 OOM / memory-budget feature (PRs #1440, #1442, #1443, #1452).

## Stale Branches

Remote branches older than 30 days that are not merged: **none**.

Only `origin/main` is present. All feature work is squash-merged and branches deleted.

## Comparison with April 2026 Audit

| Finding | Apr 2026 | May 2026 | Status |
|---------|----------|----------|--------|
| Secrets / credentials in diffs | Clean | Clean | No change |
| `.claude/skills/` false positive | Known | Known | Unchanged — preflight exception still pending |
| Absolute paths (`/home/ec2-user/`) | `deploy-aws.sh` only (accepted) | 3 additional files from #1412/#1422 | LOW — same category, recommend doc cleanup |
| `gitleaks` installed | macOS only | Not in this env | MEDIUM — add to CI |
| Large PRs (>1,500 lines) | N/A (no threshold check) | 2 (#1415, #1206) | New threshold; guidance to team |
| Stale branches | N/A | 0 | Clean |
| Repo size / large images | 173 MB, Git LFS pending | No new significant additions | Stable |
| TODO count | 6 (2 files) | 1 (eslint.config.js only — `index.tsx` TODO resolved by #1421) | Improved |

## Action Items

### New This Audit

1. **Add gitleaks to CI** (MEDIUM) — Install via `gitleaks/gitleaks-action` in the GitHub
   Actions PR workflow so secret scanning runs automatically without depending on a local
   binary. Fixes FAIL 3.

2. **Document large-PR splitting guidance** (LOW) — Add a note to `CONTRIBUTING.md` or the
   PR template recommending PRs >1,500 lines be split by architectural layer. Addresses the
   #1415 and #1206 findings going forward.

3. **Optionally parameterise EC2 paths in docs** (LOW) — Replace `/home/ec2-user/jwst-app/`
   in `backup-mongo.sh` and `deployment.md` examples with a placeholder variable if the repo
   moves to a public mirror. Not urgent.

### Carry-Forward (from April)

1. **Add `.claude/skills/` exception to `public-preflight.sh`** — Eliminates persistent
   false-positive FAIL.
2. **Evaluate Git LFS for blog images** — 47 tracked images >1 MB; deferred from April.
3. **Resolve ESLint TODO #891** — Properly tagged; no urgency.

## Conclusion

The repository remains clean and safe. No secrets, credentials, or PII were introduced in
the audit window. Active development (95 PRs, heavy dependency management, new design system
import, composite OOM feature) proceeded without introducing security regressions. The main
actionable items are adding gitleaks to CI (MEDIUM) and codifying large-PR splitting
guidance (LOW).
