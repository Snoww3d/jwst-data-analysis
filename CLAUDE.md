# CLAUDE.md

Claude Code specific guidance for this repository.

> Shared process, workflow, coding standards, and project context live in `AGENTS.md`.
> Read `AGENTS.md` first — it is authoritative. If this file conflicts, follow `AGENTS.md`.

## Claude Code Tips

### Branch-First Reminder

Before using the Edit or Write tools, always confirm you're on a feature branch — not `main`. Run `git status` first.

### Pre-PR

- Always run `/compliance-check` before finalizing PRs.
- Prettier may need a second pass — run formatting before committing.

### Vitest Mock Hoisting

Fix mock hoisting issues systematically rather than iterating blindly.

## Skills

Skills are quick utility commands. Located in `~/.claude/commands/`.

| Skill | Purpose |
| :--- | :--- |
| `/start-application` | Start the full Docker stack |
| `/view-docs` | Open documentation site in browser |
| `/keybindings-help` | Customize keyboard shortcuts |
| `/compliance-check` | Run all quality checks before PR merge |

## Task Tracking

Use Claude Code's task system for tracking work items, tech debt, and multi-step implementations.

**Storage**: `~/.claude/tasks/<session-id>/*.json` (persists across sessions)

**When to use tasks**:
- Tech debt and bug tracking (with dependencies)
- Multi-step implementations
- Code review findings
- Any work that spans multiple sessions

### Task → PR Workflow

```bash
# 1. Start task
TaskUpdate taskId="1" status="in_progress"

# 2. Create feature branch
git checkout -b fix/task-1-description   # or feature/task-N-...

# 3. Make changes and commit
git add <files>
git commit -m "fix: Description (Task #1)"

# 4. Push and create PR
git push -u origin fix/task-1-description
gh pr create --title "fix: Description (Task #1)" --body "..."

# 5. Execute test plan (REQUIRED before user review)
# - Run ALL items in the PR's test plan using Docker environment
# - Document results (pass/fail) for each test item
# - If a test item CANNOT be executed, clearly note this

# 6. Wait for CI, open PR for user review
gh pr checks <pr-number>
gh pr view <pr-number> --web
# STOP: Report PR URL, CI status, test results, wait for user approval

# 7. After user approves: merge
gh pr merge <pr-number> --merge --delete-branch

# 8. Mark task complete
TaskUpdate taskId="1" status="completed"

# 9. Cleanup
git checkout main && git pull
git fetch --prune
```

### Task Structure

```json
{
  "id": "1",
  "subject": "Brief title",
  "description": "Full details with **Location**, **Issue**, **Fix**",
  "status": "pending|in_progress|completed",
  "blocks": ["2"],
  "blockedBy": ["3"],
  "metadata": { "priority": "critical", "category": "security" }
}
```

**Current tech debt**: See `docs/tech-debt.md` for full details, run `/tasks` for status.

## Editor

- **Primary Editor**: Google Antigravity IDE
- **Command**: `agy` (opens the current workspace)

## MCP Server Security Policy

This project does NOT require any MCP servers for its core functionality.

| Policy | Rule |
|--------|------|
| **No MCP server installation** | `mcp-add`, `mcp-config-set` permissions are explicitly denied in `.claude/settings.local.json` |
| **No credential embedding** | Never store API tokens, passwords, or secrets in MCP config files. Use Docker secrets or environment variables |
| **Approved MCP tools only** | If MCP tools are needed in future, they must be explicitly documented here and added to settings.local.json |

**If you need MCP servers** (e.g., for MongoDB management via MCP_DOCKER):
1. Document the specific tools required and their purpose
2. Add only the minimum required tool permissions to `.claude/settings.local.json`
3. Store any credentials using Docker secrets:
   ```bash
   docker mcp secret set SECRET_NAME
   ```
4. Reference secrets in config instead of embedding values

**Currently Approved MCP Tools**: None (project uses direct API calls and Docker Compose services)

## Capturing Ideas & Random Thoughts

**Storage**: All ideas go into [`docs/feature-ideas.md`](docs/feature-ideas.md)

**From Claude Code**: Simply ask: "Add this to feature ideas: [your idea]"

**From Phone** (GitHub Mobile/Web):
1. Open GitHub app → Navigate to `docs/feature-ideas.md`
2. Tap "Edit" → Add your idea at the bottom
3. Commit on a docs branch and open a PR (do not commit directly to `main`)

**From Desktop** (Scripts):
```bash
./scripts/quick-idea.sh "Add spectral line detection tool"   # Quick one-liner
./scripts/add-idea.sh                                         # Interactive
```

See [`docs/idea-capture-guide.md`](docs/idea-capture-guide.md) for the comprehensive guide.

## Cloud / Phone Sessions

This project is sometimes accessed from **cloud Claude Code sessions** (e.g., phone). These sessions have access to the full repo context but **do not** have local skills (`/compliance-check`, etc.) or Docker.

### Critical Rule: Always Commit and Push

Cloud sessions are ephemeral — **any uncommitted changes are lost when the session ends**. After editing any file:

```bash
git add <files>
git commit -m "docs: <description>"
git checkout -b docs/<short-name>
git push -u origin docs/<short-name>
gh pr create --title "docs: <description>" --body "Docs-only update from phone"
gh pr merge --merge --delete-branch
```

### Quick Capture Commands

**Add a tech debt item** — append to `docs/tech-debt.md` under "Remaining Tasks", using the next available task number. Format:

```markdown
### {N}. {Title}
**Priority**: {Critical|High|Medium|Low|Nice to Have}
**Location**: `{file path}`
**Category**: {Category}

**Issue**: {Description}

**Fix Approach**:
1. {Step}

---
```

**Add a feature idea** — append to `docs/feature-ideas.md` under "Submitted Ideas".

**Add a bug** — append to `docs/bugs.md`.

### What Cloud Sessions Cannot Do

- Run Docker or local services
- Execute custom skills (`/start-application`, etc.)
- Access agent worktrees
- Run tests (no Docker = no test environment)

Stick to documentation edits, idea capture, and planning work.

## Known Issues / Tech Debt

See [`docs/tech-debt.md`](docs/tech-debt.md) for the authoritative list.

**Quick stats**: 53 resolved | 35 remaining (as of 2026-02-07)
