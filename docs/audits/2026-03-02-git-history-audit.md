# Git History Security Audit

**Date**: 2026-03-02
**Status**: Complete - No critical issues found
**Previous audit**: 2026-01-31

## Executive Summary

Monthly git history security scan. **No secrets, API keys, or sensitive credentials found.** The repository remains safe for public access. All findings from the January audit have been addressed.

## Changes Since Last Audit

- 974 total commits (up from ~200 at last audit)
- Git directory: 19 MB (up from 1.8 MB — healthy growth from active development)
- MongoDB credentials fully externalized to `.env` (Task #18 complete)
- Author now using GitHub noreply address for new commits

## Scan Results

### Secrets and Credentials

| Category | Status | Details |
|----------|--------|---------|
| API Keys (AWS AKIA) | ✅ Clean | No patterns found |
| GitHub Tokens (ghp_/gho_) | ✅ Clean | No patterns found |
| Private Keys (PEM/RSA) | ✅ Clean | No key files or key material found |
| .env Files | ✅ Clean | Never committed |
| Bearer Tokens | ✅ Clean | No hardcoded tokens (only variable references) |
| MongoDB Credentials | ⚠️ Historical | `admin:password` placeholder in old docker-compose commits (see below) |
| S3/Cloud Credentials | ✅ Clean | Only `${VAR}` references, no hardcoded values |

### MongoDB Credential History

Old commits contain `mongodb://admin:password@mongodb:27017` — a development placeholder. Current docker-compose uses `${MONGO_ROOT_PASSWORD}` from `.env`. The history entries are:

- Not real credentials (intentional dev defaults)
- Documented in `.env.example` with `changeme_use_strong_password`
- Not worth a history rewrite — standard practice for development

### Sensitive File Extensions

No sensitive files (`.pem`, `.key`, `.p12`, `.pfx`, `.credentials`, `.keystore`, `.jks`, `.secret`) have ever been committed.

### Infrastructure Details in History

Staging deployment scripts reference generic patterns (`ec2-user@<PUBLIC_IP>`, `$STAGING_IP`) — no hardcoded IP addresses or key file paths in committed code. Staging connection details exist only in local config (CLAUDE.md, which is gitignored).

### Author Identities

| Identity | Type | Commits | Notes |
|----------|------|---------|-------|
| Shanon Clemmons (noreply) | GitHub noreply | Current | Active, recommended |
| Shanon Clemmons (personal) | 2 personal emails | Historical | In old commits, cannot be removed without history rewrite |
| dependabot[bot] | Bot | 60 | Automated dependency updates |
| Claude | Co-author | 3 | AI pair programming co-author |

**Note on personal emails**: Two personal email addresses appear in historical commits. These are inherent to git's design and cannot be removed without a full history rewrite (`git filter-repo`), which would invalidate all existing forks, PRs, and references. The GitHub noreply address is now used for all new commits. This is an acceptable tradeoff for a public repository.

### Repository Size

| Metric | Value |
|--------|-------|
| Git directory | 19 MB |
| Loose objects | 2,337 (11.18 MB) |
| Packed objects | 7,608 (6.31 MB) |
| Pack files | 4 |
| Garbage | 0 |
| Total commits | 974 |

No unusually large blobs or orphaned objects detected. Growth since last audit is proportional to development activity.

### .gitignore Coverage

| Category | Status | Pattern |
|----------|--------|---------|
| FITS data | ✅ | `data/`, `data/mast/`, `data-agent*/` |
| Environment files | ✅ | `.env`, `.env.local`, `.env.*.local`, `*.env` |
| Node modules | ✅ | `node_modules/`, `build/`, `dist/` |
| Python artifacts | ✅ | `__pycache__/`, `venv/`, `.venv/` |
| .NET build output | ✅ | `bin/`, `obj/` |
| IDE config | ✅ | `.vscode/`, `.idea/` |
| Credentials safety net | ✅ | `*.pem`, `*.key`, `*.p12`, `*.pfx`, `credentials.json`, `secrets.json`, `**/secrets/` |
| Claude Code | ✅ | `.claude/`, `CLAUDE.md` |
| Test artifacts | ✅ | `test-results/`, `playwright-report/`, `coverage.cobertura.xml` |
| Docker runtime | ✅ | `*.pid`, `*.log` |
| Docs site | ✅ | `site/` |

No gaps identified. The `.gitignore` has good defense-in-depth coverage.

## Comparison with Previous Audit

| Finding | Jan 2026 | Mar 2026 | Status |
|---------|----------|----------|--------|
| Hardcoded MongoDB creds | ⚠️ Active | ✅ Fixed | Externalized to `.env` |
| Email addresses in history | ⚠️ Exposed | ⚠️ Historical | Now using noreply for new commits |
| Large orphaned blobs | ✅ Cleaned | ✅ Clean | No new orphans |
| .gitignore gaps | ⚠️ Minor | ✅ Complete | All recommendations from Jan adopted |
| API keys/tokens | ✅ Clean | ✅ Clean | No change |

## Action Items

### Resolved Since Last Audit

1. ~~MongoDB credentials externalized~~ (Task #18 — complete)
2. ~~.gitignore additions~~ (`.env`, credentials safety net — complete)
3. ~~Switch to GitHub noreply email~~ (complete)

### Ongoing

1. **Monthly audit**: Next scheduled for 2026-04-01
2. **Email in history**: Accepted risk — noreply used for all new commits

## Conclusion

The repository remains clean and safe for public access. All action items from the January audit are resolved. No new security concerns identified.
