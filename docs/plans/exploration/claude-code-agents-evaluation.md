# Claude Code Agents Evaluation

Evaluation of agents from [awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) for the JWST Data Analysis project.

> **Evaluated**: 2026-03-02 | **Source**: 128 agents across 10 categories | **Status**: Under review

---

## Agent File Format

Agents are plain `.md` files with YAML frontmatter. Install by copying to `~/.claude/agents/` (global) or `.claude/agents/` (project-local). Project-local takes precedence.

```yaml
---
name: agent-name
description: "Use when... (drives auto-selection)"
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet | opus | haiku
---
[System prompt with capabilities, workflow, communication protocol]
```

---

## Existing Project Automation

Before evaluating new agents, inventory of what we already have:

| Type | What | Location |
|------|------|----------|
| Skill | `interface-design` — craft-first UI design system | `.claude/skills/interface-design/` |
| Skill | `ux-designer` — expert UX/UI guidance | `.claude/skills/ux-designer/` |
| Command | `compliance-check` — 18+ pre-merge checks | `~/.claude/commands/compliance-check.md` |
| Command | `team` — multi-agent orchestration | `~/.claude/commands/team.md` |
| Command | `browser-debug` — Playwright debugging | `~/.claude/commands/browser-debug.md` |
| Command | `start-application` — Docker stack startup | `~/.claude/commands/start-application.md` |
| Command | `view-docs` — MkDocs viewer | `~/.claude/commands/view-docs.md` |
| Hook | `block-pr-merge.sh` — merge approval warning | `.claude/hooks/` |
| Hook | `block-push-merged-branch.sh` — prevent stale pushes | `.claude/hooks/` |
| Hook | `validate-before-pr-create.sh` — PR body validation | `.claude/hooks/` |
| Script | `agent-stack.sh` — isolated Docker stacks per agent | `scripts/` |
| Script | `validate-pr.sh` — local PR validation | `scripts/` |
| Script | `check-docs-consistency.sh` — doc vs code validation | `scripts/` |
| Memory | `MEMORY.md` — persistent project context, preferences, lessons | `~/.claude/projects/.../memory/` |

---

## Tier 1: High Value — Should Install

