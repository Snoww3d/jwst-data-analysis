# Scripts Directory

Utility scripts for JWST Data Analysis project development and maintenance.

## Idea Capture

### `add-idea.sh`
Interactive script for adding detailed feature ideas with full metadata.

```bash
./scripts/add-idea.sh
```

Prompts for:
- Idea name
- Category (UI/UX, Scientific, Performance, etc.)
- Priority (Low/Medium/High)
- Description
- Use case
- Technical notes

### `quick-idea.sh`
Quick one-liner for capturing ideas fast.

```bash
# As argument
./scripts/quick-idea.sh "Your idea here"

# From stdin
echo "Your idea" | ./scripts/quick-idea.sh

# Multi-line
./scripts/quick-idea.sh << EOF
Your multi-line
idea here
EOF
```

See [`docs/idea-capture-guide.md`](../docs/idea-capture-guide.md) for complete documentation.

---

## Docker Utilities

### `agent-docker.sh`
Manage isolated Docker stacks for parallel agent development.

```bash
./scripts/agent-docker.sh up 1       # Start Agent 1's stack
./scripts/agent-docker.sh down 2     # Stop Agent 2's stack
./scripts/agent-docker.sh logs 1     # Tail Agent 1's logs
./scripts/agent-docker.sh restart 1  # Rebuild and restart
./scripts/agent-docker.sh exec 1 processing python -m pytest  # Run tests
```

See [AGENTS.md](../AGENTS.md) for shared workflow policy and isolated Docker stack details.

### `agent-env-init.sh`
Generate `.env.agent*` files for agent Docker stacks.

```bash
./scripts/agent-env-init.sh
```

---

## Git Utilities

### `setup-hooks.sh`
Install git hooks (pre-push hook prevents direct pushes to main).

```bash
./scripts/setup-hooks.sh
```

---

## Documentation Utilities

### `check-docs-consistency.sh`
Validate shared documentation consistency and portability.

```bash
./scripts/check-docs-consistency.sh
```

Checks include:
- No machine-specific absolute paths in shared docs
- No assistant-specific workflow command leakage in shared docs
- README React version aligned with frontend package version
- Python version requirements aligned between setup and quick reference
- `docs/tech-debt.md` remaining-count consistency
- Development phase status alignment between roadmap docs

### `public-preflight.sh`
Run a strict preflight audit before considering public visibility for the repository.

```bash
./scripts/public-preflight.sh
```

Checks include:
- Presence of public baseline files (`README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`)
- Detection of tracked/internal agentic files in working tree and git history
- Detection of absolute local filesystem path leaks
- Detection of absolute symlink targets
- Detection of tracked runtime `.env` files
- Secret scanning via `gitleaks` (working tree + full history)
- Warnings for internal-doc references and non-noreply author emails
- Detection of large tracked files (>1 MB) that inflate clone size
- Scan for TODO/FIXME/HACK comments that may contain internal context

### `validate-pr.sh`
Validate PR title, body, and branch name against the same rules used in CI. Reuses `.github/scripts/validate-pr.js` so local and CI checks never drift.

```bash
# Validate the PR for the current branch
./scripts/validate-pr.sh

# Validate a specific PR by number
./scripts/validate-pr.sh 238

# Validate before creating a PR (dry-run)
./scripts/validate-pr.sh --title "fix: resolve issue" --body-file /tmp/body.md --branch fix/my-fix
```

---

## Browser Automation

### `capture-screenshots.sh`
Capture documentation screenshots of the running application using playwright-cli.

```bash
# Headless (default)
./scripts/capture-screenshots.sh

# Visible browser for debugging
./scripts/capture-screenshots.sh --headed
```

Prerequisites:
- `playwright-cli` installed globally: `npm install -g @playwright/cli@latest`
- Docker stack running: `cd docker && docker compose up -d`

Captures:
- Login page → `docs/images/screenshot-login.png`
- Dashboard (authenticated) → `docs/images/screenshot-dashboard.png`

The script automatically registers a temporary user and injects auth tokens for authenticated screenshots.

---

## Adding New Scripts

When adding new scripts:

1. **Make executable**: `chmod +x scripts/your-script.sh`
2. **Add documentation**: Update this README
3. **Follow conventions**:
   - Use bash shebang: `#!/bin/bash`
   - Add usage comment at top
   - Use colors for output (GREEN, BLUE, YELLOW, NC)
   - Include error handling
4. **Test thoroughly**: Try edge cases
5. **Update docs**: Update `AGENTS.md` for shared workflow-impacting scripts

---

## Script Templates

### Basic Script Template

```bash
#!/bin/bash
# Description: What this script does
# Usage: ./scripts/my-script.sh [args]

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check prerequisites
if ! command -v some-tool &> /dev/null; then
    echo -e "${RED}Error: some-tool is not installed${NC}"
    exit 1
fi

# Main logic
echo -e "${BLUE}Starting...${NC}"
# ... do stuff ...
echo -e "${GREEN}✓ Done!${NC}"
```

### Script with Arguments

```bash
#!/bin/bash
# Usage: ./scripts/my-script.sh <arg1> [arg2]

if [ $# -lt 1 ]; then
    echo "Usage: $0 <arg1> [arg2]"
    exit 1
fi

ARG1="$1"
ARG2="${2:-default_value}"

# ... use $ARG1 and $ARG2 ...
```

---

## Contributing

When contributing new scripts:
- Follow existing patterns
- Add clear documentation
- Test on your local environment
- Consider cross-platform compatibility
- Add error handling for common failures
