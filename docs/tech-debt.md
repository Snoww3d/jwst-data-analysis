# Tech Debt Tracking

> **Active tracking has moved to [GitHub Issues](https://github.com/Snoww3d/jwst-data-analysis/issues?q=is%3Aissue+label%3Atech-debt).** This document is a historical reference. To file new tech debt, [create a GitHub Issue](https://github.com/Snoww3d/jwst-data-analysis/issues/new?template=tech_debt.md) with the `tech-debt` label.

## Summary

| Status                        | Count   |
| ----------------------------- | ------- |
| **Resolved**                  | 53      |
| **Moved to bugs.md**          | 3       |
| **Migrated to GitHub Issues** | 38      |

> **Code Style Suppressions (2026-02-03)**: Items #77-#87 track StyleCop/CodeAnalysis rule suppressions in `.editorconfig`. Lower priority but tracked for future cleanup.

> **Security Audit (2026-02-02)**: Comprehensive audit identified 18 security issues (#50-#67). Most critical/high items now resolved.

---

## Resolved Tasks (53)

### Quick Reference

| #   | Description                                             | PR                   | Notes                                               |
| --- | ------------------------------------------------------- | -------------------- | --------------------------------------------------- |
| 1   | Path Traversal in Preview Endpoint                      | PR #26               |                                                     |
| 2   | Memory Exhaustion in File Download                      | PR #27               |                                                     |
| 3   | Regex Injection in MongoDB Search                       | PR #28               |                                                     |
| 4   | Path Traversal in Export Endpoint                       | PR #29               |                                                     |
| 5   | N+1 Query in Export Endpoint                            | PR #30               |                                                     |
| 6   | Duplicated Import Code in MastController                | PR #31               |                                                     |
| 7   | Missing Frontend TypeScript Types                       | PR #32               |                                                     |
| 8   | Hardcoded API URLs in Frontend                          | PR #33               |                                                     |
| 9   | Statistics Query Loads All Documents                    | PR #34               |                                                     |
| 10  | Missing MongoDB Indexes                                 | PR #35               |                                                     |
| 11  | File Extension Validation Bypass                        | PR #36               |                                                     |
| 12  | Centralized API Service Layer                           | PR #37               |                                                     |
| 15  | Download Job Cleanup Timer                              | PR #46               |                                                     |
| 16  | Missing Magma/Inferno Colormaps                         | PR #45               |                                                     |
| 17  | Stretched Histogram Panel Drag UX                       | PR #86               |                                                     |
| 18  | Remove Hardcoded Credentials                            | Previously completed |                                                     |
| 19  | Configure CORS for Production                           | PR #78               |                                                     |
| 20  | Add Rate Limiting                                       | PR #79               |                                                     |
| 21  | Create Public README.md                                 | Previously completed |                                                     |
| 22  | Add LICENSE File                                        | Previously completed |                                                     |
| 23  | Add CONTRIBUTING.md and Community Files                 | Previously completed |                                                     |
| 24  | Add GitHub Issue and PR Templates                       | PR #80               |                                                     |
| 25  | Separate Dev/Prod Docker Configs                        | PR #81               |                                                     |
| 26  | Add GitHub Actions CI/CD Pipeline                       | Previously completed |                                                     |
| 28  | Add Linting and Formatting Configurations               | PR #83               |                                                     |
| 29  | Enable Dependabot                                       | Previously completed |                                                     |
| 35  | Review and Clean Git History                            | Gitleaks scan: clean |                                                     |
| 38  | Refactor MongoDBService for Dependency Injection        | PR #93               |                                                     |
| 39  | Implement Playwright E2E Testing                        | PR #85               |                                                     |
| 45  | Add Mandatory Documentation Updates to Workflows        | Direct commit        |                                                     |
| 47  | Fix GetSearchCountAsync Incomplete Filter Logic         | PR #95               |                                                     |
| 50  | Exposed MongoDB Password in Repository                  | Verified             | FALSE POSITIVE - never committed                    |
| 51  | Path Traversal via obsId Parameter                      | PR #108              | Added regex validation + defense-in-depth           |
| 52  | SSRF Risk in MAST URL Construction                      | PR #110              | Added URI validation + 38 security tests            |
| 53  | Path Traversal in Chunked Downloader Filename           | PR #112              | Added filename sanitization + 23 security tests     |
| 54  | Missing HTTPS/TLS Enforcement                           | PR #113              | nginx TLS termination, security headers             |
| 55  | Missing Authentication on All API Endpoints             | PR #117              | JWT Bearer auth with role-based access              |
| 56  | Unbounded Memory Allocation in FITS Processing          | PR #124              | Two-layer validation, HTTP 413 responses            |
| 57  | Missing Input Validation on Numeric Parameters          | Resolved             | Whitelist + range checks on all endpoints           |
| 58  | Docker Containers Run as Root                           | Resolved             | Non-root USER in all 4 Dockerfiles                  |
| 59  | MongoDB Port Exposed to Host Network                    | Resolved             | All ports bound to 127.0.0.1                        |
| 62  | Unspecified Docker Image Versions                       | Resolved             | All images pinned to specific versions              |
| 63  | Missing Security Headers in nginx                       | PR #113              | Fixed alongside Task #54                            |
| 72  | Frontend Authentication UI                              | PR #131              | AuthContext, login/register, JWT, ProtectedRoute    |
| 73  | Anonymous Users Can Access All Non-Archived Data        | Resolved             | Public-only access for anonymous users              |
| 74  | Anonymous Download/Query Endpoints Leak Private Data    | Resolved             | IsDataAccessible + FilterAccessibleData checks      |
| 75  | Missing Access Filtering on User-Scoped Queries         | Resolved             | Owner restriction + post-filtering on all endpoints |
| 88  | Token Refresh Failure Logs User Out Instead of Retrying | PR #171              | Retry with backoff (3 attempts)                     |
| 90  | Disable Seed Users in Production                        | PR #176              | SeedDataService with SeedingSettings config         |
| 91  | Incomplete Downloads Panel Not Visible After Cancel     | PR #176              | refreshResumableJobs() on modal close               |
| 92  | Mosaic Wizard Export Button Cut Off                     | PR #176              | Merged duplicate CSS rules                          |
| 77  | SA1202 - Public Members Before Private Members          | PR #209              | Reordered all backend files                         |
| 78  | SA1204 - Static Members Before Non-Static Members       | PR #209              | Reordered all backend files                         |
| 94  | Fix E2E CI Job Docker Stack Permissions                 | PR #236              | mkdir + chmod data dir, include override compose    |

### Moved to bugs.md

| #   | Description                              |
| --- | ---------------------------------------- |
| 60  | Unsafe URL Construction in Frontend      |
| 65  | Information Disclosure in Error Messages |
| 66  | Race Condition in Download Resume        |

### Previously Resolved Security Issues (Cross-Reference)

These early security issues were addressed in earlier PRs but may warrant re-review given later audit findings:

| #   | Description                        | PR     | Notes                        |
| --- | ---------------------------------- | ------ | ---------------------------- |
| 1   | Path Traversal in Preview Endpoint | PR #26 | Different location than #51  |
| 3   | Regex Injection in MongoDB Search  | PR #28 | Verify fix complete          |
| 4   | Path Traversal in Export Endpoint  | PR #29 | Different location than #51  |
| 19  | Configure CORS for Production      | PR #78 | May need header restrictions |

---

## Adding New Tech Debt

New tech debt is now tracked via [GitHub Issues](https://github.com/Snoww3d/jwst-data-analysis/issues/new?template=tech_debt.md) with the `tech-debt` label.
