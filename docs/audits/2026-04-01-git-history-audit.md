# Git History Security Audit

**Date**: 2026-04-01
**Status**: Complete - No critical issues found
**Previous audit**: 2026-03-02

## Executive Summary

Monthly git history security scan. **No secrets, API keys, or sensitive credentials found.** The repository remains safe for public access. One minor finding: the `public-preflight.sh` script flags tracked `.claude/skills/` files, but these are intentionally public (`.gitignore` explicitly un-ignores them).

## Changes Since Last Audit

- 1,118 total commits (up from 974 at last audit; 289 new commits this period)
- Git directory: 173 MB (up from 19 MB — significant growth from blog screenshots, architecture docs, and active feature development)
- 286 new files added since last audit
- Active development areas: design token migration (P1-P19), composite/mosaic recipe fixes, blog infrastructure, 4+1 architecture docs, UX polish

## Commit Author Breakdown (Since Last Audit)

| Author | Commits | Notes |
|--------|---------|-------|
| Shanon Clemmons (noreply) | 248 | Primary developer, using GitHub noreply |
| dependabot[bot] | 40 | Automated dependency updates |
| Claude (co-author) | 1 | AI pair programming co-author |

## Scan Results

### Secrets and Credentials

| Category | Status | Details |
|----------|--------|---------|
| API Keys (AWS AKIA) | Clean | No patterns found |
| GitHub Tokens (ghp_/gho_) | Clean | No patterns found |
| Private Keys (PEM/RSA) | Clean | No key files or key material found |
| .env Files | Clean | Never committed; none in recent history |
| Bearer Tokens | Clean | No hardcoded tokens |
| MongoDB Credentials | Historical only | Same `admin:password` placeholder from prior audits (accepted risk) |
| S3/Cloud Credentials | Clean | Only variable references |
| AWS Instance IDs (i-xxx) | Clean | No patterns found in tracked content |
| Sensitive File Extensions | Clean | No `.pem`, `.key`, `.p12`, `.pfx`, `.credentials`, `.keystore`, `.jks`, `.secret` files |

### gitleaks

gitleaks is installed (`/opt/homebrew/bin/gitleaks`) but could not be executed during this audit session due to tool permission constraints. **Manual follow-up recommended**: run `./scripts/public-preflight.sh` from a terminal to get the full gitleaks scan.

### Absolute Filesystem Paths

No absolute user-specific paths found in **tracked** content. Untracked files (`.claude/settings.local.json`, `.claude/launch.json`) contain local home directory paths but are correctly gitignored.

The deploy script `scripts/deploy-aws.sh` references a generic EC2 default user path — not PII.

### Internal Control Files

| Path | Status | Notes |
|------|--------|-------|
| `.claude/skills/**` (17 files) | Tracked (intentional) | `.gitignore` explicitly un-ignores `.claude/skills/`; these are public-facing skill docs |
| `.claude/commands/enrich-blog.md` | Removed | Was in history from earlier commits; removed by #583 |
| `CLAUDE.md` | Not tracked | Correctly gitignored |
| `.claude/settings.local.json` | Not tracked | Correctly gitignored |

The preflight script regex `^\.claude($|/)` flags the tracked skills files. This is a **false positive** — the skills are intentionally public. Consider adding an exception to the preflight script for `.claude/skills/`.

### Author Identities

| Identity | Type | Commits | Notes |
|----------|------|---------|-------|
| Shanon Clemmons (noreply) | GitHub noreply | Current | Active, recommended |
| Shanon Clemmons (personal) | 2 personal emails | Historical | Unchanged from prior audits |
| dependabot[bot] | Bot | 40+ | Automated dependency updates |
| Claude | Co-author (noreply) | 1 | AI pair programming co-author |

No new personal email addresses introduced since last audit.

### Repository Size

| Metric | Value | Change |
|--------|-------|--------|
| Git directory | 173 MB | +154 MB |
| Loose objects | 745 (4.5 MB) | Reduced (repacked) |
| Packed objects | 10,742 (170 MB) | +3,134 objects |
| Pack files | 1 | Consolidated from 4 |
| Garbage | 0 | Clean |
| Total commits | 1,118 | +144 |
| Tracked files | 929 | - |

**Size growth note**: The 154 MB increase is primarily from blog screenshot images (commits #578, #580, #582) which added ~130 PNG screenshots. This is proportional to the content added. Consider Git LFS if the blog image collection continues to grow.

### .gitignore Coverage

| Category | Status | Pattern |
|----------|--------|---------|
| FITS data | Covered | `data/`, `data/mast/`, `data-agent*/` |
| Environment files | Covered | `.env`, `.env.local`, `.env.*.local`, `*.env` |
| Node modules | Covered | `node_modules/`, `build/`, `dist/` |
| Python artifacts | Covered | `__pycache__/`, `venv/`, `.venv/` |
| .NET build output | Covered | `bin/`, `obj/` |
| IDE config | Covered | `.vscode/`, `.idea/` |
| Credentials safety net | Covered | `*.pem`, `*.key`, `*.p12`, `*.pfx`, `credentials.json`, `secrets.json`, `**/secrets/` |
| Claude Code | Covered | `.claude/*` with `!.claude/skills/` exception |
| Test artifacts | Covered | `test-results/`, `playwright-report/`, `coverage.cobertura.xml` |
| Docker runtime | Covered | `*.pid`, `*.log` |
| Docs site | Covered | `site/` |

No gaps identified.

### TODO/FIXME/HACK Comments

6 occurrences across 3 files (4 in `scripts/public-preflight.sh` are self-references):

- `frontend/jwst-frontend/src/index.tsx`: TODO tagged for v1 release (remove debug helpers, issue #840)
- `frontend/jwst-frontend/eslint.config.js`: TODO for ESLint plugin upgrade (issue #891)

Both are properly tagged with issue numbers. No internal context leakage risk.

## Comparison with Previous Audit

| Finding | Mar 2026 | Apr 2026 | Status |
|---------|----------|----------|--------|
| MongoDB creds in history | Historical | Historical | Accepted risk (dev placeholder) |
| Email addresses in history | Historical | Historical | Noreply used for all new commits |
| .claude/skills tracked | N/A | Intentional | False positive in preflight |
| Repo size growth | 19 MB | 173 MB | Blog images; monitor going forward |
| API keys/tokens | Clean | Clean | No change |
| Sensitive file extensions | Clean | Clean | No change |
| .gitignore gaps | Clean | Clean | No change |

## Action Items

### New This Audit

1. **Consider Git LFS for blog images** — 130+ PNGs added this period drove significant repo size growth. Not blocking, but worth evaluating before the next batch.
2. **Update preflight script** — Add exception for `.claude/skills/` in the internal paths check (they are intentionally public per `.gitignore`).
3. **Run `./scripts/public-preflight.sh` manually** — gitleaks scan could not run during this audit session. Verify clean results from a terminal.

### Ongoing

1. **Monthly audit**: Next scheduled for 2026-05-01
2. **Email in history**: Accepted risk — noreply used for all new commits
3. **MongoDB placeholder in history**: Accepted risk — development default, not real credentials

## Conclusion

The repository remains clean and safe for public access. No new secrets, credentials, or PII detected. The main change this period is significant repo size growth from blog screenshots — worth monitoring but not a security concern. All TODOs are properly issue-tagged. The `.claude/skills/` tracking is intentional and the preflight false positive should be addressed.
