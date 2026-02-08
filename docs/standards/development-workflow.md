# Development Workflow Rules

## Source of Truth

- Shared agent workflow rules are defined in `AGENTS.md`.
- Use this file for repository-level workflow details and executable command patterns.

## Git Management

- Use a branch for every change (including docs-only updates).
- Open a PR for every branch.
- Never push directly to `main`.
- Follow conventional commit messages.
- Keep commits atomic and focused.

## Standard Workflows

### 1. Feature Work

1. Create branch: `git checkout -b feature/<short-name>`
2. Implement and update relevant docs
3. Run checks (lint/tests, and Docker verification when integration is affected)
4. Commit and push
5. Open PR and wait for review/CI
6. Merge after maintainer approval

### 2. Bug Fixes

1. Create branch: `git checkout -b fix/<short-name>`
2. Reproduce and fix
3. Add/adjust tests
4. Update `docs/bugs.md` when tracking changes are needed
5. Commit, push, and open PR

### 3. Tech Debt

1. Pick an item from `docs/tech-debt.md`
2. Create branch: `git checkout -b refactor/task-<N>-<short-name>`
3. Implement and verify
4. Update `docs/tech-debt.md` status/details
5. Commit, push, and open PR

## Useful Repository Scripts

- `./scripts/setup-hooks.sh` - Install local git hooks
- `./scripts/agent-docker.sh` - Manage isolated Docker stacks
- `./scripts/quick-idea.sh` - Capture quick feature ideas
- `./scripts/add-idea.sh` - Capture structured feature ideas

## Development Phases

Current focus: Phase 4/5 transition (advanced frontend capabilities complete; additional processing algorithms and queueing remain in progress).

## Testing Strategy

- Implement unit tests for services and utilities
- Use integration tests for API endpoints
- Use end-to-end tests for critical UI flows
- Verify integration changes in Docker

## Code Quality

- Use linting and formatting tools
- Implement proper error handling
- Follow coding standards for each technology stack
- Favor strongly typed interfaces/models where possible

## Security Best Practices

- Never commit sensitive credentials
- Use environment variables for configuration
- Validate input and constrain file/path operations
- Run regular security reviews

## Documentation

- Keep `README.md` and setup docs current
- Document API/model/behavior changes in docs under `docs/`
- Keep roadmap and tracking docs synchronized with current status

## Deployment

- Use Docker for consistent environments
- Keep CI green before merge
- Use environment-specific configuration management