### security-auditor
- **Model:** Opus | **Tools:** Read, Grep, Glob (read-only)
- **What:** Comprehensive security audits — OWASP, access control, injection, IDOR, path traversal. Audits against SOC 2, ISO 27001, NIST frameworks.
- **Why for JWST:** We just completed a full security audit session (PR #564, 8 high-priority issues fixed, 7 new issues filed). A dedicated read-only security auditor would automate this. The read-only tool restriction is correct — auditors shouldn't modify the system they audit.
- **Replaces/Enhances:** New capability. Complements `docs/architecture/security-model.md`.
- **Customization needed:** Add JWST-specific context — MongoDB auth patterns, `CanModifyData`/`IsDataAccessible` helpers, the processing engine trust boundary, known gap issues.

### dotnet-core-expert
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** .NET 10 + C# 14, minimal APIs, AOT compilation, source generators, TestContainers. Targets cutting-edge .NET.
- **Why for JWST:** Our backend is .NET 10. This agent knows the exact version we use, vs the generic `csharp-developer` which targets .NET 8.
- **Replaces/Enhances:** New — specialized for our exact backend stack.
- **Customization needed:** Add project conventions — repository pattern, MongoDB service layer, ApiControllerBase helpers, our test patterns (xUnit + Moq + FluentAssertions).

### react-specialist
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** React 18+ optimization — React.memo, useMemo, useCallback, code splitting, virtual scrolling, concurrent features. Focused on improving *existing* React apps.
- **Why for JWST:** Frontend is mature React+TS. UI/UX is flagged as a major gap. This agent focuses on optimization, not greenfield — exactly what we need.
- **Replaces/Enhances:** Complements existing `ux-designer` skill (which handles design decisions, not code optimization).
- **Customization needed:** Add our component library (MUI), state management patterns, Vite config, E2E test awareness rules from MEMORY.md.

### docker-expert
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** Multi-stage builds, Alpine/distroless bases, image size reduction (<100MB), build cache optimization, Docker Scout, Compose Watch. Supply chain security (SBOM, image signing).
- **Why for JWST:** Docker disk bloat is a recurring problem (hit it again this session — 55GB used, engine wouldn't start). Build cache management, image pruning, and size optimization directly address this.
- **Replaces/Enhances:** New — addresses recurring pain point. MEMORY.md already has `--no-cache` rules but a dedicated agent would be more systematic.
- **Customization needed:** Add our Docker Compose structure (5 services), MongoDB crash-loop recovery pattern, agent-stack.sh port allocation rules.

### refactoring-specialist
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** Code smell detection, extract/inline/encapsulate operations, characterization tests (golden master), mutation testing, architecture layer extraction. Core constraint: "zero behavior changes verified."
- **Why for JWST:** Tech debt backlog has 20+ items. The zero-behavior-change constraint is valuable — refactoring should be safe and verifiable.
- **Replaces/Enhances:** New — useful for dedicated tech debt sprints.
- **Customization needed:** Add our test infrastructure (777 backend tests, 859 frontend tests), doc update rules from MEMORY.md.

### code-reviewer
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** Structured review: security first, then correctness, then quality. Cyclomatic complexity <10, >80% coverage checks. Constructive/mentoring feedback style.
- **Why for JWST:** MEMORY.md defines a deep self-review pipeline for feature PRs. This agent would formalize and enhance that process.
- **Replaces/Enhances:** Enhances the deep self-review pipeline. Could be restricted to read-only tools for pure review tasks.
- **Customization needed:** Add our review triggers (3+ layers, new endpoints, auth-adjacent code), the "fix ALL non-nit issues" rule, E2E test awareness checklist.

---

## Tier 2: Medium Value — Worth Having

### python-pro
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** Python 3.11+, FastAPI, async, scientific stack (numpy, scipy, astropy). Mypy strict, >90% pytest coverage.
- **Why for JWST:** Processing engine is Python/FastAPI with astropy, reproject, photutils. Scientific computing needs specialized knowledge.
- **Replaces/Enhances:** New — specialized for processing engine work.
- **Customization needed:** Add astropy/reproject patterns, FITS file handling, MastService conventions, the `docker exec` test pattern.

### test-automator
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** Test automation frameworks, E2E testing, CI/CD integration, <1% flaky rate target. Test data management.
- **Why for JWST:** E2E test stability has been a recurring issue (PR #563 was all E2E fixes). The E2E awareness checklist in MEMORY.md exists because of repeated breakage.
- **Replaces/Enhances:** Enhances E2E test awareness rules. Could own the Playwright test suite.
- **Customization needed:** Add Playwright patterns, our mock data shapes, the E2E pre-push checklist from MEMORY.md, CI check behavior (E2E not a required check).

### accessibility-tester
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** WCAG 2.1/3.0 AA compliance, screen reader testing, tab order, focus management, contrast ratios, cognitive accessibility, ARIA remediation.
- **Why for JWST:** UI/UX is the flagged major gap. When that workstream activates, accessibility should be part of the polish layer, not an afterthought. Portfolio piece needs this.
- **Replaces/Enhances:** Complements `ux-designer` and `interface-design` skills (which handle aesthetics, not accessibility compliance).
- **Customization needed:** Minimal — mostly generic WCAG rules. Add our component library (MUI) specifics.

### documentation-engineer
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** API docs, architecture guides, doc automation, code example validation, automated link checking. <2s load times, 100% API coverage.
- **Why for JWST:** We maintain 15+ architecture docs + MkDocs site. Doc drift is a real risk — the doc update rules in MEMORY.md exist because of it.
- **Replaces/Enhances:** Enhances `check-docs-consistency.sh`. Could automate the "when a PR adds a controller/endpoint, update these docs" rule.
- **Customization needed:** Add our doc structure, MkDocs config, the specific files to update per change type from MEMORY.md.

### performance-engineer
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** Load/stress testing, CPU/memory profiling, DB query optimization, CDN caching, horizontal/vertical scaling, APM integration, capacity planning.
- **Why for JWST:** Large FITS files (up to 2GB), mosaic generation, composite image processing — all performance-sensitive. As data grows, MongoDB queries will need optimization.
- **Replaces/Enhances:** New capability.
- **Customization needed:** Add FITS file size constraints, MongoDB query patterns, processing engine resource limits, Docker resource allocation.

### dependency-manager
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** Multi-ecosystem dependency management (npm, pip, NuGet). CVE scanning, supply chain analysis, automated PR creation for updates.
- **Why for JWST:** We manage 3 dependency ecosystems. Issue #449 (python-multipart vulnerability) was exactly this kind of catch — found during security audit, turned out to already be fixed.
- **Replaces/Enhances:** New — could automate dependency audits that currently happen ad-hoc.
- **Customization needed:** Add our package files (`package.json`, `requirements.txt`, `.csproj`), the Dependabot config.

### api-documenter
- **Model:** Sonnet | **Tools:** Read, Write, Edit, Bash, Glob, Grep
- **What:** OpenAPI 3.1 interactive docs portals, multi-language code examples, 100% endpoint coverage.
- **Why for JWST:** 85+ endpoints across 9 controllers. Interactive API docs would be valuable for community release (Reddit, portfolio piece goal).
- **Replaces/Enhances:** Enhances `docs/quick-reference.md` with auto-generated, always-accurate API docs.
- **Customization needed:** Add our controller structure, auth patterns (JWT Bearer, AllowAnonymous), the security model.

---

## Tier 3: Situationally Useful

| Agent | Model | When to use |
|-------|-------|-------------|
| **database-optimizer** | Sonnet | When MongoDB queries slow down with growing data. Knows MongoDB indexing, aggregation pipeline optimization. |
| **build-engineer** | Haiku | When build times become a bottleneck. Haiku keeps cost low for this mechanical task. |
| **mcp-developer** | Sonnet | If building a JWST data MCP server for AI-powered astronomy queries — interesting for community release. |
| **dx-optimizer** | Sonnet | For developer workflow improvements — HMR speed, test execution time, pre-commit hook optimization. |
| **debugger** | Sonnet | For systematic debugging of complex cross-service issues (e.g., .NET -> Python -> MongoDB chains). |

---

## Not Relevant (128 total, ~80 skipped)

- **All PowerShell agents** (10) — Windows-only
- **All non-JS/TS/Python/.NET language specialists** (~15) — wrong stack
- **Domain-specific** (blockchain, fintech, game, IoT, embedded, WordPress, SEO, payments, quant) — wrong domain
- **Business agents** (sales-engineer, customer-success, scrum-master, content-marketer) — solo developer
- **Enterprise infrastructure** (Kubernetes, Terraform, cloud-architect, network-engineer) — premature for Docker Compose stage
- **Orchestration agents** (context-manager, agent-organizer, task-distributor) — existing `/team` command + MEMORY.md covers this with project-specific knowledge

---

## Patterns Worth Adopting (even without installing agents)

### 1. Read-Only Tools for Review Agents
The `security-auditor` uses only `Read, Grep, Glob` — no Write/Edit/Bash. Our deep review pipeline should enforce this: review agents shouldn't have write access during the review phase.

**Action:** When spawning review agents in the self-review pipeline, use a custom agent definition with restricted tools.

### 2. Model Tiering by Task Complexity
- **Opus** for security/architecture decisions (security-auditor, code-reviewer on auth code)
- **Sonnet** for standard development work
- **Haiku** for mechanical/high-frequency tasks (compliance-check, build validation, dependency audits)

**Action:** Switch `compliance-check` to use Haiku. Use Haiku for routine file searches in team mode. Reserve Opus for security reviews.

### 3. Mandatory Context Loading
Many agents start by reading project context (architecture, patterns, constraints) before doing anything.

**Action:** All project agents should start by reading: `docs/architecture/security-model.md`, `docs/key-files.md`, `docs/standards/backend-development.md`, and relevant `MEMORY.md` sections.

### 4. Tool Restriction as Security Control
Agents that shouldn't modify code get read-only tools. Agents that shouldn't access the network don't get WebFetch/WebSearch.

**Action:** Define tool sets per task type:
- **Review:** `Read, Grep, Glob` only
- **Research:** `Read, Grep, Glob, WebFetch, WebSearch`
- **Implementation:** `Read, Write, Edit, Bash, Glob, Grep`
- **Documentation:** `Read, Write, Edit, Glob, Grep` (no Bash)

---

## Installation Priority

If installing in batches:

1. **Batch 1 (immediate):** `security-auditor`, `code-reviewer`, `docker-expert`
   - Addresses active pain points (security review, PR review, Docker bloat)

2. **Batch 2 (when starting UI/UX workstream):** `react-specialist`, `accessibility-tester`
   - Needed when UI/UX moves from "want to improve" to active workstream

3. **Batch 3 (for tech debt sprints):** `refactoring-specialist`, `dotnet-core-expert`, `python-pro`
   - Specialized agents for dedicated cleanup work

4. **Batch 4 (for community release prep):** `api-documenter`, `documentation-engineer`, `performance-engineer`
   - Polish and documentation for public release

---

## Next Steps

- [ ] Review this evaluation and decide on Batch 1 installation
- [ ] Customize selected agents with JWST-specific context before installing
- [ ] Define read-only agent definitions for the self-review pipeline
- [ ] Evaluate model tiering cost savings (Haiku for compliance-check, etc.)
